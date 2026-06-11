---
tags: [type/implementation, status/active, domain/backend, domain/frontend, domain/database, domain/api]
created: 2026-05-02
---
# Implement Work Engine Foundation

## Purpose / Context

Generalize the cycle-count system into a polymorphic warehouse work-distribution
engine. Activate the dormant migration-039 schema as the canonical task table
(`work_tasks`), introduce a WorkType registry and discriminated union on the
frontend, ship the critical bug fixes (PIN, photo race, storage RLS, GRS bucket,
realtime publication, supervisor protection), and lay the configurability,
observability, and idempotency contracts that make the engine flexible per
org / warehouse / task type / priority / shift.

After this lands, the **Zoning** and **Picking** follow-on plans become a
`WorkTypeConfig` registration + a default workflow row + (optionally) a SAP
agent trigger — not a re-platforming.

Plan source: `plans/work_engine_foundation_e9c4a217.plan.md`
(read-only — never edited).

## Migration numbering

Plan called for migrations 254–259. On-disk numbering is **256–261**
because 254 (`index_hot_read_paths`) and 255 (`optimize_replica_identity`)
were already in flight from the unrelated agent + DB load reduction
effort. Mapping in `docs/work-engine/README.md`.

| Plan # | On-disk # | File | Purpose |
| ------ | --------- | ---- | ------- |
| 254 | 256 | `activate_work_engine_foundation.sql` | flags, settings, work_tasks/work_events/task_artifacts, helpers, idempotency, reassign_work_zone RPC |
| 255 | 257 | `cycle_count_to_work_tasks_projection.sql` | bidirectional sync triggers (with `app.skip_sync` GUC), realtime publication, backfill helpers |
| 256 | 258 | `workflow_configs_work_kind.sql` | rename + writable compat view |
| 257 | 259 | `supervisor_pin_verification.sql` | bcrypt PIN hash, verify RPC, atomic complete-with-pin, photo-append RPC, rate-limit table |
| 258 | 260 | `storage_rls_org_scope.sql` | org-folder RLS for `cycle-count-photos`, `grs-photos`, `task-artifacts` |
| 259 | 261 | `work_engine_observability.sql` | `work_engine_health` + `work_engine_drift` + `work_engine_dispatch_fairness` views |

## Details

### Backend (Postgres)

- All settings tables RLS-enabled with manager+ writes via
  `work_engine_is_manager_or_above_in_org()` (mirrors mig 198/027 pattern).
- `work_tasks` carries the full set of zone-engine invariants: generated
  `zone` fast path, trigger-maintained `dispatch_zone` correctness path,
  `reservation_started_at` 3-branch maintenance trigger (port of mig 252),
  composite `(org, id)` unique to support `(org, task_id)` FKs from
  `work_events` and `task_artifacts`.
- Status mapping (legacy → work_tasks):
  `pending → pending`, `in_progress → in_progress`,
  `recount → in_progress (legacy_status='recount')`,
  `awaiting_supervisor_signoff → paused (legacy_status='awaiting_supervisor_signoff')`,
  `variance_review → completed (legacy_status='variance_review')`,
  `approved → completed (legacy_status='approved')`,
  `cancelled → cancelled`.
- Sync triggers BOTH directions check `app.skip_sync` GUC to prevent
  ping-pong; verified via `supabase/tests/sync_no_loop.sql`.
- Idempotency table with TTL + per-org RLS for replay-safe POSTs (Phase 1.5).

### Backend (Rust work-service)

- New modules: `strategies/` (DispatchStrategy trait + 3 impls — cycle_count
  thin facade, zone_audit + pick stubs), `observability/` (Prometheus
  metric names + idempotency middleware), `settings/` (cache + LISTEN
  consumer), `ws_token.rs` (HS256 5-min subscribe token).
- New routes on `/api/v1/work/`: `reassign_zone`, `push_batch`, `push_top_n`,
  `ws-token`. Plus `/metrics` scaffold (gated on `prometheus` dep — currently
  returns 503 until the dep is added by ops).
- Cargo deps added: `async-trait`, `hmac`, `sha2`, `base64`.
- All existing cycle-count claim/push/complete paths preserved unchanged —
  this layer is purely additive until the dispatcher SQL refactor follow-on.

### Frontend

- `src/lib/work-service/work-task-types.ts` — new `BaseTask` + discriminated
  `WorkTask` union (cycle_count | zone_audit | pick | putaway | replenish |
  kit_pick).
- `src/lib/work-service/adapters.ts` — round-trippable legacy↔new mappers.
- `src/lib/work-service/payload-schemas.ts` — per-(task_type, version)
  validators + migrators with explicit version-bump contract.
- `src/lib/supabase/work.service.ts` — generic CRUD over `work_tasks` with
  optimistic-concurrency `updatePriority`.
- `src/lib/work-engine/` — `WorkTypeConfig` contract, registry with self-validation,
  `cycleCountWorkType` adapter, 5 disabled stubs that throw if instantiated.
- `src/components/error-boundaries/WorkflowErrorBoundary.tsx` — accepts
  `workTypeId`, forwards to `window.__OMNI_SENTRY_CAPTURE`. Backwards
  alias preserves `CycleCountErrorBoundary` for existing call sites.
- `src/components/ui/rf-steps/registry.tsx` — `STEP_REGISTRY` mapping the
  13 step types; `resolveStep()` throws in dev, falls back in prod.
- `src/components/ui/numeric-keypad.tsx` — extracted shared keypad
  (replaces 3 duplicates).
- `src/hooks/use-scan-feedback.ts` — beep + vibrate.
- `src/hooks/use-task-workflow-runtime.ts` — generic `useTaskWorkflowRuntime<T>`
  with debounced 3s scoped-key drafts + legacy migration helper.
- `src/hooks/use-workflow-snapshot.ts` — alias re-export of the renamed
  `useTaskWorkflow` config resolver (Phase 6.0 collision fix).
- `src/hooks/use-work-operations.ts` — generic supervisor queue facade.
- `src/hooks/use-work-engine-settings.ts` — settings hook with realtime invalidation.
- `src/hooks/use-work-engine-live.ts` — Operation Control merged-state hook
  (WS + Postgres-changes + 30s polling rescue, pure reducer for replay
  determinism).
- Operation Control command center (`src/features/admin/operation-control/`):
  page + zone-map (drag-drop reassign, soft/hard mode confirm), operator
  deck (draggable cards), alert rail, queue strip (per (task_type, priority)
  with canvas sparklines and shift+drop / cmd+drop semantics for top-N
  pushes), keyboard shortcuts overlay, control-center scoped CSS tokens
  (dark canvas, neon accents).
- `src/features/admin/work-engine/` — Configurability Surface (3 tabs).
- `src/components/inventory-management.tsx` — inserts `Operation Control`
  tab between `Inventory Counts` and `CubiScan`, full-width (no Card
  wrapper), tabContent memoized.

### Critical bug fixes (Phase 7)

- Supervisor PIN now server-enforced via `verify_supervisor_pin` SECURITY
  DEFINER RPC. Bcrypt hash, same-org + role check, 5/5min rate limit. PIN
  never written into notes.
- `array_append_evidence_photo` RPC — atomic, org-scoped, permission-checked.
  Replaces the read-modify-write race.
- Sign-in: removed length-trigger debounced auto-submit. Operators submit
  via Enter or button click only.
- Recount completion: blocking `prompt()` → `<Dialog>` with numeric input.
- GRS bucket + cycle-count-photos + task-artifacts all org-folder-scoped
  via mig 260.
- Supervisor protection columns (`supervisor_assigned_at/by`) on `work_tasks`
  + on the projection trigger.

### Test surface

- 6 Vitest scaffolds in `src/**/__tests__/` (21 tests, all green).
- 6 SQL probes in `supabase/tests/` (run via `psql -f`).
- `scripts/validate-check-matrix.mjs` reports matrix presence; soft-fail by
  default, `CHECK_MATRIX_STRICT=1` for CI hard-fail.
- Rust integration tests are operator-driven scaffolds (paths in matrix).

## Operator next steps

1. Apply migrations 256–261 to a target environment.
2. Regenerate `src/lib/supabase/database.types.ts`. Drop the
   `as unknown as AnySupabase` casts in:
   - `src/lib/work-engine/flags.ts`
   - `src/lib/supabase/work-engine-settings.service.ts`
   - `src/lib/supabase/work.service.ts`
   - `src/hooks/use-work-engine-live.ts`
   - `src/components/ui/rf-cycle-count-unified.tsx`
   - `src/lib/supabase/cycle-count-photos.service.ts`
3. Capture Phase 0.2 baselines.
4. Per-org enablement: `work_engine_settings.feature_flags.work_tasks_shadow_write = true`.
5. Run reconciliation per `docs/work-engine/phase-11-rollout.md`.
6. Canary one org per Phase 11.3 acceptance.

## Related

- [[Work-Engine-Roadmap-Cycle-Counts-To-Picks-Putaways]]
- [[Omni-Agent - Headless SAP Agent]]
- [[Implement-Agent-DB-Load-Reduction]]
- [[Implement-Frontend-Supabase-Load-Reduction]]
- [[Realtime-Subscription-Hygiene]]
- `plans/work_engine_foundation_e9c4a217.plan.md` (read-only source of truth)
