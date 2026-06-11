---
tags: [type/implementation, status/active, domain/backend, domain/realtime, domain/database, domain/agent, domain/frontend]
created: 2026-05-07
---

# Implement Rust Work Service — Phase 9 (Server-Side Trigger DSL Evaluator)

Phase 9 of the comprehensive [[plans/rust_work_service_full_integration_5b88165d.plan]]. The biggest remaining phase by scope and the only one that explicitly REVERSES a prior decision: [[ADR-WsEvent-Typed-vs-Envelope]] declined to ship a generic envelope + dynamic Subscribe-to-table primitive on attack-surface grounds; [[ADR-Trigger-DSL-Evaluator-Phase9]] (NEW) ships a fundamentally different shape that addresses the same goal with bounded blast radius.

## Purpose / Context

Pre-Phase-9 the OmniFrame fleet had TWO trigger evaluators co-existing:

1. **Browser-side** in [`use-agent-trigger-runtime.ts`](../../../src/features/admin/sap-testing/hooks/use-agent-trigger-runtime.ts) (~700 LOC). Held the grandfather exception in [`realtime-policy workspace rule`](../../../realtime-policy workspace rule).
2. **Agent-side** in `omni_agent/agent.py::_HARDCODED_TRIGGERS` (3 entries, ~840 LOC of supporting evaluator + dedup + backfill code).

Both shapes had hard limits: browser-side only fires while the SAP Testing tab is open; agent-side requires an EXE rebuild to add a new rule. Phase 9 retires both by moving evaluation into `rust-work-service::triggers::evaluator`, sourcing rules from a new `public.agent_triggers` table that admins author through a CRUD UI.

## Architecture

```
admin → POST /api/v1/triggers          → INSERT public.agent_triggers
                                       → notify_agent_triggers_changed NOTIFY
                                       → trigger_loader hot-reloads in-memory rules

row event → notify_<table>_changed     → trigger_evaluator listens
                                       → DSL.eval(rule.match_filter, row)
                                       → INSERT sap_agent_jobs
                                       → broadcast WsEvent::TriggerFired
                                       → existing agent fleet drains
```

## Scope shipped

### 9.1 Schema migrations 281 + 282

[`281_create_agent_triggers.sql`](../../../supabase/migrations/281_create_agent_triggers.sql) — applied via Supabase MCP `apply_migration`. Verified via `information_schema.columns` (14 columns: id, organization_id, enabled, name, description, source_table, source_events, match_filter, target_endpoint, payload_template, post_success_patch, created_at, updated_at, created_by). RLS: org members SELECT; admins (`role IN ('admin','superadmin')`) write. `agent_triggers_changed` NOTIFY trigger fires on every INSERT / UPDATE / DELETE so the in-memory rule set hot-reloads without service restart.

[`282_seed_agent_triggers.sql`](../../../supabase/migrations/282_seed_agent_triggers.sql) — applied; intentionally a no-op `RAISE NOTICE` per the design decision documented in the migration body. Admins create their own triggers via the new CRUD UI; the migration comment lists the three previously-hardcoded patterns admins can recreate in two clicks each.

### 9.2 New ADR

[[Decisions/ADR-Trigger-DSL-Evaluator-Phase9]] — partially reverses [[ADR-WsEvent-Typed-vs-Envelope]] (Workstream B section). Documents:

- DSL grammar (12 operators: `all`, `any`, `not`, `eq`, `neq`, `in`, `gt`, `gte`, `lt`, `lte`, `is_null`, `is_not_null` + the `{}` always-match shorthand)
- Source-table allowlist (`rf_putaway_operations`, `sap_agent_jobs`, `work_tasks`, `shipment_queue` — 4 entries)
- Target-endpoint allowlist (6 entries: `/sap/confirm-to`, `/sap/process-shipment`, `/sap/lt12`, `/sap/import-lt22`, `/sap/material-master-bin`, `/sap/material-master-storage-types`). Explicitly EXCLUDES agent-control endpoints (`/sap/connect`, `/supabase/login`, `/agent-token/rotate`, `/shutdown`).
- Loop-detection: per-row Redis counter `trigger:depth:{org}:{row_id}` with 60s TTL; aborts at depth >3 with audit log entry `{ kind: 'trigger.loop_detected', … }`.
- Why this shape addresses the prior ADR's concerns (browser is OUT of evaluation path; full row never serialised to WS clients; per-table allowlist gates new tables).

### 9.3 Rust evaluator

NEW module [`rust-work-service/src/triggers/`](../../../rust-work-service/src/triggers/):

- [`mod.rs`](../../../rust-work-service/src/triggers/mod.rs) — internal-only module index.
- [`config.rs`](../../../rust-work-service/src/triggers/config.rs) — security allowlists (compiled-in const arrays, NOT user-configurable, NOT env-tunable). Plus `MAX_DEPTH = 3`, `DEPTH_TTL_SECONDS = 60`, `DSL_GRAMMAR_VERSION = "trigger-dsl-evaluator-v1"`.
- [`dsl.rs`](../../../rust-work-service/src/triggers/dsl.rs) — ~470 LOC parser + evaluator. Whitelist-only grammar; rejects unknown operators, multi-key bodies, extra keys, non-numeric values for numeric operators, dangerous field-path syntax (`x; DROP TABLE`, `items[0]`, `a..b`, `.x`, `x.`). Each error carries a JSON pointer (`/all/2/eq/value`) so the FE form can highlight the exact offending node.
- [`loader.rs`](../../../rust-work-service/src/triggers/loader.rs) — boot-and-hot-reload. Bad rows logged + skipped; the loader stays running (defence-in-depth — manual SQL INSERT or schema drift can't crash the evaluator).
- [`evaluator.rs`](../../../rust-work-service/src/triggers/evaluator.rs) — per-table `PgListener` task. On each NOTIFY: parse → match rules → check loop counter → INSERT `sap_agent_jobs` (with idempotency key `trig:<id>:<row>:<unix-day>` matching the legacy agent path) → broadcast `WsEvent::TriggerFired`. Template interpolation supports `{{row.<dotted.path>}}` with type-preserving single-token resolution and string-coercion for mixed strings.

NEW [`WsEvent::TriggerFired`](../../../rust-work-service/src/websocket/mod.rs) variant carrying ONLY metadata (trigger_id, source_row_id, target_endpoint, job_id, organization_id) — the full row payload is intentionally NOT in the WS event so we don't re-introduce the row-leak concern from [[ADR-WsEvent-Typed-vs-Envelope]].

NEW route file [`rust-work-service/src/api/routes/triggers.rs`](../../../rust-work-service/src/api/routes/triggers.rs) — six endpoints under `/api/v1/triggers`:

- `GET /` — list; org-scoped via JWT.
- `POST /` — create. Strict server-side validation: source_table + target_endpoint allowlist gates, source_events validity, full DSL parse on `match_filter`. Admin-only.
- `PATCH /:id` — update. Read-modify-write so the merged shape is validated against the DSL before the UPDATE issues. Admin-only.
- `DELETE /:id` — true delete (FK `created_by ON DELETE SET NULL`). Admin-only.
- `POST /preview` — pure-function dry-run: parse a candidate `match_filter` + run it against an admin-supplied row. Returns `{matched, error?}`.
- `GET /allowlists` — surface the source-table + target-endpoint + source-events + grammar-version constants so the FE form renders dropdowns from server truth.

Wired into [`main.rs`](../../../rust-work-service/src/main.rs): two new `tokio::spawn` blocks for the loader + evaluator, plus `.nest("/api/v1/triggers", triggers_routes())`.

**Tests** — 53 new unit tests across the four sub-modules:

- `triggers::config` — 6 tests covering allowlist regression checks, agent-control-endpoint exclusion, exact-not-prefix matching, grammar-version pin.
- `triggers::dsl` — 28 tests covering every operator, the `{}` shorthand, dotted paths, real-world rule recreation, and 12 negative cases (unknown operator, multi-key, extra keys, object/array values, missing field, empty field, special chars, array index, double dots, non-object root, non-array in `all`, non-numeric in `gt`, missing `values` in `in`, JSON pointer correctness).
- `triggers::evaluator` — 9 tests covering single-token + mixed-string interpolation, dotted paths, missing-path semantics, type passthrough, nested objects/arrays, unmatched braces, depth-key shape, and end-to-end `__omni_trigger_meta` envelope splice.
- `triggers::loader` — 1 test (table indexing).
- `api::routes::triggers` — 6 tests (validate_request_shape negative + positive cases).

`cargo test --lib`: **121 passed, 0 failed** (up from 68 pre-Phase 9 / 27 pre-Phase 4). `cargo clippy --lib --all-targets`: zero warnings on Phase 9 files.

### 9.4 FE migration

**Deleted** [`use-agent-trigger-runtime.ts`](../../../src/features/admin/sap-testing/hooks/use-agent-trigger-runtime.ts) entirely (28 KB / ~700 LOC removed).

**Rewrote** [`agent-triggers-tab.tsx`](../../../src/features/admin/sap-testing/components/agent-triggers-tab.tsx) as pure CRUD UI (~700 LOC, NET CHANGE: tab body shape totally different):

- Header strip with KPI badges (Total / Enabled / Recent fires) + capability banner.
- Triggers list (3-col grid lg+): each row carries enabled toggle, edit, delete, and source/action chips.
- Recent fires panel (2-col): live `WsEvent::TriggerFired` ticker, fed by the new `useTriggerFireStream` hook.
- Create / Edit dialog: form-based JSON editor (visual filter builder deferred to a future iteration; documented as a Phase 11 candidate). Includes a "Match preview" pane that calls `POST /api/v1/triggers/preview` to dry-run the candidate filter against an admin-supplied row.
- Templates: three pre-fill cards on the empty-state screen — "Auto-Confirm Completed Putaways", "Queued Shipment Processor", "Auto-Confirm Completed Picks → LT12" — recreate the deleted `_HARDCODED_TRIGGERS` patterns in two clicks each.

**NEW** [`use-trigger-fire-stream.ts`](../../../src/features/admin/sap-testing/hooks/use-trigger-fire-stream.ts) — small WS bridge hook (~100 LOC). Subscribes to `workServiceWs` for `WsEvent::TriggerFired`, defence-in-depth org-checks, appends to a bounded ring buffer (default 200 entries).

**NEW** [`triggers-client.ts`](../../../src/lib/work-service/triggers-client.ts) — REST client (~150 LOC) wrapping `/api/v1/triggers/*` routes.

**Modified** [`types.ts`](../../../src/lib/work-service/types.ts):

- Added `'TriggerFired'` to `WsEventType` union.
- Added `trigger_id?: string` and `target_endpoint?: string` to the flat `WsEvent` shape.

**Removed** the `use-agent-trigger-runtime.ts` grandfather exception from [`realtime-policy workspace rule`](../../../realtime-policy workspace rule) — the Exceptions section now reads "(none — Phase 9 …)".

### 9.5 Agent cleanup

[`omni_agent/agent.py`](../../../omni_agent/agent.py) line count: **13,228 → 12,478 (-750 LOC)**, exceeding the -300/-400 target. Surgical replacement of the entire `# v1.6.4 — Agent-Side Trigger Evaluator` block with ~92 lines of stubs:

**Deleted** (~840 LOC):

- `_HARDCODED_TRIGGERS` (3-entry list at line ~6031)
- `_recently_queued_rows` + `_DEDUP_TTL_SECONDS` / `_DEDUP_MAX_ENTRIES` / `_DEDUP_LOG_THROTTLE_SECONDS` / `_dedup_lock` / `_dedup_log_last`
- `_purge_expired_dedup_entries`, `_is_recently_queued`, `_mark_recently_queued`, `_should_log_dedup`
- `_hardcoded_trigger_match`, `_hardcoded_trigger_payload`, `_hardcoded_trigger_post_patch`
- `_enqueue_trigger_job`
- `_backfill_one_trigger`
- The full `_start_trigger_backfill_poller` daemon (was 60s safety-net poll loop) + `_stop_trigger_backfill_poller`
- `_TRIGGER_BACKFILL_INTERVAL_SEC` / `_TRIGGER_BACKFILL_FIRST_DELAY_SEC` / `_TRIGGER_BACKFILL_LOOKBACK_HOURS` / `_TRIGGER_BACKFILL_LIMIT` / `_trigger_backfill_state`

**Stub-preserved** (so the legacy Realtime callback wiring at lines ~5532-5811 + `_on_work_ws_event`'s rf_putaway dispatch at line ~5290 keep compiling without changes):

- `_on_hardcoded_table_change(table, event_type, payload)` — body now just stamps `state.last_realtime_event_at` and kicks the poller.
- `_on_rf_putaway_change(event_type, payload)` — thin wrapper over the stub. Still bumps the parallel-run `_legacy_realtime_event_counts["RfPutawayChanged"]` counter for Phase 4 telemetry.
- `_start_trigger_backfill_poller()` / `_stop_trigger_backfill_poller()` — no-op functions kept so `_on_startup` / `_on_shutdown` don't need to be touched for Phase 9.

**Kept verbatim**:

- `_TRIGGER_DROP_AGENT_ATTRIBUTION` (v1.6.6 self-healing schema fallback) — still applies to the post-success-patch in `_apply_trigger_post_patch`.
- `_apply_trigger_post_patch` — unchanged. The new server-side evaluator embeds the post-success patch under the SAME `payload.__omni_trigger_meta.post_success_patch` envelope key, so this function still correctly applies the OVERLAY (attribution) fields after a successful SAP dispatch.

**Boot banner** — the `[triggers] loaded N hardcoded trigger(s) ...` line was replaced with a Phase 9 disclosure pointing at the ADR. The `[boot] Trigger backfill: ENABLED — poller wakes every 60s ...` line was replaced with `[boot] Trigger backfill: SERVER-SIDE — Phase 9 evaluator subscribes to per-table NOTIFY channels ...`.

`AGENT_VERSION` is INTENTIONALLY left at `"1.9.0"` per the Phase 9 plan directive — Phase 11 owns the bump to `2.0.0` marking the architecture-change boundary.

### 9.6 Capabilities

The Rust service advertises `trigger-dsl-evaluator-v1` as a const string ([`config::DSL_GRAMMAR_VERSION`](../../../rust-work-service/src/triggers/config.rs)) surfaced through the `GET /api/v1/triggers/allowlists` endpoint. The FE form references `{allowlists.grammar_version}` in its dialog copy.

The TriggerCard's `endpointWarning` `useMemo` consults `useSapTestingDashboard().fleet_capabilities` to detect when no online agent advertises the trigger's `target_endpoint` capability; today this surfaces as a friendly fallback ("No agents currently online …") rather than a hard error because most SAP handlers (`/sap/confirm-to`, `/sap/lt12`, `/sap/process-shipment`) are unconditionally available on every agent build, so an absent capability ≠ definitely-broken.

The original spec's premise — that server-side triggers don't need an agent capability at all — is correct: the server INSERTs `sap_agent_jobs` rows; ANY agent in the fleet drains them. The capability check exists only to surface "your fleet has no agents that could handle this endpoint" warnings during trigger authoring.

## Quality gates

- ✓ Migration 281 applied via Supabase MCP `apply_migration`; verified via `information_schema.columns` (14 columns).
- ✓ Migration 282 applied (intentional no-op — see migration body).
- ✓ `cargo build` clean (no new warnings).
- ✓ `cargo test --lib`: **121 passed**, 0 failed (53 new tests in `triggers::*` and `api::routes::triggers`).
- ✓ `cargo clippy --lib --all-targets`: zero warnings on Phase 9 files (`triggers/*.rs`, `api/routes/triggers.rs`).
- ✓ `python3 -c "import ast; ast.parse(open('omni_agent/agent.py').read())"` clean.
- ✓ `pnpm tsc -b --noEmit` clean.
- ✓ `pnpm build` clean (no chunk-budget regressions; `feature-admin-sap` chunk size unchanged).
- ✓ ReadLints on all four new TS files clean.

## DSL grammar example exercising every operator

```jsonc
{
  "all": [
    { "eq":  { "field": "to_status",       "value": "Completed" } },
    { "neq": { "field": "is_mca_workflow", "value": true } },
    { "in":  { "field": "warehouse",       "values": ["WH5", "WH7", "WH9"] } },
    { "any": [
        { "is_null":     { "field": "confirmed_source" } },
        { "is_not_null": { "field": "confirmed_at" } }
    ]},
    { "not": { "eq": { "field": "payload.material", "value": "BLOCKED-001" } } },
    { "gt":  { "field": "qty",  "value": 0 } },
    { "gte": { "field": "qty",  "value": 1 } },
    { "lt":  { "field": "qty",  "value": 10000 } },
    { "lte": { "field": "qty",  "value": 9999 } }
  ]
}
```

This rule fires on `rf_putaway_operations` rows with `to_status='Completed'`, not flagged for MCA, in WH5/7/9, that either have NEVER been confirmed (`confirmed_source IS NULL`) or HAVE been confirmed (`confirmed_at IS NOT NULL`), aren't on the BLOCKED-001 material, and have qty in `(0, 9999]`. All 12 operators exercised.

## Sample CRUD flow

### Create

```
POST /api/v1/triggers
Authorization: Bearer <admin JWT>
Content-Type: application/json

{
  "name": "Auto-Confirm Completed Putaways",
  "enabled": true,
  "source_table": "rf_putaway_operations",
  "source_events": ["INSERT", "UPDATE"],
  "match_filter": {
    "all": [
      { "eq":  { "field": "to_status", "value": "Completed" } },
      { "is_null": { "field": "confirmed_source" } }
    ]
  },
  "target_endpoint": "/sap/confirm-to",
  "payload_template": {
    "to_number": "{{row.to_number}}",
    "warehouse": "{{row.warehouse}}"
  }
}
→ 200 OK with the inserted row (id, created_at, etc.)
```

### Match preview (dry-run, no side effects)

```
POST /api/v1/triggers/preview
{
  "match_filter": {
    "all": [
      { "eq": { "field": "to_status", "value": "Completed" } },
      { "neq": { "field": "is_mca_workflow", "value": true } }
    ]
  },
  "row": {
    "to_status": "Completed",
    "is_mca_workflow": false,
    "to_number": "1790022",
    "warehouse": "WH5"
  }
}
→ { "matched": true, "error": null }
```

A bad filter returns `matched=false` with a `pointer` + `message`:

```
POST /api/v1/triggers/preview
{ "match_filter": { "shell_exec": { "cmd": "rm -rf /" } }, "row": {} }
→ {
    "matched": false,
    "error": {
      "pointer": "/shell_exec",
      "message": "unknown operator 'shell_exec' (allowed: all, any, not, eq, neq, in, gt, gte, lt, lte, is_null, is_not_null)"
    }
  }
```

### Dry-run ↔ live fire

The CRUD UI's "Match preview" pane is the dry-run path; toggling `enabled=true` is the cutover. The server-side evaluator picks up the new rule on the very next NOTIFY tick (loader hot-reloads in <100ms after the agent_triggers row commits).

## Files

### Created

- `supabase/migrations/281_create_agent_triggers.sql`
- `supabase/migrations/282_seed_agent_triggers.sql`
- `rust-work-service/src/triggers/mod.rs`
- `rust-work-service/src/triggers/config.rs`
- `rust-work-service/src/triggers/dsl.rs`
- `rust-work-service/src/triggers/loader.rs`
- `rust-work-service/src/triggers/evaluator.rs`
- `rust-work-service/src/api/routes/triggers.rs`
- `src/features/admin/sap-testing/hooks/use-trigger-fire-stream.ts`
- `src/lib/work-service/triggers-client.ts`
- `memorybank/OmniFrame/Decisions/ADR-Trigger-DSL-Evaluator-Phase9.md`
- `memorybank/OmniFrame/Implementations/Implement-Rust-Work-Service-Phase9.md`

### Modified

- `rust-work-service/src/lib.rs` — `pub mod triggers;`
- `rust-work-service/src/main.rs` — `mod triggers;`, route nest, loader + evaluator spawns.
- `rust-work-service/src/api/routes/mod.rs` — `pub mod triggers;` + `pub use triggers::triggers_routes;`
- `rust-work-service/src/websocket/mod.rs` — `WsEvent::TriggerFired` variant + `organization_id()` arm.
- `omni_agent/agent.py` — net **-750 LOC**: removed v1.6.4 evaluator + v1.6.9 backfill poller; replaced with Phase 9 stubs that preserve function names so existing Realtime callback wiring still compiles. AGENT_VERSION unchanged at 1.9.0 per plan directive.
- `src/lib/work-service/types.ts` — `'TriggerFired'` + `trigger_id` / `target_endpoint` fields.
- `src/features/admin/sap-testing/components/agent-triggers-tab.tsx` — pure CRUD rewrite.
- `realtime-policy workspace rule` — removed `use-agent-trigger-runtime.ts` exception.

### Deleted

- `src/features/admin/sap-testing/hooks/use-agent-trigger-runtime.ts` (entire file, ~700 LOC).

## Deferred

- **Visual DSL builder UI**. The form ships with a JSON textarea + the `/preview` dry-run pane. A drag-and-drop visual builder is a Phase 11 candidate.
- **Audit log table for trigger fires**. The current evaluator emits a `tracing::info!` per fire and INSERTs a `sap_agent_jobs` row (which IS the audit trail), plus broadcasts `WsEvent::TriggerFired` for live observability. A dedicated `trigger_fire_log` table for retrospective analysis is a follow-up.
- **Per-trigger metrics on `/metrics`**. The evaluator's per-trigger fire / loop-detected counts can be promoted to Prometheus metrics in a follow-up; today they live in the structured-log stream.
- **`work_tasks_changed` NOTIFY trigger**. The evaluator's allowlist already includes `work_tasks`, but the table's NOTIFY trigger isn't installed yet (Phase 4 only added `rf_putaway_operation_changed`, `sap_agent_job_changed`, etc.). The listener attempt logs and skips when the channel doesn't exist; once a future migration adds the NOTIFY trigger, work_tasks-sourced rules start firing without a Rust release.
- **AGENT_VERSION bump to 2.0.0**. Phase 11 owns this — it's the architecture-change boundary that flips the Phase 4 `OMNIFRAME_AGENT_USE_RUST_WS` default and deletes the legacy Supabase Realtime stack from agent.py.

## Related

- [[Implement-Rust-Work-Service-Phase4]] — foundational `WsEvent` + `PgListener` plumbing reused.
- [[Implement-Rust-Work-Service-Phase8]] — `useSapTestingDashboard().fleet_capabilities` map this phase consumes for endpoint warnings.
- [[Decisions/ADR-Trigger-DSL-Evaluator-Phase9]] — the security model + grammar.
- [[Decisions/ADR-WsEvent-Typed-vs-Envelope]] — the prior ADR Phase 9 partially reverses (Workstream B section).
- [[Components/Omni-Agent - Headless SAP Agent]] — agent component (Recent additions updated with the cleanup).
- [[Sessions/2026-05-07]] — session log this phase appends to.
