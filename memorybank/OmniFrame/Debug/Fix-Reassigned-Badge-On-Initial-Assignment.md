---
tags: [type/debug, status/active, domain/database, domain/frontend]
created: 2026-04-19
---
# Fix: "Reassigned" badge showing on first assignment

## Symptom
Dashboard rendered the amber "Reassigned" badge on cycle counts that had only ever been assigned once (the current assignee was the very first one). Live DB state before the fix: 135 of 1,180 rows had `reassignment_count > 0` but only 28 history rows existed in `cycle_count_assignment_history`.

## Root cause
`track_assignment_changes()` (migration 216) had an outer guard of
```sql
IF NEW.assigned_to IS NOT NULL AND OLD.assigned_to IS DISTINCT FROM NEW.assigned_to
```
That guard fires for BOTH the initial assignment (`OLD.assigned_to IS NULL` → user UUID) and real reassignments. The history-insert block inside it correctly re-gated with `IF OLD.assigned_to IS NOT NULL OR OLD.counted_quantity IS NOT NULL`, but the `NEW.reassignment_count := OLD.reassignment_count + 1` increment at the bottom of the function was NOT re-gated — so every initial assignment bumped the counter to 1.

## Fix — migration 221
`supabase/migrations/221_fix_reassignment_count_initial_assignment.sql`

1. Moved the `reassignment_count` increment INSIDE the `IF OLD.assigned_to IS NOT NULL OR OLD.counted_quantity IS NOT NULL THEN` block so it shares the same guard as the history insert.
2. Also added `SET search_path = public, pg_temp` to the function (Supabase advisor hygiene).
3. **Backfilled `reassignment_count`** from the authoritative source (`cycle_count_assignment_history`): each row's counter = number of history entries pointing at it. Rows with no history got zeroed.

## Post-fix verification
- `reassignment_count > 0` rows: 135 → **28** (exactly matches 28 distinct counts in `cycle_count_assignment_history`).
- End-to-end DO block simulating insert → first assign → reassign → reassign-back:
  | Step | counter |
  |---|---|
  | After insert | 0 |
  | After first assign (NULL → user1) | **0** |
  | After reassign (user1 → user2) | 1 |
  | After reassign (user2 → user1) | 2 |
- Supabase advisor clean for the updated function.

## Related
- Original trigger: `supabase/migrations/216_add_assignment_history_tracking.sql`
- [[Fix-Unassigned-Deferred-Reassigned-Badges]] — companion UI-side fix that hides the badge on unassigned rows.
