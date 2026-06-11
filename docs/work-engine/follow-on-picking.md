# Follow-on: Picking WorkType

This is the runbook for the **Picking** entry in the Work Engine
registry. It mirrors the structure of the parallel Zoning follow-on so
both follow-ons share the same lifecycle language.

## Mission

An operator pulls line items from source bins to fulfill a SAP
transfer order. Each `pick` task in `work_tasks` represents **one line
item** of one TO. On operator confirmation, OmniAgent fires `LT12`
against that TO + line to confirm the movement in SAP.

- One `work_tasks` row per `(transfer_order, item)` tuple.
- `payload.pick_qty` is the expected quantity (seeded from LT22 /
  upstream dispatch); `result_payload.picked_qty` is what the
  operator actually pulled.
- Completion flips `status → completed`, which the agent's Realtime
  subscription on `work_tasks` sees and matches against the
  `builtin-pick-completed` trigger.

## Operator workflow (v1)

Five registry step components drive the RF flow, matching the default
`work_workflow_configs.steps` seeded by migration 268:

| # | `step.type`          | Label                 | What the operator does                                |
| - | -------------------- | --------------------- | ----------------------------------------------------- |
| 1 | `confirm`            | Confirm Pick          | Confirms they're starting the pick for this task.     |
| 2 | `location_scan`      | Scan Source Location  | Scans the source bin to verify they're at the right spot. |
| 3 | `quantity_entry`     | Enter Pick Quantity   | Enters the actual quantity pulled (may short-pick).   |
| 4 | `barcode_label_scan` | Scan Pick Label       | Scans the printed pick label to audit the pull.       |
| 5 | `review`             | Review                | Reviews the summary and taps Complete.                |

The RF shell resolves each step via `STEP_REGISTRY` (no bespoke
components per work type) and drives navigation through
`useTaskWorkflowRuntime`. The adapter lives at
`src/lib/work-engine/work-types/pick-runner.tsx` and the registry entry
at `src/lib/work-engine/work-types/pick.tsx`.

### `buildResultPayload` shape

```ts
{
  picked_qty: number,
  destination_location_confirmed: string,
  notes?: string
}
```

This becomes `work_tasks.result_payload` on completion. The agent reads
`result_payload.picked_qty` first; if unset it falls back to
`payload.pick_qty`.

## OmniAgent `builtin-pick-completed` trigger lifecycle

The agent owns LT12 confirmation so the operator's RF device never
talks to SAP directly. The full lifecycle is a three-step dance between
the operator, `work_tasks`, and OmniAgent:

```
┌───────────────┐  status = completed  ┌──────────┐  match + enqueue  ┌────────────────┐
│ Operator taps │ ───────────────────▶ │ work_    │ ────────────────▶ │ sap_agent_jobs │
│ "Complete"    │                      │ tasks    │                   │ (endpoint:     │
└───────────────┘                      │ Realtime │                   │  /sap/lt12)    │
                                       └──────────┘                   └────────────────┘
                                                                              │
                                                                              ▼ claim
                                                                     ┌────────────────┐
                                                                     │ OmniAgent job  │
                                                                     │ poller claims  │
                                                                     │ → LT12 via SAP │
                                                                     └────────────────┘
                                                                              │
                                                                              ▼ success
                                                                     ┌────────────────┐
                                                                     │ PATCH work_    │
                                                                     │ tasks.payload  │
                                                                     │ with           │
                                                                     │ lt12_confirmed_at │
                                                                     └────────────────┘
```

### The three pure functions (all in `omni_agent/agent.py`)

1. **`_hardcoded_trigger_match(trigger, row)`** — predicate. For
   `trigger.id == "builtin-pick-completed"`:
   - `row.task_type == "pick"` (cycle_count / zone_audit rows on the
     same table are rejected).
   - `row.status == "completed"`.
   - `row.payload.lt12_confirmed_at` is **falsy** (idempotency guard).
   - `row.payload.transfer_order` is truthy (LT12 requires a target).

2. **`_hardcoded_trigger_payload(trigger, row)`** — shape fed to
   `/sap/lt12`:
   ```python
   {
     "transfer_order":       row.payload.transfer_order,
     "warehouse":            row.warehouse,
     "picked_qty":           row.result_payload.picked_qty or row.payload.pick_qty,
     "destination_location": row.payload.destination_location,
     "movement_type":        row.payload.movement_type or "601",
   }
   ```

3. **`_hardcoded_trigger_post_patch(trigger, row)`** — post-success
   patch applied by the job poller after LT12 dispatches cleanly. For
   pick we do a **JSONB merge on `work_tasks.payload`**:
   ```python
   {
     "table":   "work_tasks",
     "row_id":  row.id,
     "patch":   { "payload": {
                   **row.payload,
                   "lt12_confirmed_at":         <utcnow-Z>,
                   "lt12_confirmed_by_agent_id": <_agent_self_id()>,
                   "lt12_confirmed_source":     "agent_trigger_direct",
                }},
     "skip_if": {},  # idempotency handled by the match-branch guard
   }
   ```

### Post-patch path chosen: `work_tasks` JSONB merge

Two options were considered:

| Option                      | Chosen? | Rationale                                          |
| --------------------------- | ------- | -------------------------------------------------- |
| Direct JSONB merge via PATCH on `work_tasks.payload` | ✅ | `work_tasks` already grants `UPDATE` to `authenticated` (mig 256 RLS). The match-branch guard on `payload.lt12_confirmed_at` + the 5-min in-memory dedup cache make the race window effectively zero — the task is in `status='completed'` and no other caller touches the payload after that point. The Realtime record already carries the current payload, so the merge happens in-memory before one single PATCH fires. |
| INSERT `work_events('reassigned', …)` audit only | ❌ | Clean but `work_events` INSERT is `service_role`-only (mig 256). Routing through a new SECURITY DEFINER RPC just for the audit marker would add DDL + grant churn without the corresponding idempotency benefit (the match-branch guard wants a marker on the row itself, not on a joined audit table). |

The dispatcher helper `_apply_trigger_post_patch` therefore gained an
**early `work_tasks` branch** (before the `rf_putaway_operations`
attribution-fields allowlist) that bypasses the filter and PATCHes the
full merged `payload` object.

### Capability advertised

`AGENT_CAPABILITIES` gains `agent-side-triggers:builtin-pick-completed`
so a future frontend runtime that wants to gate per-trigger can target
the pick entry specifically. The umbrella capability
`agent-side-triggers` is already present and still silences the
browser-side runtime for ALL supabase-realtime templates; the granular
entry is purely additive.

## Realtime channel

The agent's `_start_realtime_subscription` now adds a fourth channel:

```
work-tasks-<org_id>
  ↳ INSERT @ public.work_tasks  (filter: organization_id=eq.<org_id>)
  ↳ UPDATE @ public.work_tasks  (filter: organization_id=eq.<org_id>)
```

`work_tasks` was already in the `supabase_realtime` publication per
mig 257 and has `REPLICA IDENTITY FULL`, so `OLD` records are available
to the publication. Both INSERT and UPDATE route through
`_on_hardcoded_table_change("work_tasks", …)` → `_HARDCODED_TRIGGERS` →
the `builtin-pick-completed` match function.

The 60s backfill poller carries a `task_type=eq.pick&status=eq.completed`
filter so any row the agent missed during a reconnect blip is picked up
within a minute. As with the other trigger backfills, `lt12_confirmed_at`
in the payload short-circuits re-fires via the defensive match guard.

## Enabling for a new org

```sql
-- 1. Seed the default workflow row (idempotent via
-- `work_workflow_configs_org_kind_subtype_key`).
INSERT INTO public.work_workflow_configs
  (organization_id, work_kind, task_subtype, display_name, description,
   is_active, steps, version, updated_by)
SELECT <org_id>, 'pick', 'standard_pick', 'Pick — Standard',
       '5-step pick workflow, agent-confirmed via LT12.', true,
       -- `steps` jsonb array — copy from mig 268 --
       '<steps-jsonb>'::jsonb, 1,
       (SELECT id FROM public.user_profiles WHERE organization_id = <org_id> LIMIT 1)
ON CONFLICT ON CONSTRAINT work_workflow_configs_org_kind_subtype_key DO NOTHING;

-- 2. Flip the per-type setting (enabled + capacity).
UPDATE public.work_type_settings
   SET enabled = true, capacity_per_worker = 5, updated_at = now()
 WHERE organization_id = <org_id> AND task_type = 'pick';

-- 3. Append to the engine's enabled_work_types array.
UPDATE public.work_engine_settings
   SET enabled_work_types = array_append(enabled_work_types, 'pick'),
       updated_at = now()
 WHERE organization_id = <org_id>
   AND NOT ('pick' = ANY(enabled_work_types));
```

Leave `work_engine_enabled` set to `false` on the master org flag until
a shadow-write soak of the new work type has passed without drift; the
agent-side trigger is a no-op while that flag is off because no upstream
caller will be creating `pick` rows.

## Operator next action — restart OmniAgent

The agent changes are code-only (no `AGENT_VERSION` bump — this is
additive). Operators running an installed OmniAgent EXE must **restart
the local agent process** so the new `work_tasks` Realtime channel and
the `builtin-pick-completed` trigger branches load. `/health` will then
advertise `agent-side-triggers:builtin-pick-completed` in the
`capabilities` array.

No frontend rebuild is required — the agent is additive and the
frontend's `requiredCapability` gate reads the `/health.capabilities`
array at runtime.

## Open items — v2 and beyond

- **Wave picking** — a single operator walks multiple TO lines as one
  wave. Requires a new `task_subtype` (`wave_pick`) + a one-to-many
  relation between wave tasks and their constituent lines. LT12 still
  fires per line, so the agent-side trigger shouldn't need changes.
- **Batch confirmation** — for high-volume picks, confirm a batch of
  lines with one LT12 call (SAP supports batch BAPI `BAPI_WHSE_OB_DELIV_CONFIRM`).
  Would require a new endpoint on the agent and a batched job shape;
  the work_tasks rows would still flip to `completed` individually so
  the existing Realtime subscription observes them correctly.
- **Exceptions handling** — short picks, damaged parts, bin not found.
  Today the operator short-picks via `quantity_entry` (`picked_qty`
  less than `pick_qty`). A proper exception flow would branch into a
  "variance review" step (mirror the cycle-count pattern at
  `supabase/migrations/203h_update_variance_trigger_row_thresholds.sql`)
  and optionally park the task in a supervisor queue.
- **Pick slot optimization** — when multiple tasks target bins in the
  same aisle, order them by warehouse path graph. Wire through the
  `warehouse_aisle_nodes` / `warehouse_aisle_edges` routing RPCs
  (mig 238-239). Purely backend — no agent impact.
- **Two-step picks** — when a pick requires an interim consolidation
  move (e.g. 916 → 914 → 001). Today this is two separate TOs; v2
  could model it as one task with two stage payloads.

## Related

- `supabase/migrations/268_pick_workflow_seed.sql` — the workflow seed
  + canary enablement.
- `src/lib/work-engine/work-types/pick.tsx` — registry entry.
- `src/lib/work-engine/work-types/pick-runner.tsx` — RF adapter driving
  `useTaskWorkflowRuntime`.
- `src/lib/work-engine/__tests__/pick.test.ts` — contract tests.
- `omni_agent/agent.py` — three `_hardcoded_trigger_*` branches + the
  work_tasks Realtime subscription + `agent-side-triggers:builtin-pick-completed`
  capability string.
- `omni_agent/tests/test_builtin_pick_completed.py` — pytest coverage
  of the three pure functions (operator runs on Python 3.10+ because
  `agent.py` uses `X | Y` union-type syntax; the tests gracefully skip
  on older Pythons).
- `docs/work-engine/README.md` — engine-level context.
