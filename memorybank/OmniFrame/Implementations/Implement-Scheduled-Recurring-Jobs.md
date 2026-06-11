---
tags: [type/implementation, status/completed, domain/backend, domain/database, domain/frontend]
created: 2026-04-29
completed: 2026-04-29
---
# Implement: Scheduled / Recurring Jobs (Phase D #14) — COMPLETED

## Purpose / Context
Some SAP operations should run nightly or hourly without a human present — e.g. "every weekday at 6am, sweep all unconfirmed putaway TOs older than 12h via LT12" or "every Monday 2am, refresh the master-data extract via LT10".

Builds on Phase A1's job queue: a Postgres function inserts due rows into `sap_agent_jobs`; the on-prem agent claims and runs them like any other job — **no agent code change needed to consume scheduled work**.

## Implementation summary
**Migration `248_create_sap_agent_schedules.sql`** (applied via Supabase MCP):
- Table `public.sap_agent_schedules`: id UUID PK, organization_id (FK), name, description, enabled, cron_expression, endpoint, payload JSONB, assigned_agent_id, max_attempts, priority, last_run_at, last_job_id (FK to sap_agent_jobs), last_error, next_run_at, created_by, created_at, updated_at. RLS scoped to org. Realtime publication + REPLICA IDENTITY FULL.
- Function `compute_next_run_at(cron_expression, from_ts)` — minimal Postgres-side parser supporting:
  - `*/N * * * *` — every N minutes
  - `0 */N * * *` — every N hours on the hour
  - `0 H * * *` — daily at HH:00
  - `0 H * * D` — weekly on day-of-week D at HH:00 (0=Sun)
  - Anything else falls back to `+1h` so the scheduler never gets stuck.
- Function `enqueue_due_schedules()` — sweeps enabled schedules where `next_run_at <= now()`, inserts a queued `sap_agent_jobs` row using a per-minute idempotency key (`sched:<id>:<YYYYMMDDHHMI>`), and advances `next_run_at` via `compute_next_run_at(...)`. Wrapped in a per-row savepoint so a single bad schedule can't block the rest. On error, stamps `last_error` and pushes `next_run_at` out 5min.
- Trigger `tg_sap_agent_schedules_touch_updated_at` keeps `updated_at` honest.
- pg_cron registration: `cron.schedule('omniframe-enqueue-due-schedules', '* * * * *', 'SELECT public.enqueue_due_schedules();')`. **pg_cron is NOT enabled in this Supabase project today** — the `DO` block detects this gracefully and emits a NOTICE. The agent's polling fallback (60s) plus the manual "Run now" button cover the gap until pg_cron is enabled in Supabase Dashboard → Database → Extensions.

**Agent**: nothing new — the agent claims scheduled rows like any other job. (Schedules `assigned_agent_id` flows through naturally because migration 247 added pin-aware claim.)

**Frontend**:
- New tab `Scheduled Jobs` registered in `src/features/admin/sap-testing/index.tsx` (between Inventory Management and TO History).
- New `src/features/admin/sap-testing/components/scheduled-jobs-tab.tsx` (~600 LOC):
  - List view: name + description + last_error pill, cron expression with human-readable label, endpoint, pinned-to badge, last_run_at relative + absolute, next_run_at relative + absolute, enable/disable Switch, "Run now" / Edit / Delete actions.
  - "Run now" inserts a one-off `sap_agent_jobs` row using the schedule's endpoint + payload + pin (idempotency_key `manual:<id>:<ts>`); next_run_at is left untouched so the cron tick still fires on time.
  - Editor `<Dialog>`: name, description, cron expression with 7 one-click presets ("Every 15 minutes", "Every hour", "Daily at 03:00", "Weekly Monday 06:00", etc.) + free-form text box, endpoint dropdown (matches `_JOB_ENDPOINT_MODELS` in agent) + custom override, "Pin to agent" picker pulled from `useOnlineSapAgents()`, payload JSON textarea, enable Switch.
  - CSV export.
  - Realtime-subscribed to `sap_agent_schedules` so manual runs / pg_cron promotions reflect immediately.

## Edge cases handled
- **Agent offline at fire time**: enqueued row sits in `sap_agent_jobs` until an agent claims it.
- **pg_cron not enabled**: migration logs a NOTICE; the agent's 60s polling fallback still picks up due schedules within a minute.
- **Long-running job overlaps next fire**: per-minute idempotency token (`sched:<id>:<YYYYMMDDHHMI>`) dedupes within the same minute via `ON CONFLICT (organization_id, idempotency_key) DO NOTHING`.
- **Bad cron expression**: parser returns `+1h` and `last_error` is stamped on the row so operators can re-edit.
- **Agent crashes during run**: lease (Phase D #13) expires → another agent re-claims; the schedule stays unaware (it only cares that *one* job was enqueued).

## Files
- `supabase/migrations/248_create_sap_agent_schedules.sql`
- `src/features/admin/sap-testing/components/scheduled-jobs-tab.tsx` (new)
- `src/features/admin/sap-testing/index.tsx` (registers tab)

## Capabilities (handoff to foreground for /health)
- `scheduled-jobs`

## Operator follow-ups
1. **Enable pg_cron** in Supabase Dashboard → Database → Extensions for true Postgres-side cron. Then re-run the `DO` block at the bottom of `248_create_sap_agent_schedules.sql` (or just the inner `cron.schedule(...)` call) to register the omniframe job.
2. Pin schedules that depend on a specific warehouse's SAP system to the right agent via the editor's "Pin to agent" picker.

## Related
- [[Implementations/Implement-Multi-Agent-Coordination]]
- [[Components/Scheduled-Jobs]]
- [[Implementations/Job-Queue-Architecture]]
