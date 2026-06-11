# Runbook — Rollback Drill (quarterly cadence)

**Owner.** Platform engineering. **Cadence.** Quarterly, in staging only.

## Pre-drill (T-1 day)

- Confirm staging mirrors production schema (run
  `supabase/tests/work_engine_migration_range.sql`).
- Stage at least 50 active cycle-count tasks across `pending`, `claimed`,
  `in_progress`, `paused` per org. Capture pre-drill snapshot via
  `scripts/supabase-validation/rollback_drill_snapshot.sql` (operator-driven).

## Drill (T+0)

1. With work in flight, set `work_tasks_read_primary = true` for one canary
   org for ≥ 1 hour, then trigger rollback per Phase 0.3:
   ```sql
   UPDATE work_engine_settings
      SET feature_flags = feature_flags
            || '{"work_tasks_read_primary":      false}'::jsonb
            || '{"work_tasks_rollback_to_legacy": true}'::jsonb
    WHERE organization_id = $canary_org;
   ```
2. Snapshot immediately after rollback.
3. Reconcile via `scripts/supabase-validation/work_tasks_drift.sql`.
4. Re-enable shadow writes only after drift = 0.

## Pass criteria (per Phase 0.3)

- No lost tasks (count(claimed) + count(in_progress) preserved).
- No duplicate claims.
- No artifact loss.
- No cross-org visibility.
- Legacy `rr_cyclecount_data` reads return the same operational queue as
  pre-drill.

## Document

Append the drill log to `memorybank/OmniFrame/Sessions/YYYY-MM-DD.md` with
links to before/after snapshots and the reconciliation diff.
