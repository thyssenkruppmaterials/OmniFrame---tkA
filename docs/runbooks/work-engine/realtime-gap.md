# Runbook — Realtime Gap

**Symptom.** Supervisor desktop or Operation Control surface shows static
data for > 60s; the header banner reads "Reconnecting…".

## Triage

1. **WS health.** Browser devtools → Network → WS frame inspector. The
   `workServiceWs` connection should emit a heartbeat every 30s.

2. **Postgres-changes health.** Run from the Supabase SQL editor:
   ```sql
   SELECT count(*), max(at) FROM work_events
    WHERE organization_id = $org;
   ```
   If the wall-clock max is fresh but the browser shows nothing, the WS
   path is fine and the Postgres-changes channel is the culprit.

3. **30s polling rescue.** `useWorkEngineLive` falls back to
   `work_engine_health` polling after 60s of silence. Confirm the polling
   query is succeeding by tailing `work-service` logs for the
   `pg_advisory_lock_wait_seconds` histogram.

## Backfill poller (OmniAgent precedent)

The OmniAgent's v1.7.8 "backfill polling skipped when Realtime healthy"
pattern (`omni_agent/agent.py:116`) is the model to follow. When a
supervisor desktop reports a gap:

- Confirm the OmniAgent's backfill poller is still running for the org.
- If both WS and Postgres-changes are silent, the org's supabase_realtime
  publication may be excluding `work_tasks` or `work_events`. Run
  `supabase/tests/work_engine_migration_range.sql` and
  `supabase/migrations/257_cycle_count_to_work_tasks_projection.sql`
  membership probe.
