/**
 * Camera System Types
 *
 * TypeScript interfaces for the camera monitoring system.
 * Supports MJPEG streams, PTZ controls, events, and recordings.
 */

// Camera status
export type CameraStatus = 'online' | 'offline' | 'recording' | 'error'

// Camera category for filtering
export type CameraCategory =
  | 'all'
  | 'indoor'
  | 'outdoor'
  | 'entrance'
  | 'parking'
  | 'warehouse'

// PTZ capability
export interface PTZCapabilities {
  pan: boolean
  tilt: boolean
  zoom: boolean
  presets: boolean
}

// Camera entity
export interface Camera {
  id: string
  exacq_camera_id?: number // ExacqVision camera ID for streaming
  name: string
  location: string
  category: CameraCategory
  status: CameraStatus
  ip_address: string
  stream_url: string
  thumbnail_url?: string
  ptz_capable: boolean
  ptz_capabilities?: PTZCapabilities
  recording_enabled: boolean
  motion_detection_enabled: boolean
  organization_id: string
  created_at: string
  updated_at: string
  last_seen_at?: string
  // User-specific
  is_favorite?: boolean
}

// Camera stream quality options
export type StreamQuality = 'low' | 'medium' | 'high' | 'auto'

// Camera stream state
export interface CameraStreamState {
  camera_id: string
  quality: StreamQuality
  is_connected: boolean
  is_loading: boolean
  error?: string
  reconnect_attempts: number
}

// PTZ preset position
export interface PTZPreset {
  id: string
  name: string
  camera_id: string
  position: {
    pan: number
    tilt: number
    zoom: number
  }
}

// PTZ control command
export interface PTZCommand {
  camera_id: string
  action:
    | 'pan_left'
    | 'pan_right'
    | 'tilt_up'
    | 'tilt_down'
    | 'zoom_in'
    | 'zoom_out'
    | 'stop'
    | 'goto_preset'
  preset_id?: string
  speed?: number
}

// Camera event types
export type CameraEventType =
  | 'motion'
  | 'alarm'
  | 'line_crossing'
  | 'intrusion'
  | 'loitering'
  | 'offline'
  | 'online'

// Camera event
export interface CameraEvent {
  id: string
  camera_id: string
  camera_name: string
  event_type: CameraEventType
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  snapshot_url?: string
  video_clip_url?: string
  timestamp: string
  acknowledged: boolean
  acknowledged_by?: string
  acknowledged_at?: string
  metadata?: Record<string, unknown>
}

// Camera recording
export interface CameraRecording {
  id: string
  camera_id: string
  camera_name: string
  start_time: string
  end_time: string
  duration_seconds: number
  file_size_mb: number
  file_url: string
  thumbnail_url?: string
  event_triggered: boolean
  event_id?: string
}

// Recording filter
export interface RecordingFilter {
  camera_id?: string
  start_date?: string
  end_date?: string
  event_triggered?: boolean
}

// Camera statistics
export interface CameraStats {
  total: number
  online: number
  offline: number
  recording: number
  alerts_today: number
}

// Filter status for UI
export type CameraFilterStatus = 'all' | 'online' | 'offline'

// User camera preferences
export interface CameraPreferences {
  default_quality: StreamQuality
  auto_reconnect: boolean
  reconnect_interval_ms: number
  show_timestamp_overlay: boolean
  favorite_camera_ids: string[]
  default_view_layout: 'single' | 'grid-4' | 'grid-9'
  alert_sound_enabled: boolean
  motion_notification_enabled: boolean
}

// Alert toast data
export interface CameraAlert {
  id: string
  camera_id: string
  camera_name: string
  event_type: CameraEventType
  message: string
  snapshot_url?: string
  timestamp: string
}
