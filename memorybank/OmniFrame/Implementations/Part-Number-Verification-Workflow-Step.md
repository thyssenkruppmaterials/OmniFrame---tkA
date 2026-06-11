---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-04-19
---
# Part Number Verification Workflow Step

## Purpose / Context
New workflow step `part_number_verification` lets the RF operator verify that the material at a location matches the expected `material_number`. Captures scanned (or manually-typed) part numbers and auto-detects **part variance** (mismatch) distinct from quantity variance. Also supports "location empty" short-circuit when there's no barcode to scan.

## Details

### Migration 219 — `219_add_part_verification_columns.sql`
Applied live to project `wncpqxwmbxjgxvrpcake`.

- `scanned_material_number TEXT` — what the operator scanned / typed.
- `location_reported_empty BOOLEAN DEFAULT FALSE` — distinct from zero-quantity counts ("no barcode found" vs "counted zero units").
- `part_variance BOOLEAN GENERATED ALWAYS AS (...) STORED` — auto-derived: `scanned IS NOT NULL AND scanned <> '' AND scanned <> material_number`. Zero app responsibility to maintain.
- Partial index `idx_rr_cyclecount_data_part_variance ON (organization_id, part_variance) WHERE part_variance = TRUE` for dashboard perf.

Live-verified via test inserts: generated column returns `false` when scanned equals expected, `true` when different.

### Rust work-service
- `CycleCountTask` struct + all 9 SELECT clauses (plus the `cc.`-prefixed variant) now include `scanned_material_number`, `location_reported_empty`, `part_variance`.
- `cargo check` + 8/8 `cargo test` clean.

### Frontend types
- `src/lib/work-service/types.ts` — mirrored fields on `CycleCountTask`.
- `src/lib/supabase/database.types.ts` — added to Row/Insert/Update (generated `part_variance` is Row-only, not writable).

### New step type
- `src/lib/supabase/workflow-config.service.ts` — `WorkflowStepType` union gains `'part_number_verification'`.
- `src/components/count-settings.tsx` — `STEP_TYPE_META.part_number_verification` (fuchsia color, Barcode icon, singleton). Added to `DATA_CAPTURE_STEPS` so it satisfies the "review requires a data-capture step before it" validation.
- Validation now accepts `quantity_entry`, `empty_location_verification`, **or** `part_number_verification` as the minimum "count or verify" step.

### RFStepPartNumberVerification component
`src/components/ui/rf-steps/rf-step-part-number-verification.tsx`

Four phases:
1. **`scan`** — `ScannerInput` (auto-focused) + two action buttons:
   - **Manual Entry** → switches to phase `manual`.
   - **Location Empty** → switches to phase `empty`.
2. **`manual`** — `QWERTYKeyboard` overlay (same component used by GRS flows). Cancel returns to `scan`; Verify promotes to `verified`.
3. **`verified`** — case-insensitive comparison against `taskData.material_number`; green "Part Matches ✓" or red "Part Variance" banner + expected/found/method breakdown. Re-scan button returns to phase `scan`.
4. **`empty`** — amber confirmation card; Continue emits `shouldComplete: true` so the parent short-circuits.

Completion payload shapes (documented in-file):
- Scan/manual:  `{ scannedMaterial, expectedMaterial, match, method, verifiedAt }`.
- Empty:        `{ locationEmpty: true, scannedMaterial: null, match: null, reportedAt, shouldComplete: true }`.

### Extras pipeline wiring
- `useExtraWorkflowSteps` — `part_number_verification` added to `PRE_COUNT_TYPES`, alongside `barcode_label_scan`. Runs between Location (step 2) and Quantity (step 3).
- `ExtraStepRenderer` — dispatches to `RFStepPartNumberVerification`.
- `handlePreExtraComplete` in `rf-cycle-count-unified.tsx`:
  - For `part_number_verification`, persists `scanned_material_number` + `location_reported_empty` directly to Supabase (triggers the generated `part_variance` column).
  - Merges variance marker (`[Part Variance] Expected X, found Y`) into `formData.notes` so completion notes record the event.
  - On `shouldComplete`: appends `[Location Reported Empty]` note, calls `completeTask(0, notes)` + `handleTaskComplete()` — mirrors the legacy `empty_location_verification` short-circuit.

### Manual Counts dashboard
`src/components/manual-counts-search.tsx`

- New **Part Check** column between Variance and Status.
- `<PartCheckBadge>` component renders:
  - **Match** (green `CheckCircle`).
  - **Part Variance** (red `AlertTriangle` + "Expected X → Found Y").
  - **Location Empty** (amber `Archive`).
  - **— not verified** (neutral) as the default state.
- Column filter: Select with options `all / match / variance / empty / unverified`. Wired into `columnFilteredData` filter logic.
- `ManualCountsColumnFilters.partCheck` added with stable 'all' default.

### Tests (+7 new)
`src/components/ui/rf-steps/__tests__/rf-step-part-number-verification.test.tsx`:
1. Renders expected part + location.
2. Match path emits `{ match: true, method: 'scan' }`.
3. Variance path emits `{ match: false }` + shows "Part Variance" + red-styled Continue button.
4. Manual Entry button opens QWERTY overlay; Verify disabled when empty.
5. Location Empty button short-circuits with `{ locationEmpty: true, shouldComplete: true }`.
6. Case-insensitive matching (`part-abc-123` == `PART-ABC-123`).
7. Continue disabled in initial scan phase.

## Verification
- `npx tsc -b --noEmit` — 0 errors.
- `npx eslint` on touched files — 0 errors (only pre-existing `any` warnings).
- `npx vitest run` — 153/155 passed (7 new; same 2 pre-existing env/storage failures as baseline).
- `cargo check` + `cargo test` — clean; 8/8 tests.
- Live SQL insert tests confirm generated `part_variance` column computes correctly for both match and mismatch cases.

## Operator flow (admin-configurable)
Admin edits a workflow in Count Settings (e.g. the `part_verification` count type) and adds a **Part Number Verification** step:

```
1. Confirm
2. Location Scan
3. Part Number Verification  ← new
4. Quantity Entry (optional — skipped when location_empty)
5. Review (optional)
```

Operator workflow on the RF:
1. Confirms the task.
2. Scans location.
3. **Scans the part barcode at the location** → system compares to expected.
   - **Match** → green banner, continue.
   - **Mismatch** → red "Part Variance" banner, operator presses "Continue (Variance)" to proceed; count row gets flagged.
   - **No barcode** → tap "Manual Entry" to key the part in via QWERTY.
   - **Nothing in location** → tap "Location Empty" → task completes with empty marker.
4. Completes remaining configured steps.

Dashboard reflects part_variance instantly (generated column, no app write needed beyond populating `scanned_material_number`).

## Related
- [[Close-Out-RF-Workflow-Future-Work]]
- [[Wire-Extra-Workflow-Steps-And-Rust-Passthrough]]
- [[Wire-Cycle-Count-Workflow-To-RF-Counter]]
- [[Configuration Services - Supabase Service]]


## 2026-04-19 — v2 refinements

### Fix: stacked step layout
The original rendering guarded only steps 3 and 4 with `subStep === null`. Steps 1, 2, and 5 would still render alongside extras, causing the "Scan Part In Location" card to appear below a still-rendered "Scan Location" card (visible in the bug screenshot). Added `subStep === null &&` to those three step blocks — clean navigation through the flow now.

### Design change: part verification now short-circuits
All three outcomes (match / variance / empty) complete the task immediately. Quantity entry is no longer a separate step — it's captured per-found-part inside the verification step itself. Matches the user's intent: "It only needs the quantity of the part if it doesn't belong in that location."

Resulting `handlePreExtraComplete` now:
- Writes `scanned_material_number`, `location_reported_empty`, and `scanned_parts` (JSONB).
- Picks `counted_quantity` for completion: `0` (empty), `system_quantity` (match), or sum of scanned entries that equal the expected material (variance, almost always `0`).
- Appends a concise `[Part Variance] Expected X — found: W×3, V×7` marker to notes and calls `completeTask` + `handleTaskComplete`.

### Multi-part capture
Migration 220 adds `scanned_parts JSONB NOT NULL DEFAULT '[]'::jsonb` with a CHECK constraint (`jsonb_typeof = 'array'`). Each entry: `{ part_number, quantity, method: 'scan'|'manual', captured_at }`.

Verified live:
- Multi-part inserts persist cleanly.
- CHECK constraint rejects non-array writes.
- `part_variance` generated column still flips true based on `scanned_material_number`.

Rust work-service struct gained `scanned_parts: serde_json::Value` and all 9 SELECTs now `COALESCE(scanned_parts, '[]'::jsonb)`. TS mirror exports `ScannedPart` from `@/lib/work-service/types`.

### New operator flow (variance path)
1. Scan wrong part → "Wrong Part at Location" card with an inline numeric keypad.
2. Enter qty → "Record This Part" appends to the found-parts list.
3. Either press **Add Another Part** to keep scanning or **Complete with Variance (N)** to finalize.
4. Each wrong part can be removed from the list before finalizing (trash button).

### Dashboard simplification
Dropped the "Expected X → Found Y" subtitle. Now shows just the found part number (primary scan). When more than one distinct part was captured, appends " +N more".

### Tests (+3 new multi-part paths)
- `rf-step-part-number-verification.test.tsx` now covers: match auto-complete (no qty keypad), single-part variance with keypad, **multi-part variance with two different parts + quantities**, **remove-part-from-list**, disable-Record-until-positive-qty, Location Empty disabled after captures, manual entry overlay.
- 10/10 pass. Full suite 156/158 (same 2 pre-existing failures as baseline).

### Verification
- `cargo check` + `cargo test` — 8/8.
- `npx tsc -b --noEmit` — 0 errors.
- `npx eslint` on touched files — 0 errors (only pre-existing `any` warnings).
- Live DB tests confirm: multi-part JSONB persists, CHECK constraint enforces array-only writes, generated `part_variance` still fires correctly.

### Related
- [[Close-Out-RF-Workflow-Future-Work]]
- [[Wire-Extra-Workflow-Steps-And-Rust-Passthrough]]
- [[Configuration Services - Supabase Service]]


## 2026-04-19 — v3: "Find Another Part" from match phase

### Change
Operators on the green "Part Matches" card can now also capture additional parts at the same location (e.g. the expected part *is* there, but so are extras). Previously the match path was terminal — tap Complete Count and you're done.

### UX additions
- **Find Another Part** button on the Part Matches card, placed right below *Re-scan Part*.
- Clicking it routes to the qty-capture phase with the matched value preserved and the qty keypad pre-filled to `taskData.system_quantity` (the operator can adjust before recording).
- Qty capture card header now adapts to the scanned value: green "Expected Part Found" when the current working part matches, red "Wrong Part at Location" otherwise.
- List/review card adapts too: green "N parts recorded" when everything captured equals the expected material, red "Part Variance · N parts found" when any entry is wrong.
- Footer button reads *Complete Count (N)* for all-match lists, *Complete with Variance (N)* when any wrong part is captured.
- Each captured entry gets an `EXPECTED` chip in the list when it matches the target, so operators can at-a-glance distinguish right vs wrong.

### Logic
`acceptCapture` routes differently based on state:
- First capture + value matches expected → phase `match` (single-shot happy path, no qty).
- First capture + mismatch → phase `qty` (capture quantity of the wrong part).
- Already in multi-part mode (`foundParts.length > 0`) → phase `qty` regardless of match/mismatch (because we need qty for everything when multiple parts are involved).

`handleContinue` now computes the final `match` boolean from the full `foundParts` array: `match = true` only when **every** entry equals the expected material. So "matched + 1 extra" ends as `match=false`, which is the correct semantic for the dashboard.

### Phase rename (internal)
Renamed `variance_qty` → `qty` and `variance_list` → `list` since they're now used for both match and mismatch entries. No user-facing effect beyond copy updates on the cards.

### Tests (+3 new, 13 total)
- Find Another Part button is visible on the match card.
- Match + wrong extra → `match=false` + 2 entries in `scannedParts` (first is expected, second is wrong).
- All-match multi-entry (operator captures two matching entries) → `match=true` + "N parts recorded" header + "Complete Count (N)" footer.
- Previous coverage (variance paths, removal, location empty, manual entry, disabled states) all preserved and passing.

### Verification
- `npx tsc -b --noEmit` — 0 errors.
- `npx eslint` — 0 errors.
- `npx vitest run` — **159/161 passed** (+3 new tests; same 2 pre-existing env/storage failures).
- `cargo check` + `cargo test` — 8/8 (no Rust changes this pass).

### Related
- [[Part-Number-Verification-Workflow-Step]]
- [[Close-Out-RF-Workflow-Future-Work]]
- [[Wire-Extra-Workflow-Steps-And-Rust-Passthrough]]
