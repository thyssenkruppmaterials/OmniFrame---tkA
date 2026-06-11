---
tags: [type/component, status/active, domain/backend, domain/infra]
created: 2026-04-10
---
# Device Registration & Device Manager Services

## Purpose
Two device-related services:
1. **DeviceRegistrationService** — Syncs device fingerprint data from localStorage to Supabase for session/device management visibility. Called after login.
2. **DeviceManagerService** — Full MDM (Mobile Device Management) service for enterprise device fleet management including commands, compliance, geofencing, profiles, apps, and workflows.

## Pattern
- `DeviceRegistrationService` — Static methods (no singleton).
- `DeviceManagerService` — Static methods (no singleton). Uses `supabase as any` for tables not yet in generated types.

## DeviceRegistrationService Key Functions
- `syncDeviceToDatabase(userId, organizationId)` — Upserts device registration via RPC `upsert_device_registration` with fingerprint data (user agent, screen resolution, timezone, touch points, etc.).
- `getDeviceNameByUserId(userId)` — Get most recently active device name for a user.
- `getOrganizationDevices(organizationId?)` — List all active devices for organization (admin view).
- `updateDeviceLastSeen(fingerprintId)` — Periodic heartbeat update.

## DeviceManagerService Key Functions

### Fleet & Devices
- `getFleetStatistics()` — RPC `get_mdm_fleet_statistics`.
- `getCommandMetrics(days)` — RPC `get_mdm_command_metrics`.
- `searchDevices({ search, status, groupId, limit, offset })` — RPC `search_mdm_devices`.
- `getDevice(deviceId)` / `updateDevice(deviceId, updates)` — Single device CRUD.
- `getDeviceGroups()` — List device groups.

### Commands
- `queueCommand({ deviceId, commandType, payload, priority, scheduledAt })` — Queue MDM command.
- `getCommands({ deviceId, status, limit, offset })` — List commands with pagination.
- `getCommandApprovals(status)` / `approveCommand(approvalId, approved, reason)` — Command approval workflow.

### Location & Geofencing
- `getLocationHistory(params)` / `getLatestLocations()` — Device location tracking.
- `getGeofences()` / `createGeofence(geofence)` — Geofence management.

### Compliance, Profiles, Workflows
- `getCompliancePolicies()` / `getViolations(params)` — Compliance management.
- `getProfiles()` / `createProfile(profile)` — Configuration profiles.
- `getWorkflows()` / `createWorkflow(workflow)` — Automation workflows.
- `getIncidents(params)` — Security incidents.

### Realtime Subscriptions
- `subscribeToDeviceChanges(callback)` — `mdm_devices` table changes.
- `subscribeToCommandChanges(callback)` — `mdm_commands` table changes.
- `subscribeToLocationChanges(callback)` — `mdm_device_locations` inserts.

## Database Tables
- **`device_registrations`** — Device fingerprint storage (fingerprint_id, device_name, device_type, os, browser, user_id, organization_id, is_active, last_seen).
- **`mdm_devices`**, **`mdm_device_groups`**, **`mdm_commands`**, **`mdm_command_approvals`**, **`mdm_command_events`**, **`mdm_command_templates`** — Device and command management.
- **`mdm_device_locations`**, **`mdm_geofences`**, **`mdm_geofence_events`** — Location tracking.
- **`mdm_profiles`**, **`mdm_profile_assignments`**, **`mdm_apps`**, **`mdm_installed_apps`** — Profile and app management.
- **`mdm_compliance_policies`**, **`mdm_compliance_violations`** — Compliance.
- **`mdm_workflows`**, **`mdm_workflow_executions`**, **`mdm_incidents`** — Automation and incidents.

## RPC Functions
- `upsert_device_registration(...)` — Device sync.
- `get_mdm_fleet_statistics` — Fleet overview.
- `get_mdm_command_metrics(p_days)` — Command analytics.
- `search_mdm_devices(...)` — Device search.

## Dependencies
- `./client` (supabase)
- `@/lib/utils/device-fingerprint` (getDeviceRegistration, createDeviceFingerprint)
- `@/lib/utils/logger`
- `@/features/admin/device-manager/types/device-manager.types` (MDM type definitions)

## Related
- [[Architecture]] — System overview
- [[Supabase Client Infrastructure - Supabase Service]] — Client dependency
