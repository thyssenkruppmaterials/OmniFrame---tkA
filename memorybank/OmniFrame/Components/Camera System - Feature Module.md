---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# Camera System

## Purpose
Complete warehouse camera monitoring and security system with live MJPEG stream viewing, PTZ (Pan-Tilt-Zoom) controls, event monitoring with alerts, and recording playback/download. Integrates with ExacqVision NVR system for camera streams.

## Key Components
- **CameraSystemTab** (`components/CameraSystemTab.tsx`) — Main container with 25/75 responsive layout (list/view panels). Mobile-optimized with swipe navigation.
- **CameraListPanel** — Camera list with filtering by category (indoor, outdoor, entrance, parking, warehouse) and status.
- **CameraViewPanel** — Camera viewer panel displaying selected camera feed with controls.
- **CameraFeed** — Live MJPEG stream viewer component.
- **PTZControls** — Pan-Tilt-Zoom camera control interface.
- **CameraStatusBadge** — Status indicator badge (online/offline/recording/error).
- **CameraEventsList** — Real-time event feed (motion, alarm, line crossing, intrusion, loitering).
- **RecordingsPanel** — Recording playback interface with date range filtering and download.
- **CameraAlertToast** — Real-time alert notification toasts for camera events.

## Hooks
- `useCameras` — Camera list with filtering, real-time updates, stats, and favorites.
- `useCameraStream` — MJPEG stream connection with quality selection and auto-reconnect.
- `useCameraEvents` — Camera event monitoring with severity filtering.
- `useCameraRecordings` — Recording list with date range and event-triggered filters.
- `useCameraPreferences` — User preferences (quality, reconnect, overlay, layout, alerts).

## State Management
- Local state for selected camera, filters, and mobile view toggle
- React Query with real-time Supabase subscriptions
- Touch handling via `useRef` for swipe navigation on mobile

## Types
- `Camera` — Entity with ExacqVision integration, PTZ capabilities, recording/motion flags
- `CameraStreamState` — Stream connection state with quality and reconnect tracking
- `PTZCommand` — Control commands (pan, tilt, zoom, stop, goto_preset)
- `CameraEvent` — Events with severity levels and acknowledgment
- `CameraRecording` — Recording metadata with file URLs
- `CameraPreferences` — User settings including view layout (single, grid-4, grid-9)

## Routes
- Rendered as a tab within the main application dashboard

## Related
- [[Architecture]]
