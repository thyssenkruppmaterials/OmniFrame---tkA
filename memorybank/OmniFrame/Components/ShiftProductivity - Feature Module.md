---
tags: [type/component, status/active, domain/frontend, domain/backend]
created: 2026-04-10
---
# Shift Productivity

## Purpose
Comprehensive shift and labor productivity tracking system for warehouse/logistics operations. Provides real-time team performance monitoring, associate-level performance analysis, overtime management, time adjustment approvals, and extensive settings for labor management configuration. Central to operational visibility across shifts, departments, and working areas.

## Key Components

### Team Performance (`team-performance/`)
- **TeamPerformanceDashboard** (`team-performance-dashboard.tsx`) — Main dashboard with stat cards (Total Associates, Tasks Completed, Avg Efficiency, Active Now) and unified real-time/historical view
- **RealTimeView** — Live shift monitoring with auto-refresh (30s interval)
- **HistoricalView** — Past performance analysis with date picker navigation
- **PerformanceChart** — Data visualization for performance trends
- **ActivityGantt** — Gantt-style activity timeline per associate
- **DepartmentCard** — Department-level performance summary
- **KpiCard** — Key performance indicator display
- **AssociatePerformanceRow** — Individual associate performance detail row
- **LaborBoard** / **LaborBoardColumn** / **LaborBoardCard** — Kanban-style labor allocation board
- **ManageOvertimeDialog** — Overtime scheduling from performance view
- **AddEventDialog** / **ManageEventsDialog** — Shift event management

### Associate Performance (`associate-performance/`)
- **AssociatePerformanceDashboard** — Individual associate deep-dive performance view

### Overtime Management (`overtime-management/`)
- **OvertimeManagementDashboard** — Overtime allocation, approval, and tracking

### Time Adjustment Approvals (`time-adjustment-approvals/`)
- **TimeAdjustmentApprovalsDashboard** — Pending time correction requests approval workflow

### Settings (`settings/`)
- **Settings Index** — Sidebar navigation layout with 6 settings categories
- **GeneralSettings** — Global shift productivity configuration
- **TeamSettings** — Team structure management:
  - `ShiftScheduleManagement` — Define shift patterns
  - `UnassignedUsersManagement` — Handle unassigned workforce
- **KpiSettings** — KPI thresholds and targets
- **ActivitySourcesSettings** — Configure data sources feeding productivity metrics
- **NotificationSettings** — Alert rules for performance thresholds
- **AdvancedSettings** — Advanced configuration options
- **LaborManagementSettings** — Extensive labor management with:
  - `OrgChartTree` — Organizational hierarchy visualization
  - `LaborStandardsTab` — Define performance standards per task/position
  - `PositionOptionsTab` — Position configuration
  - CRUD dialogs for areas, positions, standards, assignments
  - Bulk operations: `BulkImportStandardsDialog`, `BulkAssignUsersDialog`

## State Management
- **useTeamPerformance** (`hooks/use-team-performance.ts`) — Primary hook providing:
  - `performanceData` with `summary` (totalAssociates, activeAssociates, totalTasksCompleted, averageEfficiency, onBreakAssociates, offlineAssociates)
  - `weeklyTrend` data, `workingAreas`, `departments`, `timelineEvents`, `approvedOvertime`
  - Date navigation: `selectedDate`, `setSelectedDate`, `goToToday`, `goToPreviousDay`, `goToNextDay`, `canGoForward`
  - Filter management: `updateFilters` (departments, areas, search, sortBy, sortOrder)
  - Actions: `refresh`, `exportToCSV`
  - Auto-refresh: configurable interval (default 30s) when viewing today
  - Organization-scoped via `organizationId`
- **useLaborBoard** (`hooks/use-labor-board.ts`) — Labor board data and drag-drop state
- **useAnimeFlip** / **useAnimeEffects** — Animation hooks for smooth UI transitions
- **Types** (`types/team-performance.types.ts`) — Performance data type definitions
- **Backend**: `@/lib/supabase/labor-management.service` for `WorkingArea` and labor data

## Architecture Notes
- Efficiency values capped at 150% to prevent outlier skew in team averages
- Date picker supports navigating to past dates for historical analysis; forward navigation blocked past today
- Uses `framer-motion` for animated stat card entrance and performance tips
- Sidebar settings layout reuses shared `ContentSection` and `SidebarNav` components
- Labor standards define expected performance per task type per position
- Organization chart rendered as interactive tree component
- 2026-04-25 Settings redesign: Settings now acts as an operations control center with URL-backed sections, a visible feature wiring matrix, live/partial/setup/pending status labels, timezone-aware performance queries, and cache invalidation across settings, labor, and activity-source changes. See [[Redesign-ShiftProductivity-Settings-Operations-Control-Center]].

## Related
- [[Architecture]]
- [[HRTimeTracking - Feature Module]]
- [[UserManagement - Feature Module]]
- [[WorkQueue - Feature Module]]
- [[Redesign-ShiftProductivity-Associate-Row]]
- [[ProductionBoards - Feature Module]] — sibling app under Labor Management; reuses the same `shift_productivity:view` permission, timezone, and per-hour targets to render a TV-display-grade Hourly Completion Tracker (per-associate × per-hour grid). Added 2026-05-10.