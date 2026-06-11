---
tags:
  - type/debug
  - status/active
  - domain/frontend
  - domain/database
  - cycle-count
created: 2026-05-18
---
# Fix — Inventory Counts "Total" Did Not Match Pending + Completed

## Symptom
On the Inventory Management → **Inventory Counts** tab, the **Count Status** card showed Total = 9,127 but Pending (369) + Completed (7,679) only summed to 8,048 — a 1,079-row discrepancy.

## Root cause
The Supabase RPC `get_cycle_count_statistics()` (originally written in migration 062) computed each pill independently:
- `totalCounts` — `COUNT(*)` (all rows)
- `pendingCounts` — `status = 'pending'`
- `completedCounts` — `status = 'completed'`

The `cycle_count_status` enum (`pending`, `in_progress`, `completed`, `variance_review`, `approved`, `cancelled`) has six values, so rows in `variance_review` (777) and `approved` (302) were silently excluded from both visible pills but still counted in `totalCounts`.

## Fix
### 1. Migration `315_fix_cycle_count_statistics_grouping.sql`
Redefined the two visible buckets so they cover every non-cancelled workflow state, then derive `totalCounts` from those:
- `pendingCounts` = `status IN ('pending', 'in_progress')` — work still to do (or actively in flight).
- `completedCounts` = `status IN ('completed', 'approved', 'variance_review')` — counting is finished even if approval / variance review is still in progress.
- `totalCounts` = `pendingCounts + completedCounts` (equivalent to `COUNT(*) WHERE status != 'cancelled'`).

The Variance Metrics card stays untouched:
- `varianceReviewCounts` is still `status = 'variance_review'` (a subset of completed).
- `countsRequiringRecount` is still `requires_recount = true AND recount_completed = false`.

The `priorityBreakdown` was also widened to include `in_progress` (matching the new `pendingCounts` definition) so per-priority totals stay consistent with the pill.

### 2. `src/components/manual-counts-search.tsx`
- Added `PENDING_GROUP_STATUSES` and `COMPLETED_GROUP_STATUSES` sets.
- Extended the `columnFilteredData` predicate so clicking the **Pending** pill matches both `pending` and `in_progress`, and clicking **Completed** matches `completed`, `approved`, and `variance_review` — keeping the visible row count in the table aligned with the pill number.
- Fixed the previously dead `recount` pill: it now matches `requires_recount === true AND !recount_completed` (same predicate as `countsRequiringRecount` in the RPC) instead of trying to compare against a non-existent `status = 'recount'`.
- Tightened the dropdown labels and the `title=`/`valueTitle=` tooltips on the Total / Pending / Completed pills so the grouping is discoverable.

## Verification
- `apply_migration` succeeded; `obj_description(...)` confirms the new function is live.
- Live SQL math check: `pendingCounts (639) + completedCounts (8758) = totalCounts (9397)` → `math_ok = true`.
- `npx tsc --noEmit -p tsconfig.app.json` → 0 errors.
- `npx eslint src/components/manual-counts-search.tsx` → 0 errors, 8 pre-existing `no-explicit-any` warnings (unchanged).

## Why this grouping (decision rationale)
Three options were considered:
1. **Hide variance_review / approved from `totalCounts`** — would have desynced the pill from the table (clicking Total still showed all rows).
2. **Add Approved + Variance Review pills to Count Status** — breaks the 3-column card layout and duplicates the Variance Metrics card's "Review" pill.
3. **Group statuses semantically (chosen)** — "Pending" = still needs counting, "Completed" = counted (any post-count state). Matches how supervisors actually talk about counts on the floor and is the minimum change that makes the math self-consistent.

## Follow-up (2026-05-19)
The companion 505-row purge that was run after this fix to clear a stale pending batch surfaced a second issue: `rr_cyclecount_data` DELETEs were not projected to `work_tasks`, so 505 orphan rows in `work_tasks` blocked all subsequent bulk imports the next morning. Resolved by [[Fix-Cycle-Count-Delete-Leaves-Orphan-Work-Tasks]] (migration 316 adds the missing DELETE projection).

## Related
- [[ManualCountsSearch - Inventory Tab]]
- [[Inventory-Counts-Tab-Comprehensive-Redesign]]
- [[Stat-Card-Clickable-Filter-Pills]]
- [[Fix-Cycle-Count-Delete-Leaves-Orphan-Work-Tasks]]
