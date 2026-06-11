---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# Productivity & Settings Services

## Purpose
Two complementary services: one for individual user productivity statistics with date selection, and another for managing organization-level shift productivity configuration (KPI thresholds, notifications, team settings, timezone, and advanced analytics options).

## Services

### DateAwareProductivityService (`productivity-date-aware.service.ts`)
**Individual user productivity stats** for any specific date.

Singleton class:
- `getStatsForDate(targetDate)` → executes 9 parallel count queries scoped to the authenticated user's organization and the target date (EST timezone boundaries). Returns counts for: inbound_scans, cart_stows, put_aways, picking, packed, shipped, final_packed, putbacks, cycle_counts.

Query sources (all filtered by user ID + date range + organization_id):
1. `rr_inbound_scans` → `scanned_by` / `scanned_at`
2. `inbound_cart_assignments` → `stowed_by` / `stowed_at`
3. `rf_putaway_operations` → `created_by` / `created_at`
4. `outbound_to_data` (picked) → `picked_by` / `picked_at`
5. `outbound_to_data` (packed) → `packed_by` / `packed_at`
6. `outbound_to_data` (shipped) → `shipped_by` / `shipped_at`
7. `outbound_to_data` (final_packed) → `final_packed_by` / `final_packed_at`
8. `putback_tickets` → `created_by` / `created_at`
9. `rr_cyclecount_data` → `assigned_to` / `completed_at` (status in `completed`, `approved`)

### ShiftProductivitySettingsService (`shift-productivity-settings.service.ts`)
**Organization-level shift productivity configuration.**

Singleton class with section-based update methods:
- `getSettings(orgId)` → fetches from `shift_productivity_settings` (maybeSingle)
- `upsertSettings(settings)` → upsert on `organization_id` conflict
- `updateGeneralSettings(orgId, form)` → tracking, shift duration (8/10/12h), break tracking, auto clock-out, timezone
- `updateKPISettings(orgId, form)` → target scans/putaways/picks/cycle-counts per hour, quality/accuracy thresholds
- `updateNotificationSettings(orgId, form)` → shift reminders, low productivity alerts, team milestones, daily summary
- `updateTeamSettings(orgId, form)` → team size, shift rotation (fixed/rotating/flexible), competitive mode, visibility toggles
- `updateAdvancedSettings(orgId, form)` → data retention days, auto archive, export format (csv/excel/json), calculation method (simple/weighted/rolling), debug mode

Form conversion helpers: `toGeneralForm()`, `toKPIForm()`, `toNotificationForm()`, `toTeamForm()`, `toAdvancedForm()` — convert snake_case DB records to camelCase React form values.

## Database Tables
- `shift_productivity_settings` — per-organization configuration (unique on organization_id)
- `rr_inbound_scans` — inbound scan records
- `inbound_cart_assignments` — cart stow records
- `rf_putaway_operations` — putaway records
- `outbound_to_data` — outbound pick/pack/ship records
- `putback_tickets` — putback records
- `rr_cyclecount_data` — cycle count records
- `user_profiles` — user organization linkage

## Key Interfaces
- `ProductivityStats` — 10-field count object for individual user daily stats
- `ShiftProductivitySettings` — full settings record (~30 config fields)
- `GeneralSettingsForm` / `KPISettingsForm` / `NotificationSettingsForm` / `TeamSettingsForm` / `AdvancedSettingsForm` — typed form value interfaces with literal types matching Zod schemas
- `DEFAULT_SETTINGS` — default configuration values

## Design Notes
- Date-aware service uses EST timezone (hardcoded) for date boundary calculation
- Settings service uses upsert pattern — creates row on first save, updates on subsequent
- All 5 settings sections can be updated independently without affecting other sections
- Default timezone: `America/New_York` (configurable in general settings)
- 2026-04-25 Settings wiring pass: `timezone` and `export_format` are consumed by Shift Productivity runtime code; settings mutations now invalidate affected performance queries. Notification, auto clock-out, retention/archive, and advanced analytics settings remain stored preferences until background workers or analytics services are added. See [[Redesign-ShiftProductivity-Settings-Operations-Control-Center]].

## Related
- [[Architecture]]
- [[TeamPerformance - Supabase Service]]
- [[LaborManagement - Supabase Service]]
- [[ActivitySourceConfig - Supabase Service]]