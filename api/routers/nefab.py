# Created and developed by Jai Singh
"""
FastAPI router for Nefab PFC Trace API integration.

Provides endpoints for kit cart tracking and item status.

Author: OneBox AI Team
Date: December 17, 2025
Version: 1.0.0
"""

import logging
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends, Query

try:
    from ..services.nefab_service import get_nefab_service, NefabService
    from ..models.nefab_models import (
        NefabItemsResponse, NefabStatisticsResponse, NefabServiceResponse,
        NefabItemTypesResponse, NEFAB_ITEM_TYPES, KIT_CART_ITEM_TYPE_IDS
    )
    from ..auth.supabase_auth import get_current_user, AuthenticatedUser
except ImportError:
    from services.nefab_service import get_nefab_service, NefabService
    from models.nefab_models import (
        NefabItemsResponse, NefabStatisticsResponse, NefabServiceResponse,
        NefabItemTypesResponse, NEFAB_ITEM_TYPES, KIT_CART_ITEM_TYPE_IDS
    )
    from auth.supabase_auth import get_current_user, AuthenticatedUser

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(
    prefix="/nefab",
    tags=["Nefab PFC Trace"],
    responses={404: {"description": "Not found"}}
)


# ==================== DEPENDENCY INJECTION ====================

async def get_authenticated_nefab_service(
    current_user: AuthenticatedUser = Depends(get_current_user)
) -> NefabService:
    """Get Nefab service with authenticated user context."""
    service = await get_nefab_service()
    return service


# ==================== ERROR HANDLERS ====================

def handle_service_error(error: Exception) -> HTTPException:
    """Convert service errors to HTTP exceptions."""
    error_message = str(error)
    
    if "authentication" in error_message.lower() or "api key" in error_message.lower():
        return HTTPException(status_code=401, detail=error_message)
    elif "rate limit" in error_message.lower():
        return HTTPException(status_code=429, detail=error_message)
    elif "not found" in error_message.lower():
        return HTTPException(status_code=404, detail=error_message)
    elif "timeout" in error_message.lower():
        return HTTPException(status_code=504, detail=error_message)
    else:
        return HTTPException(status_code=500, detail=error_message)


# ==================== HEALTH & STATUS ====================

@router.get("/health", response_model=NefabServiceResponse)
async def health_check(
    service: NefabService = Depends(get_nefab_service)
):
    """
    Check Nefab API connection health.
    
    Returns:
        Connection status and basic statistics
    """
    try:
        return await service.test_connection()
    except Exception as e:
        logger.error(f"Nefab health check failed: {str(e)}")
        raise handle_service_error(e)


# ==================== ITEMS ENDPOINTS ====================

@router.get("/items", response_model=NefabItemsResponse)
async def get_all_items(
    item_type_id: Optional[int] = Query(None, description="Filter by item type ID"),
    use_cache: bool = Query(True, description="Use cached data if available"),
    service: NefabService = Depends(get_authenticated_nefab_service)
):
    """
    Get all items from Nefab PFC Trace.
    
    Args:
        item_type_id: Optional filter by specific item type
        use_cache: Whether to use cached data (default: True)
    
    Returns:
        List of all items with their current status
    """
    try:
        return await service.get_all_items(
            item_type_id=item_type_id,
            use_cache=use_cache
        )
    except Exception as e:
        logger.error(f"Get all items failed: {str(e)}")
        raise handle_service_error(e)


@router.get("/kit-carts", response_model=NefabItemsResponse)
async def get_kit_carts(
    use_cache: bool = Query(True, description="Use cached data if available"),
    service: NefabService = Depends(get_authenticated_nefab_service)
):
    """
    Get all kit cart items (filtered to kit cart types).
    
    This endpoint returns only items that are classified as kit carts:
    - Kit Cart AE Common (305)
    - Kit Cart LiftFan (310)
    - Kit Cart 2100 Flow (311)
    - Kit Cart 1107 Flow (312)
    - Kit Cart 3007 Flow (313)
    - Kit Cart Series II (314)
    - Kit Cart Series IV (315)
    - Kit Cart RR300 (316)
    - Kit Cart Industrial (319)
    
    Args:
        use_cache: Whether to use cached data (default: True)
    
    Returns:
        List of kit cart items with their current status
    """
    try:
        return await service.get_kit_carts(use_cache=use_cache)
    except Exception as e:
        logger.error(f"Get kit carts failed: {str(e)}")
        raise handle_service_error(e)


@router.get("/items/by-type/{item_type_id}", response_model=NefabItemsResponse)
async def get_items_by_type(
    item_type_id: int,
    use_cache: bool = Query(True, description="Use cached data if available"),
    service: NefabService = Depends(get_authenticated_nefab_service)
):
    """
    Get items filtered by specific item type ID.
    
    Args:
        item_type_id: The item type ID to filter by
        use_cache: Whether to use cached data (default: True)
    
    Returns:
        List of items of the specified type
    """
    try:
        return await service.get_all_items(
            item_type_id=item_type_id,
            use_cache=use_cache
        )
    except Exception as e:
        logger.error(f"Get items by type {item_type_id} failed: {str(e)}")
        raise handle_service_error(e)


# ==================== ITEM TYPES ====================

@router.get("/item-types", response_model=NefabItemTypesResponse)
async def get_item_types(
    kit_carts_only: bool = Query(False, description="Return only kit cart types")
):
    """
    Get list of available item types.
    
    Args:
        kit_carts_only: If True, return only kit cart types
    
    Returns:
        List of item type definitions with IDs and names
    """
    if kit_carts_only:
        filtered_types = [t for t in NEFAB_ITEM_TYPES if t.Id in KIT_CART_ITEM_TYPE_IDS]
        return NefabItemTypesResponse(
            success=True,
            message=f"Retrieved {len(filtered_types)} kit cart item types",
            item_types=filtered_types
        )
    
    return NefabItemTypesResponse(
        success=True,
        message=f"Retrieved {len(NEFAB_ITEM_TYPES)} item types",
        item_types=NEFAB_ITEM_TYPES
    )


# ==================== STATISTICS ====================

@router.get("/statistics", response_model=NefabStatisticsResponse)
async def get_statistics(
    use_cache: bool = Query(True, description="Use cached data if available"),
    service: NefabService = Depends(get_authenticated_nefab_service)
):
    """
    Get aggregated statistics for all items.
    
    Returns:
        Statistics including counts by item type, status, and warehouse
    """
    try:
        return await service.get_statistics(use_cache=use_cache)
    except Exception as e:
        logger.error(f"Get statistics failed: {str(e)}")
        raise handle_service_error(e)


# ==================== CACHE MANAGEMENT ====================

@router.post("/cache/clear", response_model=NefabServiceResponse)
async def clear_cache(
    service: NefabService = Depends(get_authenticated_nefab_service)
):
    """
    Clear the Nefab API cache.
    
    Use this to force fresh data on the next request.
    
    Returns:
        Confirmation message
    """
    try:
        service.clear_cache()
        return NefabServiceResponse(
            success=True,
            message="Cache cleared successfully"
        )
    except Exception as e:
        logger.error(f"Clear cache failed: {str(e)}")
        raise handle_service_error(e)


@router.get("/items/refresh", response_model=NefabItemsResponse)
async def refresh_items(
    item_type_id: Optional[int] = Query(None, description="Filter by item type ID"),
    service: NefabService = Depends(get_authenticated_nefab_service)
):
    """
    Get fresh items data, bypassing the cache.
    
    Args:
        item_type_id: Optional filter by specific item type
    
    Returns:
        Fresh list of items from the API
    """
    try:
        return await service.get_all_items(
            item_type_id=item_type_id,
            use_cache=False
        )
    except Exception as e:
        logger.error(f"Refresh items failed: {str(e)}")
        raise handle_service_error(e)

# Created and developed by Jai Singh
