/**
 * Camera System Feature
 *
 * Complete camera monitoring system with:
 * - Live MJPEG stream viewing
 * - PTZ camera controls
 * - Event monitoring and alerts
 * - Recording playback and download
 * - User preferences
 */

// Main component
export { CameraSystemTab } from './components/CameraSystemTab'

// Panel components
export { CameraListPanel } from './components/CameraListPanel'
export { CameraViewPanel } from './components/CameraViewPanel'

// Feature components
export { CameraFeed } from './components/CameraFeed'
export { PTZControls } from './components/PTZControls'
export { CameraStatusBadge } from './components/CameraStatusBadge'
export { CameraEventsList } from './components/CameraEventsList'
export { RecordingsPanel } from './components/RecordingsPanel'
export {
  CameraAlertToast,
  useShowCameraAlert,
} from './components/CameraAlertToast'

// Hooks
export {
  useCameras,
  CAMERAS_QUERY_KEY,
  CAMERA_STATS_KEY,
} from './hooks/use-cameras'
export { useCameraStream } from './hooks/use-camera-stream'
export { useCameraEvents, CAMERA_EVENTS_KEY } from './hooks/use-camera-events'
export {
  useCameraRecordings,
  CAMERA_RECORDINGS_KEY,
} from './hooks/use-camera-recordings'
export { useCameraPreferences } from './hooks/use-camera-preferences'

// Types
export type {
  Camera,
  CameraStatus,
  CameraCategory,
  CameraFilterStatus,
  CameraStats,
  CameraEvent,
  CameraEventType,
  CameraRecording,
  CameraAlert,
  CameraPreferences,
  PTZCapabilities,
  PTZPreset,
  PTZCommand,
  StreamQuality,
  CameraStreamState,
  RecordingFilter,
} from './types/camera.types'
