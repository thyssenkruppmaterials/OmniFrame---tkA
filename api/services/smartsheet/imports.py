# Created and developed by Jai Singh
"""Ticket / data-import mixin for SmartsheetService."""

import logging
from typing import Optional, Dict, Any

from .mappers import SmartsheetResponse

logger = logging.getLogger(__name__)


class _ImportsMixin:
    """Ticket-management and data-import methods.

    Mixed into the final ``SmartsheetService`` class so that ``self`` has
    access to sheet / row / attachment / discussion helpers from other mixins.
    """

    async def get_tickets_by_customer(self, customer_id: Optional[str] = None,
                                     email: Optional[str] = None,
                                     ticket_sheet_id: int = 2987059899748228) -> SmartsheetResponse:
        """Get all tickets for a customer by customer_id or email."""
        try:
            await self._rate_limit_check()

            sheet_response = await self.get_sheet(ticket_sheet_id, level=2, include=['discussions', 'attachments'])

            if not sheet_response.success:
                return sheet_response

            sheet_data = sheet_response.data
            rows = sheet_data.get('rows', [])

            filtered_rows = []
            for row in rows:
                cells = row.get('cells', [])

                match = False
                for cell in cells:
                    value = str(cell.get('value') or cell.get('display_value') or '').lower()

                    if customer_id and customer_id.lower() in value:
                        match = True
                        break
                    elif email and email.lower() in value:
                        match = True
                        break

                if match:
                    filtered_rows.append(row)

            await self._log_activity("get_tickets_by_customer", sheet_id=ticket_sheet_id,
                                    details={"customer_id": customer_id, "email": email, "count": len(filtered_rows)})

            return SmartsheetResponse(
                success=True,
                data={
                    "sheet_id": ticket_sheet_id,
                    "tickets": filtered_rows,
                    "columns": sheet_data.get('columns', []),
                    "total_count": len(filtered_rows)
                },
                message=f"Found {len(filtered_rows)} tickets"
            )

        except Exception as e:
            await self._log_activity("get_tickets_by_customer", sheet_id=ticket_sheet_id,
                                    status="error", error_message=str(e))
            return await self._handle_api_error(e)

    async def create_ticket(self, ticket_data: Dict[str, Any],
                          ticket_sheet_id: int = 2987059899748228) -> SmartsheetResponse:
        """Create a new ticket in the Smartsheet."""
        try:
            await self._rate_limit_check()

            sheet_response = await self.get_sheet(ticket_sheet_id, level=1)
            if not sheet_response.success:
                return sheet_response

            rows_data = [{
                'cells': ticket_data.get('cells', [])
            }]

            result = await self.add_rows(ticket_sheet_id, rows_data, location="toBottom")

            if result.success:
                await self._log_activity("create_ticket", sheet_id=ticket_sheet_id,
                                        details={"ticket_data": ticket_data})

            return result

        except Exception as e:
            await self._log_activity("create_ticket", sheet_id=ticket_sheet_id,
                                    status="error", error_message=str(e))
            return await self._handle_api_error(e)

    async def get_ticket_by_row_id(self, row_id: int,
                                   ticket_sheet_id: int = 2987059899748228) -> SmartsheetResponse:
        """Get a specific ticket by row ID with all details."""
        try:
            await self._rate_limit_check()

            sheet_response = await self.get_sheet(ticket_sheet_id, level=2, include=['discussions', 'attachments'])

            if not sheet_response.success:
                return sheet_response

            sheet_data = sheet_response.data
            rows = sheet_data.get('rows', [])

            ticket_row = None
            for row in rows:
                if row.get('id') == row_id:
                    ticket_row = row
                    break

            if not ticket_row:
                return SmartsheetResponse(
                    success=False,
                    error=f"Ticket with row ID {row_id} not found"
                )

            discussions_response = await self.list_row_discussions(ticket_sheet_id, row_id)
            discussions = discussions_response.data.get('discussions', []) if discussions_response.success else []

            attachments_response = await self.list_row_attachments(ticket_sheet_id, row_id)
            attachments = attachments_response.data.get('attachments', []) if attachments_response.success else []

            ticket_row['discussions'] = discussions
            ticket_row['attachments'] = attachments

            await self._log_activity("get_ticket_by_row_id", sheet_id=ticket_sheet_id,
                                    details={"row_id": row_id})

            return SmartsheetResponse(
                success=True,
                data={
                    "ticket": ticket_row,
                    "columns": sheet_data.get('columns', []),
                    "sheet_id": ticket_sheet_id
                },
                message="Ticket retrieved successfully"
            )

        except Exception as e:
            await self._log_activity("get_ticket_by_row_id", sheet_id=ticket_sheet_id,
                                    status="error", error_message=str(e), details={"row_id": row_id})
            return await self._handle_api_error(e)

    async def update_ticket_status(self, row_id: int, status: str,
                                   ticket_sheet_id: int = 2987059899748228,
                                   column_id: Optional[int] = None) -> SmartsheetResponse:
        """Update ticket status."""
        try:
            await self._rate_limit_check()

            if not column_id:
                sheet_response = await self.get_sheet(ticket_sheet_id, level=1)
                if not sheet_response.success:
                    return sheet_response

                columns = sheet_response.data.get('columns', [])
                for col in columns:
                    if col.get('title', '').lower() == 'status':
                        column_id = col.get('id')
                        break

                if not column_id:
                    return SmartsheetResponse(
                        success=False,
                        error="Status column not found in sheet"
                    )

            cell_updates = [{'column_id': column_id, 'value': status}]
            result = await self.update_cells(ticket_sheet_id, row_id, cell_updates)

            if result.success:
                await self._log_activity("update_ticket_status", sheet_id=ticket_sheet_id,
                                        details={"row_id": row_id, "status": status})

            return result

        except Exception as e:
            await self._log_activity("update_ticket_status", sheet_id=ticket_sheet_id,
                                    status="error", error_message=str(e), details={"row_id": row_id})
            return await self._handle_api_error(e)

    async def update_ticket_fields(self, row_id: int, field_updates: Dict[int, Any],
                                  ticket_sheet_id: int = 2987059899748228) -> SmartsheetResponse:
        """Update multiple ticket fields."""
        try:
            await self._rate_limit_check()

            cell_updates = [
                {'column_id': col_id, 'value': value}
                for col_id, value in field_updates.items()
            ]

            result = await self.update_cells(ticket_sheet_id, row_id, cell_updates)

            if result.success:
                await self._log_activity("update_ticket_fields", sheet_id=ticket_sheet_id,
                                        details={"row_id": row_id, "fields_updated": len(cell_updates)})

            return result

        except Exception as e:
            await self._log_activity("update_ticket_fields", sheet_id=ticket_sheet_id,
                                    status="error", error_message=str(e), details={"row_id": row_id})
            return await self._handle_api_error(e)

# Created and developed by Jai Singh
