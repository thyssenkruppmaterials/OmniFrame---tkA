---
tags: [type/implementation, status/active, domain/backend, domain/database, domain/api]
created: 2026-05-08
---

# Implement Putaway Confirm Backfill Loop

## Purpose / Context

Close the auto-recovery gap that left putaway TO confirms permanently `failed`
whenever the agent's SAP GUI session had a transient hiccup. As of
2026-05-08, the Phase 9 trigger evaluator + agent dispatch path had no
retry surface for `sap_agent_jobs.status='failed'` rows; the user had to
manually `UPDATE rf_putaway_operations SET updated_at = now()` to drive a
fresh NOTIFY, which itself was insufficient because the trigger evaluator's
INSERT collides with the existing failed row on
`UNIQUE(organization_id, idempotency_key)`.

This implementation adds:

1. A 5-minute pg_cron loop (migration 289) that requeues stuck failed
   jobs and replays NOTIFYs for orphaned candidate rows.
2. A rust-work-service v0.1.35 admin endpoint
   (`POST /api/v1/sap-agents/backfill-pending-confirms`) for on-demand
   draining.
3. An FE indicator + admin force-button on the Putaway Log Search
   panel's `Pending Confirms` card.

## Diagnosis (the visible-on-2026-05-08 incident)

- 11 rows on org `c9d89a74-7179-4033-93ea-56267cf42a17` stuck at
  `to_status='Completed', confirmed_source IS NULL, is_mca_workflow=false`
  with `created_at` between 15:53–17:57 UTC.
- Every stuck row had a corresponding `sap_agent_jobs` row keyed
  `trig:b8160159-ac8c-4488-bce2-3d193dc33697:<row_id>:20581` in
  `status='failed', attempts=1, max_attempts=1`. So **Category 5
  ("Agent claimed but failed silently")** fits — the trigger evaluator
  fired, the agent claimed, the SAP GUI script failed transiently, the
  job moved to terminal `failed` and was never revisited.
- Errors observed:
  - `(-2147352567, 'Exception occurred.', (619, 'SAP Frontend Server', 'The control could not be found by id.'))` — LT12 layout race.
  - `No active SAP GUI session found` — operator logged out of SAPGUI mid-run.
  - `Watchdog: job exceeded 120s timeout — likely SAP session hang`.
- Independent confirmations from the same window: 30+ later TOs
  auto-confirmed by Omni Agent at 21:27+ UTC, proving the underlying
  SAP path recovered — only the earlier failed jobs were orphaned.

For exhaustive diagnosis SQL evidence + the rejected categories, see the
`## Diagnosis` section of the migration-289 file header in
`supabase/migrations/289_backfill_pending_putaway_confirms.sql`.

## Why "bump updated_at" alone isn't enough

The Phase 9 evaluator's idempotency key includes a `<unix-day>` suffix
(see `rust-work-service/src/triggers/evaluator.rs::fire_trigger`) so a
failed row gets a fresh key on the next UTC day. **Within the same UTC
day**, an UPDATE that drives a NOTIFY → trigger evaluator INSERT
produces the SAME key as the existing failed row, and the
`ON CONFLICT (organization_id, idempotency_key) DO NOTHING` clause
silently no-ops. So the recovery path has to reset the failed job
in-place. The migration does both:

- **Branch 1 (failed-job reset)**: flip `status='failed' → 'queued'`,
  clear claim/heartbeat fields, reset `attempts=0`, raise
  `max_attempts = GREATEST(max_attempts, attempts + 2)`, append a
  `| retried by backfill at <ts>` breadcrumb. Guards: only resets jobs
  whose `completed_at` is older than 60s and whose `claim_count < 8`.
- **Branch 2 (orphan NOTIFY-replay)**: for candidate rows with NO
  matching `sap_agent_jobs` row at all in the lookback window AND whose
  org has at least one enabled trigger on `rf_putaway_operations`, bump
  `updated_at` to fire a fresh NOTIFY. The trigger evaluator INSERTs a
  job (no key collision because the row is a true orphan).

## Components

### Migration 289 (`supabase/migrations/289_backfill_pending_putaway_confirms.sql`)

- `public.backfill_pending_putaway_confirms(p_lookback_hours int default 24, p_failed_min_age_seconds int default 60, p_max_claim_count int default 8, p_organization_id uuid default null) returns table(rows_failed_requeued int, rows_orphan_replayed int, oldest_pending_minutes int)`
- Idempotent. `SECURITY DEFINER`. Runs via pg_cron at `*/5 * * * *`
  under jobname `omniframe-backfill-pending-putaway-confirms`.
- The function joins through `agent_triggers` (NOT a hardcoded UUID) so
  any future enabled trigger on `rf_putaway_operations` lights up
  automatically. Today only one trigger
  (`b8160159-ac8c-4488-bce2-3d193dc33697`, "Auto-Confirm Completed Putaways")
  matches.
- The cron path passes `p_organization_id := NULL` (cross-org).
- The on-demand route passes the caller's JWT org so an admin can only
  ever drain their own tenant.

### rust-work-service v0.1.35 — `POST /api/v1/sap-agents/backfill-pending-confirms`

- New route registered in `sap_agents.rs::sap_agents_routes()`.
- Accepts an optional JSON body `{ lookback_hours?: int, failed_min_age_seconds?: int, max_claim_count?: int }`.
- Clamps inputs to defensible ranges (lookback 1..168, failed-min-age
  0..3600, max_claim_count 1..100).
- Auth: same posture as `sap_console::allow_console_write` — any
  authenticated principal with an `organization_id` claim can call it,
  service-key callers (`role="service"`) bypass the org-required gate.
- Calls `public.backfill_pending_putaway_confirms($1::int, $2::int, $3::int, $4::uuid)` with `org_uuid` bound to the caller.
- Two unit tests added (`backfill_request_deserialises_with_all_defaults`,
  `backfill_request_clamp_helpers_match_handler_semantics`).

### FE — `useStuckPutawayConfirms` + `backfillPendingConfirms`

- `src/lib/work-service/sap-agents-client.ts`: new `backfillPendingConfirms()`
  function + `BackfillPendingConfirmsRequest` / `BackfillPendingConfirmsResponse`
  interfaces.
- `src/hooks/use-stuck-putaway-confirms.ts` (new): derives a stuck-pending
  view from already-loaded putaway data (no extra DB query). Exposes
  `count`, `oldestAgeMinutes`, `severity` (`ok` | `warn` | `error`),
  and a `forceBackfill()` mutation that calls the Rust route.
- `src/components/putaway-log-search.tsx`: enhances the existing
  "Pending Confirms" stats card with:
  - Border + ring colour shift when `severity !== 'ok'`.
  - Warning sub-caption (`{count} stuck (oldest {min} min) — auto-recovery runs every 5 min`).
  - Admin-only "Force backfill now" button (gated on
    `profile.role in ('admin','superadmin')`).

## Thresholds (`STUCK_THRESHOLDS` in the hook)

| Severity | Trigger                                                 |
|----------|---------------------------------------------------------|
| `warn`   | `count >= 5` OR `oldestAgeMinutes >= 30`               |
| `error`  | `count >= 15` OR `oldestAgeMinutes >= 60`              |

The 5-min pg_cron cadence + the 30-min `warn` threshold means a single
SAP outage that spans 1-5 cron ticks never lights up the badge.

## End-to-end verification (live, 2026-05-08 23:50–23:54 UTC)

1. Migration applied, pg_cron job registered
   (`SELECT * FROM cron.job WHERE jobname LIKE '%backfill%'` returned the row).
2. First manual call: `SELECT * FROM public.backfill_pending_putaway_confirms()`
   returned `rows_failed_requeued=11, rows_orphan_replayed=0, oldest_pending_minutes=477`.
3. Within ~5 seconds, one job already transitioned `failed → queued → running`
   (`USINDPR-CXA101V-Console-U8206556`) — the agent's claim poller picked
   it up immediately.
4. By 23:54:54 UTC, **all 11 originally stuck rows were `to_status='TO Confirmed', confirmed_source='agent_trigger_direct', confirmed_by_label='Omni Agent'`**.
5. `count(*) AS still_pending_24h` query post-drain returned `0`.

## Build status

- `cargo build` (rust-work-service v0.1.35): clean.
- `cargo test --lib api::routes::sap_agents`: 6/6 pass (4 pre-existing + 2 new).
- `pnpm tsc -b --noEmit`: clean.
- `pnpm build`: clean (PWA precache 182 entries / 10.27 MB).
- `pnpm eslint` on touched FE files: 0 new warnings, 0 new suppressions.
- Lint ratchet shows no regression vs pre-change baseline
  (warnings 93 → 93, suppressions 166 → 166).

## Constraints honoured

- AGENT_VERSION held at 2.0.0 (no agent code touched).
- rust-work-service bumped 0.1.34 → 0.1.35 because a new route shipped.
- Trigger evaluator unchanged — backfill is purely about driving the
  existing pipeline.
- Lookback is bounded (24h default for both branches).
- WHERE-NOT-EXISTS guard prevents double-INSERTs.
- Loop-detection compatibility verified: orphan-NOTIFY path is depth=1
  from the cron context.
- Tunables live as function arguments (`p_lookback_hours`, etc.) and
  request body fields, not hardcoded constants.

## Open follow-ups

- **MCA workflow has its own equivalent gap?** The MCA flow uses
  `is_mca_workflow=true` rows and a different agent path; this backfill
  intentionally excludes them. If MCA confirms start sticking, a sibling
  function `backfill_pending_mca_confirms` should follow the same
  pattern.
- **Layer 3 (Prometheus alert)** deferred. Suggested rule:
  `rf_putaway_pending_confirms_total{age_bucket="1h+"} > 5` for 10m → page ops.
  Pairs with the `oldest_pending_minutes` value the SQL function returns.
- **Idempotency-key window**: today's `<unix-day>` suffix is fine for
  the requeue path, but a future redesign that uses a per-attempt
  suffix (e.g. UUID per claim) would let the trigger evaluator INSERT
  fresh jobs without needing the failed-job reset branch at all.
- **Service-key permission tightening**: the route currently accepts
  any authenticated principal with an org claim (matches
  `sap_console::allow_console_write` posture). Phase 10's service-key
  path should add a fine-grained `agent.queue.admin` permission and
  switch this route over.

## Related

- [[Decisions/ADR-Trigger-DSL-Evaluator-Phase9]]
- [[Components/Rust-Work-Service]]
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Implementations/Implement-Phase10-Service-Key-First-Rollout]]
- [[Patterns/Realtime-Presence-Browser-Hardening]]
- [[Sessions/2026-05-08]]



## 2026-05-20 update — follow-on fix in [[Fix-Putaway-Confirms-Stuck-At-41]]

This design's `claim_count < p_max_claim_count` cap had a hidden
failure mode: the function reset `attempts = 0` on each requeue but
*didn't* reset `claim_count`, so `claim_count` accumulated
monotonically across cycles while `attempts` reset every cycle. After
7 backfill ticks (≈35 min of continuous SAP outage) any row hit
`claim_count >= 8` and got silently abandoned. Production saw 41
rows hit this on 2026-05-19/20 from a single SAPGUI-logout window.

Migration 321 (`supabase/migrations/321_backfill_resets_claim_count.sql`)
amends the function: `claim_count = 0` and `assigned_agent_id = NULL`
are now reset alongside `attempts = 0`. The cap stays in place as a
per-cycle guard. Cumulative budget remains bounded by the 24h
lookback. One-time rescue at the bottom of migration 321 unstuck the
41-row backlog.

A second, independent failure mode was also fixed in the same
incident: when the agent's `state.supabase_token` is missing/expired,
the agent confirms in SAP successfully but silently no-ops the
`rf_putaway_operations` PATCH (`omni_agent/agent.py:6827` +
`:7349`). Migration 322 adds an `AFTER UPDATE` trigger on
`sap_agent_jobs` that applies the `post_success_patch` server-side,
lifting the dependency on the agent's user token entirely.

See [[Fix-Putaway-Confirms-Stuck-At-41]] for full diagnosis +
verification.
