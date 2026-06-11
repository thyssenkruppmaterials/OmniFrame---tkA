# Runbook — Lost Claim

**Symptom.** Operator sees a task in their queue but `claimNext()` returns
`null` (RF shows "no work available").

## Triage

1. **Phase 1 of dispatcher already-assigned check.**
   ```sql
   SELECT id, status, assigned_to FROM work_tasks
    WHERE organization_id = $org AND assigned_to = $user
      AND status IN ('claimed','in_progress')
    LIMIT 1;
   ```
   If a row exists, the dispatcher SHOULD have returned it. Capture the
   row + the task's full `work_events` history.

2. **Defer table.**
   ```sql
   SELECT count_id FROM cycle_count_operator_deferred_counts
    WHERE user_id = $user AND is_active = true
    ORDER BY created_at DESC
    LIMIT 5;
   ```
   The dispatcher excludes IDs in this set for this user only.

3. **Zone exclusivity rejection.**
   Tail the work-service log for `ZONE_LOCKED: active` or
   `ZONE_LOCKED: reserved` errors with this user's id.

## Fix

- If Phase 1 is silently dropping the assigned row: capture the strategy
  context (`SELECT * FROM worker_capabilities WHERE user_id = $user`) and
  the task's `dispatch_zone`. Open `rust-work-service/tests/dispatcher_phase1.rs`
  and add a failing test mirroring the missing case.
- If a deferred row was created accidentally: clear with
  `DELETE FROM cycle_count_operator_deferred_counts WHERE user_id = $user AND count_id = $tid;`.
