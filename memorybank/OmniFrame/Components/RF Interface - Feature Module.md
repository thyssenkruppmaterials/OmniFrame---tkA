---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# RF Interface

## Purpose
Mobile-first handheld RF scanner interface for warehouse floor operations. Runs as a standalone PWA (Progressive Web App) optimized for barcode scanner hardware and iOS native apps. Provides the primary touchpoint for warehouse associates performing inbound receiving, putaway, picking, cycle counting, kitting, drone control, and SAP MIGO transactions.

## Key Components
- **RFInterface** (`rf-interface.tsx`) — Main orchestrator component with view-based navigation. Manages a dock-based navigation system with Home, Inventory, Locations, Picking, and Profile sections. Contains the InboundScanForm with 5-field auto-advance barcode scanning (tracking number, SO/Line, material number, quantity, TKA batch number) and hot truck priority flagging.
- **RFLayout** (`rf-layout.tsx`) — Standalone layout shell with auth guard and PWA initialization via `rfPWAManager`. Handles session loss detection and redirect.
- **RFSignIn** (`rf-signin.tsx`) — Dedicated RF terminal authentication with auto-advance from email to password fields and auto-login after valid credentials. Uses `ScannerInput` and `ScannerPasswordInput` for barcode scanner compatibility.
- **Dock** — Fixed bottom navigation bar (2-6 items) with active state indicators and iOS safe area support.
- **RFThemeSelector** — 4-option theme selector (Light, Dark, System, Custom) in the Profile section.
- **QuickActionButton** — Color-coded action tiles for the home screen application cluster.
- **InboundScanForm** — Auto-advance multi-field form with 800ms delay, field completion detection, TKA batch validation (must be 10 chars starting with TK2), and auto-submit on last field completion.

## Sub-Module Components (imported)
- `RFPutawayForm` — Putaway operations
- `RFPickingForm` — Order picking with kitting detection
- `RFKittingPickingForm` — Kit-specific picking with Kit PO auto-detection
- `RFBuildKitForm` — Kit assembly on RF terminal
- `RFInspectKitForm` — Kit inspection
- `RFCycleCountUnified` — Unified cycle count with auto/manual modes and pushed work support
- `RFGRSCycleCountForm` — GRS-specific cycle counting
- `RFLocationScanner` — Location-based scanning
- `RFDroneControl` — Drone control from RF terminal
- `RFWorkQueueDashboardSimple` — Work queue visibility
- `RFTaskClaim` — Task claiming from work queue
- `RFSAPMigoForm` — SAP MIGO goods movement

## Hooks
- `useUnifiedAuth` — Authentication state and sign-in/sign-out
- `usePushedWork` — Pushed work tracking with badge count for cycle count alerts
- `useWorkerHeartbeat` — Worker status heartbeat at 30s intervals
- `useTeamPerformance` — Team performance data for My Productivity view with activity timeline
- `useDeviceRegistration` — Device registration dialog flow
- `useTheme` — Theme management (light/dark/system/custom)

## State Management
- **View-based navigation**: `currentView` state drives which sub-module renders (home, scan, putaway, picking, cycle-count, etc.)
- **Dock sync**: `dockActiveIndex` syncs with current view via `navigateToView` helper
- **WebSocket**: Connects to Work Service WebSocket per organization for real-time pushed work and queue stats
- **Hot Part Alerts**: Full-screen overlay triggered by `hotPartAlertService.checkForAlerts()` after inbound scans
- **Device Registration**: First-login device registration with database sync via `DeviceRegistrationService`
- **Inbound Scans**: Submitted to Supabase via `InboundScanService.createScan()`

## Routes
- `/rf-signin` — RF terminal sign-in page
- `/rf-interface` — Main RF interface (standalone, separate from main app shell)

## Related
- [[Architecture]]
- [[SingletonAuthManager - Authentication Core]]
- [[UnifiedAuthProvider - React Provider]]
