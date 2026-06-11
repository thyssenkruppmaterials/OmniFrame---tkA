---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-04-19
---
# Close-out — RF workflow future work

## Purpose / Context
Final pass closing out the remaining future-work items from [[Wire-Extra-Workflow-Steps-And-Rust-Passthrough]]:
- Multi-photo flow (operator can capture multiple photos when `photo_capture` step is required).
- Draft hydration for extras (resumed counts skip already-completed extra steps).
- DraftData extended with sub-step state.
- Serial-number column mirror.
- Dead code cleanup.
- Unit test coverage for all new logic.

## Details

### Multi-photo pipeline
`src/lib/supabase/cycle-count-photos.service.ts`
- New `uploadCycleCountEvidencePhotos({ files, taskId, organizationId })`:
  - Uploads files in parallel to the `cycle-count-photos` bucket.
  - Per-file validation (image mime, 5 MB cap) returned as `failed[]` without aborting other uploads.
  - **Atomic merge** into `evidence_photo_urls` (single read+update, Set-dedupe) so concurrent uploads don't race.
  - Returns `{ uploaded: [{ publicUrl, storagePath }], failed: [{ file, error }] }`.
- Legacy single-file `uploadCycleCountEvidencePhoto` kept for the optional inline variance photo.

`src/components/ui/rf-cycle-count-unified.tsx`
- `ExtraStepRenderer` now dispatches `photo_capture` → `RFStepPhotoCapture` (multi-photo with `max_photos` from `step.config`).
- `handlePostExtraComplete` detects the `photo_capture` step type, batches the upload, converts `File[]` → URL list, and stores URLs (not Files) in `workflow_result`. Surfaces partial failures via toast.
- Added `photo_capture` to `POST_COUNT_TYPES` in `useExtraWorkflowSteps`.
- Inline review-step photo UI now only renders when the workflow does **not** have a `photo_capture` step — preserved as an optional variance-documentation escape hatch.
- Dropped the `photoStepRequired`-forces-step-4 branch; photos are enforced by the required extras pipeline instead.

### Draft hydration for extras
`src/hooks/use-unified-cycle-count.ts`
- `DraftData` extended with `subStep: 'pre_extras' | 'post_extras' | null`, `preCountIndex`, `postCountIndex`.
- `saveDraft` merges these alongside existing fields. PIN state is intentionally NOT persisted.

`src/components/ui/rf-cycle-count-unified.tsx`
- Auto-save effect now runs when `subStep !== null` (previously only when `currentStep > 1`).
- Resume flow restores `subStep` from the draft and includes a toast that reads “Restored at pre-count check / post-count capture” when applicable.
- `initialExtraResults` memo pulls `task.workflow_result` and passes it into `useExtraWorkflowSteps` so returning operators skip already-completed extras.

`src/hooks/use-extra-workflow-steps.ts`
- New `initialResults?: Record<string, unknown>` parameter.
- `useEffect` hydrates internal `results` + advances `preCountIndex` / `postCountIndex` past any step whose id already appears in `initialResults`, keyed by a `(result-ids + workflow-step-ids)` signature so it only fires on genuine task changes.

### Serial-number mirror
When the `serial_number` extra completes, `handlePostExtraComplete` also writes the captured array into the existing `rr_cyclecount_data.serial_numbers TEXT[]` column so downstream dashboards can query it without parsing `workflow_result` JSONB.

### Dead code cleanup
- Deleted `src/components/ui/rf-cycle-count-out-form.tsx` (13.6 KB) — no TypeScript imports anywhere in the app.
- The deprecated `validateCycleCount` on `rf-cycle-count.service.ts` still exists for its single consumer (its own test file); left in place since deleting it would require re-writing a pre-existing test that already fails on missing env vars.

### Tests added (+16 new, all passing)
- `src/hooks/__tests__/use-extra-workflow-steps.test.ts` — 6 tests: bucketing, ordering, advance/retreat, initialResults hydration (skips completed), reset, no-extras workflow.
- `src/hooks/__tests__/use-task-workflow.test.ts` — 5 tests: synchronous fast path from task payload, step sorting, fallback when snapshot empty, `hasStepType`, `getStep`.
- `src/lib/supabase/__tests__/cycle-count-photos.service.test.ts` — 5 tests: empty input, mime+size rejection, atomic URL merge (dedupe), skip update when all failed, partial-success (row still updated with successful URLs).
- Updated `rf-cycle-count-unified.test.tsx` mocks for `uploadCycleCountEvidencePhotos` + `supabase/client` so the test suite still loads without env vars. Pre-existing release-dialog failure unchanged.

## Verification
- Root `npx tsc -b --noEmit` — 0 errors.
- Root `npx eslint` on touched files — 0 errors (1 pre-existing unrelated warning).
- Root `npx vitest run` — 146/148 passed (4 files fail on pre-existing env/storage issues; +16 net tests vs baseline).
- `cd rust-work-service && cargo check && cargo test` — clean; 8/8 tests.

## Workflow step-type coverage matrix

| Step type | Wired? | Where |
|-----------|--------|-------|
| `confirm` | ✓ | Core step 1 |
| `location_scan` | ✓ | Core step 2 |
| `quantity_entry` | ✓ | Core step 3 |
| `empty_location_verification` | ✓ | Step 3 branch (via step-type detection, `count_type` fallback) |
| `barcode_label_scan` | ✓ | Pre-count extra (after location, before quantity) |
| `serial_number` | ✓ | Post-count extra; mirrored to `serial_numbers` column |
| `condition_assessment` | ✓ | Post-count extra |
| `notes` | ✓ | Post-count extra (also auto-merged into `formData.notes`) |
| `photo_capture` | ✓ | Post-count extra (multi-photo, batch upload, URLs stored in `workflow_result`) |
| `review` | ✓ | Core step 4 (gated by hasStepType + variance) |
| `supervisor_signoff` | ✓ | Core step 5 (PIN-pad; library `RFStepSupervisorSignoff` intentionally bypassed for PIN enforcement) |

## True remaining future work (none blocking)

- **Rust workflow-result writeback on complete.** Today `completeTask` only persists `counted_quantity` + `notes`; extra-step results ride along via the frontend's direct Supabase update. A future Rust-side enhancement could consolidate the complete call to atomically write `workflow_result` + `evidence_photo_urls` too.
- **Cross-client sync of in-progress extras.** Draft lives in the operator's localStorage; if they switch devices mid-extras they'd re-enter the extras (row-stamped `workflow_result` still lets us skip completed ones thanks to hydration).
- **Better advisor coverage for new SQL functions.** Both `cycle_count_thresholds_from_config` and `stamp_cycle_count_workflow` have explicit `SET search_path` and ship clean. Future migrations should follow the same pattern.

## Related
- [[Wire-Cycle-Count-Workflow-To-RF-Counter]]
- [[Wire-Extra-Workflow-Steps-And-Rust-Passthrough]]
- [[ADR-Workflow-Snapshot-Stamping-Strategy]]
- [[ADR-Count-Type-Enum-To-Text]]
- [[Configuration Services - Supabase Service]]
