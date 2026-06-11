---
tags: [type/component, status/active, domain/frontend, domain/admin]
created: 2026-04-10
---
# Device Manager

## Purpose
Enterprise Mobile Device Management (MDM) admin panel for managing supervised iOS devices. Provides fleet oversight, remote command execution, geolocation tracking, compliance enforcement, app lifecycle management, and automated policy workflows. Supports full device lifecycle from enrollment to retirement.

## Key Components
- **DeviceManagerPage** (`index.tsx`) — Main page with 9-tab layout using `TabMenu` and `useTabSearchParam`
- **FleetOverviewTab** — Dashboard summary of fleet health, enrollment stats, and device status distribution
- **DeviceInventoryTab** — Searchable/filterable device list with detail panels; uses `useDeviceInventory` hook
- **CommandCenterTab** — Remote MDM command execution (lock, wipe, restart, etc.) via `useMdmCommands`
- **LocationIntelligenceTab** — Map-based device tracking with geofencing via `useDeviceLocations` and `useGeofencing`
- **ProfilesPoliciesTab** — Device configuration profiles and policy assignment
- **AppManagementTab** — App deployment, updates, and removal across fleet
- **ComplianceSecurityTab** — Compliance rule engine and security posture monitoring via `useComplianceEngine`
- **AutomationTab** — Automated workflows and policy triggers
- **AnalyticsReportingTab** — Fleet analytics, reporting dashboards

### Shared Components
- `TelemetryFreshnessBadge` — Shows data recency
- `DeviceStatusDot` — Online/offline/warning indicator
- `ApprovalBanner` — Pending approval notifications
- `ComplianceBadge` — Compliance status display
- `CommandStatusBadge` — Command execution state
- `DeviceHealthBadge` — Overall device health indicator
- `DeviceIcon` — Platform-aware device icon

## State Management
- **React Query** (`@tanstack/react-query`) — Primary data fetching via custom hooks:
  - `useDeviceInventory` / `useDeviceList` — Device listing with search, status, and group filters; query key `['mdm-devices']`
  - `useFleetStatistics` — Fleet-wide stats with 60s auto-refetch
  - `useDeviceDetail` — Single device details with 15s stale time
  - `useMdmCommands` — Remote command execution mutations
  - `useDeviceLocations` / `useGeofencing` — Location data and geofence management
  - `useAgentHealth` — Device agent status monitoring
  - `useComplianceEngine` — Compliance rule evaluation
  - `useDeviceStream` — Real-time device telemetry
- **Lazy Loading** — 7 of 9 tabs use `React.lazy()` for code splitting; only FleetOverview and DeviceInventory are eagerly loaded
- **Backend Service** — `DeviceManagerService` from `@/lib/supabase/device-manager.service`

## Architecture Notes
- Tab state persisted in URL search params via `useTabSearchParam` hook
- `pageResource='device_manager'` passed to TabMenu for RBAC-aware tab visibility
- Types defined in `types/device-manager.types.ts` (e.g., `MdmDevice`)
- Command definitions in `constants/command-definitions.ts`

## Related
- [[Architecture]]
- [[RolesPermissions - Feature Module]]
- [[SecurityDashboard - Feature Module]]
- [[PermissionGuard - UI Components]]