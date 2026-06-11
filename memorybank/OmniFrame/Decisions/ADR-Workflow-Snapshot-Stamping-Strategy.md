---
tags: [type/decision, status/active, domain/database, domain/frontend]
created: 2026-04-19
---
# ADR: Workflow snapshot stamping via DB trigger, not app code

## Context
`cycle_count_workflow_configs` holds per-org workflow definitions; `rr_cyclecount_data` has `workflow_config_id`, `workflow_config_version`, `workflow_snapshot`, `review_threshold_pct`, `review_threshold_abs`. There were multiple potential insertion paths for cycle counts (manual create, bulk LX03, reassignment, future RPCs, tests, future services). Each would have needed to remember to call `workflowConfigService.getSnapshotForTask()` and stamp the snapshot — and historically, none of them did.

## Decision
Stamp the snapshot in a BEFORE INSERT trigger on `rr_cyclecount_data` (migration 218). The trigger:
- Pulls the active config for `(organization_id, count_type)`.
- Writes `workflow_config_id`, `workflow_config_version`, a JSON `workflow_snapshot` containing the steps, and extracts `review_threshold_pct` / `review_threshold_abs` from the review step config.
- Skips stamping any field the caller already supplied (so explicit overrides still work).

The RF frontend reads the stamped snapshot per task via `useTaskWorkflow`, falling back to a live `getSnapshotForTask` lookup if a row predates the trigger and to a hardcoded default workflow otherwise.

## Alternatives considered
1. **Stamp in `CycleCountService.createCycleCount` / `createMultipleCycleCounts`.** Works but forces every current and future insert path to import the workflow service. High regression risk; easy to forget in a new RPC.
2. **Rust work service exposes snapshot in `CycleCountTask`.** Cleanest layering but requires touching Rust + redeploy; mid-flow changes wouldn't propagate into already-queued tasks any more cleanly than the DB trigger.
3. **Frontend always fetches the live config by `count_type` at runtime.** Simpler but loses version pinning — an admin editing a workflow while a count is in progress would mutate the flow under the operator.

The trigger-based approach gives us (a) universal coverage, (b) version pinning, (c) zero app-code changes when new insert paths get added, and (d) a natural audit trail (each row carries the exact steps it was counted against).

## Consequences
- Per-row `review_threshold_*` are now populated in practice, so `auto_calculate_cycle_count_variance`'s `COALESCE(..., 10)` path becomes secondary.
- Configs that change after a count is created do NOT retroactively affect that count; the snapshot is frozen.
- Backfill runs once on migration; pending counts picked up the latest config at that moment.
- Deleting a workflow config after counts have been created leaves dangling `workflow_config_id`s (`ON DELETE SET NULL`) but the snapshot JSON preserves the step definition.

## Related
- [[Wire-Cycle-Count-Workflow-To-RF-Counter]]
- [[Configuration Services - Supabase Service]]
