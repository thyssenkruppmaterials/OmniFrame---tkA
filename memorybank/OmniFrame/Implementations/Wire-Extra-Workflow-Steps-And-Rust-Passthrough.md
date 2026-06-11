---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-04-19
---
# Wire extra workflow steps + Rust work-service snapshot passthrough

## Purpose / Context
Follow-up to [[Wire-Cycle-Count-Workflow-To-RF-Counter]]. Two gaps remained:
1. **Serial number / barcode label / condition assessment / dedicated notes** step types were defined in `cycle_count_workflow_configs` and implemented in `src/components/ui/rf-steps/*`, but never rendered in the RF unified flow.
2. The Rust work service returned `CycleCountTask` without the workflow snapshot, so `useTaskWorkflow` needed a **secondary Supabase query** to fetch `workflow_snapshot` + thresholds per task.

This pass wires both pieces end-to-end.

## Details

### Rust work-service passthrough
`rust-work-service/src/db/models.rs`
- `CycleCountTask` struct gained 7 new fields:
  - `workflow_config_id: Option<Uuid>`
  - `workflow_config_version: Option<i32>`
  - `workflow_snapshot: serde_json::Value`
  - `workflow_result: serde_json::Value`
  - `evidence_photo_urls: Option<Vec<String>>`
  - `review_threshold_pct: Option<f64>`
  - `review_threshold_abs: Option<f64>`
- sqlx already has the `json` feature enabled so JSONB deserializes directly into `serde_json::Value` via the `FromRow` derive; `TEXT[]` → `Option<Vec<String>>`, `NUMERIC` columns are cast to `float8` in SQL.

`rust-work-service/src/db/queries.rs`
- **All 9 `SELECT` clauses** that hydrate `CycleCountTask` (queue, claim-by-assigned, claim-candidate-batch, claim-post-update reload, push-post-update reload, `get_worker_tasks`, `get_cycle_count_by_id`, `get_deferred_count_for_user`, plus the `cc.`-prefixed variant) now append the workflow columns. Updated via `StrReplace` with `replace_all` + a one-off for the `cc.`-prefixed variant.
- `cargo check` and `cargo test` pass (all 8 existing tests still green). No migration required — migrations 203 + 218 already added the columns and backfilled the data.

### TypeScript mirror + hook fast path
`src/lib/work-service/types.ts`
- Added `TaskWorkflowSnapshot` and `TaskWorkflowResult` types.
- `CycleCountTask` now carries the 7 workflow fields to match the Rust shape.
- `src/hooks/use-pushed-work.ts` synthetic "alert task" updated with empty workflow defaults so the `CycleCountTask` type is satisfied.

`src/hooks/use-task-workflow.ts`
- New `workflowFromTask()` pure extractor.
- `useTaskWorkflow({ task, taskId?, countType? })` now accepts a full task object. When the task payload carries `workflow_snapshot.steps`, the hook returns synchronously (`source: 'task'`) and **disables the TanStack query entirely** (`enabled: !!taskId && !fromTask`). Zero round-trips for the RF counter.
- Falls back through: `snapshot` (row lookup) → `live` (getSnapshotForTask by count_type) → `fallback` (built-in default).

`src/components/ui/rf-cycle-count-unified.tsx`
- Switched to the synchronous path: `useTaskWorkflow({ task: currentTask ∴ null })`.

### Extra-step state machine
`src/hooks/use-extra-workflow-steps.ts` (new)
- Buckets configured extras into two slots:
  - `pre_count` = `barcode_label_scan` (runs **after** location verification, **before** quantity keypad).
  - `post_count` = `serial_number`, `condition_assessment`, `notes` (runs **after** quantity submit, **before** review/signoff/complete).
- Ordered by `step.order` within each slot.
- `recordResult(stepId, result, taskId)` caches in state **and** fires `persistWorkflowResult` to write `rr_cyclecount_data.workflow_result` (merged JSONB) as the operator progresses — best-effort, errors logged, never blocking.
- Exposes `advance/retreat/reset` helpers, plus `hasPreSteps / hasPostSteps / allPreDone / allPostDone` booleans.

### RF unified component changes
`src/components/ui/rf-cycle-count-unified.tsx`
- New `subStep: 'pre_extras' | 'post_extras' | null` state.
- `ExtraStepRenderer` internal component dispatches to the appropriate `RFStep*` from `@/components/ui/rf-steps` based on `stepConfig.type`. Maps `CycleCountTask` fields to the `StepProps.taskData` contract.
- Routing:
  - `handleLocationScan` — when verified, if `hasPreSteps && !allPreDone`, enter `subStep='pre_extras'` instead of jumping to step 3.
  - `handleQuantitySubmit` — if `hasPostSteps && !allPostDone`, enter `subStep='post_extras'` instead of going to review/signoff/complete.
  - `handlePreExtraComplete` / `handlePostExtraComplete` — record result, merge any `result.notes` into `formData.notes`, advance.
  - Two `useEffect`s exit sub-state once the queue drains and pick the correct next main step (3 for pre → main, 4/5/complete for post → main).
  - Back buttons retreat within the extras queue, exiting to the parent main step if at index 0.
- **Footer hiding:** unified Submit / Continue footer is hidden when `subStep !== null`; each `rf-steps` component ships its own Back/Continue/Skip buttons.
- **StepIndicator** accepts `subStep`, `hasPreSteps`, `hasPostSteps`. Injects "Verify" (pre) and "Capture" (post) dots into the progress rail when configured. Uses a synthetic `effectiveActive` id (25/35) so the indicator highlights the sub-state correctly.

### Tests
`src/features/rf-interface/__tests__/rf-cycle-count-unified.test.tsx`
- Added stable mocks for `use-task-workflow` and `use-extra-workflow-steps` (module-level constants to avoid re-render OOM churn) + `cycle-count-photos.service`.
- Suite still 19/20; remaining failure is the pre-existing release-dialog multi-element match.

### Typecheck / lint
- `cd rust-work-service && cargo check` — clean.
- `cd rust-work-service && cargo test` — 8/8 passed.
- Root `npx tsc -b --noEmit` — 0 errors.
- Root `npx eslint` on touched files — 0 errors.

### Live verification
A direct SQL `SELECT` with the exact column list the Rust service emits returns all 37 fields including a non-empty `workflow_snapshot.steps` array and the per-row thresholds — confirming deployment-time compatibility.

## Architecture decisions

- **JSONB via `serde_json::Value`** — simpler than custom `#[sqlx(json)]` wrappers; the `json` feature in Cargo.toml was already present. Serialization back out is automatic via serde.
- **`NUMERIC` cast to `float8` in SQL** — avoids pulling in a `decimal` crate dependency and matches the existing pattern (`system_quantity::float8`). Trade-off: 10.01 could round to 10.009999... — acceptable for variance thresholds which are operator-tunable integers in practice.
- **Synthetic "2.5" / "3.5" slots** instead of fully dynamic step ordering — preserves the existing blind/recount logic and draft state shape. Admin-configured `order` still drives ordering **within** each slot, just not across the main skeleton.
- **Extra-step footer hiding** — rf-steps components ship their own buttons; trying to merge them with the unified footer would require changing every step component's API. Hiding the unified footer when a sub-step is active is a one-line change and keeps the step library reusable.
- **Best-effort `workflow_result` persistence** — each extra step's result flows to the DB via a fire-and-forget Supabase update; errors log but don't block the operator. If the operator abandons mid-flow, captured serials / condition are already persisted.

## Remaining future work
- **Draft hydration for extras** — when an operator resumes a mid-count draft, we don't currently restore their progress through the extras queue (results are safe in `workflow_result` but the index resets). Acceptable today; resume a count and re-enter. Full fix: populate `preCountIndex` / `postCountIndex` by reading which step ids already appear in `workflow_result`.
- **Unified `supervisor_signoff` vs `RFStepSupervisorSignoff`** — the library component is informational-only; the unified PIN-pad flow stays in place. If a PIN-less acknowledge is desired, swap.
- **Multi-photo support** — `RFStepPhotoCapture` collects `File[]` but the unified review step still uses single-file. Merging would need to switch the upload helper to a loop.
- **Rust WS events** — `PushedWork` events don't carry workflow snapshot; acceptable since the receiving client re-fetches the full task by id via `workServiceClient.getTask()`.

## Related
- [[Wire-Cycle-Count-Workflow-To-RF-Counter]]
- [[ADR-Workflow-Snapshot-Stamping-Strategy]]
- [[Configuration Services - Supabase Service]]
