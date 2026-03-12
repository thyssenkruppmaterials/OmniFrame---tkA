"""
SAP RFC Service for OmniFrame Logistics.
Provides connection management and function call wrappers for SAP ECC and S/4HANA.
Supports both Classic WM and EWM operations.
"""

import logging
import asyncio
from typing import Optional, Dict, List, Any
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field
import os

logger = logging.getLogger(__name__)

# Check if pyrfc is available
try:
    from pyrfc import Connection, RFCError
    PYRFC_AVAILABLE = True
except ImportError:
    PYRFC_AVAILABLE = False
    logger.warning("pyrfc not installed. SAP RFC functionality will be unavailable.")
    Connection = None
    RFCError = Exception


class SAPSystemType(str, Enum):
    """SAP system types for function module selection."""
    ECC = "ECC"  # Classic WM
    S4HANA = "S4HANA"  # EWM


class SAPConnectionConfig(BaseModel):
    """SAP connection configuration."""
    name: str = "Default"
    user: str
    passwd: str
    ashost: str
    sysnr: str = "00"
    client: str = "100"
    lang: str = "EN"
    saprouter: Optional[str] = None
    system_type: SAPSystemType = SAPSystemType.S4HANA


class SAPResponse(BaseModel):
    """Standard response model for SAP operations."""
    success: bool = True
    data: Optional[Any] = None
    message: Optional[str] = None
    error: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    operation: Optional[str] = None


class TransferOrderData(BaseModel):
    """Transfer Order data structure."""
    warehouse: str
    to_number: Optional[str] = None
    material: Optional[str] = None
    quantity: Optional[float] = None
    source_storage_type: Optional[str] = None
    source_storage_bin: Optional[str] = None
    dest_storage_type: Optional[str] = None
    dest_storage_bin: Optional[str] = None
    movement_type: Optional[str] = None
    status: Optional[str] = None


class SAPServiceError(Exception):
    """Base exception for SAP service errors."""
    pass


class SAPConnectionError(SAPServiceError):
    """Exception for SAP connection errors."""
    pass


class SAPAuthenticationError(SAPServiceError):
    """Exception for SAP authentication errors."""
    pass


class SAPService:
    """
    SAP RFC Service with connection pooling and operation wrappers.
    Supports both ECC (Classic WM) and S/4HANA (EWM) systems.
    """
    
    _instance: Optional['SAPService'] = None
    _lock = asyncio.Lock()
    
    @staticmethod
    def _get_default_config() -> 'SAPConnectionConfig':
        """Get default SAP connection config from environment variables."""
        return SAPConnectionConfig(
            name="Default SAP Connection",
            user=os.getenv("SAP_DEFAULT_USER", "STUDENT119"),
            passwd=os.getenv("SAP_DEFAULT_PASSWD", ""),
            ashost=os.getenv("SAP_DEFAULT_ASHOST", "172.21.72.22"),
            sysnr=os.getenv("SAP_DEFAULT_SYSNR", "00"),
            client=os.getenv("SAP_DEFAULT_CLIENT", "100"),
            lang=os.getenv("SAP_DEFAULT_LANG", "EN"),
            saprouter=os.getenv("SAP_DEFAULT_SAPROUTER", "/H/161.38.17.212"),
            system_type=SAPSystemType(os.getenv("SAP_DEFAULT_SYSTEM_TYPE", "S4HANA"))
        )
    
    # Default connection parameters (loaded from environment)
    DEFAULT_CONFIG: Optional[SAPConnectionConfig] = None
    
    def __init__(self):
        """Initialize SAP service."""
        if not PYRFC_AVAILABLE:
            logger.error("pyrfc library not available. Install with: pip install pyrfc")
        
        self._connection: Optional[Connection] = None
        # Load config from environment variables
        if SAPService.DEFAULT_CONFIG is None:
            SAPService.DEFAULT_CONFIG = SAPService._get_default_config()
        self._config: SAPConnectionConfig = SAPService.DEFAULT_CONFIG
        self._connected: bool = False
        
        logger.info("SAPService initialized")
    
    @classmethod
    async def get_instance(cls) -> 'SAPService':
        """Get singleton instance with thread safety."""
        if cls._instance is None:
            async with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance
    
    def _get_connection_params(self, config: Optional[SAPConnectionConfig] = None) -> Dict[str, str]:
        """Build connection parameters dictionary."""
        cfg = config or self._config
        params = {
            'user': cfg.user,
            'passwd': cfg.passwd,
            'ashost': cfg.ashost,
            'sysnr': cfg.sysnr,
            'client': cfg.client,
            'lang': cfg.lang,
        }
        if cfg.saprouter:
            params['saprouter'] = cfg.saprouter
        return params
    
    async def _get_connection(self, config: Optional[SAPConnectionConfig] = None) -> Connection:
        """Get or create SAP connection."""
        if not PYRFC_AVAILABLE:
            raise SAPConnectionError("pyrfc library not installed")
        
        # Run connection in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        params = self._get_connection_params(config)
        
        def connect():
            return Connection(**params)
        
        try:
            connection = await loop.run_in_executor(None, connect)
            return connection
        except Exception as e:
            error_str = str(e)
            if "RFC_LOGON_FAILURE" in error_str:
                raise SAPAuthenticationError(f"SAP authentication failed: {error_str}")
            elif "NIECONN_REFUSED" in error_str:
                raise SAPConnectionError(f"SAP connection refused: {error_str}")
            else:
                raise SAPConnectionError(f"SAP connection failed: {error_str}")
    
    async def _call_rfc(self, function_name: str, config: Optional[SAPConnectionConfig] = None, **kwargs) -> Dict[str, Any]:
        """Execute RFC function call."""
        loop = asyncio.get_event_loop()
        
        def execute():
            conn = None
            try:
                params = self._get_connection_params(config)
                conn = Connection(**params)
                result = conn.call(function_name, **kwargs)
                return result
            finally:
                if conn:
                    try:
                        conn.close()
                    except:
                        pass
        
        return await loop.run_in_executor(None, execute)
    
    # ==================== CONNECTION TESTING ====================
    
    async def test_connection(self, config: Optional[SAPConnectionConfig] = None) -> SAPResponse:
        """Test SAP connection and return system information."""
        try:
            if not PYRFC_AVAILABLE:
                return SAPResponse(
                    success=False,
                    error="pyrfc library not installed. Please install SAP NW RFC SDK and pyrfc.",
                    operation="test_connection"
                )
            
            cfg = config or self._config
            
            # Test with STFC_CONNECTION
            result = await self._call_rfc(
                'STFC_CONNECTION',
                config=cfg,
                REQUTEXT='OmniFrame SAP Connection Test'
            )
            
            # Get user details
            user_result = await self._call_rfc(
                'BAPI_USER_GET_DETAIL',
                config=cfg,
                USERNAME=cfg.user
            )
            
            user_info = {
                'username': cfg.user,
                'first_name': user_result.get('ADDRESS', {}).get('FIRSTNAME', ''),
                'last_name': user_result.get('ADDRESS', {}).get('LASTNAME', ''),
            }
            
            return SAPResponse(
                success=True,
                data={
                    'connection_status': 'connected',
                    'echo_text': result.get('ECHOTEXT', ''),
                    'response_text': result.get('RESPTEXT', ''),
                    'system_type': cfg.system_type.value,
                    'host': cfg.ashost,
                    'client': cfg.client,
                    'user_info': user_info
                },
                message="SAP connection successful",
                operation="test_connection"
            )
            
        except SAPAuthenticationError as e:
            logger.error(f"SAP authentication failed: {str(e)}")
            return SAPResponse(
                success=False,
                error=str(e),
                message="Authentication failed - check credentials",
                operation="test_connection"
            )
        except SAPConnectionError as e:
            logger.error(f"SAP connection failed: {str(e)}")
            return SAPResponse(
                success=False,
                error=str(e),
                message="Connection failed - check network/host settings",
                operation="test_connection"
            )
        except Exception as e:
            logger.error(f"SAP test connection error: {str(e)}")
            return SAPResponse(
                success=False,
                error=str(e),
                operation="test_connection"
            )
    
    # ==================== WAREHOUSE DATA ====================
    
    async def get_warehouses(self, config: Optional[SAPConnectionConfig] = None, include_stock_count: bool = False) -> SAPResponse:
        """Get list of warehouses from SAP, optionally with stock counts."""
        cfg = config or self._config
        warehouses = []
        tables_tried = []
        errors = []
        
        # Strategy: Try multiple tables/approaches based on system type
        # 1. EWM tables first if S4HANA
        # 2. Classic WM tables
        # 3. Plant/storage location as fallback
        
        # Approach 1: Try EWM warehouse table for S/4HANA
        if cfg.system_type == SAPSystemType.S4HANA:
            try:
                tables_tried.append('/SCWM/T300')
                result = await self._call_rfc(
                    'RFC_READ_TABLE',
                    config=cfg,
                    QUERY_TABLE='/SCWM/T300',
                    FIELDS=[{'FIELDNAME': 'LGNUM'}],
                    ROWCOUNT=100
                )
                data = result.get('DATA', [])
                for row in data:
                    wa_line = row.get('WA', '').strip()
                    if wa_line:
                        warehouses.append({
                            'warehouse_number': wa_line[:10].strip(),
                            'description': '',
                            'source': 'EWM',
                            'stock_count': 0
                        })
            except Exception as e:
                errors.append(f"/SCWM/T300: {str(e)}")
                logger.debug(f"EWM table not available: {str(e)}")
        
        # Approach 2: Try Classic WM T300 table
        if not warehouses:
            try:
                tables_tried.append('T300')
                result = await self._call_rfc(
                    'RFC_READ_TABLE',
                    config=cfg,
                    QUERY_TABLE='T300',
                    FIELDS=[{'FIELDNAME': 'LGNUM'}, {'FIELDNAME': 'LNUMT'}],
                    ROWCOUNT=100
                )
                data = result.get('DATA', [])
                for row in data:
                    wa_line = row.get('WA', '')
                    lgnum = wa_line[:4].strip() if len(wa_line) >= 4 else wa_line.strip()
                    lnumt = wa_line[4:].strip() if len(wa_line) > 4 else ''
                    if lgnum:
                        warehouses.append({
                            'warehouse_number': lgnum,
                            'description': lnumt,
                            'source': 'Classic WM',
                            'stock_count': 0
                        })
            except Exception as e:
                error_str = str(e)
                errors.append(f"T300: {error_str}")
                if 'TABLE_WITHOUT_DATA' in error_str:
                    logger.info("T300 has no data - Classic WM may not be configured")
                else:
                    logger.debug(f"T300 not accessible: {error_str}")
        
        # Approach 3: Try to get storage locations from T001L as fallback
        if not warehouses:
            try:
                tables_tried.append('T001L (Storage Locations)')
                result = await self._call_rfc(
                    'RFC_READ_TABLE',
                    config=cfg,
                    QUERY_TABLE='T001L',
                    FIELDS=[{'FIELDNAME': 'WERKS'}, {'FIELDNAME': 'LGORT'}],
                    ROWCOUNT=50
                )
                data = result.get('DATA', [])
                seen = set()
                for row in data:
                    wa = row.get('WA', '')
                    werks = wa[:4].strip() if len(wa) >= 4 else ''
                    lgort = wa[4:8].strip() if len(wa) >= 8 else ''
                    key = f"{werks}-{lgort}"
                    if key not in seen and werks:
                        seen.add(key)
                        warehouses.append({
                            'warehouse_number': f"{werks}/{lgort}",
                            'description': f"Plant {werks}, Storage Loc {lgort}",
                            'source': 'Storage Location',
                            'plant': werks,
                            'storage_location': lgort,
                            'stock_count': 0
                        })
            except Exception as e:
                errors.append(f"T001L: {str(e)}")
                logger.debug(f"Storage locations not accessible: {str(e)}")
        
        # Optionally fetch stock counts for each warehouse
        if include_stock_count and warehouses:
            for wh in warehouses:
                try:
                    stock_result = await self.get_warehouse_stock_count(wh['warehouse_number'], cfg)
                    if stock_result.success:
                        wh['stock_count'] = stock_result.data.get('stock_count', 0)
                except Exception as e:
                    logger.debug(f"Could not get stock count for {wh['warehouse_number']}: {str(e)}")
                    wh['stock_count'] = 0
        
        # Build response
        if warehouses:
            return SAPResponse(
                success=True,
                data={
                    'warehouses': warehouses,
                    'count': len(warehouses),
                    'tables_checked': tables_tried
                },
                message=f"Found {len(warehouses)} warehouse/storage locations",
                operation="get_warehouses"
            )
        else:
            # No warehouses found - provide helpful message
            error_detail = "; ".join(errors) if errors else "No accessible warehouse data found"
            
            # Check if it's specifically the TABLE_WITHOUT_DATA error
            if any('TABLE_WITHOUT_DATA' in e for e in errors):
                message = (
                    "No warehouse data found. This SAP system may not have "
                    "Warehouse Management (WM) or Extended Warehouse Management (EWM) configured. "
                    "Tables checked: " + ", ".join(tables_tried)
                )
            else:
                message = f"Could not retrieve warehouse data. Tables checked: {', '.join(tables_tried)}"
            
            logger.warning(f"No warehouses found: {error_detail}")
            return SAPResponse(
                success=True,  # Not a failure - just no data
                data={
                    'warehouses': [],
                    'count': 0,
                    'tables_checked': tables_tried,
                    'notes': message
                },
                message=message,
                operation="get_warehouses"
            )
    
    async def get_storage_types(self, warehouse: str, config: Optional[SAPConnectionConfig] = None) -> SAPResponse:
        """Get storage types for a warehouse."""
        try:
            cfg = config or self._config
            
            # Use EWM or Classic WM table based on system type
            table = '/SCWM/T301' if cfg.system_type == SAPSystemType.S4HANA else 'T301'
            
            try:
                result = await self._call_rfc(
                    'RFC_READ_TABLE',
                    config=cfg,
                    QUERY_TABLE=table,
                    FIELDS=[{'FIELDNAME': 'LGNUM'}, {'FIELDNAME': 'LGTYP'}],
                    OPTIONS=[{'TEXT': f"LGNUM = '{warehouse}'"}],
                    ROWCOUNT=50
                )
            except Exception:
                # Fallback to T301
                result = await self._call_rfc(
                    'RFC_READ_TABLE',
                    config=cfg,
                    QUERY_TABLE='T301',
                    FIELDS=[{'FIELDNAME': 'LGNUM'}, {'FIELDNAME': 'LGTYP'}],
                    OPTIONS=[{'TEXT': f"LGNUM = '{warehouse}'"}],
                    ROWCOUNT=50
                )
            
            data = result.get('DATA', [])
            storage_types = []
            
            for row in data:
                wa = row.get('WA', '').strip()
                lgtyp = wa[4:8].strip() if len(wa) > 4 else wa
                if lgtyp:
                    storage_types.append(lgtyp)
            
            return SAPResponse(
                success=True,
                data={'warehouse': warehouse, 'storage_types': storage_types},
                message=f"Found {len(storage_types)} storage types",
                operation="get_storage_types"
            )
            
        except Exception as e:
            logger.error(f"Error getting storage types: {str(e)}")
            return SAPResponse(
                success=False,
                error=str(e),
                operation="get_storage_types"
            )
    
    async def get_warehouse_stock(self, warehouse: str, config: Optional[SAPConnectionConfig] = None) -> SAPResponse:
        """Get available stock/quants for a warehouse."""
        try:
            cfg = config or self._config
            
            # EWM uses /SCWM/AQUA, Classic WM uses LQUA
            if cfg.system_type == SAPSystemType.S4HANA:
                try:
                    result = await self._call_rfc(
                        'RFC_READ_TABLE',
                        config=cfg,
                        QUERY_TABLE='/SCWM/AQUA',
                        FIELDS=[
                            {'FIELDNAME': 'LGNUM'},
                            {'FIELDNAME': 'LGTYP'},
                            {'FIELDNAME': 'LGPLA'},
                            {'FIELDNAME': 'MATNR'}
                        ],
                        OPTIONS=[{'TEXT': f"LGNUM = '{warehouse}'"}],
                        ROWCOUNT=100
                    )
                except Exception:
                    # Fallback to LQUA
                    result = await self._call_rfc(
                        'RFC_READ_TABLE',
                        config=cfg,
                        QUERY_TABLE='LQUA',
                        FIELDS=[
                            {'FIELDNAME': 'LGNUM'},
                            {'FIELDNAME': 'LGTYP'},
                            {'FIELDNAME': 'LGPLA'},
                            {'FIELDNAME': 'MATNR'}
                        ],
                        OPTIONS=[{'TEXT': f"LGNUM = '{warehouse}'"}],
                        ROWCOUNT=100
                    )
            else:
                result = await self._call_rfc(
                    'RFC_READ_TABLE',
                    config=cfg,
                    QUERY_TABLE='LQUA',
                    FIELDS=[
                        {'FIELDNAME': 'LGNUM'},
                        {'FIELDNAME': 'LGTYP'},
                        {'FIELDNAME': 'LGPLA'},
                        {'FIELDNAME': 'MATNR'}
                    ],
                    OPTIONS=[{'TEXT': f"LGNUM = '{warehouse}'"}],
                    ROWCOUNT=100
                )
            
            data = result.get('DATA', [])
            stock_items = []
            
            for row in data:
                wa = row.get('WA', '').strip()
                # Parse fixed-width output
                if len(wa) >= 40:
                    stock_items.append({
                        'warehouse': wa[:4].strip(),
                        'storage_type': wa[4:8].strip(),
                        'storage_bin': wa[8:18].strip(),
                        'material': wa[18:].strip()
                    })
            
            return SAPResponse(
                success=True,
                data={'warehouse': warehouse, 'stock': stock_items, 'count': len(stock_items)},
                message=f"Found {len(stock_items)} stock items",
                operation="get_warehouse_stock"
            )
            
        except Exception as e:
            logger.error(f"Error getting warehouse stock: {str(e)}")
            return SAPResponse(
                success=False,
                error=str(e),
                operation="get_warehouse_stock"
            )
    
    async def get_warehouse_stock_count(self, warehouse: str, config: Optional[SAPConnectionConfig] = None) -> SAPResponse:
        """Get stock count for a warehouse (faster than getting full stock details)."""
        try:
            cfg = config or self._config
            stock_count = 0
            
            # EWM uses /SCWM/AQUA, Classic WM uses LQUA
            if cfg.system_type == SAPSystemType.S4HANA:
                try:
                    result = await self._call_rfc(
                        'RFC_READ_TABLE',
                        config=cfg,
                        QUERY_TABLE='/SCWM/AQUA',
                        FIELDS=[{'FIELDNAME': 'LGNUM'}],
                        OPTIONS=[{'TEXT': f"LGNUM = '{warehouse}'"}],
                        ROWCOUNT=9999
                    )
                    stock_count = len(result.get('DATA', []))
                except Exception:
                    # Fallback to LQUA
                    result = await self._call_rfc(
                        'RFC_READ_TABLE',
                        config=cfg,
                        QUERY_TABLE='LQUA',
                        FIELDS=[{'FIELDNAME': 'LGNUM'}],
                        OPTIONS=[{'TEXT': f"LGNUM = '{warehouse}'"}],
                        ROWCOUNT=9999
                    )
                    stock_count = len(result.get('DATA', []))
            else:
                result = await self._call_rfc(
                    'RFC_READ_TABLE',
                    config=cfg,
                    QUERY_TABLE='LQUA',
                    FIELDS=[{'FIELDNAME': 'LGNUM'}],
                    OPTIONS=[{'TEXT': f"LGNUM = '{warehouse}'"}],
                    ROWCOUNT=9999
                )
                stock_count = len(result.get('DATA', []))
            
            return SAPResponse(
                success=True,
                data={'warehouse': warehouse, 'stock_count': stock_count},
                message=f"Found {stock_count} stock items",
                operation="get_warehouse_stock_count"
            )
            
        except Exception as e:
            logger.debug(f"Error getting warehouse stock count: {str(e)}")
            return SAPResponse(
                success=True,
                data={'warehouse': warehouse, 'stock_count': 0},
                message="Could not retrieve stock count",
                operation="get_warehouse_stock_count"
            )
    
    # ==================== TRANSFER ORDER OPERATIONS ====================
    
    async def get_open_transfer_orders(self, warehouse: Optional[str] = None, config: Optional[SAPConnectionConfig] = None) -> SAPResponse:
        """Get open (unconfirmed) transfer orders."""
        try:
            cfg = config or self._config
            
            # Build options filter
            options = [{'TEXT': "KZETE = ' '"}]  # KZETE = ' ' means not confirmed
            if warehouse:
                options.append({'TEXT': f"AND LGNUM = '{warehouse}'"})
            
            # Try EWM first, then Classic WM
            try:
                if cfg.system_type == SAPSystemType.S4HANA:
                    result = await self._call_rfc(
                        'RFC_READ_TABLE',
                        config=cfg,
                        QUERY_TABLE='/SCWM/ORDIM_O',
                        FIELDS=[
                            {'FIELDNAME': 'LGNUM'},
                            {'FIELDNAME': 'TANUM'},
                            {'FIELDNAME': 'TAPOS'},
                            {'FIELDNAME': 'MATNR'}
                        ],
                        ROWCOUNT=200
                    )
                else:
                    raise Exception("Use Classic WM")
            except Exception:
                # Use LTAK for TO headers
                result = await self._call_rfc(
                    'RFC_READ_TABLE',
                    config=cfg,
                    QUERY_TABLE='LTAK',
                    FIELDS=[
                        {'FIELDNAME': 'LGNUM'},
                        {'FIELDNAME': 'TANUM'},
                        {'FIELDNAME': 'KZETE'}
                    ],
                    OPTIONS=options,
                    ROWCOUNT=200
                )
            
            data = result.get('DATA', [])
            transfer_orders = []
            by_warehouse = {}
            
            for row in data:
                wa_line = row.get('WA', '')
                lgnum = wa_line[:4].strip() if len(wa_line) >= 4 else ''
                tanum = wa_line[4:14].strip() if len(wa_line) >= 14 else wa_line[4:].strip()
                
                if lgnum:
                    if lgnum not in by_warehouse:
                        by_warehouse[lgnum] = []
                    by_warehouse[lgnum].append({
                        'warehouse': lgnum,
                        'to_number': tanum,
                        'status': 'open'
                    })
                    transfer_orders.append({
                        'warehouse': lgnum,
                        'to_number': tanum,
                        'status': 'open'
                    })
            
            return SAPResponse(
                success=True,
                data={
                    'transfer_orders': transfer_orders,
                    'by_warehouse': by_warehouse,
                    'total_count': len(transfer_orders)
                },
                message=f"Found {len(transfer_orders)} open transfer orders",
                operation="get_open_transfer_orders"
            )
            
        except Exception as e:
            logger.error(f"Error getting open TOs: {str(e)}")
            return SAPResponse(
                success=False,
                error=str(e),
                operation="get_open_transfer_orders"
            )
    
    async def create_transfer_order(
        self,
        warehouse: str,
        material: str,
        quantity: float,
        source_storage_type: str,
        dest_storage_type: str,
        source_storage_bin: Optional[str] = None,
        dest_storage_bin: Optional[str] = None,
        movement_type: str = "999",
        plant: str = "1010",
        storage_location: Optional[str] = None,
        config: Optional[SAPConnectionConfig] = None
    ) -> SAPResponse:
        """
        Create a new transfer order using custom Z_RFC_WM_TO_CREATE function.
        
        This function should be created in SAP SE37 with proper parameters for
        source/destination storage types and bins.
        """
        try:
            cfg = config or self._config
            
            logger.info(f"Creating TO: warehouse={warehouse}, material={material}, qty={quantity}")
            logger.info(f"  Source: type={source_storage_type}, bin={source_storage_bin}")
            logger.info(f"  Dest: type={dest_storage_type}, bin={dest_storage_bin}")
            
            try:
                # Build parameters - only include non-empty values
                params = {
                    'I_LGNUM': warehouse,
                    'I_BWLVS': movement_type,
                    'I_MATNR': material,
                    'I_WERKS': plant,
                    'I_ANFME': quantity,
                    'I_VLTYP': source_storage_type,
                    'I_NLTYP': dest_storage_type,
                }
                
                # Add optional parameters if provided
                if source_storage_bin:
                    params['I_VLPLA'] = source_storage_bin
                if dest_storage_bin:
                    params['I_NLPLA'] = dest_storage_bin
                if storage_location:
                    params['I_LGORT'] = storage_location
                
                result = await self._call_rfc(
                    'Z_RFC_WM_TO_CREATE',
                    config=cfg,
                    **params
                )
                
                logger.info(f"Z_RFC_WM_TO_CREATE result: {result}")
                
                to_number = result.get('E_TANUM', '')
                return_code = result.get('E_SUBRC', 0)
                message = result.get('E_MESSAGE', '')
                
                # Convert return code to int if string
                if isinstance(return_code, str):
                    return_code = int(return_code) if return_code.isdigit() else 99
                
                if return_code == 0 and to_number:
                    return SAPResponse(
                        success=True,
                        data={
                            'to_number': to_number,
                            'warehouse': warehouse,
                            'material': material,
                            'quantity': quantity,
                            'source_storage_type': source_storage_type,
                            'source_storage_bin': source_storage_bin,
                            'dest_storage_type': dest_storage_type,
                            'dest_storage_bin': dest_storage_bin,
                            'return_code': return_code
                        },
                        message=message or f"Transfer Order {to_number} created successfully",
                        operation="create_transfer_order"
                    )
                else:
                    return SAPResponse(
                        success=False,
                        error=message or f"TO creation failed with return code {return_code}",
                        data={'return_code': return_code},
                        operation="create_transfer_order"
                    )
                    
            except Exception as e:
                error_str = str(e)
                logger.error(f"Z_RFC_WM_TO_CREATE exception: {error_str}")
                
                if 'FUNCTION_NOT_FOUND' in error_str or 'FU_NOT_FOUND' in error_str:
                    return SAPResponse(
                        success=False,
                        error="Z_RFC_WM_TO_CREATE function not found in SAP. Please create it in SE37.",
                        operation="create_transfer_order"
                    )
                else:
                    return SAPResponse(
                        success=False,
                        error=f"RFC call failed: {error_str}",
                        operation="create_transfer_order"
                    )
                
        except Exception as e:
            logger.error(f"Error creating TO: {str(e)}")
            return SAPResponse(
                success=False,
                error=str(e),
                operation="create_transfer_order"
            )
    
    async def confirm_transfer_order(
        self,
        warehouse: str,
        to_number: str,
        quantity: Optional[float] = None,
        config: Optional[SAPConnectionConfig] = None
    ) -> SAPResponse:
        """
        Confirm a transfer order using custom Z_RFC_WM_TO_CONFIRM function.
        
        This function should be created in SAP SE37 with the proper interface.
        """
        try:
            cfg = config or self._config
            
            # Use custom Z-function (the only reliable method for Classic WM)
            logger.info(f"Calling Z_RFC_WM_TO_CONFIRM for TO {to_number} in warehouse {warehouse}")
            
            try:
                result = await self._call_rfc(
                    'Z_RFC_WM_TO_CONFIRM',
                    config=cfg,
                    I_LGNUM=warehouse,
                    I_TANUM=to_number
                )
                
                logger.info(f"Z_RFC_WM_TO_CONFIRM result: {result}")
                
                return_code = result.get('E_SUBRC', 0)
                message = result.get('E_MESSAGE', '')
                
                # Convert return code to int if it's a string
                if isinstance(return_code, str):
                    return_code = int(return_code) if return_code.isdigit() else 99
                
                if return_code == 0:
                    return SAPResponse(
                        success=True,
                        data={
                            'to_number': to_number,
                            'warehouse': warehouse,
                            'method': 'Z_RFC_WM_TO_CONFIRM',
                            'return_code': return_code
                        },
                        message=message or f"Transfer Order {to_number} confirmed successfully",
                        operation="confirm_transfer_order"
                    )
                else:
                    # Return the error from Z function - don't try other methods
                    return SAPResponse(
                        success=False,
                        error=message or f"Confirmation failed with return code {return_code}",
                        data={
                            'to_number': to_number,
                            'warehouse': warehouse,
                            'return_code': return_code
                        },
                        operation="confirm_transfer_order"
                    )
                    
            except Exception as e:
                error_str = str(e)
                logger.error(f"Z_RFC_WM_TO_CONFIRM exception: {error_str}")
                
                # Check if function doesn't exist
                if 'FUNCTION_NOT_FOUND' in error_str or 'FU_NOT_FOUND' in error_str:
                    return SAPResponse(
                        success=False,
                        error="Z_RFC_WM_TO_CONFIRM function not found in SAP. Please create it in SE37.",
                        data={'warehouse': warehouse, 'to_number': to_number},
                        operation="confirm_transfer_order"
                    )
                else:
                    # Return the actual RFC error
                    return SAPResponse(
                        success=False,
                        error=f"RFC call failed: {error_str}",
                        data={'warehouse': warehouse, 'to_number': to_number},
                        operation="confirm_transfer_order"
                    )
                
        except Exception as e:
            logger.error(f"Error confirming TO: {str(e)}")
            return SAPResponse(
                success=False,
                error=str(e),
                operation="confirm_transfer_order"
            )
    
    # ==================== GOODS RECEIPT (MIGO) OPERATIONS ====================
    
    async def create_goods_receipt(
        self,
        material: str,
        plant: str,
        storage_location: str,
        quantity: float,
        movement_type: str = "501",
        po_number: Optional[str] = None,
        po_item: Optional[str] = None,
        vendor: Optional[str] = None,
        batch: Optional[str] = None,
        cost_center: Optional[str] = None,
        config: Optional[SAPConnectionConfig] = None
    ) -> SAPResponse:
        """
        Create a Goods Receipt (MIGO equivalent) using Z_RFC_GOODS_RECEIPT_V2.
        
        Supports movement types:
        - 101: GR for Purchase Order (requires po_number)
        - 501: Receipt without reference (requires cost_center)
        
        Args:
            material: Material number
            plant: Plant number
            storage_location: Storage location
            quantity: Quantity to receive
            movement_type: SAP movement type (101, 501, etc.)
            po_number: Purchase Order number (required for mvt type 101)
            po_item: PO line item number (optional, defaults to 00010)
            vendor: Vendor number (optional)
            batch: Batch number (optional)
            cost_center: Cost center (required for mvt type 501)
            config: Optional SAP connection config
        
        Returns:
            SAPResponse with material document number on success
        """
        try:
            cfg = config or self._config
            
            logger.info(f"Creating Goods Receipt: material={material}, plant={plant}, qty={quantity}, mvt={movement_type}")
            if po_number:
                logger.info(f"  PO Reference: {po_number}/{po_item or '00010'}")
            if cost_center:
                logger.info(f"  Cost Center: {cost_center}")
            
            # Build parameters for Z_RFC_GOODS_RECEIPT_V2
            params = {
                'I_MATERIAL': material,
                'I_PLANT': plant,
                'I_STORAGE_LOC': storage_location,
                'I_QUANTITY': quantity,
                'I_MOVEMENT_TYPE': movement_type,
            }
            
            # Add optional parameters if provided
            if po_number:
                params['I_PO_NUMBER'] = po_number
            if po_item:
                # SAP EBELP field is 5 characters - pad with leading zeros
                params['I_PO_ITEM'] = po_item.zfill(5)
            if vendor:
                params['I_VENDOR'] = vendor
            if batch:
                params['I_BATCH'] = batch
            if cost_center:
                params['I_KOSTL'] = cost_center
            
            try:
                result = await self._call_rfc(
                    'Z_RFC_GOODS_RECEIPT_V2',
                    config=cfg,
                    **params
                )
                
                logger.info(f"Z_RFC_GOODS_RECEIPT_V2 result: {result}")
                
                mat_doc = result.get('E_MAT_DOC', '')
                mat_year = result.get('E_MAT_YEAR', '')
                delivery = result.get('E_DELIVERY', '')
                return_code = result.get('E_SUBRC', 0)
                message = result.get('E_MESSAGE', '')
                
                # Convert return code to int if string
                if isinstance(return_code, str):
                    return_code = int(return_code) if return_code.isdigit() else 99
                
                if return_code == 0 and mat_doc:
                    response_data = {
                        'material_document': mat_doc,
                        'material_year': mat_year,
                        'material': material,
                        'quantity': quantity,
                        'movement_type': movement_type,
                        'plant': plant,
                        'storage_location': storage_location,
                        'po_number': po_number
                    }
                    if delivery:
                        response_data['inbound_delivery'] = delivery
                    
                    return SAPResponse(
                        success=True,
                        data=response_data,
                        message=message or f"Goods Receipt {mat_doc}/{mat_year} posted successfully",
                        operation="create_goods_receipt"
                    )
                else:
                    return SAPResponse(
                        success=False,
                        error=message or f"Goods Receipt posting failed with return code {return_code}",
                        data={'return_code': return_code},
                        operation="create_goods_receipt"
                    )
                    
            except Exception as e:
                error_str = str(e)
                logger.error(f"Z_RFC_GOODS_RECEIPT_V2 exception: {error_str}")
                
                if 'FUNCTION_NOT_FOUND' in error_str or 'FU_NOT_FOUND' in error_str:
                    # Fall back to V1 or direct BAPI call
                    logger.info("Z_RFC_GOODS_RECEIPT_V2 not found, trying Z_RFC_GOODS_RECEIPT")
                    try:
                        # Try V1 without cost center
                        params_v1 = {k: v for k, v in params.items() if k != 'I_KOSTL'}
                        result = await self._call_rfc('Z_RFC_GOODS_RECEIPT', config=cfg, **params_v1)
                        mat_doc = result.get('E_MAT_DOC', '')
                        mat_year = result.get('E_MAT_YEAR', '')
                        return_code = result.get('E_SUBRC', 0)
                        message = result.get('E_MESSAGE', '')
                        if isinstance(return_code, str):
                            return_code = int(return_code) if return_code.isdigit() else 99
                        if return_code == 0 and mat_doc:
                            return SAPResponse(
                                success=True,
                                data={'material_document': mat_doc, 'material_year': mat_year},
                                message=message or f"Goods Receipt {mat_doc}/{mat_year} posted",
                                operation="create_goods_receipt"
                            )
                        else:
                            return SAPResponse(
                                success=False,
                                error=message or f"GR failed with code {return_code}",
                                operation="create_goods_receipt"
                            )
                    except:
                        logger.info("Z_RFC_GOODS_RECEIPT not found, falling back to BAPI")
                        return await self._create_goods_receipt_bapi(
                            material, plant, storage_location, quantity,
                            movement_type, po_number, po_item, vendor, batch, cfg
                        )
                else:
                    return SAPResponse(
                        success=False,
                        error=f"RFC call failed: {error_str}",
                        operation="create_goods_receipt"
                    )
                
        except Exception as e:
            logger.error(f"Error creating goods receipt: {str(e)}")
            return SAPResponse(
                success=False,
                error=str(e),
                operation="create_goods_receipt"
            )
    
    async def _create_goods_receipt_bapi(
        self,
        material: str,
        plant: str,
        storage_location: str,
        quantity: float,
        movement_type: str,
        po_number: Optional[str],
        po_item: Optional[str],
        vendor: Optional[str],
        batch: Optional[str],
        config: SAPConnectionConfig
    ) -> SAPResponse:
        """
        Fallback: Use standard BAPI_GOODSMVT_CREATE directly.
        
        This is called when Z_RFC_GOODS_RECEIPT is not available in the SAP system.
        """
        from datetime import datetime
        
        today = datetime.now().strftime('%Y%m%d')
        
        # Determine GM code based on movement type
        # 01 = Goods receipt for purchase order
        # 05 = Other goods receipts
        gm_code = '01' if po_number else '05'
        
        header = {
            'PSTNG_DATE': today,
            'DOC_DATE': today,
        }
        
        code = {'GM_CODE': gm_code}
        
        item = {
            'MATERIAL': material,
            'PLANT': plant,
            'STGE_LOC': storage_location,
            'MOVE_TYPE': movement_type,
            'ENTRY_QNT': quantity,
            'ENTRY_UOM': 'EA',
        }
        
        if po_number:
            item['PO_NUMBER'] = po_number
            # SAP EBELP field is 5 characters - pad with leading zeros
            item['PO_ITEM'] = po_item.zfill(5) if po_item else '00010'
        if vendor:
            item['VENDOR'] = vendor
        if batch:
            item['BATCH'] = batch
        
        try:
            logger.info(f"Calling BAPI_GOODSMVT_CREATE with header={header}, code={code}, item={item}")
            
            result = await self._call_rfc(
                'BAPI_GOODSMVT_CREATE',
                config=config,
                GOODSMVT_HEADER=header,
                GOODSMVT_CODE=code,
                GOODSMVT_ITEM=[item]
            )
            
            logger.info(f"BAPI_GOODSMVT_CREATE result: {result}")
            
            head_ret = result.get('GOODSMVT_HEADRET', {})
            returns = result.get('RETURN', [])
            
            # Check for errors in return table
            errors = [r for r in returns if r.get('TYPE') in ('E', 'A', 'X')]
            
            if errors:
                error_msg = errors[0].get('MESSAGE', 'Unknown error during goods movement')
                logger.error(f"BAPI error: {error_msg}")
                
                # Rollback on error
                await self._call_rfc('BAPI_TRANSACTION_ROLLBACK', config=config)
                
                return SAPResponse(
                    success=False,
                    error=error_msg,
                    operation="create_goods_receipt"
                )
            
            # Commit the transaction
            await self._call_rfc('BAPI_TRANSACTION_COMMIT', config=config, WAIT='X')
            
            mat_doc = head_ret.get('MAT_DOC', '')
            mat_year = head_ret.get('DOC_YEAR', '')
            
            if mat_doc:
                return SAPResponse(
                    success=True,
                    data={
                        'material_document': mat_doc,
                        'material_year': mat_year,
                        'material': material,
                        'quantity': quantity,
                        'movement_type': movement_type,
                        'plant': plant,
                        'storage_location': storage_location,
                        'po_number': po_number
                    },
                    message=f"Goods Receipt {mat_doc}/{mat_year} posted successfully (via BAPI)",
                    operation="create_goods_receipt"
                )
            else:
                return SAPResponse(
                    success=False,
                    error="No material document returned from BAPI",
                    operation="create_goods_receipt"
                )
            
        except Exception as e:
            logger.error(f"BAPI_GOODSMVT_CREATE exception: {str(e)}")
            return SAPResponse(
                success=False,
                error=str(e),
                operation="create_goods_receipt"
            )
    
    # ==================== FUNCTION MODULE DISCOVERY ====================
    
    async def search_functions(self, pattern: str, config: Optional[SAPConnectionConfig] = None) -> SAPResponse:
        """Search for available RFC functions matching a pattern."""
        try:
            cfg = config or self._config
            
            result = await self._call_rfc(
                'RFC_FUNCTION_SEARCH',
                config=cfg,
                FUNCNAME=pattern
            )
            
            functions = []
            for func in result.get('FUNCLIST', []):
                fname = func.get('FUNCNAME', '')
                if fname:
                    functions.append(fname)
            
            return SAPResponse(
                success=True,
                data={'pattern': pattern, 'functions': sorted(functions)},
                message=f"Found {len(functions)} functions matching '{pattern}'",
                operation="search_functions"
            )
            
        except Exception as e:
            logger.error(f"Error searching functions: {str(e)}")
            return SAPResponse(
                success=False,
                error=str(e),
                operation="search_functions"
            )
    
    async def get_function_interface(self, function_name: str, config: Optional[SAPConnectionConfig] = None) -> SAPResponse:
        """Get interface definition for an RFC function."""
        try:
            cfg = config or self._config
            
            result = await self._call_rfc(
                'RFC_GET_FUNCTION_INTERFACE',
                config=cfg,
                FUNCNAME=function_name
            )
            
            params = []
            for p in result.get('PARAMS', []):
                params.append({
                    'name': p.get('PARAMETER', ''),
                    'class': p.get('PARAMCLASS', ''),
                    'type': p.get('TABNAME', '') or p.get('EXID', ''),
                    'optional': p.get('OPTIONAL', '') == 'X'
                })
            
            return SAPResponse(
                success=True,
                data={'function': function_name, 'parameters': params},
                message=f"Retrieved interface for {function_name}",
                operation="get_function_interface"
            )
            
        except Exception as e:
            logger.error(f"Error getting function interface: {str(e)}")
            return SAPResponse(
                success=False,
                error=str(e),
                operation="get_function_interface"
            )


# Global service instance
_sap_service: Optional[SAPService] = None


async def get_sap_service() -> SAPService:
    """Get the global SAP service instance."""
    global _sap_service
    if _sap_service is None:
        _sap_service = await SAPService.get_instance()
    return _sap_service

# Developer and Creator: Jai Singh
