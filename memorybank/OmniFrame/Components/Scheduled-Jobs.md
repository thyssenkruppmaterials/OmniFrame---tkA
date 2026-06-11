---
tags: [type/component, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-04-29
---
# Scheduled Jobs (Phase D #14)

## Purpose / Context
Lets users define recurring SAP automations (cron-style) that fire without a human present — e.g. "every weekday 6am sweep unconfirmed putaway TOs via LT12", "every Monday 2am refresh master-data via LT10".

Builds on the Phase A1 job queue: a Postgres function (run by pg_cron, or polled by the agent as fallback) inserts due rows into `sap_agent_jobs`. The on-prem agent claims and runs them like any other job — **no agent code change** to consume scheduled work.

## Architecture

```
┌────────────────────────────┐
│  Browser: Scheduled Jobs   │     CRUD via PostgREST + RLS
│  tab (Inventory > tools)   │ ◀──────────────▶ public.sap_agent_schedules
└────────────────────────────┘
                                       │
                            every 1m   │ pg_cron (or 60s agent poll)
                                       ▼
                   public.enqueue_due_schedules()
                                       │
                                       ▼
                   INSERT INTO public.sap_agent_jobs
                                       │
                                       ▼
                   on-prem agent claims, runs, marks done
```

## Pieces

### Database (`supabase/migrations/248_create_sap_agent_schedules.sql`)
- `public.sap_agent_schedules` — id, organization_id, name, description, enabled, cron_expression, endpoint, payload, assigned_agent_id, max_attempts, priority, last_run_at, last_job_id, last_error, next_run_at, created_by. RLS scoped to org. REPLICA IDENTITY FULL + supabase_realtime publication.
- `compute_next_run_at(cron_expression, from_ts)` — minimal Postgres-side cron parser:
  - `*/N * * * *` — every N minutes
  - `0 */N * * *` — every N hours on the hour
  - `0 H * * *` — daily at HH:00
  - `0 H * * D` — weekly on dow D at HH:00 (0=Sun)
  - Anything else → `+1h` fallback (so the scheduler never gets stuck).
- `enqueue_due_schedules()` — sweeps enabled schedules where `next_run_at <= now()`, inserts a queued `sap_agent_jobs` row using a per-minute idempotency key, advances `next_run_at`. Per-row savepoints so a single bad schedule can't block the rest. On error, stamps `last_error` and pushes `next_run_at` out 5min.
- pg_cron registration: `'omniframe-enqueue-due-schedules'` calling the function every minute. **pg_cron is NOT enabled in this Supabase project today** — gracefully no-op'd; agent's 60s polling fallback covers the gap.

### Frontend
- New tab `Scheduled Jobs` in `src/features/admin/sap-testing/index.tsx`.
- New `src/features/admin/sap-testing/components/scheduled-jobs-tab.tsx`:
  - List view with name, cron + human-readable label, endpoint, pinned-to badge, last/next run, enable Switch, Run-now / Edit / Delete actions.
  - "Run now" inserts a one-off job using the schedule's endpoint + payload + pin (idempotency `manual:<id>:<ts>`); next_run_at is left untouched so the cron tick still fires on time.
  - Editor `<Dialog>` with cron presets ("Every 15 minutes", "Daily at 03:00", "Weekly Monday 06:00"…) plus free-form text box, endpoint dropdown (matches `_JOB_ENDPOINT_MODELS` in agent.py) + custom override, "Pin to agent" picker via `useOnlineSapAgents()`, payload JSON textarea, enable Switch.
  - CSV export.
  - Realtime-subscribed to `sap_agent_schedules` so manual runs / pg_cron promotions reflect immediately.

## Operational notes
- **Enable pg_cron** in Supabase Dashboard → Database → Extensions for true Postgres-side cron. Then re-run the inner `cron.schedule(...)` call from migration 248 to register the omniframe job.
- **Times**: stored as UTC; the cron parser interprets HH:MM in UTC. Display is the user's browser locale, with both relative ("in 3h") and absolute timestamps.
- **Long-running jobs**: per-minute idempotency token prevents double-fires within the same minute. Multi-minute overlap is a non-issue (each minute's tick produces a distinct job row that the agent serializes via SAP's single-threaded session).
- **Agent offline at fire time**: enqueued row sits in `sap_agent_jobs` until an agent claims it (no data loss). If `assigned_agent_id` is set and that agent is offline, the row stays queued; consider this when designing critical schedules.

## Capabilities published
- `scheduled-jobs`

## Related
- [[Implementations/Implement-Scheduled-Recurring-Jobs]]
- [[Implementations/Implement-Multi-Agent-Coordination]]
- [[Components/Inventory-Management - SAP Query Framework]]
