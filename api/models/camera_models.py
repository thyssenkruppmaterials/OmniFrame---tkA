"""
Pydantic models for camera operations.
Supports ExacqVision camera integration and video surveillance.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, ConfigDict
from enum import Enum


# ==================== Enums ====================

class CameraStatus(str, Enum):
    """Camera device status."""
    ONLINE = "online"
    OFFLINE = "offline"
    RECORDING = "recording"
    MAINTENANCE = "maintenance"
    ERROR = "error"


class CameraEventType(str, Enum):
    """Camera event types."""
    MOTION = "motion"
    ALARM = "alarm"
    TAMPERING = "tampering"
    VIDEO_LOSS = "video_loss"
    RECORDING_START = "recording_start"
    RECORDING_STOP = "recording_stop"
    CONNECTION_LOST = "connection_lost"
    CONNECTION_RESTORED = "connection_restored"


class RecordingStatus(str, Enum):
    """Recording status."""
    RECORDING = "recording"
    COMPLETED = "completed"
    FAILED = "failed"
    PROCESSING = "processing"


# ==================== Camera Device Models ====================

class CameraDeviceBase(BaseModel):
    """Base model for camera device data."""
    name: str = Field(..., description="Camera display name")
    exacq_camera_id: Optional[str] = Field(None, description="ExacqVision camera ID")
    location: Optional[str] = Field(None, description="Physical location description")
    zone: Optional[str] = Field(None, description="Warehouse zone")
    model: Optional[str] = Field(None, description="Camera model")
    manufacturer: Optional[str] = Field(None, description="Camera manufacturer")
    ip_address: Optional[str] = Field(None, description="Camera IP address")
    mac_address: Optional[str] = Field(None, description="Camera MAC address")
    resolution: Optional[str] = Field(None, description="Video resolution (e.g., 1920x1080)")
    fps: Optional[int] = Field(None, description="Frames per second")
    stream_url: Optional[str] = Field(None, description="RTSP or stream URL")
    is_ptz: bool = Field(default=False, description="Is PTZ (Pan-Tilt-Zoom) camera")
    is_enabled: bool = Field(default=True, description="Is camera enabled")


class CameraDeviceCreate(CameraDeviceBase):
    """Model for creating camera device records."""
    pass


class CameraDeviceUpdate(BaseModel):
    """Model for updating camera device records."""
    name: Optional[str] = None
    location: Optional[str] = None
    zone: Optional[str] = None
    is_ptz: Optional[bool] = None
    is_enabled: Optional[bool] = None
    stream_url: Optional[str] = None


class CameraDeviceResponse(CameraDeviceBase):
    """Model for camera device API responses."""
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    organization_id: str
    status: CameraStatus = CameraStatus.OFFLINE
    last_seen_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    thumbnail_url: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)


class CameraListResponse(BaseModel):
    """Paginated camera list response."""
    success: bool
    data: List[CameraDeviceResponse]
    count: int
    limit: int
    offset: int


# ==================== Camera Recording Models ====================

class CameraRecordingBase(BaseModel):
    """Base model for camera recording data."""
    camera_id: str = Field(..., description="Camera ID")
    start_time: datetime = Field(..., description="Recording start time")
    end_time: Optional[datetime] = Field(None, description="Recording end time")
    duration_seconds: Optional[int] = Field(None, description="Recording duration in seconds")
    file_size_bytes: Optional[int] = Field(None, description="Recording file size")
    file_path: Optional[str] = Field(None, description="Storage path for recording")
    storage_url: Optional[str] = Field(None, description="URL to access recording")
    triggered_by: Optional[str] = Field(None, description="What triggered recording (motion, manual, schedule)")


class CameraRecordingCreate(CameraRecordingBase):
    """Model for creating recording records."""
    pass


class CameraRecordingResponse(CameraRecordingBase):
    """Model for recording API responses."""
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    organization_id: str
    status: RecordingStatus = RecordingStatus.RECORDING
    created_at: datetime
    updated_at: datetime
    thumbnail_url: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)


class CameraRecordingFilter(BaseModel):
    """Filter model for recordings list."""
    camera_id: Optional[str] = None
    status: Optional[RecordingStatus] = None
    triggered_by: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    min_duration: Optional[int] = Field(None, description="Minimum duration in seconds")


class RecordingListResponse(BaseModel):
    """Paginated recording list response."""
    success: bool
    data: List[CameraRecordingResponse]
    count: int
    limit: int
    offset: int


# ==================== Camera Event Models ====================

class CameraEventBase(BaseModel):
    """Base model for camera event data."""
    camera_id: str = Field(..., description="Camera ID")
    event_type: CameraEventType = Field(..., description="Type of event")
    timestamp: datetime = Field(..., description="When event occurred")
    description: Optional[str] = Field(None, description="Event description")
    snapshot_url: Optional[str] = Field(None, description="URL to event snapshot")
    recording_id: Optional[str] = Field(None, description="Associated recording ID")
    confidence_score: Optional[float] = Field(None, ge=0, le=1, description="AI confidence score")
    zone_triggered: Optional[str] = Field(None, description="Motion zone that triggered event")


class CameraEventCreate(CameraEventBase):
    """Model for creating event records."""
    pass


class CameraEventResponse(CameraEventBase):
    """Model for event API responses."""
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    organization_id: str
    is_acknowledged: bool = False
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)


class CameraEventFilter(BaseModel):
    """Filter model for events list."""
    camera_id: Optional[str] = None
    event_type: Optional[CameraEventType] = None
    is_acknowledged: Optional[bool] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    zone: Optional[str] = None


class CameraEventAcknowledge(BaseModel):
    """Model for acknowledging an event."""
    notes: Optional[str] = Field(None, description="Optional notes about the acknowledgement")


class EventListResponse(BaseModel):
    """Paginated event list response."""
    success: bool
    data: List[CameraEventResponse]
    count: int
    limit: int
    offset: int


# ==================== Camera User Preferences Models ====================

class CameraUserPreferences(BaseModel):
    """User preferences for camera viewing."""
    default_layout: str = Field(default="grid", description="Default view layout (grid, list, single)")
    grid_columns: int = Field(default=2, ge=1, le=6, description="Number of columns in grid view")
    auto_play: bool = Field(default=True, description="Auto-play streams when opening")
    muted_by_default: bool = Field(default=True, description="Mute audio by default")
    show_timestamps: bool = Field(default=True, description="Show timestamps on streams")
    motion_alerts_enabled: bool = Field(default=True, description="Show motion detection alerts")
    alert_sound_enabled: bool = Field(default=False, description="Play sound on alerts")
    favorite_cameras: List[str] = Field(default_factory=list, description="List of favorite camera IDs")
    default_recording_quality: str = Field(default="high", description="Recording quality (low, medium, high)")
    retention_days: int = Field(default=30, ge=1, le=365, description="Days to retain recordings")


class CameraUserPreferencesUpdate(BaseModel):
    """Model for updating user preferences."""
    default_layout: Optional[str] = None
    grid_columns: Optional[int] = Field(None, ge=1, le=6)
    auto_play: Optional[bool] = None
    muted_by_default: Optional[bool] = None
    show_timestamps: Optional[bool] = None
    motion_alerts_enabled: Optional[bool] = None
    alert_sound_enabled: Optional[bool] = None
    favorite_cameras: Optional[List[str]] = None
    default_recording_quality: Optional[str] = None
    retention_days: Optional[int] = Field(None, ge=1, le=365)


class CameraUserPreferencesResponse(CameraUserPreferences):
    """Model for preferences API response."""
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    user_id: str
    organization_id: str
    created_at: datetime
    updated_at: datetime


# ==================== Camera Sync Models ====================

class CameraSyncRequest(BaseModel):
    """Request model for syncing cameras from ExacqVision."""
    exacq_server_url: Optional[str] = Field(None, description="ExacqVision server URL (uses default if not provided)")
    force_refresh: bool = Field(default=False, description="Force refresh even if recently synced")


class CameraSyncResponse(BaseModel):
    """Response model for camera sync operation."""
    success: bool
    cameras_added: int = 0
    cameras_updated: int = 0
    cameras_removed: int = 0
    errors: List[str] = Field(default_factory=list)
    sync_timestamp: datetime


# ==================== Stream Proxy Models ====================

class StreamProxyRequest(BaseModel):
    """Request model for stream proxy."""
    quality: str = Field(default="auto", description="Stream quality (low, medium, high, auto)")
    format: str = Field(default="mjpeg", description="Stream format (mjpeg, hls)")


class StreamInfo(BaseModel):
    """Information about an active stream."""
    camera_id: str
    stream_url: str
    format: str
    quality: str
    started_at: datetime
    viewers: int = 0


# ==================== Snapshot Models ====================

class SnapshotRequest(BaseModel):
    """Request model for snapshot."""
    quality: str = Field(default="high", description="Snapshot quality")
    save_to_storage: bool = Field(default=False, description="Save snapshot to storage")


class SnapshotResponse(BaseModel):
    """Response model for snapshot."""
    success: bool
    camera_id: str
    snapshot_url: str
    timestamp: datetime
    storage_url: Optional[str] = None
