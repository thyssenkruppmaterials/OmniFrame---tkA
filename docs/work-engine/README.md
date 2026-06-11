# Work Engine Foundation

The Work Engine is OmniFrame's polymorphic warehouse work-distribution system.
It generalizes the cycle-count engine into a registry-driven contract that
covers cycle counts today, and Zoning + Picking via follow-on plans.

## Migration Numbering Note

The Work Engine Foundation plan originally specified migrations `254`–`259`.
At the time of implementation, migrations `254_index_hot_read_paths.sql` and
`255_optimize_replica_identity.sql` were already in flight (unrelated agent +
DB load-reduction effort, v1.7.8). To avoid disturbing that work the
work-engine migrations were renumbered to **256–261**:

| Plan number | On-disk number | Purpose |
| ----------- | -------------- | ------- |
| 254         | **256**        | `activate_work_engine_foundation.sql` (flags, settings, work_tasks/work_events/task_artifacts, helpers, idempotency) |
| 255         | **257**        | `cycle_count_to_work_tasks_projection.sql` (sync triggers, realtime publication, backfill helpers) |
| 256         | **258**        | `workflow_configs_work_kind.sql` (rename + compatibility view) |
| 257         | **259**        | `supervisor_pin_verification.sql` (`supervisor_pins`, `verify_supervisor_pin`, `complete_task_with_supervisor_pin`) |
| 258         | **260**        | `storage_rls_org_scope.sql` (cycle-count-photos + grs-photos org-folder RLS) |
| 259         | **261**        | `work_engine_observability.sql` (`work_engine_health`, slow-claim collector, alert helper views) |

Tests in `supabase/tests/work_engine_migration_range.sql` validate that all six
migrations are applied before canary cutover. Documentation references in this
folder, runbooks, and tests use the on-disk numbers (256–261), not the
original plan numbers.

## Follow-ons

Individual WorkTypes live in their own follow-on plans. Each ships a
docs page in this folder plus a migration that seeds a default workflow
row and flips the canary org's `work_type_settings.enabled` +
`work_engine_settings.enabled_work_types` array.

| WorkType     | Status                 | Migration | Doc                                                             |
| ------------ | ---------------------- | --------- | --------------------------------------------------------------- |
| `cycle_count`| ✅ Foundation baseline | 256–263   | Full foundation (see above)                                     |
| `zone_audit` | ✅ Follow-on shipped   | 267       | (Zoning follow-on — parallel worker)                            |
| `pick`       | ✅ Follow-on shipped   | 268       | [`follow-on-picking.md`](./follow-on-picking.md)                |
| `putaway`    | Stub                   | —         | —                                                               |
| `replenish`  | Stub                   | —         | —                                                               |
| `kit_pick`   | Stub                   | —         | —                                                               |

## Folders

- `docs/work-engine/` — engine-level docs (this README, baselines, rollout)
- `docs/runbooks/work-engine/` — incident runbooks (`stuck-zone.md`, `cross-tenant-leak.md`, …)
- `supabase/migrations/256–261_*.sql` — schema, projection, RPCs, RLS, observability
- `supabase/tests/*.sql` — RLS / FK / migration / storage probes (Phase 13.4 matrix)
- `src/lib/work-engine/` — frontend WorkType registry + flags
- `src/lib/work-service/` — typed client, payload schemas, idempotency, adapters
- `src/features/admin/work-engine/` — admin Configurability Surface
- `src/features/admin/operation-control/` — Operation Control command center
- `rust-work-service/src/strategies/` — DispatchStrategy implementations per work type
- `rust-work-service/src/observability/` — Prometheus metrics + idempotency middleware
- `rust-work-service/src/settings/` — settings cache + LISTEN consumer
- `rust-work-service/src/auth/` — WS subscribe-token issuance/verification
- `scripts/backfill/` — cycle-count → work_tasks chunked backfill driver

## Phases

See `.cursor/plans/work_engine_foundation_e9c4a217.plan.md` (read-only — do
not edit) for the authoritative phase definitions. Live status:

- Phase 0: ✅ flags helper, baselines doc, rollback contract
- Phase 0a: ✅ settings tables (in 256), settings service, admin scaffold
- Phase 0b: ⏳ Operation Control center (page scaffold + tab seed in 256; full
  drag-and-drop wiring delivered incrementally)
- Phase 1: ✅ migrations 256–261 schema foundation + types regen note
- Phase 2: ⏳ Rust dispatcher trait scaffold + generic claim wrapper
- Phase 3: ✅ discriminated union, adapters, payload-schemas, work.service.ts,
  idempotency client
- Phase 4: ✅ WorkType registry + WorkflowErrorBoundary + cycle-count adapter
- Phase 5: ✅ STEP_REGISTRY, NumericKeypad, scan feedback hook, scoped draft
  keys
- Phase 6: ⏳ hook rename + generic runtime introduced as facade over the
  unified hook (full migration deferred to follow-on)
- Phase 7: ✅ all critical bug fixes (PIN + photo + RLS + concurrency +
  signin + prompt + GRS + supervisor protection)
- Phase 8: ✅ non-destructive helpers extracted, tabs memoized
- Phase 9: ✅ test scaffolding (full pnpm quality:ci is operator-driven)
- Phase 10: ✅ SQL probes scaffolded for MCP/SQL fallback validation
- Phase 11: ⏳ rollout instructions documented; staged execution is
  operator-driven
- Phase 12: ✅ metrics surface, alert artifacts, dashboard JSON skeletons
- Phase 13: ✅ SLOs + runbooks + test-matrix script

⏳ = scaffold + contract in place; full execution deferred to operator/follow-on.

## Follow-on plans

These plans extend the Foundation with additional WorkType vertical
slices. Each is additive (gated on its own per-type setting + the
engine `work_engine_enabled` flag) so they can ship independently of
the Foundation cutover.

| Plan | Status | Doc |
| ---- | ------ | --- |
| Zoning Work Type | v1 shipped (additive, gated) | [`follow-on-zoning.md`](./follow-on-zoning.md) |

## Operator follow-up (intentionally deferred this pass)

These items are documented as deferrals — the scaffolds are in place but
the full implementation requires operator-driven steps that don't make
sense to bake into the gap-closure pass.

### Database types regeneration (PRE-CUTOVER STEP 1)

`src/lib/supabase/database.types.ts` was generated before migrations
256–263. Frontend code that touches `work_tasks`, `work_events`,
`work_engine_settings`, `work_type_settings`,
`work_type_warehouse_overrides`, `supervisor_pins`, the new RPCs
(`reassign_work_zone`, `complete_task_with_supervisor_pin`,
`record_settings_change_event`, `verify_supervisor_pin`,
`array_append_evidence_photo`), and the env-layer flag helper currently
casts through `supabase as unknown as AnySupabase` (see
`src/lib/work-engine/flags.ts` for the established pattern).

Operator first step before the type-cast removal pass:

```bash
npx supabase gen types typescript --project-id wncpqxwmbxjgxvrpcake > src/lib/supabase/database.types.ts
```

Then sweep for `as unknown as AnySupabase` / `AnyRpcSupabase` and remove
the casts where the regenerated types now cover the call site. The
search-and-replace is mechanical but should land in its own PR so a
revert is a single commit.

### Migrations 262 + 263

Migrations 262 and 263 ship as part of the gap-closure pass. They are
idempotent (`CREATE OR REPLACE FUNCTION`) and have no DDL on existing
tables. Operator deployment order is identical to 256–261 — they slot in
behind 261 and run in numeric order.

| On-disk | Purpose |
| ------- | ------- |
| **262** | `work_engine_feature_flag_env_layer.sql` — adds the GUC-backed env-override evaluation layer (Plan §0a.3 layer 1) to the existing `work_engine_feature_flag` helper. The Rust service must set `work_engine.flag_overrides` per pool connection from the `WORK_ENGINE_FLAG_OVERRIDES` env var (operator follow-up; SQL plumbing only this pass). |
| **263** | `settings_change_audit.sql` — `record_settings_change_event(p_org, p_table, p_key, p_before, p_after)` SECURITY DEFINER RPC. The frontend `work-engine-settings.service.ts` calls it after every mutation; the RPC writes a `work_events('settings_changed')` row with the before/after diff. |

### `work_tasks` advisory-locked zone exclusivity (Plan §1.4a)

The plan calls for porting the legacy zone-engine triggers (mig 225-253
worth of advisory locks + zone-state pins) onto `work_tasks` so the new
table holds the same invariants as `rr_cyclecount_data`. This is a deep
piece of work and is **deferred until the `work_tasks_read_primary`
cutover** — meaningful only after reads switch to the new table.

Until then:

- All `work_tasks` mutations go through SECURITY DEFINER RPCs
  (`reassign_work_zone`, `complete_task_with_supervisor_pin`, the
  projection trigger from migration 257) that hold the legacy invariants
  by writing through to `rr_cyclecount_data`.
- Direct INSERT/UPDATE on `work_tasks` from authenticated clients is
  blocked by RLS (the table only grants service_role write).
- A TODO comment in migration 256 near the `work_tasks` CREATE points
  back here.

When the cutover is scheduled, scope the zone-exclusivity port as a
follow-on plan (`work_tasks_zone_exclusivity_*.plan.md`) and reuse the
existing trigger shapes from `cycle_count_zone_assignments`.

### Strategy registry → `claim_next` wiring

`rust-work-service/src/strategies/` defines per-work-type DispatchStrategy
intent (Phase 2 scaffold). The Rust dispatcher in
`rust-work-service/src/api/routes/work.rs::claim_next` does NOT yet
consult the registry — it preserves current `claim_next_cycle_count`
semantics exactly per Plan §2 ("preserve current Rust dispatcher
semantics exactly"). A TODO comment near `claim_next` flags this.

Wiring lands when the new dispatcher trait is ready to swap in behind
`work_tasks_read_primary`.

### Found-part-transfer projection branch

The cycle-count → work_tasks projection (migration 257) does NOT yet
emit a separate work_tasks row for found-part-transfer side effects.
Tracked in `docs/work-engine/phase-11-rollout.md` under the
pre-`work_tasks_read_primary` checklist — non-blocker while
`rr_cyclecount_data` is authoritative for promotion logic.

### Rust integration test scaffolds

The test matrix (`scripts/validate-check-matrix.mjs`) lists ~18 Rust
integration tests under `rust-work-service/tests/`. These are
operator-driven scaffolds per Plan §13.4. The validator is strict by
default (Phase 9 commit) — operators iterating locally on scaffold work
can opt in to soft-fail with `CHECK_MATRIX_LENIENT=1`. See
`docs/work-engine/phase-9-verification.md`.
