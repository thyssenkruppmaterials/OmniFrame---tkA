---
tags: [type/debug, status/active, domain/database, domain/backend]
created: 2026-04-14
---
# Fix: Cycle Count Completed Status Despite Non-Zero Variance

## Problem
Cycle counts with non-zero variance (e.g., CC-20260414-0003 variance=-4, CC-20260413-0100 variance=-2) were showing status `completed` instead of `variance_review` in the Manual Counts tab.

## Root Cause
The `auto_calculate_cycle_count_variance` trigger (migration 203) only upgraded status to `variance_review` when `requires_recount = true`, which required exceeding **thresholds**:
- `variance_percentage > 10%` (default) **OR**
- `|variance_quantity| > 10 units` (default)

Small absolute variances on high-quantity items fell below both thresholds. For example:
- System=93, Counted=89, Variance=-4 → 4.3% and 4 units → both under thresholds → stayed `completed`
- System=27, Counted=24, Variance=-3 → 11.1% → exceeded 10% → correctly set to `variance_review`

## Fix (Migration 215)
Decoupled status logic from threshold-based `requires_recount`:
- **Status**: ANY non-zero variance on completion → `variance_review`
- **requires_recount**: Remains threshold-based (for recount workflow decisions)

Key change in trigger:
```sql
-- Before (threshold-gated):
IF NEW.requires_recount = true AND NEW.status = 'completed' ...

-- After (any discrepancy):
IF NEW.variance_quantity != 0 AND NEW.status = 'completed' ...
```

Also ran data fix to update 127 existing `completed` rows with non-zero variance to `variance_review`.

## Files Changed
- `supabase/migrations/215_fix_variance_review_any_discrepancy.sql` — new migration

## Related
- [[Fix-CycleCount-Complete-Variance-Overflow]]
- [[RFCycleCountServices - Supabase Service]]
- [[ManualCountsSearch - Inventory Tab]]
- [[Database-Schema-Overview]]