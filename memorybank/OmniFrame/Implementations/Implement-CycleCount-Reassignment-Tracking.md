---
tags: [type/implementation, status/active, domain/database, domain/frontend]
created: 2026-04-14
---
# Implement: Cycle Count Reassignment Tracking

## Purpose
When cycle counts are reassigned to a different user, the system now automatically:
1. Records who previously counted and what they counted
2. Zeros out `counted_quantity` so the new counter starts fresh
3. Increments a `reassignment_count` for quick UI indicators
4. Surfaces history in the Manual Counts table and detail modal

## Architecture
Uses a **BEFORE UPDATE trigger** (`track_assignment_changes`) on `assigned_to` changes, so all assignment paths (RPC, Rust push/claim) are covered automatically without modifying each code path.

## Database Changes (Migration 216)

### New table: `cycle_count_assignment_history`
- `count_id` FK → `rr_cyclecount_data`
- `previous_counter_id`, `previous_counter_name`, `previous_counted_quantity`, `previous_status`
- `new_counter_id`, `new_counter_name`
- `reassigned_by`, `reassigned_at`
- `organization_id` with RLS

### New column: `rr_cyclecount_data.reassignment_count`
INTEGER DEFAULT 0 — fast indicator for the UI without a join.

### Trigger: `track_assignment_changes()`
Fires BEFORE UPDATE OF `assigned_to` on `rr_cyclecount_data`:
- Records history when there was a previous assignee or counted quantity
- Zeros out `counted_quantity`, variance fields, resets status to `in_progress`
- Increments `reassignment_count`
- Captures acting user from Supabase JWT context via `request.jwt.claims`

## Service Layer
- `CycleCountService.fetchAssignmentHistory(countId)` — queries history table with user profile join
- `AssignmentHistoryRecord` type exported from `cycle-count.service.ts`

## Frontend (manual-counts-search.tsx)
- **Table row**: Amber "Reassigned" badge with `RefreshCw` icon in the Counter column
- **Detail modal**: "Assignment History" card with timeline of previous assignments (counter name, counted qty, status at reassignment, date)

## Files Changed
- `supabase/migrations/216_add_assignment_history_tracking.sql`
- `src/lib/supabase/database.types.ts` — new table types + `reassignment_count` column
- `src/lib/supabase/cycle-count.service.ts` — `fetchAssignmentHistory` method + type
- `src/components/manual-counts-search.tsx` — table badge + modal history card

## Related
- [[ManualCountsSearch - Inventory Tab]]
- [[RFCycleCountServices - Supabase Service]]
- [[RustService - Work Service]]
- [[Database-Schema-Overview]]
- [[Fix-CycleCount-Completed-With-Variance]]