---
tags: [type/implementation, status/active, domain/frontend, domain/backend]
created: 2026-04-25
---
# Redesign ShiftProductivity Settings Operations Control Center
## Purpose / Context
Redesigned the Shift Productivity Settings tab into an operations configuration center and audited persisted settings so controls are either live, setup-only, partial, or explicitly pending automation. This prevents saved settings from looking active when no runtime behavior or background worker exists yet.

## Details
- Added URL-backed Settings sections for overview, tracking, operating model, performance standards, data sources, team schedules, automation, and advanced controls.
- Added a Settings Overview wiring matrix that documents storage, read path, runtime behavior, invalidation, and status for each configurable feature.
- Wired saved timezone into `useTeamPerformance` and `TeamPerformanceService` calls; included timezone/calculation method in performance cache keys.
- Added cross-invalidation from settings, labor management, and activity source edits to runtime team performance views.
- Updated exports to honor `export_format` for team performance and labor-management downloads.
- Marked backend-dependent automation honestly in the UI: notifications, automatic clock-out, retention/archive, and advanced analytics now show pending/partial status instead of implying live automation.
- Refactored Labor Management overview into `LaborManagementOverview` and made the labor sub-tabs/actions more responsive while preserving existing dialogs.
- Fixed unassigned-user bulk assignment cleanup so only successfully assigned users are removed from selection/state.
- Follow-up from completed review agents: threaded configured timezone through `ActivityGantt`, `RealTimeView`, `AssociateList`, and associate performance Gantt usage; added horizontal overflow guards for Labor Management tables and org chart.
- 2026-04-25 v2 redesign pass: replaced the heavy header card with a sidebar hero (configuration health pill + live/pending counters) and a sticky breadcrumb-style content header. Sidebar nav is now grouped (Foundations / Performance / People / System) with no scrollbar — items always fit, active state uses a left-rail indicator and accent tile. ContentSection lightened (no separator) so the breadcrumb does not visually duplicate section titles.

## Verification
- `pnpm exec eslint` on touched Shift Productivity/settings files passed.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec vite build` passed with existing chunk-size warnings.
- Temporary Vite dev smoke check returned HTTP 200 for `/apps/shift-productivity?tab=settings`.

## Related
- [[ShiftProductivity - Feature Module]]
- [[ProductivityAndSettings - Supabase Service]]
- [[LaborManagement - Supabase Service]]
- [[TeamPerformance - Supabase Service]]
- [[UI Component Conventions]]
- [[State Management Patterns]]