---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# Team Performance Service

## Purpose
Aggregates productivity data across all team members by department and working area. Provides Gantt-style activity timelines, labor standard efficiency calculations, weekly trend analysis, and CSV export. This is the primary analytics engine powering the Shift Productivity dashboard.

**Performance optimized** (Jan 3, 2026): Replaced N+1 query pattern (~850 queries/day) with 3-5 batch RPC queries.

## Key Functions

### TeamPerformanceService (singleton class)

#### Core Data Retrieval
- `getTeamProductivity(orgId, targetDate, filters?, timezone?)` → main entry point; fetches all data in 4 parallel queries (shift assignments, labor standards, productivity counts, activity events), processes in-memory, returns full team performance data with department/area aggregation
- `getTeamProductivityForDateRange(orgId, startDate, endDate, filters?, timezone?)` → multi-day aggregation; fetches each day in parallel, merges associate productivity across days
- `getWeeklyTrendOptimized(orgId, endDate?, timezone?)` → 7-day trend via single RPC `get_weekly_productivity_summary`

#### Optimized Batch RPC Methods (private)
- `getTeamProductivityCounts(orgId, startDate, endDate)` → RPC `get_team_productivity_counts` — returns per-user counts for all task types
- `getTeamActivityEvents(orgId, startDate, endDate)` → RPC `get_team_activity_events` — returns timestamped events with dynamic activity config metadata
- `getShiftAssignmentsWithDetails(orgId)` → RPC `get_shift_assignments_with_details` — full assignment data with user, position, area, schedule, supervisor info

#### Timeline Construction
- `buildActivityBlocks(events)` → groups events into work/idle blocks using 15-minute idle threshold; preserves dynamic config metadata
- `splitIdleBlocksAroundBreaks(blocks, dateString, scheduledBreaks, timezone?)` → separates scheduled break time from idle blocks for accurate Gantt visualization
- `buildDailyTimeline(events, dateString, shiftStart?, shiftEnd?, breaks?, timezone?)` → full day timeline with shift boundary clamping, overnight shift support, pre/post-shift idle padding

#### Efficiency Calculations
- `calculateAssociateEfficiency(productivity, laborStandards)` → weighted average efficiency across task types using labor standards; individual tasks capped at 150% to prevent outlier skewing; supports alias-based matching (legacy + dynamic activity types)
- `calculateLaborStandardComparisons(stats, laborStandards)` → team-level standard comparisons with excellent/meets/below/critical status

#### Aggregation
- `aggregateByDepartment(associates)` → groups by department with efficiency averages
- `aggregateByArea(associates, orgId)` → groups by working area with weighted efficiency, time metrics, production efficiency, capacity utilization
- `calculateSummary(associates)` → top 5 performers, needs-attention list (efficiency <70%)
- `calculateTeamStats(associates)` → summed task counts across all task types

#### Utilities
- `getActiveAssociatesCount(orgId)` / `getDepartments(orgId)` / `exportToCsv(data)`

### Exported Timezone Helpers
- `getDateStringInTimezone(date, timezone?)` / `isDateInDST(dateString, timezone?)` / `getESTOffsetHours(dateString, timezone?)` / `getUTCBoundariesForESTDate(dateString)`

## Database Tables
- `shift_assignments` / `shift_positions` / `working_areas` / `labor_standards` / `shift_schedules` / `user_profiles`
- Productivity source tables: `rr_inbound_scans`, `rf_putaway_operations`, `outbound_to_data`, `putback_tickets`, `rr_cyclecount_data`

## Database RPCs
- `get_team_productivity_counts(p_organization_id, p_start_date, p_end_date)`
- `get_team_activity_events(p_organization_id, p_start_date, p_end_date)`
- `get_shift_assignments_with_details(p_organization_id)`
- `get_weekly_productivity_summary(p_organization_id, p_end_date)`

## Design Notes
- Default timezone: `America/New_York` (configurable per-organization)
- Efficiency cap: 150% per task type to prevent statistical outlier skewing
- Idle threshold: 15 minutes between events = new block
- Overnight shift support: handles shifts crossing midnight
- Cross-day event filtering: events outside target date in local timezone are excluded

## Related
- [[Architecture]]
- [[LaborManagement - Supabase Service]]
- [[ProductivityAndSettings - Supabase Service]]
- [[StandardWorkAndOperations - Supabase Service]]