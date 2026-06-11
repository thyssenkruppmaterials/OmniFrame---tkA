---
tags: [type/implementation, status/active, domain/frontend, domain/database, domain/backend]
created: 2026-04-19
---
# Wire Cycle Count Workflow To RF Counter

## Purpose / Context
The RF cycle count app in `src/components/ui/rf-cycle-count-unified.tsx` was entirely disconnected from the workflow configs admins author in Count Settings (`src/components/count-settings.tsx`):
- The step machine was hardcoded as `type WorkflowStep = 1 | 2 | 3 | 4 | 5` with a fixed Confirm → Location → Count → Review → Complete sequence.
- `workflow_config_id`, `workflow_snapshot`, `review_threshold_pct`, `review_threshold_abs`, `evidence_photo_urls` existed on `rr_cyclecount_data` (from migration 203) but nothing in the app ever stamped or read them.
- `WorkflowConfigService.getSnapshotForTask(count_type)` was dead code.
- Thresholds were literal `10` / `10` everywhere.
- `count_type === 'empty_location_check'` was the only way the UI adapted to workflow intent.
- `photo_capture` UI existed but photos were never uploaded anywhere; the `cycle-count-photos` bucket sat unused.
- `supervisor_signoff`, `serial_number`, `barcode_label_scan`, `condition_assessment` step types were defined in configs but never surfaced to operators.

This implementation closes those gaps end-to-end.

## Details

### Migration 218 — DB auto-stamp trigger
`supabase/migrations/218_stamp_workflow_on_cycle_counts.sql`

- `public.cycle_count_thresholds_from_config(config_id UUID)` — extracts `review_threshold_pct` / `review_threshold_abs` from the review step of a workflow config. Handles both `review_threshold_*` and legacy `variance_threshold_*` keys. Falls back to 10/10 when no review step exists.
- `public.stamp_cycle_count_workflow()` BEFORE INSERT trigger on `rr_cyclecount_data`:
  - Looks up the active config for `(organization_id, count_type)`.
  - Stamps `workflow_config_id`, `workflow_config_version`, `workflow_snapshot` (`{config_id, config_version, count_type, steps}`), and per-row thresholds — only if the caller didn't pass them.
  - Respects caller-provided values so recount/reassignment paths can override.
- Backfilled all 1,181 existing rows on project `wncpqxwmbxjgxvrpcake`.
- Verified with `SET steps[3].config` + insert test: new counts pick up the latest config thresholds. No security advisors raised.

### Frontend plumbing

**`src/hooks/use-task-workflow.ts`** (new)
- `useTaskWorkflow({ taskId, countType })` — TanStack Query hook that:
  1. Fetches `workflow_snapshot` + thresholds from the task row (version-pinned).
  2. Falls back to `workflowConfigService.getSnapshotForTask(count_type)` if the row pre-dates the trigger.
  3. Falls back to a legacy default workflow (Confirm → Location → Quantity → Review) to guarantee rendering.
- `hasStepType(workflow, type)` and `getStep(workflow, type)` helpers.
- 5-min stale time (snapshots are version-pinned; cache safely).

**`src/lib/supabase/cycle-count-photos.service.ts`** (new)
- `uploadCycleCountEvidencePhoto({ file, taskId, organizationId })` uploads to the `cycle-count-photos` bucket and appends the public URL to `rr_cyclecount_data.evidence_photo_urls`.
- Validates mime/size (images only, 5 MB max) and de-dupes URLs.

**`src/lib/supabase/database.types.ts`**
- Added `workflow_config_id`, `workflow_config_version`, `workflow_snapshot`, `workflow_result`, `evidence_photo_urls`, `review_threshold_pct`, `review_threshold_abs` to the `rr_cyclecount_data` Row/Insert/Update shapes so `Tables<'rr_cyclecount_data'>` surfaces them in `CycleCountData`.

### RF unified component (`src/components/ui/rf-cycle-count-unified.tsx`)

- Imports `useTaskWorkflow`, `hasStepType`, `getStep`, `uploadCycleCountEvidencePhoto`.
- Replaces hardcoded `count_type === 'empty_location_check'` with `hasStepType(workflow, 'empty_location_verification')` (legacy slug kept as fallback).
- Replaces literal `10` / `10` with `workflow.reviewThresholdPct` / `workflow.reviewThresholdAbs` across `handleQuantitySubmit` and the "Variance Significance" copy.
- Review step only fires if `hasStepType(workflow, 'review')` AND variance exceeds configured thresholds AND this is a recount.
- Required `photo_capture` forces the operator through step 4 even when variance wouldn't normally trigger review, so the photo is always captured on configs that require it.
- Photo section in step 4 is hidden entirely if no `photo_capture` step is configured.
- `persistEvidencePhotoIfAny` uploads the captured File on review completion.
- New step 5: Supervisor Sign-off. Renders a PIN pad when `hasStepType(workflow, 'supervisor_signoff')`. Appends a `[Supervisor Sign-off] PIN: **** at <ISO>` marker to notes (PIN itself is redacted) and completes the task.
- `StepIndicator` now accepts `hasReviewStep` + `hasSupervisorSignoff` and builds the label array dynamically.
- Footer button switch handles step 5 and surfaces a distinct label (`Continue to Sign-off` / `Approve & Complete`).
- `resetWorkflowState` clears supervisor PIN + verification state on task change.

### Tests

`src/features/rf-interface/__tests__/rf-cycle-count-unified.test.tsx` — added `vi.mock` for `@/hooks/use-task-workflow` and `@/lib/supabase/cycle-count-photos.service` so tests don't require Supabase env vars. Pre-existing "release task" test failure (unrelated, multi-element match) is unchanged.

### Typecheck / lint

- `npx tsc -b --noEmit` — 0 errors.
- `npx eslint <touched files>` — 0 errors.

## Gaps deliberately left for later

- `serial_number`, `barcode_label_scan`, `condition_assessment` step types are still not wired into the unified component. The `src/components/ui/rf-steps/*` reusable components exist and can be composed in when those step types are enabled in a config. Doing so requires moving off the shared-footer pattern (each `rf-steps` component ships its own Back/Continue).
- The Rust work-service `CycleCountTask` model does not yet expose workflow columns; the front end queries Supabase directly for them. If tasks need to surface snapshot without a second round-trip, extend `rust-work-service/src/db/models.rs` and `queries.rs`.
- The legacy `src/components/ui/rf-cycle-count-out-form.tsx` and deprecated `src/lib/supabase/rf-cycle-count.service.ts` still have hardcoded thresholds. Deprecation markers are in place.

## Related
- [[Configuration Services - Supabase Service]]
- [[Add-New-Count-Workflow-Button]]
- [[ADR-Count-Type-Enum-To-Text]]
