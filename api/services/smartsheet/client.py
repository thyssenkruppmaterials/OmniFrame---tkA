"""SmartsheetService base class -- initialisation, auth, sheets, rows, and utilities."""

import asyncio
import logging
import time
from typing import Optional, Dict, List, Any

from concurrent.futures import ThreadPoolExecutor

import smartsheet
from smartsheet import Smartsheet
from cachetools import TTLCache
import httpx

try:
    from ...config.settings import settings
    from ...config.database import get_supabase_client
except ImportError:
    from config.settings import settings
    from config.database import get_supabase_client

from .mappers import (
    SmartsheetResponse,
    SheetSummary,
    CellData,
    RowData,
    ColumnData,
    SmartsheetConnectionError,
    SmartsheetRateLimitError,
    SmartsheetAuthenticationError,
)

logger = logging.getLogger(__name__)

_SMARTSHEET_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="smartsheet_")


class _SmartsheetBase:
    """Core SmartsheetService: singleton, connection, caching, rate-limiting,
    sheet / row CRUD, search, summary, and utility helpers.
    """

    _instance: Optional['_SmartsheetBase'] = None
    _lock = asyncio.Lock()

    def __init__(self):
        if type(self)._instance is not None:
            raise RuntimeError("Use get_instance() instead")

        self._client: Optional[Smartsheet] = None
        self._http_client: Optional[httpx.AsyncClient] = None

        self._response_cache = TTLCache(
            maxsize=1000,
            ttl=settings.smartsheet_cache_ttl
        )
        self._sheet_cache = TTLCache(
            maxsize=100,
            ttl=300
        )

        self._rate_limit_window = []
        self._rate_limit_lock = asyncio.Lock()
        self._connection_pool_size = settings.smartsheet_max_connections

        logger.info("SmartsheetService initialized")

    @classmethod
    async def get_instance(cls) -> '_SmartsheetBase':
        if cls._instance is None:
            async with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
                    await cls._instance._initialize()
        return cls._instance

    # ---- internal helpers ----------------------------------------------------

    async def _initialize(self):
        try:
            if not settings.smartsheet_access_token:
                raise SmartsheetConnectionError("Smartsheet access token not configured")

            logger.info("Initializing Smartsheet client with configured token")

            self._client = smartsheet.Smartsheet(
                access_token=settings.smartsheet_access_token
            )
            self._client.errors_as_exceptions(True)

            self._http_client = httpx.AsyncClient(
                timeout=httpx.Timeout(timeout=60.0),
                limits=httpx.Limits(
                    max_connections=self._connection_pool_size,
                    max_keepalive_connections=self._connection_pool_size // 2
                )
            )

            await self._test_connection()
            logger.info("Smartsheet client initialized successfully")

        except Exception as e:
            logger.error(f"Failed to initialize Smartsheet client: {str(e)}")
            raise SmartsheetConnectionError(f"Initialization failed: {str(e)}")

    async def _test_connection(self) -> bool:
        try:
            loop = asyncio.get_event_loop()
            current_user = await loop.run_in_executor(
                _SMARTSHEET_EXECUTOR,
                self._client.Users.get_current_user
            )
            logger.info(f"Connected to Smartsheet as user: {current_user.email}")
            return True
        except Exception as e:
            logger.error(f"Smartsheet connection test failed: {str(e)}")
            raise SmartsheetConnectionError(f"Connection test failed: {str(e)}")

    async def _rate_limit_check(self):
        async with self._rate_limit_lock:
            now = time.time()
            self._rate_limit_window = [
                t for t in self._rate_limit_window if now - t < 1.0
            ]
            if len(self._rate_limit_window) >= settings.smartsheet_rate_limit_per_second:
                sleep_time = 1.0 - (now - self._rate_limit_window[0])
                if sleep_time > 0:
                    logger.debug(f"Rate limit reached, sleeping for {sleep_time:.2f}s")
                    await asyncio.sleep(sleep_time)
            self._rate_limit_window.append(now)

    async def _handle_api_error(self, error: Exception) -> SmartsheetResponse:
        error_message = str(error)
        if "401" in error_message or "authentication" in error_message.lower():
            raise SmartsheetAuthenticationError(f"Authentication failed: {error_message}")
        elif "429" in error_message or "rate limit" in error_message.lower():
            raise SmartsheetRateLimitError(f"Rate limit exceeded: {error_message}")
        elif "network" in error_message.lower() or "connection" in error_message.lower():
            raise SmartsheetConnectionError(f"Connection error: {error_message}")
        else:
            logger.error(f"Smartsheet API error: {error_message}")
            return SmartsheetResponse(success=False, error=error_message)

    async def _log_activity(self, action: str, sheet_id: Optional[int] = None,
                           sheet_name: Optional[str] = None, details: Optional[Dict] = None,
                           status: str = "success", error_message: Optional[str] = None,
                           user_id: Optional[str] = None, organization_id: Optional[str] = None,
                           duration_ms: Optional[int] = None):
        """Fire-and-forget activity logging to smartsheet_activity_log."""
        try:
            activity_data = {
                "action": action,
                "sheet_id": sheet_id,
                "sheet_name": sheet_name,
                "details": details or {},
                "status": status,
                "error_message": error_message,
                "user_id": user_id,
                "organization_id": organization_id,
                "duration_ms": duration_ms
            }
            activity_data = {k: v for k, v in activity_data.items() if v is not None}

            try:
                client = await get_supabase_client()
                client.table('smartsheet_activity_log').insert(activity_data).execute()
                logger.debug(f"Smartsheet activity logged: {action} - {status}")
            except Exception as db_err:
                logger.warning(f"Failed to persist activity log to DB: {db_err}")
                logger.info(f"Smartsheet activity (fallback): {action} - {status}")

        except Exception as e:
            logger.error(f"Failed to log activity: {str(e)}")

    def _safe_dict_conversion(self, obj) -> Optional[Dict[str, Any]]:
        """Safely convert Smartsheet SDK objects to plain dicts."""
        try:
            if obj is None:
                return None
            if hasattr(obj, 'dict'):
                return obj.dict()
            elif hasattr(obj, 'to_dict'):
                return obj.to_dict()
            elif hasattr(obj, '__dict__'):
                result = {}
                for k, v in obj.__dict__.items():
                    if v is None:
                        result[k] = None
                    else:
                        try:
                            str_val = str(v)
                            result[k] = str_val if str_val is not None else repr(v)
                        except Exception:
                            result[k] = repr(v) if v is not None else None
                return result
            else:
                try:
                    str_val = str(obj)
                    return {"value": str_val if str_val is not None else repr(obj)}
                except Exception:
                    return {"value": repr(obj)}
        except Exception as e:
            logger.debug(f"Could not convert object to dict: {e}")
            return None

    # ---- connection / auth ---------------------------------------------------

    async def test_connection(self) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()
            loop = asyncio.get_event_loop()
            current_user = await loop.run_in_executor(
                _SMARTSHEET_EXECUTOR,
                self._client.Users.get_current_user
            )
            await self._log_activity("test_connection", details={
                "user_email": current_user.email,
                "user_id": current_user.id
            })
            return SmartsheetResponse(
                success=True,
                data={
                    "user_email": current_user.email,
                    "user_id": current_user.id,
                    "account": current_user.account,
                    "connection_status": "healthy"
                },
                message="Connection successful"
            )
        except Exception as e:
            await self._log_activity("test_connection", status="error", error_message=str(e))
            return await self._handle_api_error(e)

    async def get_current_user(self) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()
            loop = asyncio.get_event_loop()
            current_user = await loop.run_in_executor(
                _SMARTSHEET_EXECUTOR,
                self._client.Users.get_current_user
            )

            timezone_value = None
            try:
                timezone_value = str(current_user.timezone) if current_user.timezone else None
            except Exception as tz_error:
                logger.warning(f"Could not process timezone field: {tz_error}")

            locale_value = None
            try:
                locale_value = str(current_user.locale) if current_user.locale else None
            except Exception:
                pass

            profile_image_value = None
            try:
                profile_image_value = str(current_user.profile_image) if current_user.profile_image else None
            except Exception:
                pass

            account_value = self._safe_dict_conversion(current_user.account)

            return SmartsheetResponse(
                success=True,
                data={
                    "id": current_user.id,
                    "email": current_user.email,
                    "first_name": current_user.first_name,
                    "last_name": current_user.last_name,
                    "account": account_value,
                    "timezone": timezone_value,
                    "locale": locale_value,
                    "profile_image": profile_image_value
                }
            )
        except Exception as e:
            return await self._handle_api_error(e)

    # ---- sheet operations ----------------------------------------------------

    async def list_sheets(self, include_all: bool = True,
                         page_size: int = None) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            cache_key = f"sheets_list_{include_all}_{page_size}"
            if cache_key in self._response_cache:
                logger.debug("Returning cached sheets list")
                return self._response_cache[cache_key]

            page_size = page_size or settings.smartsheet_default_page_size

            loop = asyncio.get_event_loop()
            sheets_list = await loop.run_in_executor(
                _SMARTSHEET_EXECUTOR,
                lambda: self._client.Sheets.list_sheets(
                    include_all=include_all,
                    page_size=page_size
                )
            )

            sheets_data = []
            for sheet in sheets_list.data:
                access_level_value = None
                try:
                    access_level_value = str(sheet.access_level) if sheet.access_level else None
                except Exception as e:
                    logger.warning(f"Could not process access_level field: {e}")
                    access_level_value = "UNKNOWN"

                sheets_data.append(SheetSummary(
                    id=sheet.id,
                    name=sheet.name,
                    access_level=access_level_value,
                    created_at=sheet.created_at.isoformat() if sheet.created_at else None,
                    modified_at=sheet.modified_at.isoformat() if sheet.modified_at else None,
                    permalink=sheet.permalink,
                    version=sheet.version,
                    total_row_count=getattr(sheet, 'total_row_count', None)
                ).dict())

            response = SmartsheetResponse(
                success=True,
                data={
                    "sheets": sheets_data,
                    "total_count": len(sheets_data),
                    "page_number": sheets_list.page_number,
                    "page_size": sheets_list.page_size,
                    "total_pages": sheets_list.total_pages
                }
            )

            self._response_cache[cache_key] = response

            await self._log_activity("list_sheets", details={
                "count": len(sheets_data),
                "include_all": include_all
            })

            return response

        except Exception as e:
            await self._log_activity("list_sheets", status="error", error_message=str(e))
            return await self._handle_api_error(e)

    async def get_sheet(self, sheet_id: int, level: int = 2,
                       include: Optional[List[str]] = None) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            cache_key = f"sheet_{sheet_id}_{level}_{include}"
            if cache_key in self._sheet_cache:
                logger.debug(f"Returning cached sheet {sheet_id}")
                return self._sheet_cache[cache_key]

            include = include or ['attachments', 'discussions']

            loop = asyncio.get_event_loop()
            sheet = await loop.run_in_executor(
                _SMARTSHEET_EXECUTOR,
                lambda: self._client.Sheets.get_sheet(
                    sheet_id, level=level, include=include
                )
            )

            rows_data = []
            if hasattr(sheet, 'rows') and sheet.rows:
                for row in sheet.rows:
                    cells_data = []
                    if hasattr(row, 'cells') and row.cells:
                        for cell in row.cells:
                            hyperlink_data = None
                            try:
                                if cell.hyperlink:
                                    if hasattr(cell.hyperlink, 'dict'):
                                        hyperlink_data = cell.hyperlink.dict()
                                    else:
                                        hyperlink_data = {"url": str(cell.hyperlink)}
                            except Exception:
                                pass

                            link_in_data = None
                            try:
                                if cell.link_in_from_cell:
                                    if hasattr(cell.link_in_from_cell, 'dict'):
                                        link_in_data = cell.link_in_from_cell.dict()
                                    else:
                                        link_in_data = {"cell_id": str(cell.link_in_from_cell)}
                            except Exception:
                                pass

                            cells_data.append(CellData(
                                column_id=cell.column_id,
                                value=cell.value,
                                display_value=cell.display_value,
                                hyperlink=hyperlink_data,
                                link_in_from_cell=link_in_data
                            ).dict())

                    rows_data.append(RowData(
                        id=row.id,
                        row_number=row.row_number,
                        parent_id=row.parent_id,
                        sibling_id=row.sibling_id,
                        cells=cells_data,
                        created_at=row.created_at.isoformat() if row.created_at else None,
                        created_by=self._safe_dict_conversion(row.created_by),
                        modified_at=row.modified_at.isoformat() if row.modified_at else None,
                        modified_by=self._safe_dict_conversion(row.modified_by)
                    ).dict())

            columns_data = []
            if hasattr(sheet, 'columns') and sheet.columns:
                for column in sheet.columns:
                    column_type_value = None
                    try:
                        column_type_value = str(column.type) if column.type else 'TEXT_NUMBER'
                    except Exception as e:
                        logger.warning(f"Could not process column type field: {e}")
                        column_type_value = 'TEXT_NUMBER'

                    columns_data.append(ColumnData(
                        id=column.id,
                        index=column.index,
                        title=column.title,
                        type=column_type_value,
                        primary=column.primary or False,
                        validation=column.validation or False,
                        width=column.width,
                        locked=column.locked or False,
                        locked_for_user=column.locked_for_user or False
                    ).dict())

            access_level_value = None
            try:
                access_level_value = str(sheet.access_level) if sheet.access_level else None
            except Exception as e:
                logger.warning(f"Could not process access_level field: {e}")
                access_level_value = "UNKNOWN"

            sheet_data = {
                "id": sheet.id,
                "name": sheet.name,
                "access_level": access_level_value,
                "columns": columns_data,
                "rows": rows_data,
                "total_row_count": sheet.total_row_count,
                "created_at": sheet.created_at.isoformat() if sheet.created_at else None,
                "modified_at": sheet.modified_at.isoformat() if sheet.modified_at else None,
                "permalink": sheet.permalink,
                "version": sheet.version,
                "workspace": self._safe_dict_conversion(sheet.workspace) if sheet.workspace else None
            }

            response = SmartsheetResponse(success=True, data=sheet_data)
            self._sheet_cache[cache_key] = response

            await self._log_activity("get_sheet", sheet_id=sheet_id, sheet_name=sheet.name)
            return response

        except Exception as e:
            await self._log_activity("get_sheet", sheet_id=sheet_id, status="error", error_message=str(e))
            return await self._handle_api_error(e)

    async def create_sheet(self, name: str, columns: List[Dict[str, Any]]) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            sheet_spec = smartsheet.models.Sheet()
            sheet_spec.name = name
            sheet_spec.columns = []

            for col_data in columns:
                column = smartsheet.models.Column()
                column.title = col_data.get('title', 'Column')
                column.type = col_data.get('type', 'TEXT_NUMBER')
                column.primary = col_data.get('primary', False)
                column.width = col_data.get('width')
                sheet_spec.columns.append(column)

            result = self._client.Sheets.create_sheet(sheet_spec)

            self._response_cache.clear()
            self._sheet_cache.clear()

            await self._log_activity("create_sheet", sheet_id=result.result.id,
                                    sheet_name=name, details={"columns": len(columns)})

            return SmartsheetResponse(
                success=True,
                data={
                    "id": result.result.id,
                    "name": result.result.name,
                    "access_level": result.result.access_level,
                    "permalink": result.result.permalink
                },
                message="Sheet created successfully"
            )
        except Exception as e:
            await self._log_activity("create_sheet", sheet_name=name, status="error", error_message=str(e))
            return await self._handle_api_error(e)

    async def update_sheet(self, sheet_id: int, updates: Dict[str, Any]) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            sheet_update = smartsheet.models.Sheet()
            sheet_update.id = sheet_id

            if 'name' in updates:
                sheet_update.name = updates['name']

            result = self._client.Sheets.update_sheet(sheet_update)

            cache_keys_to_remove = [key for key in self._sheet_cache.keys() if f"sheet_{sheet_id}" in key]
            for key in cache_keys_to_remove:
                del self._sheet_cache[key]
            self._response_cache.clear()

            await self._log_activity("update_sheet", sheet_id=sheet_id, details=updates)

            return SmartsheetResponse(
                success=True,
                data={
                    "id": result.result.id,
                    "name": result.result.name,
                    "version": result.result.version
                },
                message="Sheet updated successfully"
            )
        except Exception as e:
            await self._log_activity("update_sheet", sheet_id=sheet_id, status="error", error_message=str(e))
            return await self._handle_api_error(e)

    async def delete_sheet(self, sheet_id: int) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            sheet_name = None
            try:
                sheet = self._client.Sheets.get_sheet(sheet_id, level=0)
                sheet_name = sheet.name
            except:
                pass

            self._client.Sheets.delete_sheet(sheet_id)

            cache_keys_to_remove = [key for key in self._sheet_cache.keys() if f"sheet_{sheet_id}" in key]
            for key in cache_keys_to_remove:
                del self._sheet_cache[key]
            self._response_cache.clear()

            await self._log_activity("delete_sheet", sheet_id=sheet_id, sheet_name=sheet_name)

            return SmartsheetResponse(success=True, message="Sheet deleted successfully")
        except Exception as e:
            await self._log_activity("delete_sheet", sheet_id=sheet_id, status="error", error_message=str(e))
            return await self._handle_api_error(e)

    # ---- row operations ------------------------------------------------------

    async def get_rows(self, sheet_id: int, page_size: int = None,
                      page: int = 1) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            page_size = page_size or settings.smartsheet_default_page_size

            loop = asyncio.get_event_loop()
            sheet = await loop.run_in_executor(
                _SMARTSHEET_EXECUTOR,
                lambda: self._client.Sheets.get_sheet(
                    sheet_id, level=2, page_size=page_size, page=page
                )
            )

            rows_data = []
            if hasattr(sheet, 'rows') and sheet.rows:
                for row in sheet.rows:
                    cells_data = []
                    if hasattr(row, 'cells') and row.cells:
                        for cell in row.cells:
                            cells_data.append(CellData(
                                column_id=cell.column_id,
                                value=cell.value,
                                display_value=cell.display_value
                            ).dict())

                    rows_data.append(RowData(
                        id=row.id,
                        row_number=row.row_number,
                        cells=cells_data,
                        created_at=row.created_at.isoformat() if hasattr(row, 'created_at') and row.created_at else None,
                        created_by=self._safe_dict_conversion(getattr(row, 'created_by', None)),
                        modified_at=row.modified_at.isoformat() if hasattr(row, 'modified_at') and row.modified_at else None,
                        modified_by=self._safe_dict_conversion(getattr(row, 'modified_by', None))
                    ).dict())

            await self._log_activity("get_rows", sheet_id=sheet_id, details={
                "page": page, "page_size": page_size, "rows_count": len(rows_data)
            })

            return SmartsheetResponse(
                success=True,
                data={
                    "rows": rows_data,
                    "total_count": sheet.total_row_count,
                    "page": page,
                    "page_size": page_size
                }
            )
        except Exception as e:
            await self._log_activity("get_rows", sheet_id=sheet_id, status="error", error_message=str(e))
            return await self._handle_api_error(e)

    async def update_cells(self, sheet_id: int, row_id: int,
                          cell_updates: List[Dict[str, Any]]) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            row = smartsheet.models.Row()
            row.id = row_id

            for cell_update in cell_updates:
                cell = smartsheet.models.Cell()
                cell.column_id = cell_update.get('column_id')
                cell.value = cell_update.get('value')

                if cell_update.get('clear_hyperlink'):
                    cell.hyperlink = smartsheet.models.ExplicitNull()
                elif cell_update.get('hyperlink'):
                    hyperlink = smartsheet.models.Hyperlink()
                    hyperlink.url = cell_update['hyperlink'].get('url')
                    hyperlink.report_id = cell_update['hyperlink'].get('report_id')
                    hyperlink.sheet_id = cell_update['hyperlink'].get('sheet_id')
                    cell.hyperlink = hyperlink

                row.cells.append(cell)

            response = self._client.Sheets.update_rows(sheet_id, [row])

            if response.request_response.status_code == 200:
                cache_keys_to_remove = [key for key in self._sheet_cache.keys() if f"sheet_{sheet_id}" in key]
                for key in cache_keys_to_remove:
                    del self._sheet_cache[key]
                logger.debug(f"Cleared {len(cache_keys_to_remove)} cache entries for sheet {sheet_id} after cell update")

                await self._log_activity("update_cells", sheet_id=sheet_id,
                                        details={"cells_updated": len(cell_updates), "row_id": row_id})

                return SmartsheetResponse(
                    success=True,
                    data={
                        "updated_cells": len(cell_updates),
                        "row_id": row_id,
                        "result": response.to_dict()
                    },
                    message=f"Successfully updated {len(cell_updates)} cells in row {row_id}"
                )
            else:
                raise Exception(f"Update failed with status: {response.request_response.status_code}")

        except Exception as e:
            await self._log_activity("update_cells", sheet_id=sheet_id,
                                    status="error", error_message=str(e), details={"row_id": row_id})
            return await self._handle_api_error(e)

    async def add_rows(self, sheet_id: int, rows_data: List[Dict[str, Any]],
                      location: Optional[str] = "toBottom") -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            rows = []
            for row_data in rows_data:
                row = smartsheet.models.Row()
                for cell_data in row_data.get('cells', []):
                    cell = smartsheet.models.Cell()
                    cell.column_id = cell_data.get('column_id')
                    cell.value = cell_data.get('value')
                    row.cells.append(cell)
                rows.append(row)

            location_params = {}
            if location == "toTop":
                location_params['to_top'] = True
            elif location == "toBottom":
                location_params['to_bottom'] = True

            response = self._client.Sheets.add_rows(sheet_id, rows, **location_params)

            if response.request_response.status_code == 200:
                cache_keys_to_remove = [key for key in self._sheet_cache.keys() if f"sheet_{sheet_id}" in key]
                for key in cache_keys_to_remove:
                    del self._sheet_cache[key]
                logger.debug(f"Cleared {len(cache_keys_to_remove)} cache entries for sheet {sheet_id} after adding rows")

                await self._log_activity("add_rows", sheet_id=sheet_id,
                                        details={"rows_added": len(rows_data)})

                return SmartsheetResponse(
                    success=True,
                    data={
                        "rows_added": len(rows_data),
                        "result": response.to_dict()
                    },
                    message=f"Successfully added {len(rows_data)} rows"
                )
            else:
                raise Exception(f"Add rows failed with status: {response.request_response.status_code}")

        except Exception as e:
            await self._log_activity("add_rows", sheet_id=sheet_id, status="error", error_message=str(e))
            return await self._handle_api_error(e)

    # ---- search / summary ----------------------------------------------------

    async def search_sheets(self, query: str, scope: str = 'workspace') -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            sheets_response = await self.list_sheets()
            if not sheets_response.success:
                return sheets_response

            filtered_sheets = [
                s for s in sheets_response.data['sheets']
                if query.lower() in s['name'].lower()
            ]

            await self._log_activity("search_sheets", details={
                "query": query, "scope": scope, "results_count": len(filtered_sheets)
            })

            return SmartsheetResponse(
                success=True,
                data={"sheets": filtered_sheets, "query": query, "total_count": len(filtered_sheets)}
            )
        except Exception as e:
            await self._log_activity("search_sheets", status="error", error_message=str(e))
            return await self._handle_api_error(e)

    async def get_sheet_summary(self, sheet_id: int) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            sheet = self._client.Sheets.get_sheet(sheet_id, level=2)

            total_rows = sheet.total_row_count or 0
            total_columns = len(sheet.columns) if sheet.columns else 0

            non_empty_cells = 0
            if hasattr(sheet, 'rows') and sheet.rows:
                for row in sheet.rows:
                    if hasattr(row, 'cells') and row.cells:
                        for cell in row.cells:
                            if cell.value is not None and cell.value != "":
                                non_empty_cells += 1

            summary = {
                "sheet_id": sheet.id,
                "sheet_name": sheet.name,
                "total_rows": total_rows,
                "total_columns": total_columns,
                "non_empty_cells": non_empty_cells,
                "last_modified": sheet.modified_at.isoformat() if sheet.modified_at else None,
                "version": sheet.version,
                "access_level": sheet.access_level
            }

            await self._log_activity("get_sheet_summary", sheet_id=sheet_id, sheet_name=sheet.name)

            return SmartsheetResponse(success=True, data=summary)
        except Exception as e:
            await self._log_activity("get_sheet_summary", sheet_id=sheet_id, status="error", error_message=str(e))
            return await self._handle_api_error(e)

    # ---- cleanup -------------------------------------------------------------

    async def close(self):
        try:
            if self._http_client:
                await self._http_client.aclose()
            self._response_cache.clear()
            self._sheet_cache.clear()
            logger.info("SmartsheetService cleanup completed")
        except Exception as e:
            logger.error(f"Error during SmartsheetService cleanup: {str(e)}")

    def __del__(self):
        try:
            if self._http_client and not self._http_client.is_closed:
                asyncio.create_task(self._http_client.aclose())
        except:
            pass

# Developer and Creator: Jai Singh
