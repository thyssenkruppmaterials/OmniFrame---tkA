---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-05-02
---
# Implement Picking WorkType Follow-On

## Purpose / Context

The Work Engine Foundation shipped with `cycle_count` as the only live
work type. This pass adds the Picking follow-on — a new end-to-end
path where an operator pulls items from source bins to fulfill a SAP
transfer order, and OmniAgent confirms the TO line server-side via
`LT12`. One `pick` task per `(transfer_order, item)` line.

Ships alongside the parallel Zoning follow-on (mig 267); this is mig
**268** for Pick.

## Details

### A — Frontend WorkTypeConfig

Replaced the `disabledStub({id:'pick'})` shim at
`src/lib/work-engine/work-types/pick.ts` with a real `.tsx`:

- `src/lib/work-engine/work-types/pick.tsx` — registry entry, 5-step
  default workflow (confirm → location_scan → quantity_entry →
  barcode_label_scan → review), `buildPickResultPayload` returning
  `{picked_qty, destination_location_confirmed, notes}`,
  `capabilityRequired: 'pick'`, `enabled: true`.
- `src/lib/work-engine/work-types/pick-runner.tsx` — thin wrapper that
  drives `useTaskWorkflowRuntime<PickTask>` against `STEP_REGISTRY`
  and projects `PickTask.payload` onto the cycle-count-shaped
  `StepProps.taskData` so existing step components render unchanged.
  Mirrors `zone-audit-runner.tsx`.
- `src/lib/work-engine/__tests__/pick.test.ts` — 6 new Vitest cases
  (registry presence + enabled, contract assert, 5-step default
  workflow, buildResultPayload shape including null/undefined
  tolerance).
- `src/lib/work-engine/__tests__/registry.test.ts` — updated existing
  exhaustiveness test: `pick` is now in the enabled set; the
  "disabled stubs throw" spec now uses `putaway` instead.

### B — Migration 268 (pick_workflow_seed)

`supabase/migrations/268_pick_workflow_seed.sql`:

1. Seeds one `work_workflow_configs` row per org with at least one
   user: `work_kind='pick'`, `task_subtype='standard_pick'`,
   5-step `steps` jsonb, idempotent via `ON CONFLICT ON CONSTRAINT
   work_workflow_configs_org_kind_subtype_key`.
2. Flips `work_type_settings.enabled = true` + `capacity_per_worker =
   5` for the j.AI OneBox canary org (`c9d89a74-…`).
3. Appends `'pick'` to `work_engine_settings.enabled_work_types`
   (now `['cycle_count','zone_audit','pick']`).

Column mapping differs from the plan sketch (`name / is_default /
created_by`) — the actual schema after mig 258 is `display_name /
is_active / updated_by`. Matches migration 267's adapted shape.
Applied via Supabase MCP.

### C — OmniAgent `builtin-pick-completed` trigger

Five surgical additions to `omni_agent/agent.py` (NO `AGENT_VERSION`
bump — this is additive):

1. New capability string `agent-side-triggers:builtin-pick-completed`
   in `AGENT_CAPABILITIES`.
2. New entry in `_HARDCODED_TRIGGERS` keyed off `work_tasks` table,
   INSERT+UPDATE events, `/sap/lt12` endpoint, backfill filter
   `task_type=eq.pick&status=eq.completed`.
3. New branch in each of the three pure functions:
   - `_hardcoded_trigger_match`: requires `task_type='pick'`,
     `status='completed'`, `payload.lt12_confirmed_at` unset, and
     `payload.transfer_order` truthy.
   - `_hardcoded_trigger_payload`: returns `{transfer_order,
     warehouse, picked_qty, destination_location, movement_type}`
     matching the existing LT12 handler shape. Falls back from
     `result_payload.picked_qty` → `payload.pick_qty` when the
     operator didn't populate the result, and defaults `movement_type`
     to 601.
   - `_hardcoded_trigger_post_patch`: returns a `work_tasks` JSONB
     merge shape — reads the row's current `payload`, merges in
     `lt12_confirmed_at / _by_agent_id / _source`, and hands the
     merged object back for the dispatcher to PATCH wholesale.
4. Extended `_apply_trigger_post_patch` with an early `table ==
   'work_tasks'` branch that PATCHes the full merged payload and
   bypasses the attribution-fields allowlist (which is specific to
   `rf_putaway_operations`). `work_tasks` RLS already grants
   `UPDATE TO authenticated`, so no RPC needed.
5. New Realtime channel `work-tasks-<org_id>` subscribed to INSERT +
   UPDATE with `organization_id=eq.<org>` filter. Routes through the
   existing `_on_hardcoded_table_change` dispatcher (also stamps
   `state.last_realtime_event_at` now so the v1.7.8 backfill-skip
   optimization applies uniformly).
6. `_enqueue_trigger_job` gains a payload-shape validation branch for
   `builtin-pick-completed` (requires `transfer_order` +
   `warehouse`).

#### Post-patch path chosen: `work_tasks` JSONB merge

Two options were evaluated. The match-branch guard
(`payload.lt12_confirmed_at`) + the 5-min in-memory dedup cache make
the race window effectively zero, so the simpler JSONB-merge path is
preferred over a `work_events` audit insert (which would require a new
SECURITY DEFINER RPC because `work_events.INSERT` is service-role-only
per mig 256). The Realtime record already carries the current payload,
so the merge happens in-memory before one single PATCH fires.

### C.bis — Unit test

`omni_agent/tests/test_builtin_pick_completed.py` — 12 pytest cases
covering match (happy path + 5 rejection paths incl. idempotency
guard, wrong task type, non-completed status, missing transfer order,
defensive null-payload tolerance), payload (3 cases — realistic input,
`picked_qty` fallback, `movement_type` default), and post_patch (2
cases — JSONB merge shape + missing-payload tolerance).

Tests gracefully skip when `agent.py` can't be imported (the sandbox
has Python 3.9; `agent.py` uses 3.10+ `X | Y` type-union syntax).
Operator runs on their local venv with Python 3.10+ for the real
assertion.

### D — Documentation

- `docs/work-engine/follow-on-picking.md` — new runbook covering
  mission, operator 5-step flow, the three pure functions, trigger
  lifecycle diagram, post-patch path choice, Realtime channel setup,
  per-org enablement SQL, and v2 open items (wave picking, batch
  confirmation, exceptions, slot optimization, two-step picks).
- `docs/work-engine/README.md` — new "Follow-ons" table
  cross-linking `pick` / `zone_audit` + stubs.

## Verification

- `pnpm exec tsc -p tsconfig.app.json --noEmit` — **clean (exit 0)**.
- `pnpm exec vitest run --no-coverage src/lib/work-engine/__tests__/`
  — **17 / 17 pass** (registry exhaustiveness 4, pick 6, zone-audit 7).
- `python3 -m pytest omni_agent/tests/test_builtin_pick_completed.py -v`
  — **12 collected, 12 skipped** in this sandbox (Py 3.9 can't import
  `agent.py`). Operator runs on Py 3.10+.

Migration 268 applied cleanly via Supabase MCP:
- pick workflow_configs rows for canary org: **1**
- `work_type_settings.pick`: enabled=true, capacity_per_worker=5
- `enabled_work_types`: `['cycle_count','zone_audit','pick']`

Master `work_engine_enabled` flag **stays false** on every org — the
agent-side trigger is a no-op until an operator explicitly flips it.

## Related

- [[Implement-Work-Engine-Foundation]]
- [[Implement-Work-Engine-Operational-Hardening]]
- [[Agent-Triggers - Realtime Automation]]
- [[Omni-Agent - Headless SAP Agent]]
- [[Realtime-Subscription-Hygiene]]
- [[Patterns/Agent-Self-Attribution]]
