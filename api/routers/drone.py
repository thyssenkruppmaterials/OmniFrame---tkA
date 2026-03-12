"""
FastAPI router for Drone Scanner operations.
Provides endpoints for drone scan uploads, AI analysis, search, and missions.
"""

import logging
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends, Query, Path, UploadFile, File
from pydantic import BaseModel

try:
    from ..services.drone_service import (
        get_drone_service, DroneService,
        DroneScanCreate, DroneMissionCreate
    )
    from ..auth.supabase_auth import get_current_user, AuthenticatedUser
    from ..config.settings import settings
except ImportError:
    from services.drone_service import (
        get_drone_service, DroneService,
        DroneScanCreate, DroneMissionCreate
    )
    from auth.supabase_auth import get_current_user, AuthenticatedUser
    from config.settings import settings

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(
    prefix="/drone",
    tags=["Drone Scanner"],
    responses={404: {"description": "Not found"}}
)


# ==================== Response Models ====================

class APIResponse(BaseModel):
    """Standard API response."""
    success: bool
    message: Optional[str] = None
    data: Optional[dict | list] = None
    error: Optional[str] = None


class PaginatedResponse(BaseModel):
    """Paginated response model."""
    success: bool
    data: list
    count: int
    limit: int
    offset: int


# ==================== Error Handlers ====================

def handle_service_error(error: Exception) -> HTTPException:
    """Convert service errors to HTTP exceptions."""
    error_message = str(error)
    
    if "not found" in error_message.lower():
        return HTTPException(status_code=404, detail=error_message)
    elif "permission" in error_message.lower() or "unauthorized" in error_message.lower():
        return HTTPException(status_code=403, detail=error_message)
    else:
        return HTTPException(status_code=500, detail=error_message)


# ==================== Health Check ====================

@router.get("/health")
async def health_check():
    """Check drone service health."""
    return {"status": "healthy", "service": "drone-scanner"}


# ==================== Scan Endpoints ====================

@router.post("/scans", response_model=APIResponse)
async def create_scan(
    scan_data: DroneScanCreate,
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: DroneService = Depends(get_drone_service)
):
    """
    Create a new drone scan record.
    
    The scan will be queued for AI analysis automatically.
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.create_scan(
            scan_data=scan_data,
            organization_id=current_user.organization_id,
            user_id=current_user.id
        )
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to create scan"))
        
        return APIResponse(
            success=True,
            message="Scan created and queued for AI analysis",
            data=result["data"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating scan: {str(e)}")
        raise handle_service_error(e)


@router.get("/scans", response_model=PaginatedResponse)
async def list_scans(
    warehouse_zone: Optional[str] = Query(None, description="Filter by warehouse zone"),
    aisle: Optional[str] = Query(None, description="Filter by aisle"),
    status: Optional[str] = Query(None, description="Filter by AI analysis status"),
    mission_id: Optional[str] = Query(None, description="Filter by mission ID"),
    limit: int = Query(50, ge=1, le=200, description="Maximum results to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: DroneService = Depends(get_drone_service)
):
    """
    List drone scans with optional filters.
    
    Returns scans ordered by capture time (newest first).
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.list_scans(
            organization_id=current_user.organization_id,
            warehouse_zone=warehouse_zone,
            aisle=aisle,
            status=status,
            mission_id=mission_id,
            limit=limit,
            offset=offset
        )
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to list scans"))
        
        return PaginatedResponse(
            success=True,
            data=result["data"],
            count=result["count"],
            limit=limit,
            offset=offset
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing scans: {str(e)}")
        raise handle_service_error(e)


@router.get("/scans/search", response_model=PaginatedResponse)
async def search_scans(
    q: str = Query(..., min_length=1, description="Search query"),
    warehouse_zone: Optional[str] = Query(None, description="Filter by warehouse zone"),
    aisle: Optional[str] = Query(None, description="Filter by aisle"),
    limit: int = Query(50, ge=1, le=200, description="Maximum results to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: DroneService = Depends(get_drone_service)
):
    """
    Full-text search across drone scans.
    
    Searches through:
    - Detected text (SKUs, lot numbers, barcodes, labels)
    - AI-generated spatial descriptions
    - Warehouse zones and aisles
    
    Results are ranked by relevance.
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.search_scans(
            organization_id=current_user.organization_id,
            query=q,
            warehouse_zone=warehouse_zone,
            aisle=aisle,
            limit=limit,
            offset=offset
        )
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("error", "Search failed"))
        
        return PaginatedResponse(
            success=True,
            data=result["data"],
            count=result["count"],
            limit=limit,
            offset=offset
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error searching scans: {str(e)}")
        raise handle_service_error(e)


@router.get("/scans/statistics", response_model=APIResponse)
async def get_scan_statistics(
    days: int = Query(7, ge=1, le=90, description="Number of days to include"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: DroneService = Depends(get_drone_service)
):
    """
    Get scan statistics grouped by warehouse zone.
    
    Returns:
    - Total scans per zone
    - Analysis success/failure rates
    - Average processing time
    - Items detected count
    - Damage detection count
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.get_scan_statistics(
            organization_id=current_user.organization_id,
            days=days
        )
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to get statistics"))
        
        return APIResponse(
            success=True,
            data=result["data"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting statistics: {str(e)}")
        raise handle_service_error(e)


@router.get("/scans/{scan_id}", response_model=APIResponse)
async def get_scan(
    scan_id: str = Path(..., description="Scan ID"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: DroneService = Depends(get_drone_service)
):
    """Get a single drone scan by ID."""
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.get_scan(
            scan_id=scan_id,
            organization_id=current_user.organization_id
        )
        
        if not result["success"]:
            raise HTTPException(status_code=404, detail=result.get("error", "Scan not found"))
        
        return APIResponse(
            success=True,
            data=result["data"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting scan: {str(e)}")
        raise handle_service_error(e)


# ==================== Mission Endpoints ====================

@router.post("/missions", response_model=APIResponse)
async def create_mission(
    mission_data: DroneMissionCreate,
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: DroneService = Depends(get_drone_service)
):
    """
    Create a new drone flight mission.
    
    Missions can include waypoints for automated flight paths
    and specify which zones to scan.
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.create_mission(
            mission_data=mission_data,
            organization_id=current_user.organization_id,
            user_id=current_user.id
        )
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to create mission"))
        
        return APIResponse(
            success=True,
            message="Mission created successfully",
            data=result["data"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating mission: {str(e)}")
        raise handle_service_error(e)


@router.get("/missions", response_model=PaginatedResponse)
async def list_missions(
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(50, ge=1, le=200, description="Maximum results to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: DroneService = Depends(get_drone_service)
):
    """List drone missions with optional filters."""
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.list_missions(
            organization_id=current_user.organization_id,
            status=status,
            limit=limit,
            offset=offset
        )
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to list missions"))
        
        return PaginatedResponse(
            success=True,
            data=result["data"],
            count=result["count"],
            limit=limit,
            offset=offset
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing missions: {str(e)}")
        raise handle_service_error(e)


@router.get("/missions/{mission_id}", response_model=APIResponse)
async def get_mission(
    mission_id: str = Path(..., description="Mission ID"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: DroneService = Depends(get_drone_service)
):
    """Get a single drone mission by ID."""
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.get_mission(
            mission_id=mission_id,
            organization_id=current_user.organization_id
        )
        
        if not result["success"]:
            raise HTTPException(status_code=404, detail=result.get("error", "Mission not found"))
        
        return APIResponse(
            success=True,
            data=result["data"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting mission: {str(e)}")
        raise handle_service_error(e)


@router.patch("/missions/{mission_id}/status", response_model=APIResponse)
async def update_mission_status(
    mission_id: str = Path(..., description="Mission ID"),
    status: str = Query(..., description="New status: planned, in_progress, completed, aborted, failed"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: DroneService = Depends(get_drone_service)
):
    """Update mission status."""
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        valid_statuses = ["planned", "in_progress", "completed", "aborted", "failed"]
        if status not in valid_statuses:
            raise HTTPException(
                status_code=400, 
                detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}"
            )
        
        result = await service.update_mission_status(
            mission_id=mission_id,
            organization_id=current_user.organization_id,
            status=status
        )
        
        if not result["success"]:
            raise HTTPException(status_code=404, detail=result.get("error", "Mission not found"))
        
        return APIResponse(
            success=True,
            message=f"Mission status updated to {status}",
            data=result["data"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating mission status: {str(e)}")
        raise handle_service_error(e)


@router.get("/missions/{mission_id}/scans", response_model=PaginatedResponse)
async def get_mission_scans(
    mission_id: str = Path(..., description="Mission ID"),
    limit: int = Query(100, ge=1, le=500, description="Maximum results to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: DroneService = Depends(get_drone_service)
):
    """Get all scans associated with a mission."""
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.get_mission_scans(
            mission_id=mission_id,
            organization_id=current_user.organization_id,
            limit=limit,
            offset=offset
        )
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to get mission scans"))
        
        return PaginatedResponse(
            success=True,
            data=result["data"],
            count=result["count"],
            limit=limit,
            offset=offset
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting mission scans: {str(e)}")
        raise handle_service_error(e)

# Developer and Creator: Jai Singh
