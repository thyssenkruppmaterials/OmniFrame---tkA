"""
FastAPI router for Camera operations.
Provides endpoints for camera devices, recordings, events, and streaming proxy.
"""

import logging
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Query, Path
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
import httpx

try:
    from ..services.camera_service import get_camera_service, CameraService
    from ..auth.supabase_auth import get_current_user, AuthenticatedUser
    from ..config.settings import settings
    from ..models.camera_models import (
        CameraDeviceCreate, CameraDeviceUpdate, CameraDeviceResponse,
        CameraListResponse, CameraRecordingFilter, RecordingListResponse,
        CameraEventFilter, EventListResponse, CameraEventAcknowledge,
        CameraUserPreferences, CameraUserPreferencesUpdate,
        CameraSyncRequest, CameraSyncResponse,
        SnapshotResponse, CameraStatus, CameraEventType, RecordingStatus
    )
except ImportError:
    from services.camera_service import get_camera_service, CameraService
    from auth.supabase_auth import get_current_user, AuthenticatedUser
    from config.settings import settings
    from models.camera_models import (
        CameraDeviceCreate, CameraDeviceUpdate, CameraDeviceResponse,
        CameraListResponse, CameraRecordingFilter, RecordingListResponse,
        CameraEventFilter, EventListResponse, CameraEventAcknowledge,
        CameraUserPreferences, CameraUserPreferencesUpdate,
        CameraSyncRequest, CameraSyncResponse,
        SnapshotResponse, CameraStatus, CameraEventType, RecordingStatus
    )

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(
    prefix="/camera",
    tags=["Camera"],
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
    """Check camera service health."""
    return {"status": "healthy", "service": "camera"}


# ==================== Camera Device Endpoints ====================

@router.get("/devices", response_model=PaginatedResponse)
async def list_cameras(
    zone: Optional[str] = Query(None, description="Filter by warehouse zone"),
    status: Optional[str] = Query(None, description="Filter by camera status"),
    is_enabled: Optional[bool] = Query(None, description="Filter by enabled status"),
    limit: int = Query(50, ge=1, le=200, description="Maximum results to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: CameraService = Depends(get_camera_service)
):
    """
    List all cameras for the organization.
    
    Returns cameras ordered by name with optional filtering.
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.list_cameras(
            organization_id=current_user.organization_id,
            zone=zone,
            status=status,
            is_enabled=is_enabled,
            limit=limit,
            offset=offset
        )
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to list cameras"))
        
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
        logger.error(f"Error listing cameras: {str(e)}")
        raise handle_service_error(e)


@router.get("/devices/{camera_id}", response_model=APIResponse)
async def get_camera(
    camera_id: str = Path(..., description="Camera ID"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: CameraService = Depends(get_camera_service)
):
    """Get a single camera device by ID."""
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.get_camera(
            camera_id=camera_id,
            organization_id=current_user.organization_id
        )
        
        if not result["success"]:
            raise HTTPException(status_code=404, detail=result.get("error", "Camera not found"))
        
        return APIResponse(
            success=True,
            data=result["data"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting camera: {str(e)}")
        raise handle_service_error(e)


@router.post("/devices", response_model=APIResponse)
async def create_camera(
    camera_data: CameraDeviceCreate,
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: CameraService = Depends(get_camera_service)
):
    """Create a new camera device record."""
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.create_camera(
            camera_data=camera_data,
            organization_id=current_user.organization_id,
            user_id=current_user.id
        )
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to create camera"))
        
        return APIResponse(
            success=True,
            message="Camera created successfully",
            data=result["data"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating camera: {str(e)}")
        raise handle_service_error(e)


@router.patch("/devices/{camera_id}", response_model=APIResponse)
async def update_camera(
    camera_id: str = Path(..., description="Camera ID"),
    camera_data: CameraDeviceUpdate = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: CameraService = Depends(get_camera_service)
):
    """Update a camera device."""
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.update_camera(
            camera_id=camera_id,
            organization_id=current_user.organization_id,
            camera_data=camera_data
        )
        
        if not result["success"]:
            raise HTTPException(status_code=404, detail=result.get("error", "Camera not found"))
        
        return APIResponse(
            success=True,
            message="Camera updated successfully",
            data=result["data"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating camera: {str(e)}")
        raise handle_service_error(e)


# ==================== Stream Endpoints ====================

@router.get("/stream/{camera_id}")
async def get_camera_stream(
    camera_id: str = Path(..., description="Camera ID"),
    quality: str = Query("auto", description="Stream quality (low, medium, high, auto)"),
    format: str = Query("mjpeg", description="Stream format (mjpeg, hls)"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: CameraService = Depends(get_camera_service)
):
    """
    Proxy to rust-streaming-service for MJPEG stream.
    
    This endpoint proxies the video stream from the Rust streaming service
    to provide secure, authenticated access to camera feeds.
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        # Verify camera exists and user has access
        result = await service.get_camera(
            camera_id=camera_id,
            organization_id=current_user.organization_id
        )
        
        if not result["success"]:
            raise HTTPException(status_code=404, detail="Camera not found")
        
        camera = result["data"]
        
        # Check if camera is enabled
        if not camera.get("is_enabled", True):
            raise HTTPException(status_code=403, detail="Camera is disabled")
        
        # Get streaming service URL from settings
        streaming_service_url = getattr(settings, 'streaming_service_url', None)
        
        if not streaming_service_url:
            # Return placeholder for development
            return JSONResponse(
                content={
                    "success": True,
                    "message": "Stream proxy endpoint - streaming service URL not configured",
                    "camera_id": camera_id,
                    "stream_url": camera.get("stream_url"),
                    "quality": quality,
                    "format": format
                }
            )
        
        # Proxy to streaming service
        async def stream_generator():
            async with httpx.AsyncClient() as client:
                stream_endpoint = f"{streaming_service_url}/stream/{camera_id}"
                async with client.stream(
                    "GET",
                    stream_endpoint,
                    params={"quality": quality, "format": format},
                    headers={"X-Organization-ID": current_user.organization_id}
                ) as response:
                    async for chunk in response.aiter_bytes():
                        yield chunk
        
        content_type = "multipart/x-mixed-replace; boundary=frame" if format == "mjpeg" else "application/vnd.apple.mpegurl"
        
        return StreamingResponse(
            stream_generator(),
            media_type=content_type
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error streaming camera: {str(e)}")
        raise handle_service_error(e)


@router.get("/snapshot/{camera_id}", response_model=APIResponse)
async def get_camera_snapshot(
    camera_id: str = Path(..., description="Camera ID"),
    quality: str = Query("high", description="Snapshot quality"),
    save_to_storage: bool = Query(False, description="Save snapshot to storage"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: CameraService = Depends(get_camera_service)
):
    """
    Get a single frame snapshot from the camera.
    
    Optionally saves the snapshot to storage for later retrieval.
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        # Verify camera exists and user has access
        result = await service.get_camera(
            camera_id=camera_id,
            organization_id=current_user.organization_id
        )
        
        if not result["success"]:
            raise HTTPException(status_code=404, detail="Camera not found")
        
        camera = result["data"]
        
        # Check if camera is enabled
        if not camera.get("is_enabled", True):
            raise HTTPException(status_code=403, detail="Camera is disabled")
        
        # In production, this would fetch from streaming service
        # For now, return camera thumbnail or placeholder
        snapshot_data = {
            "camera_id": camera_id,
            "snapshot_url": camera.get("thumbnail_url") or f"/api/camera/snapshot/{camera_id}/image",
            "timestamp": datetime.utcnow().isoformat(),
            "quality": quality,
            "storage_url": None
        }
        
        if save_to_storage:
            # In production, would upload to Supabase storage
            snapshot_data["storage_url"] = f"camera-snapshots/{camera_id}/{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.jpg"
        
        return APIResponse(
            success=True,
            data=snapshot_data
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting snapshot: {str(e)}")
        raise handle_service_error(e)


# ==================== Recording Endpoints ====================

@router.get("/recordings", response_model=PaginatedResponse)
async def list_recordings(
    camera_id: Optional[str] = Query(None, description="Filter by camera ID"),
    status: Optional[str] = Query(None, description="Filter by recording status"),
    triggered_by: Optional[str] = Query(None, description="Filter by trigger type"),
    start_date: Optional[datetime] = Query(None, description="Filter recordings after this date"),
    end_date: Optional[datetime] = Query(None, description="Filter recordings before this date"),
    min_duration: Optional[int] = Query(None, description="Minimum duration in seconds"),
    limit: int = Query(50, ge=1, le=200, description="Maximum results to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: CameraService = Depends(get_camera_service)
):
    """
    List recordings with optional filters.
    
    Returns recordings ordered by start time (newest first).
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        # Build filter
        filters = None
        if any([camera_id, status, triggered_by, start_date, end_date, min_duration]):
            filters = CameraRecordingFilter(
                camera_id=camera_id,
                status=RecordingStatus(status) if status else None,
                triggered_by=triggered_by,
                start_date=start_date,
                end_date=end_date,
                min_duration=min_duration
            )
        
        result = await service.list_recordings(
            organization_id=current_user.organization_id,
            filters=filters,
            limit=limit,
            offset=offset
        )
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to list recordings"))
        
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
        logger.error(f"Error listing recordings: {str(e)}")
        raise handle_service_error(e)


@router.get("/recordings/{recording_id}", response_model=APIResponse)
async def get_recording(
    recording_id: str = Path(..., description="Recording ID"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: CameraService = Depends(get_camera_service)
):
    """Get a single recording by ID."""
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.get_recording(
            recording_id=recording_id,
            organization_id=current_user.organization_id
        )
        
        if not result["success"]:
            raise HTTPException(status_code=404, detail=result.get("error", "Recording not found"))
        
        return APIResponse(
            success=True,
            data=result["data"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting recording: {str(e)}")
        raise handle_service_error(e)


@router.get("/recordings/{recording_id}/download")
async def download_recording(
    recording_id: str = Path(..., description="Recording ID"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: CameraService = Depends(get_camera_service)
):
    """
    Download a recording clip.
    
    Returns the video file for download or a redirect to the storage URL.
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.get_recording(
            recording_id=recording_id,
            organization_id=current_user.organization_id
        )
        
        if not result["success"]:
            raise HTTPException(status_code=404, detail=result.get("error", "Recording not found"))
        
        recording = result["data"]
        
        # Check if recording is completed
        if recording.get("status") != RecordingStatus.COMPLETED.value:
            raise HTTPException(status_code=400, detail="Recording is not yet complete")
        
        storage_url = recording.get("storage_url")
        
        if not storage_url:
            raise HTTPException(status_code=404, detail="Recording file not available")
        
        # In production, return redirect or stream from storage
        return JSONResponse(
            content={
                "success": True,
                "download_url": storage_url,
                "filename": f"recording_{recording_id}.mp4",
                "file_size_bytes": recording.get("file_size_bytes"),
                "duration_seconds": recording.get("duration_seconds")
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading recording: {str(e)}")
        raise handle_service_error(e)


# ==================== Event Endpoints ====================

@router.get("/events", response_model=PaginatedResponse)
async def list_events(
    camera_id: Optional[str] = Query(None, description="Filter by camera ID"),
    event_type: Optional[str] = Query(None, description="Filter by event type"),
    is_acknowledged: Optional[bool] = Query(None, description="Filter by acknowledgement status"),
    start_date: Optional[datetime] = Query(None, description="Filter events after this date"),
    end_date: Optional[datetime] = Query(None, description="Filter events before this date"),
    zone: Optional[str] = Query(None, description="Filter by motion zone"),
    limit: int = Query(50, ge=1, le=200, description="Maximum results to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: CameraService = Depends(get_camera_service)
):
    """
    List camera events with optional filters.
    
    Events include motion detection, alarms, and system events.
    Returns events ordered by timestamp (newest first).
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        # Build filter
        filters = None
        if any([camera_id, event_type, is_acknowledged is not None, start_date, end_date, zone]):
            filters = CameraEventFilter(
                camera_id=camera_id,
                event_type=CameraEventType(event_type) if event_type else None,
                is_acknowledged=is_acknowledged,
                start_date=start_date,
                end_date=end_date,
                zone=zone
            )
        
        result = await service.list_events(
            organization_id=current_user.organization_id,
            filters=filters,
            limit=limit,
            offset=offset
        )
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to list events"))
        
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
        logger.error(f"Error listing events: {str(e)}")
        raise handle_service_error(e)


@router.get("/events/{event_id}", response_model=APIResponse)
async def get_event(
    event_id: str = Path(..., description="Event ID"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: CameraService = Depends(get_camera_service)
):
    """Get a single event by ID."""
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.get_event(
            event_id=event_id,
            organization_id=current_user.organization_id
        )
        
        if not result["success"]:
            raise HTTPException(status_code=404, detail=result.get("error", "Event not found"))
        
        return APIResponse(
            success=True,
            data=result["data"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting event: {str(e)}")
        raise handle_service_error(e)


@router.post("/events/{event_id}/acknowledge", response_model=APIResponse)
async def acknowledge_event(
    event_id: str = Path(..., description="Event ID"),
    ack_data: Optional[CameraEventAcknowledge] = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: CameraService = Depends(get_camera_service)
):
    """
    Acknowledge a camera event.
    
    Marks the event as acknowledged by the current user.
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        notes = ack_data.notes if ack_data else None
        
        result = await service.acknowledge_event(
            event_id=event_id,
            organization_id=current_user.organization_id,
            user_id=current_user.id,
            notes=notes
        )
        
        if not result["success"]:
            raise HTTPException(status_code=404, detail=result.get("error", "Event not found"))
        
        return APIResponse(
            success=True,
            message="Event acknowledged successfully",
            data=result["data"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error acknowledging event: {str(e)}")
        raise handle_service_error(e)


@router.get("/events/unacknowledged/count", response_model=APIResponse)
async def get_unacknowledged_count(
    camera_id: Optional[str] = Query(None, description="Filter by camera ID"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: CameraService = Depends(get_camera_service)
):
    """Get count of unacknowledged events."""
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.get_unacknowledged_count(
            organization_id=current_user.organization_id,
            camera_id=camera_id
        )
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to get count"))
        
        return APIResponse(
            success=True,
            data={"unacknowledged_count": result["count"]}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting unacknowledged count: {str(e)}")
        raise handle_service_error(e)


# ==================== User Preferences Endpoints ====================

@router.get("/preferences", response_model=APIResponse)
async def get_user_preferences(
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: CameraService = Depends(get_camera_service)
):
    """Get user preferences for camera viewing."""
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.get_user_preferences(
            user_id=current_user.id,
            organization_id=current_user.organization_id
        )
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to get preferences"))
        
        return APIResponse(
            success=True,
            data=result["data"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting preferences: {str(e)}")
        raise handle_service_error(e)


@router.put("/preferences", response_model=APIResponse)
async def update_user_preferences(
    preferences: CameraUserPreferencesUpdate,
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: CameraService = Depends(get_camera_service)
):
    """Update user preferences for camera viewing."""
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.update_user_preferences(
            user_id=current_user.id,
            organization_id=current_user.organization_id,
            preferences=preferences
        )
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to update preferences"))
        
        return APIResponse(
            success=True,
            message="Preferences updated successfully",
            data=result["data"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating preferences: {str(e)}")
        raise handle_service_error(e)


# ==================== Admin Endpoints ====================

@router.post("/sync", response_model=APIResponse)
async def sync_cameras_from_exacq(
    sync_request: Optional[CameraSyncRequest] = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: CameraService = Depends(get_camera_service)
):
    """
    Sync cameras from ExacqVision server.
    
    Admin only - requires appropriate permissions.
    Fetches camera configurations from ExacqVision and updates the database.
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        # Check for admin permission
        # In production, would verify user has admin role or specific permission
        if current_user.role not in ["admin", "super_admin"]:
            raise HTTPException(status_code=403, detail="Admin access required for camera sync")
        
        exacq_server_url = sync_request.exacq_server_url if sync_request else None
        force_refresh = sync_request.force_refresh if sync_request else False
        
        result = await service.sync_cameras_from_exacq(
            organization_id=current_user.organization_id,
            exacq_server_url=exacq_server_url,
            force_refresh=force_refresh
        )
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("errors", ["Sync failed"])[0])
        
        return APIResponse(
            success=True,
            message="Camera sync completed",
            data={
                "cameras_added": result["cameras_added"],
                "cameras_updated": result["cameras_updated"],
                "cameras_removed": result["cameras_removed"],
                "errors": result["errors"],
                "sync_timestamp": result["sync_timestamp"]
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error syncing cameras: {str(e)}")
        raise handle_service_error(e)


# ==================== Statistics Endpoints ====================

@router.get("/statistics", response_model=APIResponse)
async def get_camera_statistics(
    days: int = Query(7, ge=1, le=90, description="Number of days to include"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: CameraService = Depends(get_camera_service)
):
    """
    Get camera statistics for the organization.
    
    Returns:
    - Camera counts by status
    - Event counts by type
    - Recording statistics
    - Storage usage
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User has no organization")
        
        result = await service.get_camera_statistics(
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

# Developer and Creator: Jai Singh
