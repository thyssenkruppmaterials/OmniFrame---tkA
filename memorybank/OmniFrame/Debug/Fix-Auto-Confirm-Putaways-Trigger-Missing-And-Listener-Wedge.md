---
tags: [type/debug, status/active, domain/backend, domain/database, domain/agent, domain/infra]
created: 2026-05-07
---
# Fix Auto-Confirm Completed Putaways — Missing Trigger Row + PgListener Wedge

## Symptom

Second pass of the v2.0.0 OmniFrame agent on Citrix
`USINDPR-CXA103V` user `U8206556` (PID 38508, started
`2026-05-07T15:09:34Z`) — fresh `console.txt` (604 lines) showed:

- **Boot clean.** Phase 10 NameError gone (line 6:
  `DEPRECATION Agent identity v2: NOT CONFIGURED … Falling back to the
  legacy user-JWT path`). Stable agent_id, pinned SAP session,
  `[work-ws] connected to https://rust-work-service-production.up.railway.app`
  (line 82), all subsystems started.
- **WS hot.** Two `RfPutawayChanged` events delivered cleanly (lines 261,
  286). Six WS reconnects in ~30 min (Railway proxy idle-timeout, 5→30s
  exponential reconnect — benign, every reconnect succeeded inside 30s).
  No 401 / 403. One `[work-ws] console relay HTTP 500` at line 570 (Railway
  TCP reset on the relay POST, retried with backoff — benign).
- **Claim queue empty.** 40 `[claim-path] via=rust hit=no totals(rust=N,
  supabase=0)` lines — agent polled rust-work-service `/jobs/claim` 40
  times, got 0 hits. Zero `WsEvent::SapJobStatusChanged`. Zero
  `WsEvent::TriggerFired`.
- **Backlog massive.** `rf_putaway_operations` for org
  `c9d89a74-7179-4033-93ea-56267cf42a17` had 99 rows in last 24 h with
  `to_status='Completed'`, `is_mca_workflow=false`,
  `confirmed_source IS NULL` (29 in the last 90 min, all matching the
  expected trigger filter exactly). `sap_agent_jobs` for the same window:
  **0 rows.** The legacy `trig:builtin-rf-putaway-completed:*` keys
  stopped at 2026-05-06 22:32:43 UTC (last hardcoded-trigger fire before
  Phase 9 deploy at 11:39 EDT today removed the agent-side path).

The user expected the trigger evaluator's
`Auto-Confirm Completed Putaways` rule (id
`b8160159-ac8c-4488-bce2-3d193dc33697`) to fire on every
`Completed/null` putaway and INSERT a `/sap/confirm-to` job. It wasn't.

## Root cause — TWO independent bugs stacked

### Bug 1 (already fixed in repo, already deployed) — channel singular/plural

`triggers/evaluator.rs::run_for_table` originally derived the LISTEN
channel as `format!("{}_changed", table)` → `rf_putaway_operations_changed`
(plural), but `notify_rf_putaway_changed` (migration 276/285) publishes
to `rf_putaway_operation_changed` (singular). The `LISTEN` succeeds on
any name, so the `LISTEN failed` branch never fired and the bug was
invisible. Fixed in `0eefe9a` with a `channel_for_table()` mapping +
two regression tests; commit landed at `Thu May 7 11:13:22 2026 -0400`
(15:13 UTC). Railway deployment `d51c3465-583e-43fe-9701-4bf616912e0f`
created at 15:08:27 UTC, finished bootstrap at 15:14:43 UTC — and
**did include the fix** (deploy logs:
`trigger_evaluator: subscribed channel=rf_putaway_operation_changed`).
Detail: [[Fix-Trigger-Evaluator-Channel-Singular-Plural]].

### Bug 2 — `agent_triggers` row was never seeded for this org

Migration `282_seed_agent_triggers.sql` (Phase 9, 2026-05-07) is a
**deliberate no-op** — its design memo says "admins create triggers via
the SAP Testing CRUD UI". The Picks rule
`6d6b75b6-ff80-4954-b2d1-e396efc19f11`
(`Auto-Confirm Completed Picks → LT12`, source_table `work_tasks`) was
created via the UI at `2026-05-07 15:11:31 UTC`. The matching
`Auto-Confirm Completed Putaways` rule for `rf_putaway_operations` was
**never created** — neither in the Phase 9 deploy nor in any subsequent
admin session. The trigger evaluator's per-table loader filter
(`set.for_table("rf_putaway_operations")`) returned `None`, so even
though every NOTIFY arrived correctly the evaluator returned early and
no `sap_agent_jobs` were enqueued.

### Bug 3 (consequence of restart-less run) — PgListener wedge

While diagnosing, `INSERT`ing the trigger row at `15:55 UTC` did NOT
trigger `trigger_loader: rule set reloaded` even though the Phase 9
loader is supposed to hot-reload via `LISTEN agent_triggers_changed`.
`pg_stat_activity` showed only 3 surviving LISTEN backends from the
boot's 11 spawned listeners — `agent_triggers_changed`,
`sap_agent_job_changed`, `work_tasks_changed`,
`shipment_queue_changed`, and several others were silently DEAD with no
"recv failed" or "reconnect" log lines. The Phase 4 listener for
`rf_putaway_operation_changed` survived (which is why `RfPutawayChanged`
WS events kept flowing in the agent's `console.txt`) but the Phase 9
trigger evaluator's listener for the same channel was gone.
**Root cause of the wedge:** sqlx `PgListener` connections silently
dropped at some point after boot — likely a corporate-NAT idle-timeout
on the connection pool while the listener tasks were waiting in
`recv()`. The listener's `Err(e) => break` branch should have triggered
a reconnect loop but no log line surfaced — open question whether
sqlx's `recv()` is returning silently in this Railway↔Supabase pool
configuration. Tracked separately (see "Open follow-ups" below).

## Fix

Three coordinated steps. NO repo code change (the channel-name fix is
already live).

### 1. Insert the missing `agent_triggers` row

Direct SQL via Supabase MCP `execute_sql` (configuration mutation,
documented in this note for reproducibility — admins can also create
the same row via the SAP Testing → Agent Triggers CRUD UI, which is the
canonical post-Phase-9 path):

```sql
INSERT INTO public.agent_triggers (
  id, organization_id, enabled, name, description,
  source_table, source_events, match_filter, target_endpoint,
  payload_template, post_success_patch
) VALUES (
  'b8160159-ac8c-4488-bce2-3d193dc33697',
  'c9d89a74-7179-4033-93ea-56267cf42a17',
  true,
  'Auto-Confirm Completed Putaways',
  'Fire /sap/confirm-to when an rf_putaway_operations row reaches '
    || 'to_status=Completed (skips MCA + already-confirmed rows). '
    || 'Recreates the deleted _HARDCODED_TRIGGERS[0] / '
    || 'builtin-rf-putaway-completed from omni_agent/agent.py. '
    || 'Created 2026-05-07 to fix the missing-rule gap left by '
    || 'migration 282 (no-op-by-design).',
  'rf_putaway_operations',
  ARRAY['INSERT','UPDATE'],
  '{"all":[
     {"eq":      {"field":"to_status",        "value":"Completed"}},
     {"neq":     {"field":"is_mca_workflow",  "value":true}},
     {"is_null": {"field":"confirmed_source"}}
   ]}'::jsonb,
  '/sap/confirm-to',
  '{"to_number":"{{row.to_number}}","warehouse":"{{row.warehouse}}"}'::jsonb,
  '{"table":"rf_putaway_operations",
    "row_id":"{{row.id}}",
    "patch":{"confirmed_source":"agent_trigger_direct",
             "confirmed_by_label":"Omni Agent"}}'::jsonb
) ON CONFLICT (id) DO NOTHING;
```

The `post_success_patch` shape mirrors what
`omni_agent/agent.py::_apply_trigger_post_patch` reads at
`payload.__omni_trigger_meta.post_success_patch.{table,row_id,patch}` —
the patch is filtered to the OVERLAY allowlist
(`confirmed_source`, `confirmed_by_label`, `confirmed_by_agent_id`)
and PATCHed by `id=eq.<row_id>` after the legacy
`_update_putaway_status` 3-field flip.

### 2. `railway restart -s rust-work-service -y`

Forced a clean process restart. **All 11 PgListeners re-established**
(`pg_stat_activity` post-restart: `agent_triggers_changed`,
`notification_created`, `rf_putaway_operation_changed` ×2,
`sap_agent_job_changed` ×2, `lx03_data_changed`,
`work_engine_settings_changed`, `sap_import_run_changed`,
`work_tasks_changed`, `cycle_count_data_changed`,
`shipment_queue_changed`, `sap_agent_changed`). Loader log on boot:
`trigger_loader: rule set reloaded total_db_rows=2 accepted=2
rejected=0` (Picks + Putaways).

### 3. Backfill the 85 stuck rows from today

```sql
UPDATE public.rf_putaway_operations
SET    updated_at = now()
WHERE  organization_id    = 'c9d89a74-7179-4033-93ea-56267cf42a17'
  AND  to_status          = 'Completed'
  AND  confirmed_source   IS NULL
  AND  created_at        >= '2026-05-07 12:00:00+00'   -- post Phase-9 deploy
  AND  created_at         < now();
```

`updated_at` bump fires `notify_rf_putaway_changed` for each row → the
post-restart trigger evaluator picks each up → INSERTs a queued
`sap_agent_jobs` row with idempotency key
`trig:b8160159-ac8c-4488-bce2-3d193dc33697:<row_id>:20580`. The agent
on `USINDPR-CXA103V` claims them via `/api/v1/sap-agents/jobs/claim` and
runs LT12. ~12s per claim (SAP latency) → ~17 min to drain 85 rows.
The 14 yesterday-stuck rows are NOT in this backfill — they may be
SAP-confirmed already by manual ops; they need a separate triage pass.

## Verification (end-to-end smoke immediately post-restart)

1. UPDATE row `86abd91b-2c25-4869-9d19-64279aa403d3` (TO 7286150)
   → 16:01:07.254 UTC.
2. `sap_agent_jobs` INSERT `8b44f087-…` for that row → 16:01:07.803 UTC
   (550 ms after NOTIFY). Idempotency key
   `trig:b8160159-…:86abd91b-…:20580`. Payload includes
   `__omni_trigger_meta.post_success_patch` shaped exactly as the
   agent expects.
3. Agent claimed → 16:01:09.329 UTC (~1.5s after enqueue, via WS).
4. SAP LT12 completed → 16:01:14.872 UTC (~5.5s end-to-end).
5. `rf_putaway_operations.86abd91b` final state:
   - `to_status = 'TO Confirmed'` (legacy 3-field PATCH from
     `_update_putaway_status`)
   - `confirmed_source = 'agent_trigger_direct'` (overlay PATCH from
     `_apply_trigger_post_patch`)
   - `confirmed_by_label = 'Omni Agent'`
6. **Bonus.** A second job `3082eaa4-…` for row
   `e5743101-0ee7-4742-b109-f6f6a1136282` (TO 7286582) appeared at
   16:01:14.712 UTC — that wasn't part of my backfill. Confirms a
   real-time user-driven scan also fired through the trigger pipeline
   correctly.

## Resolution (2026-05-07 PM)

Bug 3 (the PgListener wedge) is fixed in `rust-work-service` v0.1.33.
Implementation note: [[Implementations/Implement-Resilient-PgListener]].

Summary of the fix:

- New `rust-work-service/src/pglistener.rs` exports `pglistener::run` —
  a resilient wrapper around `sqlx::PgListener` that LISTENs on the
  user's channel AND on a shared `rust_work_service_keepalive` channel,
  publishes its own keepalive every 30 s via the main `PgPool`
  (separate connection from the dedicated PgListener socket), and
  force-reconnects when no frame (real or keepalive echo) arrives
  within 90 s.
- Every existing listener (`settings/listener`, `sap_agents_listener`,
  `sap_jobs_listener`, `sap_import_runs_listener`,
  `cycle_count_listener`, `lx03_listener`, `rf_putaway_listener`,
  `notifications_listener`, `triggers/loader`, plus the per-table
  loop in `triggers/evaluator`) now routes through this wrapper.
- Per-channel observability surfaces on `/metrics`:
  `work_pglistener_status`, `_reconnects_total`,
  `_last_message_age_seconds`, `_keepalive_sent_total`,
  `_keepalive_received_total` — all labelled by `channel`.
- Build clean (`cargo build` + `cargo clippy --lib --all-targets` no
  new warnings); 154 unit tests pass (146 pre-existing + 6 new
  `pglistener::tests` covering the watchdog, recv-error reconnect,
  and keepalive-swallow paths).
- Deployed via `railway up -s rust-work-service` at 17:58 UTC. Image
  `sha256:d4a59402480ce49b…`. Boot logs show 13× `resilient PgListener
  starting` + 13× `resilient PgListener subscribed` between 17:59:05
  and 17:59:08 UTC. `pg_stat_activity` post-deploy shows **all 13
  listener backends alive**.
- After 2 minutes: `work_pglistener_keepalive_sent_total = 3` per
  single-listener channel (matches 30 s cadence × 6 elapsed ticks),
  `keepalive_received_total = 39` per channel = 13 senders × 3 echoes,
  proving every listener's dedicated socket is delivering NOTIFYs from
  every other listener.

Mitigation status: the periodic `railway restart -s rust-work-service`
workaround is no longer required. A wedged dedicated socket trips the
watchdog within 90–120 s and reconnects automatically.

## Open follow-ups

- ~~**PgListener wedge mechanism.**~~ ✅ Fixed (see Resolution above).

- **Migration 282 documentation.** The current migration 282 comment
  documents the THREE expected starter triggers but doesn't clarify
  that admins MUST run them before the auto-confirm pipeline works.
  Consider adding a NOTICE that surfaces in CI when an org has a
  picks/putaways/shipments rule missing. Not blocking — just makes the
  next post-Phase-9 cutover easier.

- **Yesterday's 14 stuck rows.** `rf_putaway_operations` has 14 rows
  from 2026-05-06 16:00–22:00 UTC at `Completed/null`. Some of these
  may have been SAP-confirmed manually after the agent crashed — re-
  firing `/sap/confirm-to` on those would error. Triage manually
  (compare LT22 export vs `confirmed_source`) before backfilling.

## Related

- [[Implementations/Implement-Resilient-PgListener]] — Bug 3 fix.
- [[Fix-Trigger-Evaluator-Channel-Singular-Plural]] — Bug 1 (channel
  name); already deployed, separate root cause.
- [[Implementations/Implement-Rust-Work-Service-Phase9]] — Phase 9
  trigger DSL evaluator architecture.
- [[Decisions/ADR-Trigger-DSL-Evaluator-Phase9]] — security allowlists,
  loop detection, NOTIFY channel contract.
- [[Components/Agent-Triggers - Realtime Automation]] — admin CRUD UI
  + starter templates the Phase 9 cutover relies on.
- [[Components/Rust-Work-Service]] — listener inventory + boot order.
- [[Sessions/2026-05-07]] — same-day session log, "v2 putaway
  confirmation deploy + fix" sub-section.
