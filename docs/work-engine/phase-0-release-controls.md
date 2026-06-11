# Phase 0 — Release Controls and Cutover Flags

This document is the operator contract for safely landing the Work Engine
Foundation. It complements the read-only plan at
`.cursor/plans/work_engine_foundation_e9c4a217.plan.md`.

## 0.1 Feature flags

Per-organization and environment-level flags are defined and enforced through
`public.work_engine_settings.feature_flags` (see migration 256). Flags
resolve through `public.work_engine_feature_flag(p_org uuid, p_key text)`.

| Key                              | Default | Meaning |
| -------------------------------- | ------- | ------- |
| `work_engine_enabled`            | `false` | master gate — when `false`, RF + supervisor surfaces stay on the legacy cycle-count code paths |
| `work_tasks_shadow_write`        | `false` | enable migration-257 sync triggers for this org |
| `work_tasks_read_shadow`         | `false` | read both, report drift, return legacy |
| `work_tasks_read_primary`        | `false` | flip to `work_tasks` as source of truth for this org |
| `work_tasks_rollback_to_legacy`  | `false` | break-glass — forces legacy reads/writes regardless of other flags |
| `push_preflight_zone_check`      | `true`  | retain Migration-252 supervisor preflight panel |
| `worker_capability_required`     | `false` | when `true`, claim filters by `worker_capabilities` strictly (no fall-back) |
| `signed_url_photos`              | `false` | switch evidence photo reads from public URL to signed URL |

Frontend reads via `src/lib/work-engine/flags.ts`; the Rust dispatcher reads
via the settings cache (`rust-work-service/src/settings/cache.rs`).

## 0.2 Baselines (must capture before applying migration 256)

Run these once per environment and check the output into the canary review
artifact bundle:

```sql
-- Supabase advisor snapshot (run via MCP supabase__get_advisors or SQL fallback).
-- Save the JSON output as docs/work-engine/baselines/{env}-advisors-{date}.json.

-- RLS policy inventory.
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Realtime publication membership.
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- Storage bucket policies.
SELECT id, bucket_id, name, definition
FROM storage.policies
ORDER BY bucket_id, name;

-- Row counts for cycle-count by org/status/count_type.
SELECT organization_id, status, count_type, count(*) AS rows
FROM rr_cyclecount_data
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;
```

Capture these additional artifacts:

- Work-service API route list and WebSocket event casing (`rust-work-service/src/api/routes/*.rs`).
- Output of `pnpm quality:ci` (the post-change baseline must not regress vs.
  this run).
- Inventory of deployment env vars for frontend, Rust work service, Supabase,
  and OmniAgent.

## 0.3 Rollback contract

The rehearsed sequence:

1. Set `work_tasks_read_primary = false` for affected orgs.
2. Set `work_tasks_rollback_to_legacy = true` for affected orgs.
3. If shadow trigger writes are causing errors, set
   `work_tasks_shadow_write = false`. Otherwise leave them on so reconciliation
   can keep reporting.
4. Leave `work_tasks`, `work_events`, `task_artifacts`, and
   `work_request_idempotency` rows in place for forensics.
5. Reconcile rows (run `scripts/supabase-validation/work_tasks_drift.sql`)
   before re-enabling shadow mode.

**Rehearsal acceptance criteria.** The rollback drill is "documented" only
after it has been rehearsed in staging with active work in flight, and the
following before/after snapshots are captured by
`scripts/supabase-validation/rollback_drill_snapshot.sql`:

- `pending`, `claimed`, `in_progress`, `paused` task counts;
- soft reservations and explicit zone pins;
- pushed-but-not-acknowledged work with `supervisor_assigned_at/by`;
- `work_events`, `task_artifacts`, `work_request_idempotency` row counts;
- connected RF and Operation Control WebSocket clients;
- drift counts before rollback, immediately after rollback, and after shadow
  writes are re-enabled.

**Pass criteria.** No lost tasks, no duplicate claims, no artifact loss, no
cross-org visibility, and legacy `rr_cyclecount_data` reads return the same
operational queue as before the drill. Verify via the side-by-side report from
`scripts/supabase-validation/rollback_drill_compare.sql`.

## 0.4 Environment parity checklist

Before Phase 1 migration apply, confirm these env vars are present in the
target environment:

| Surface | Var | Notes |
| ------- | --- | ----- |
| Frontend | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WORK_SERVICE_URL` | unchanged |
| Frontend | `VITE_WORK_ENGINE_FEATURE_OVERRIDES` | optional JSON for environment-level flag overrides (resolved before per-org row) |
| Rust work service | `DATABASE_URL`, `REDIS_URL`, `RUST_CORE_API_KEY` | existing |
| Rust work service | `WORK_WS_TOKEN_SECRET` | new — HMAC secret for `WS-Subscribe-Token` (Phase 2.0 v1 decision) |
| Rust work service | `WORK_ENGINE_PROMETHEUS_BIND` | new — bind address for `/metrics` (defaults to `127.0.0.1:9301` in dev, off in prod unless set) |
| Rust work service | `WORK_REQUEST_IDEMPOTENCY_TTL_SECS` | new — overrides 24h default for the idempotency cache |
| OmniAgent | `OMNIFRAME_INSECURE_SSL`, allowed origins | unchanged; Phase 10.8 verifies no wildcard CORS |

`scripts/supabase-validation/env_parity.sh` runs `node
scripts/validate-check-matrix.mjs --env-only` which inspects the deployed
Railway/Supabase configuration without touching production data.
