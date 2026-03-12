"""
Camera Service for OmniFrame Logistics.
Handles camera device management, recordings, events, and ExacqVision integration.
"""

import logging
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

try:
    from ..utils.supabase_client import get_supabase_client
    from ..config.settings import settings
    from ..models.camera_models import (
        CameraDeviceCreate, CameraDeviceUpdate,
        CameraRecordingCreate, CameraRecordingFilter,
        CameraEventCreate, CameraEventFilter,
        CameraUserPreferences, CameraUserPreferencesUpdate,
        CameraStatus, CameraEventType, RecordingStatus
    )
except ImportError:
    from utils.supabase_client import get_supabase_client
    from config.settings import settings
    from models.camera_models import (
        CameraDeviceCreate, CameraDeviceUpdate,
        CameraRecordingCreate, CameraRecordingFilter,
        CameraEventCreate, CameraEventFilter,
        CameraUserPreferences, CameraUserPreferencesUpdate,
        CameraStatus, CameraEventType, RecordingStatus
    )


class CameraService:
    """Service for camera operations."""
    
    def __init__(self):
        self.supabase = None
    
    async def _get_client(self):
        """Get Supabase client lazily."""
        if self.supabase is None:
            self.supabase = await get_supabase_client()
        return self.supabase
    
    # ==================== Camera Devices ====================
    
    async def list_cameras(
        self,
        organization_id: str,
        zone: Optional[str] = None,
        status: Optional[str] = None,
        is_enabled: Optional[bool] = None,
        limit: int = 50,
        offset: int = 0
    ) -> Dict[str, Any]:
        """List camera devices with optional filters."""
        try:
            client = await self._get_client()
            
            query = client.table("camera_devices")\
                .select("*")\
                .eq("organization_id", organization_id)\
                .order("name", desc=False)
            
            if zone:
                query = query.eq("zone", zone)
            if status:
                query = query.eq("status", status)
            if is_enabled is not None:
                query = query.eq("is_enabled", is_enabled)
            
            query = query.range(offset, offset + limit - 1)
            
            result = query.execute()
            
            return {
                "success": True,
                "data": result.data,
                "count": len(result.data)
            }
            
        except Exception as e:
            logger.error(f"Error listing cameras: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def get_camera(
        self,
        camera_id: str,
        organization_id: str
    ) -> Dict[str, Any]:
        """Get a single camera device by ID."""
        try:
            client = await self._get_client()
            
            result = client.table("camera_devices")\
                .select("*")\
                .eq("id", camera_id)\
                .eq("organization_id", organization_id)\
                .single()\
                .execute()
            
            if result.data:
                return {"success": True, "data": result.data}
            else:
                return {"success": False, "error": "Camera not found"}
            
        except Exception as e:
            logger.error(f"Error getting camera: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def create_camera(
        self,
        camera_data: CameraDeviceCreate,
        organization_id: str,
        user_id: str
    ) -> Dict[str, Any]:
        """Create a new camera device record."""
        try:
            client = await self._get_client()
            
            data = camera_data.model_dump()
            data["organization_id"] = organization_id
            data["created_by"] = user_id
            data["status"] = CameraStatus.OFFLINE.value
            
            # Remove None values
            data = {k: v for k, v in data.items() if v is not None}
            
            result = client.table("camera_devices").insert(data).execute()
            
            if result.data:
                logger.info(f"Created camera device: {result.data[0]['id']}")
                return {"success": True, "data": result.data[0]}
            else:
                return {"success": False, "error": "Failed to create camera"}
            
        except Exception as e:
            logger.error(f"Error creating camera: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def update_camera(
        self,
        camera_id: str,
        organization_id: str,
        camera_data: CameraDeviceUpdate
    ) -> Dict[str, Any]:
        """Update a camera device."""
        try:
            client = await self._get_client()
            
            # Get update data excluding None values
            update_data = {k: v for k, v in camera_data.model_dump().items() if v is not None}
            update_data["updated_at"] = datetime.utcnow().isoformat()
            
            result = client.table("camera_devices")\
                .update(update_data)\
                .eq("id", camera_id)\
                .eq("organization_id", organization_id)\
                .execute()
            
            if result.data:
                return {"success": True, "data": result.data[0]}
            else:
                return {"success": False, "error": "Camera not found"}
            
        except Exception as e:
            logger.error(f"Error updating camera: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def update_camera_status(
        self,
        camera_id: str,
        organization_id: str,
        status: CameraStatus
    ) -> Dict[str, Any]:
        """Update camera status."""
        try:
            client = await self._get_client()
            
            update_data = {
                "status": status.value,
                "last_seen_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat()
            }
            
            result = client.table("camera_devices")\
                .update(update_data)\
                .eq("id", camera_id)\
                .eq("organization_id", organization_id)\
                .execute()
            
            if result.data:
                return {"success": True, "data": result.data[0]}
            else:
                return {"success": False, "error": "Camera not found"}
            
        except Exception as e:
            logger.error(f"Error updating camera status: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def sync_cameras_from_exacq(
        self,
        organization_id: str,
        exacq_server_url: Optional[str] = None,
        force_refresh: bool = False
    ) -> Dict[str, Any]:
        """
        Sync cameras from ExacqVision server.
        
        This method would connect to the ExacqVision API to fetch
        camera configurations and sync them to the database.
        """
        try:
            client = await self._get_client()
            
            # In production, this would make API calls to ExacqVision
            # For now, we'll return a placeholder response
            logger.info(f"Syncing cameras from ExacqVision for org {organization_id}")
            
            # Get existing cameras to compare
            existing = client.table("camera_devices")\
                .select("exacq_camera_id")\
                .eq("organization_id", organization_id)\
                .execute()
            
            existing_ids = {c.get("exacq_camera_id") for c in (existing.data or []) if c.get("exacq_camera_id")}
            
            # Placeholder: In production, fetch from ExacqVision API
            # exacq_cameras = await self._fetch_from_exacq(exacq_server_url)
            
            return {
                "success": True,
                "cameras_added": 0,
                "cameras_updated": 0,
                "cameras_removed": 0,
                "errors": [],
                "sync_timestamp": datetime.utcnow().isoformat(),
                "message": "ExacqVision sync would connect to configured server"
            }
            
        except Exception as e:
            logger.error(f"Error syncing cameras from ExacqVision: {str(e)}")
            return {
                "success": False,
                "cameras_added": 0,
                "cameras_updated": 0,
                "cameras_removed": 0,
                "errors": [str(e)],
                "sync_timestamp": datetime.utcnow().isoformat()
            }
    
    # ==================== Recordings ====================
    
    async def list_recordings(
        self,
        organization_id: str,
        filters: Optional[CameraRecordingFilter] = None,
        limit: int = 50,
        offset: int = 0
    ) -> Dict[str, Any]:
        """List recordings with optional filters."""
        try:
            client = await self._get_client()
            
            query = client.table("camera_recordings")\
                .select("*, camera_devices(name, location, zone)")\
                .eq("organization_id", organization_id)\
                .order("start_time", desc=True)
            
            if filters:
                if filters.camera_id:
                    query = query.eq("camera_id", filters.camera_id)
                if filters.status:
                    query = query.eq("status", filters.status.value)
                if filters.triggered_by:
                    query = query.eq("triggered_by", filters.triggered_by)
                if filters.start_date:
                    query = query.gte("start_time", filters.start_date.isoformat())
                if filters.end_date:
                    query = query.lte("start_time", filters.end_date.isoformat())
                if filters.min_duration:
                    query = query.gte("duration_seconds", filters.min_duration)
            
            query = query.range(offset, offset + limit - 1)
            
            result = query.execute()
            
            return {
                "success": True,
                "data": result.data,
                "count": len(result.data)
            }
            
        except Exception as e:
            logger.error(f"Error listing recordings: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def get_recording(
        self,
        recording_id: str,
        organization_id: str
    ) -> Dict[str, Any]:
        """Get a single recording by ID."""
        try:
            client = await self._get_client()
            
            result = client.table("camera_recordings")\
                .select("*, camera_devices(name, location, zone)")\
                .eq("id", recording_id)\
                .eq("organization_id", organization_id)\
                .single()\
                .execute()
            
            if result.data:
                return {"success": True, "data": result.data}
            else:
                return {"success": False, "error": "Recording not found"}
            
        except Exception as e:
            logger.error(f"Error getting recording: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def create_recording_entry(
        self,
        recording_data: CameraRecordingCreate,
        organization_id: str
    ) -> Dict[str, Any]:
        """Create a new recording entry."""
        try:
            client = await self._get_client()
            
            data = recording_data.model_dump()
            data["organization_id"] = organization_id
            data["status"] = RecordingStatus.RECORDING.value
            
            # Convert datetime to ISO string
            if data.get("start_time"):
                data["start_time"] = data["start_time"].isoformat()
            if data.get("end_time"):
                data["end_time"] = data["end_time"].isoformat()
            
            # Remove None values
            data = {k: v for k, v in data.items() if v is not None}
            
            result = client.table("camera_recordings").insert(data).execute()
            
            if result.data:
                logger.info(f"Created recording entry: {result.data[0]['id']}")
                return {"success": True, "data": result.data[0]}
            else:
                return {"success": False, "error": "Failed to create recording entry"}
            
        except Exception as e:
            logger.error(f"Error creating recording entry: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def complete_recording(
        self,
        recording_id: str,
        organization_id: str,
        end_time: datetime,
        file_size_bytes: Optional[int] = None,
        storage_url: Optional[str] = None
    ) -> Dict[str, Any]:
        """Mark a recording as completed."""
        try:
            client = await self._get_client()
            
            # Get the recording to calculate duration
            recording = await self.get_recording(recording_id, organization_id)
            if not recording["success"]:
                return recording
            
            start_time = datetime.fromisoformat(recording["data"]["start_time"].replace("Z", "+00:00"))
            duration = int((end_time - start_time).total_seconds())
            
            update_data = {
                "end_time": end_time.isoformat(),
                "duration_seconds": duration,
                "status": RecordingStatus.COMPLETED.value,
                "updated_at": datetime.utcnow().isoformat()
            }
            
            if file_size_bytes:
                update_data["file_size_bytes"] = file_size_bytes
            if storage_url:
                update_data["storage_url"] = storage_url
            
            result = client.table("camera_recordings")\
                .update(update_data)\
                .eq("id", recording_id)\
                .eq("organization_id", organization_id)\
                .execute()
            
            if result.data:
                return {"success": True, "data": result.data[0]}
            else:
                return {"success": False, "error": "Recording not found"}
            
        except Exception as e:
            logger.error(f"Error completing recording: {str(e)}")
            return {"success": False, "error": str(e)}
    
    # ==================== Events ====================
    
    async def list_events(
        self,
        organization_id: str,
        filters: Optional[CameraEventFilter] = None,
        limit: int = 50,
        offset: int = 0
    ) -> Dict[str, Any]:
        """List camera events with optional filters."""
        try:
            client = await self._get_client()
            
            query = client.table("camera_events")\
                .select("*, camera_devices(name, location, zone)")\
                .eq("organization_id", organization_id)\
                .order("timestamp", desc=True)
            
            if filters:
                if filters.camera_id:
                    query = query.eq("camera_id", filters.camera_id)
                if filters.event_type:
                    query = query.eq("event_type", filters.event_type.value)
                if filters.is_acknowledged is not None:
                    query = query.eq("is_acknowledged", filters.is_acknowledged)
                if filters.start_date:
                    query = query.gte("timestamp", filters.start_date.isoformat())
                if filters.end_date:
                    query = query.lte("timestamp", filters.end_date.isoformat())
                if filters.zone:
                    query = query.eq("zone_triggered", filters.zone)
            
            query = query.range(offset, offset + limit - 1)
            
            result = query.execute()
            
            return {
                "success": True,
                "data": result.data,
                "count": len(result.data)
            }
            
        except Exception as e:
            logger.error(f"Error listing events: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def get_event(
        self,
        event_id: str,
        organization_id: str
    ) -> Dict[str, Any]:
        """Get a single event by ID."""
        try:
            client = await self._get_client()
            
            result = client.table("camera_events")\
                .select("*, camera_devices(name, location, zone)")\
                .eq("id", event_id)\
                .eq("organization_id", organization_id)\
                .single()\
                .execute()
            
            if result.data:
                return {"success": True, "data": result.data}
            else:
                return {"success": False, "error": "Event not found"}
            
        except Exception as e:
            logger.error(f"Error getting event: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def create_event(
        self,
        event_data: CameraEventCreate,
        organization_id: str
    ) -> Dict[str, Any]:
        """Create a new camera event."""
        try:
            client = await self._get_client()
            
            data = event_data.model_dump()
            data["organization_id"] = organization_id
            data["event_type"] = data["event_type"].value
            data["is_acknowledged"] = False
            
            # Convert datetime to ISO string
            if data.get("timestamp"):
                data["timestamp"] = data["timestamp"].isoformat()
            
            # Remove None values
            data = {k: v for k, v in data.items() if v is not None}
            
            result = client.table("camera_events").insert(data).execute()
            
            if result.data:
                logger.info(f"Created camera event: {result.data[0]['id']}")
                return {"success": True, "data": result.data[0]}
            else:
                return {"success": False, "error": "Failed to create event"}
            
        except Exception as e:
            logger.error(f"Error creating event: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def acknowledge_event(
        self,
        event_id: str,
        organization_id: str,
        user_id: str,
        notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """Acknowledge a camera event."""
        try:
            client = await self._get_client()
            
            update_data = {
                "is_acknowledged": True,
                "acknowledged_by": user_id,
                "acknowledged_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat()
            }
            
            if notes:
                # Add notes to metadata
                event = await self.get_event(event_id, organization_id)
                if event["success"]:
                    metadata = event["data"].get("metadata", {}) or {}
                    metadata["acknowledgement_notes"] = notes
                    update_data["metadata"] = metadata
            
            result = client.table("camera_events")\
                .update(update_data)\
                .eq("id", event_id)\
                .eq("organization_id", organization_id)\
                .execute()
            
            if result.data:
                logger.info(f"Acknowledged event {event_id} by user {user_id}")
                return {"success": True, "data": result.data[0]}
            else:
                return {"success": False, "error": "Event not found"}
            
        except Exception as e:
            logger.error(f"Error acknowledging event: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def get_unacknowledged_count(
        self,
        organization_id: str,
        camera_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get count of unacknowledged events."""
        try:
            client = await self._get_client()
            
            query = client.table("camera_events")\
                .select("id", count="exact")\
                .eq("organization_id", organization_id)\
                .eq("is_acknowledged", False)
            
            if camera_id:
                query = query.eq("camera_id", camera_id)
            
            result = query.execute()
            
            return {
                "success": True,
                "count": result.count or 0
            }
            
        except Exception as e:
            logger.error(f"Error getting unacknowledged count: {str(e)}")
            return {"success": False, "error": str(e)}
    
    # ==================== User Preferences ====================
    
    async def get_user_preferences(
        self,
        user_id: str,
        organization_id: str
    ) -> Dict[str, Any]:
        """Get user preferences for camera viewing."""
        try:
            client = await self._get_client()
            
            result = client.table("camera_user_preferences")\
                .select("*")\
                .eq("user_id", user_id)\
                .eq("organization_id", organization_id)\
                .single()\
                .execute()
            
            if result.data:
                return {"success": True, "data": result.data}
            else:
                # Return default preferences if none exist
                default_prefs = CameraUserPreferences().model_dump()
                return {
                    "success": True,
                    "data": {
                        "user_id": user_id,
                        "organization_id": organization_id,
                        **default_prefs
                    }
                }
            
        except Exception as e:
            # If not found, return defaults
            if "PGRST116" in str(e):  # Row not found error
                default_prefs = CameraUserPreferences().model_dump()
                return {
                    "success": True,
                    "data": {
                        "user_id": user_id,
                        "organization_id": organization_id,
                        **default_prefs
                    }
                }
            
            logger.error(f"Error getting user preferences: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def update_user_preferences(
        self,
        user_id: str,
        organization_id: str,
        preferences: CameraUserPreferencesUpdate
    ) -> Dict[str, Any]:
        """Update user preferences for camera viewing."""
        try:
            client = await self._get_client()
            
            # Get update data excluding None values
            update_data = {k: v for k, v in preferences.model_dump().items() if v is not None}
            update_data["updated_at"] = datetime.utcnow().isoformat()
            
            # Try to update existing
            result = client.table("camera_user_preferences")\
                .update(update_data)\
                .eq("user_id", user_id)\
                .eq("organization_id", organization_id)\
                .execute()
            
            if result.data:
                return {"success": True, "data": result.data[0]}
            else:
                # Create new preferences record
                insert_data = CameraUserPreferences().model_dump()
                insert_data.update(update_data)
                insert_data["user_id"] = user_id
                insert_data["organization_id"] = organization_id
                
                result = client.table("camera_user_preferences").insert(insert_data).execute()
                
                if result.data:
                    return {"success": True, "data": result.data[0]}
                else:
                    return {"success": False, "error": "Failed to create preferences"}
            
        except Exception as e:
            logger.error(f"Error updating user preferences: {str(e)}")
            return {"success": False, "error": str(e)}
    
    # ==================== Statistics ====================
    
    async def get_camera_statistics(
        self,
        organization_id: str,
        days: int = 7
    ) -> Dict[str, Any]:
        """Get camera statistics for the organization."""
        try:
            client = await self._get_client()
            
            date_from = datetime.utcnow() - timedelta(days=days)
            
            # Get camera counts by status
            cameras_result = client.table("camera_devices")\
                .select("status")\
                .eq("organization_id", organization_id)\
                .execute()
            
            camera_status_counts = {}
            for cam in (cameras_result.data or []):
                status = cam.get("status", "unknown")
                camera_status_counts[status] = camera_status_counts.get(status, 0) + 1
            
            # Get event counts by type
            events_result = client.table("camera_events")\
                .select("event_type")\
                .eq("organization_id", organization_id)\
                .gte("timestamp", date_from.isoformat())\
                .execute()
            
            event_type_counts = {}
            for event in (events_result.data or []):
                event_type = event.get("event_type", "unknown")
                event_type_counts[event_type] = event_type_counts.get(event_type, 0) + 1
            
            # Get recording statistics
            recordings_result = client.table("camera_recordings")\
                .select("duration_seconds, file_size_bytes")\
                .eq("organization_id", organization_id)\
                .gte("start_time", date_from.isoformat())\
                .execute()
            
            total_duration = sum(r.get("duration_seconds", 0) or 0 for r in (recordings_result.data or []))
            total_storage = sum(r.get("file_size_bytes", 0) or 0 for r in (recordings_result.data or []))
            
            return {
                "success": True,
                "data": {
                    "period_days": days,
                    "total_cameras": len(cameras_result.data or []),
                    "camera_status_breakdown": camera_status_counts,
                    "total_events": len(events_result.data or []),
                    "event_type_breakdown": event_type_counts,
                    "total_recordings": len(recordings_result.data or []),
                    "total_recording_duration_seconds": total_duration,
                    "total_storage_bytes": total_storage
                }
            }
            
        except Exception as e:
            logger.error(f"Error getting camera statistics: {str(e)}")
            return {"success": False, "error": str(e)}


# Singleton instance
_camera_service: Optional[CameraService] = None


async def get_camera_service() -> CameraService:
    """Get or create the camera service singleton."""
    global _camera_service
    if _camera_service is None:
        _camera_service = CameraService()
    return _camera_service

# Developer and Creator: Jai Singh
