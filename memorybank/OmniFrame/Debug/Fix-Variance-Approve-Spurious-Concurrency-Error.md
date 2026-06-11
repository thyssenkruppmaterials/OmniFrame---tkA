---
tags: [type/debug, status/active, domain/frontend, domain/database, cycle-count, work-engine]
created: 2026-06-07
---
# Fix: Variance Approve Raises Spurious "Count was modified in another window"

## Symptom

On the Inventory → **Inventory Counts** (Manual Counts) page, approving a
single count in `variance_review` failed almost every time with the toast
**"Count was modified in another window — refreshing"**. The row never got
approved; the page just refreshed and the count stayed in variance review.
The **mass-approve** path (select rows → approve) worked fine, which was the
key tell that the single-row path had a unique defect.

## Root cause (file:line)

Single-row supervisor actions implemented "optimistic concurrency" against the
**wrong table/column**.

`src/components/manual-counts-search.tsx::handleApproveCount` (and the twin
`handleAssignCount`) read rows from `rr_cyclecount_data` (`item.id`,
`item.updated_at`), then called `workService.approveVariance` /
`updateAssignment` which ran a CAS on **`work_tasks`**:

```
.eq('id', countId).eq('updated_at', expected_updated_at)   // on work_tasks
```

Two independent reasons this CAS almost always matched 0 rows → threw
`ConcurrencyError` → the handler early-returned **before** the authoritative
legacy write ever ran:

1. **No projection row exists for most counts.** The `rr_cyclecount_data` →
   `work_tasks` projection (`migration 257`) only fires on INSERT/UPDATE while
   `work_tasks_shadow_write` is ON, and never back-inserts on UPDATE. Live
   check on tenant `c9d89a74` (flag ON): of **746** `variance_review` rows,
   only **72** had a matching `work_tasks` row (`wt.id = cc.id`).
2. **`updated_at` is set by different clocks.** The legacy row's `updated_at`
   is a client `new Date().toISOString()`; the projection stamps
   `work_tasks.updated_at = now()` (DB transaction clock). Even among the 72
   matched rows, only **60** had equal `updated_at`.

Net: ~91% of single approvals hit `count === 0` → spurious `ConcurrencyError`.
`massApproveVariance`/`massDelete` were immune because they match by
`source_id` with **no** `updated_at` CAS.

Confirming SQL:
```sql
SELECT public.work_engine_feature_flag(cc.organization_id,'work_tasks_shadow_write') AS shadow_on,
       count(*) variance_rows, count(wt.id) matching_work_tasks,
       count(*) FILTER (WHERE wt.id IS NOT NULL AND wt.updated_at = cc.updated_at) updated_at_matches
FROM rr_cyclecount_data cc LEFT JOIN work_tasks wt ON wt.id = cc.id
WHERE cc.status='variance_review' GROUP BY 1;
-- shadow_on=t, variance_rows=746, matching_work_tasks=72, updated_at_matches=60
```

## Fix

Optimistic concurrency for single-row supervisor actions now lives on the
**authoritative legacy write** — the table + `updated_at` the UI actually read:

- `handleApproveCount`: one `rr_cyclecount_data` UPDATE with
  `.eq('id', countId).eq('organization_id', orgId)` plus
  `.eq('updated_at', expectedUpdatedAt)` (only when provided) and
  `{ count: 'exact' }`. A genuine CAS miss (`count === 0`) still shows the
  "modified in another window" toast + refresh — but now it only fires when the
  *legacy* row really changed (or was already approved). The `work_tasks` sync
  runs afterward, best-effort, matched by `source_id` (no CAS), so a
  missing/stale projection row can never block the approval.
- `handleAssignCount`: zone-aware `assignCountToUser` (the existing source of
  truth) runs first; the `work_tasks` sync is best-effort by `source_id`.
- `src/lib/supabase/work.service.ts`: `approveVariance` and `updateAssignment`
  rewritten to match by `source_id`, drop the `work_tasks.updated_at` CAS, and
  return an affected-row count instead of throwing `ConcurrencyError` (mirrors
  `massApproveVariance`/`massDelete`). `updatePriority` (no UI caller) left
  untouched; `ConcurrencyError` class retained for it.
- Removed the now-unused `ConcurrencyError` import from
  `manual-counts-search.tsx`.

## Why this is correct, not just "remove the guard"

The supervisor dashboard is a `rr_cyclecount_data` view. The only timestamp it
can meaningfully compare against is that table's `updated_at`. `work_tasks` is a
secondary projection with its own lifecycle, so a CAS there could never reflect
"did the row the user is looking at change?". Moving the CAS to the legacy row
makes the guard real for the first time while ending the false positives.

## Verification

- `tsc -b` clean; ESLint clean on both files.
- `useCycleCountOperations.test.ts` (10 tests) pass.
- No other callers of `approveVariance`/`updateAssignment` exist (grep), no
  tests reference them.

## Related
- [[ManualCountsSearch - Inventory Tab]]
- `supabase/migrations/257_cycle_count_to_work_tasks_projection.sql`
- [[Fix-RF-Cycle-Count-Stuck-Waiting]] (same tenant `c9d89a74`, work-engine projection gaps)
