# Created and developed by Jai Singh
"""
FastAPI router for SAP RFC operations.
Provides RESTful endpoints for SAP ECC and S/4HANA integration.
"""

import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, Query, Path, Body
from pydantic import BaseModel, Field

try:
    from ..services.sap_service import (
        get_sap_service, SAPService, SAPResponse,
        SAPConnectionConfig, SAPSystemType, PYRFC_AVAILABLE
    )
    from ..auth.supabase_auth import get_current_user, AuthenticatedUser, require_admin_role
except ImportError:
    from services.sap_service import (
        get_sap_service, SAPService, SAPResponse,
        SAPConnectionConfig, SAPSystemType, PYRFC_AVAILABLE
    )
    try:
        from auth.supabase_auth import get_current_user, AuthenticatedUser, require_admin_role
    except ImportError:
        from api.auth.supabase_auth import get_current_user, AuthenticatedUser, require_admin_role

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(
    prefix="/sap",
    tags=["SAP Integration"],
    responses={404: {"description": "Not found"}}
)


# ==================== REQUEST/RESPONSE MODELS ====================

class ConnectionTestRequest(BaseModel):
    """Request model for connection test with optional custom config."""
    use_custom_config: bool = False
    user: Optional[str] = None
    passwd: Optional[str] = None
    ashost: Optional[str] = None
    sysnr: Optional[str] = "00"
    client: Optional[str] = "100"
    lang: Optional[str] = "EN"
    saprouter: Optional[str] = None
    system_type: Optional[str] = "S4HANA"


class CreateTORequest(BaseModel):
    """Request model for creating a Transfer Order."""
    warehouse: str = Field(..., description="Warehouse number (e.g., '034')")
    material: str = Field(..., description="Material number")
    quantity: float = Field(..., gt=0, description="Quantity to move")
    source_storage_type: str = Field(..., description="Source storage type")
    source_storage_bin: Optional[str] = Field(None, description="Source storage bin (optional)")
    dest_storage_type: str = Field(..., description="Destination storage type")
    dest_storage_bin: Optional[str] = Field(None, description="Destination storage bin (optional)")
    movement_type: str = Field(default="999", description="Movement type")
    plant: str = Field(default="1010", description="Plant number")
    storage_location: Optional[str] = Field(None, description="Storage location (optional)")


class ConfirmTORequest(BaseModel):
    """Request model for confirming a Transfer Order."""
    warehouse: str = Field(..., description="Warehouse number")
    to_number: str = Field(..., description="Transfer Order number")
    quantity: Optional[float] = Field(None, description="Confirmed quantity (optional)")


class GoodsReceiptRequest(BaseModel):
    """Request model for Goods Receipt (MIGO equivalent)."""
    material: str = Field(..., description="Material number")
    plant: str = Field(..., description="Plant number")
    storage_location: str = Field(..., description="Storage location")
    quantity: float = Field(..., gt=0, description="Quantity to receive")
    movement_type: str = Field(default="501", description="Movement type (101=GR for PO, 501=Receipt w/o reference)")
    po_number: Optional[str] = Field(None, description="Purchase Order number (required for mvt type 101)")
    po_item: Optional[str] = Field(None, description="PO line item number (optional)")
    vendor: Optional[str] = Field(None, description="Vendor number (optional)")
    batch: Optional[str] = Field(None, description="Batch number (optional)")
    cost_center: Optional[str] = Field(None, description="Cost center (required for mvt type 501)")


class FunctionSearchRequest(BaseModel):
    """Request model for searching SAP functions."""
    pattern: str = Field(..., description="Search pattern (e.g., '*TO*CREATE*')")


class SAPBaseResponse(BaseModel):
    """Base response model for SAP operations."""
    success: bool
    message: Optional[str] = None
    error: Optional[str] = None
    data: Optional[Any] = None
    operation: Optional[str] = None


# ==================== ERROR HANDLERS ====================

def handle_sap_error(error: Exception) -> HTTPException:
    """Convert SAP service errors to HTTP exceptions."""
    error_message = str(error)
    
    if "authentication" in error_message.lower() or "logon" in error_message.lower():
        return HTTPException(status_code=401, detail=error_message)
    elif "not_authorized" in error_message.lower():
        return HTTPException(status_code=403, detail=error_message)
    elif "connection" in error_message.lower() or "refused" in error_message.lower():
        return HTTPException(status_code=503, detail=error_message)
    else:
        return HTTPException(status_code=500, detail=error_message)


# ==================== HEALTH & CONNECTION ====================

@router.get("/health", response_model=SAPBaseResponse)
async def sap_health_check():
    """Check SAP integration health and pyrfc availability."""
    return SAPBaseResponse(
        success=PYRFC_AVAILABLE,
        message="SAP RFC SDK is available" if PYRFC_AVAILABLE else "pyrfc library not installed",
        data={
            "pyrfc_available": PYRFC_AVAILABLE,
            "status": "healthy" if PYRFC_AVAILABLE else "unavailable"
        },
        operation="health_check"
    )


@router.post("/test-connection", response_model=SAPBaseResponse)
async def test_connection(
    request: Optional[ConnectionTestRequest] = Body(default=None),
    service: SAPService = Depends(get_sap_service),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Test SAP RFC connection.
    
    Uses default connection parameters if no custom config is provided.
    Returns system information and user details on success.
    """
    import os
    try:
        config = None
        if request and request.use_custom_config:
            # Use environment variables as fallbacks for custom config
            config = SAPConnectionConfig(
                name="Custom Connection",
                user=request.user or os.getenv("SAP_DEFAULT_USER", ""),
                passwd=request.passwd or os.getenv("SAP_DEFAULT_PASSWD", ""),
                ashost=request.ashost or os.getenv("SAP_DEFAULT_ASHOST", ""),
                sysnr=request.sysnr or os.getenv("SAP_DEFAULT_SYSNR", "00"),
                client=request.client or os.getenv("SAP_DEFAULT_CLIENT", "100"),
                lang=request.lang or os.getenv("SAP_DEFAULT_LANG", "EN"),
                saprouter=request.saprouter or os.getenv("SAP_DEFAULT_SAPROUTER"),
                system_type=SAPSystemType(request.system_type) if request.system_type else SAPSystemType.S4HANA
            )
        
        result = await service.test_connection(config)
        
        return SAPBaseResponse(
            success=result.success,
            message=result.message,
            error=result.error,
            data=result.data,
            operation=result.operation
        )
        
    except Exception as e:
        logger.error(f"SAP connection test failed: {str(e)}")
        raise handle_sap_error(e)


# ==================== WAREHOUSE DATA ====================

@router.get("/warehouses", response_model=SAPBaseResponse)
async def get_warehouses(
    include_stock_count: bool = Query(False, description="Include stock count for each warehouse"),
    service: SAPService = Depends(get_sap_service),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Get list of warehouses from SAP. Optionally includes stock counts."""
    try:
        result = await service.get_warehouses(include_stock_count=include_stock_count)
        return SAPBaseResponse(
            success=result.success,
            message=result.message,
            error=result.error,
            data=result.data,
            operation=result.operation
        )
    except Exception as e:
        logger.error(f"Get warehouses failed: {str(e)}")
        raise handle_sap_error(e)


@router.get("/warehouses/{warehouse}/storage-types", response_model=SAPBaseResponse)
async def get_storage_types(
    warehouse: str = Path(..., description="Warehouse number"),
    service: SAPService = Depends(get_sap_service),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Get storage types for a specific warehouse."""
    try:
        result = await service.get_storage_types(warehouse)
        return SAPBaseResponse(
            success=result.success,
            message=result.message,
            error=result.error,
            data=result.data,
            operation=result.operation
        )
    except Exception as e:
        logger.error(f"Get storage types failed: {str(e)}")
        raise handle_sap_error(e)


@router.get("/warehouses/{warehouse}/stock", response_model=SAPBaseResponse)
async def get_warehouse_stock(
    warehouse: str = Path(..., description="Warehouse number"),
    service: SAPService = Depends(get_sap_service),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Get available stock/quants for a warehouse."""
    try:
        result = await service.get_warehouse_stock(warehouse)
        return SAPBaseResponse(
            success=result.success,
            message=result.message,
            error=result.error,
            data=result.data,
            operation=result.operation
        )
    except Exception as e:
        logger.error(f"Get warehouse stock failed: {str(e)}")
        raise handle_sap_error(e)


@router.get("/warehouse-data", response_model=SAPBaseResponse)
async def get_warehouse_data(
    warehouse: Optional[str] = Query(None, description="Filter by warehouse number"),
    service: SAPService = Depends(get_sap_service),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Get comprehensive warehouse data including warehouses, storage types, and stock.
    If warehouse is specified, returns detailed data for that warehouse only.
    """
    try:
        # Get warehouses
        warehouses_result = await service.get_warehouses()
        
        if warehouse:
            # Get detailed data for specific warehouse
            storage_result = await service.get_storage_types(warehouse)
            stock_result = await service.get_warehouse_stock(warehouse)
            
            return SAPBaseResponse(
                success=True,
                message=f"Warehouse data for {warehouse}",
                data={
                    "warehouse": warehouse,
                    "storage_types": storage_result.data.get("storage_types", []) if storage_result.success else [],
                    "stock": stock_result.data.get("stock", []) if stock_result.success else [],
                    "stock_count": stock_result.data.get("count", 0) if stock_result.success else 0
                },
                operation="get_warehouse_data"
            )
        else:
            return SAPBaseResponse(
                success=warehouses_result.success,
                message=warehouses_result.message,
                error=warehouses_result.error,
                data=warehouses_result.data,
                operation="get_warehouse_data"
            )
            
    except Exception as e:
        logger.error(f"Get warehouse data failed: {str(e)}")
        raise handle_sap_error(e)


# ==================== TRANSFER ORDER OPERATIONS ====================

@router.get("/open-tos", response_model=SAPBaseResponse)
async def get_open_transfer_orders(
    warehouse: Optional[str] = Query(None, description="Filter by warehouse number"),
    service: SAPService = Depends(get_sap_service),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Get all open (unconfirmed) transfer orders."""
    try:
        result = await service.get_open_transfer_orders(warehouse)
        return SAPBaseResponse(
            success=result.success,
            message=result.message,
            error=result.error,
            data=result.data,
            operation=result.operation
        )
    except Exception as e:
        logger.error(f"Get open TOs failed: {str(e)}")
        raise handle_sap_error(e)


@router.post("/create-to", response_model=SAPBaseResponse)
async def create_transfer_order(
    request: CreateTORequest,
    service: SAPService = Depends(get_sap_service),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Create a new Transfer Order in SAP.
    
    Uses custom Z_RFC_WM_TO_CREATE function for Classic WM.
    """
    try:
        result = await service.create_transfer_order(
            warehouse=request.warehouse,
            material=request.material,
            quantity=request.quantity,
            source_storage_type=request.source_storage_type,
            source_storage_bin=request.source_storage_bin,
            dest_storage_type=request.dest_storage_type,
            dest_storage_bin=request.dest_storage_bin,
            movement_type=request.movement_type,
            plant=request.plant,
            storage_location=request.storage_location
        )
        
        if not result.success:
            return SAPBaseResponse(
                success=False,
                message="Transfer Order creation failed",
                error=result.error,
                data=result.data,
                operation=result.operation
            )
        
        return SAPBaseResponse(
            success=result.success,
            message=result.message,
            error=result.error,
            data=result.data,
            operation=result.operation
        )
        
    except Exception as e:
        logger.error(f"Create TO failed: {str(e)}")
        raise handle_sap_error(e)


@router.post("/confirm-to", response_model=SAPBaseResponse)
async def confirm_transfer_order(
    request: ConfirmTORequest,
    service: SAPService = Depends(get_sap_service),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Confirm a Transfer Order in SAP.
    
    Supports both EWM (S/4HANA) and Classic WM (ECC) systems.
    """
    try:
        result = await service.confirm_transfer_order(
            warehouse=request.warehouse,
            to_number=request.to_number,
            quantity=request.quantity
        )
        
        if not result.success:
            return SAPBaseResponse(
                success=False,
                message="Transfer Order confirmation failed",
                error=result.error,
                data=result.data,
                operation=result.operation
            )
        
        return SAPBaseResponse(
            success=result.success,
            message=result.message,
            error=result.error,
            data=result.data,
            operation=result.operation
        )
        
    except Exception as e:
        logger.error(f"Confirm TO failed: {str(e)}")
        raise handle_sap_error(e)


# ==================== GOODS RECEIPT (MIGO) ====================

@router.post("/goods-receipt", response_model=SAPBaseResponse)
async def create_goods_receipt(
    request: GoodsReceiptRequest,
    service: SAPService = Depends(get_sap_service),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Create a Goods Receipt (MIGO equivalent) in SAP.
    
    One-click GR posting using Z_RFC_GOODS_RECEIPT or BAPI_GOODSMVT_CREATE.
    
    Movement Types:
    - 101: GR for Purchase Order (requires po_number)
    - 501: Receipt without PO reference
    """
    try:
        result = await service.create_goods_receipt(
            material=request.material,
            plant=request.plant,
            storage_location=request.storage_location,
            quantity=request.quantity,
            movement_type=request.movement_type,
            po_number=request.po_number,
            po_item=request.po_item,
            vendor=request.vendor,
            batch=request.batch,
            cost_center=request.cost_center
        )
        
        if not result.success:
            return SAPBaseResponse(
                success=False,
                message="Goods Receipt posting failed",
                error=result.error,
                data=result.data,
                operation=result.operation
            )
        
        return SAPBaseResponse(
            success=result.success,
            message=result.message,
            error=result.error,
            data=result.data,
            operation=result.operation
        )
        
    except Exception as e:
        logger.error(f"Goods Receipt failed: {str(e)}")
        raise handle_sap_error(e)


# ==================== FUNCTION DISCOVERY ====================

@router.post("/search-functions", response_model=SAPBaseResponse)
async def search_functions(
    request: FunctionSearchRequest,
    service: SAPService = Depends(get_sap_service),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Search for available RFC functions in SAP.
    
    Useful for discovering available APIs.
    Pattern supports wildcards (e.g., '*TO*CREATE*', '/SCWM/*').
    """
    try:
        result = await service.search_functions(request.pattern)
        return SAPBaseResponse(
            success=result.success,
            message=result.message,
            error=result.error,
            data=result.data,
            operation=result.operation
        )
    except Exception as e:
        logger.error(f"Search functions failed: {str(e)}")
        raise handle_sap_error(e)


@router.get("/function-interface/{function_name}", response_model=SAPBaseResponse)
async def get_function_interface(
    function_name: str = Path(..., description="RFC function name"),
    service: SAPService = Depends(get_sap_service),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Get interface definition for an RFC function.
    
    Returns parameter definitions including names, types, and whether they're optional.
    """
    try:
        result = await service.get_function_interface(function_name)
        return SAPBaseResponse(
            success=result.success,
            message=result.message,
            error=result.error,
            data=result.data,
            operation=result.operation
        )
    except Exception as e:
        logger.error(f"Get function interface failed: {str(e)}")
        raise handle_sap_error(e)


# ==================== RAW RFC CALL (ADMIN ONLY) ====================

class RawRFCRequest(BaseModel):
    """Request model for raw RFC function call."""
    function_name: str = Field(..., description="RFC function name to call")
    parameters: Dict[str, Any] = Field(default={}, description="Function parameters")


@router.post("/raw-call", response_model=SAPBaseResponse)
async def raw_rfc_call(
    request: RawRFCRequest,
    service: SAPService = Depends(get_sap_service),
    current_user: AuthenticatedUser = Depends(get_current_user),
    _admin=Depends(require_admin_role()),
):
    """
    Execute a raw RFC function call (for advanced users/testing).
    
    WARNING: This endpoint allows direct RFC calls. Requires admin role.
    """
    try:
        # Log the call for audit
        logger.info(f"Raw RFC call: {request.function_name}")
        
        result = await service._call_rfc(request.function_name, **request.parameters)
        
        return SAPBaseResponse(
            success=True,
            message=f"RFC call to {request.function_name} completed",
            data=result,
            operation="raw_rfc_call"
        )
        
    except Exception as e:
        logger.error(f"Raw RFC call failed: {str(e)}")
        raise handle_sap_error(e)

# Created and developed by Jai Singh
