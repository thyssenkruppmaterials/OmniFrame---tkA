---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-04-19
---
# Found Part Transfer Workflow

## Purpose / Context
New count workflow that captures the operator moving a misplaced part from one location (A, source) into the task's location (B, destination) and records the new consolidated quantity at B. Registered as count type `found_part_transfer` with a dedicated workflow step type of the same name.

## Details

### Migration 222 — `222_add_found_part_transfer_workflow.sql`
- New columns on `rr_cyclecount_data`:
  - `transfer_source_location TEXT` — where the part was found (A).
  - `transfer_source_quantity NUMERIC(10,3)` — how many units were moved from A → the task's `location` (B).
- The existing `counted_quantity` stores the **final consolidated count at B** after transfer, so variance triggers / reporting / dashboards work unchanged.
- Partial index on `(organization_id, transfer_source_location) WHERE transfer_source_location IS NOT NULL` to accelerate "show all transfer counts" queries.
- Seeded default workflow config for every org:
  ```
  [ confirm, location_scan, found_part_transfer, notes ]
  ```
  where `location_scan` is the *destination* (task's location) and `found_part_transfer` is the new composite step.

### Rust work-service
- `CycleCountTask` struct gained `transfer_source_location: Option<String>` and `transfer_source_quantity: Option<f64>` (NUMERIC cast to float8 in SQL to match the existing pattern).
- All 9 `SELECT` clauses in `src/db/queries.rs` (plus the `cc.`-prefixed variant) updated.
- `cargo check` + `cargo test` — clean, 8/8.

### TypeScript / Supabase types
- `src/lib/work-service/types.ts` — new fields on `CycleCountTask`.
- `src/lib/supabase/database.types.ts` — same fields on Row/Insert/Update for `rr_cyclecount_data`.
- `src/hooks/use-pushed-work.ts` synthetic alert task + `rf-cycle-count-unified.test.tsx` mocks updated with defaults.

### Step type + metadata
- `WorkflowStepType` in `workflow-config.service.ts` gains `'found_part_transfer'`.
- `count-settings.tsx`:
  - New `STEP_TYPE_META.found_part_transfer` (MapPin icon, sky colour, singleton, data-capture step).
  - Added to `DATA_CAPTURE_STEPS` so it satisfies the "review requires a prior capture step" validation.
  - Validator now accepts `quantity_entry | empty_location_verification | part_number_verification | found_part_transfer` as the "at least one count/verify step" requirement.
- `use-count-type-options.ts` — `BUILT_IN_COUNT_TYPE_OPTIONS` gains a `Found Part Transfer` entry so the "+ New Workflow" picker surfaces it.

### RF step component
`src/components/ui/rf-steps/rf-step-found-part-transfer.tsx`

Four phases with a persistent "From→To" header card:

1. **`source_loc`** — scan or manually enter the source location (A). Rejects a same-location transfer (toast + stays on phase).
2. **`source_loc_manual`** — QWERTY overlay for typing when no barcode is available.
3. **`qty_moved`** — inline numeric keypad; enforces qty > 0.
4. **`final_count`** — inline keypad pre-filled to `system_quantity + sourceQty`. Blocks review when final < moved.
5. **`review`** — summary card (Part, From, Moved, To, Final Count) with a subtle warning banner when the operator's final count differs from `system + moved`. Confirm emits payload + `shouldComplete: true`.

Completion payload:
```
{
  sourceLocation, sourceLocationMethod: 'scan' | 'manual',
  sourceQuantity, destinationFinalQuantity, destinationLocation,
  recordedAt, shouldComplete: true,
}
```

### Extras pipeline integration
- `useExtraWorkflowSteps` — `'found_part_transfer'` added to `PRE_COUNT_TYPES`.
- `ExtraStepRenderer` — dispatches to `RFStepFoundPartTransfer`.
- `handlePreExtraComplete` in `rf-cycle-count-unified.tsx` handles the step:
  - Writes `transfer_source_location` + `transfer_source_quantity` to the task row.
  - Calls `completeTask(finalQty, mergedNotes)` with a concise marker appended to notes:
    `[Found Part Transfer] Moved <N> <UOM> from <A> → <B>; final count at destination: <Y>.`
  - Same short-circuit pattern as `part_number_verification` — the rest of the workflow is skipped because the step already has the final count.

### View-count dialog panel
`src/components/manual-counts-search.tsx` EditCountModal now renders a dedicated sky-coloured "Found Part Transfer" panel above Notes when `transfer_source_location` is set. Shows a `From → To` visual with qty moved (from) and final count (destination), using `ArrowRight` as the separator.

### Tests (+6 new, 13 passing in the transfer test file)
`rf-step-found-part-transfer.test.tsx`:
- Header renders material + destination.
- Rejects source == destination.
- Full happy path scan → qty → final count → review → complete, verifies uppercased source location + all payload fields including `sourceLocationMethod: 'scan'` and ISO `recordedAt`.
- Manual Entry opens QWERTY overlay with Confirm button + placeholder text.
- Review button is disabled when final count < moved qty.
- Record & Continue is disabled until moved qty > 0.

### Live DB verification
Inserted a test row with all transfer columns populated. Round-trip returned the exact values (material, destination, source, moved=3.000, final_count=8.000). Confirmed the partial index was created.

## Verification
- `npx tsc -b --noEmit` — 0 errors.
- `npx eslint` on all touched files — 0 errors.
- `npx vitest run` — **165/167 passed** (+6 new; same 2 pre-existing env/storage baseline failures).
- `cargo check && cargo test` — clean, 8/8.

## Operator walkthrough
Admin selects `Found Part Transfer` from the count type picker when creating a count (or uses the seeded workflow). Task has `material_number` + `location = B` + `system_quantity` = what's expected to be at B.

Operator on the RF:
1. Confirms the task.
2. Scans B (task location).
3. **Found Part Transfer step**:
   1. Scans or types location A where they found the part.
   2. Enters qty they moved.
   3. Confirms final count at B (pre-filled to `system + moved`).
   4. Reviews + confirms.
4. Task completes. Row now has:
   - `transfer_source_location = A`
   - `transfer_source_quantity = N`
   - `counted_quantity = final consolidated qty at B`
   - Notes marker documenting the move.

Dashboard: the EditCountModal shows a sky From→To panel; the Counted Qty + Part Check columns on the main grid stay correct (since `counted_quantity` is still the count at the task's location).

## Related
- [[Part-Number-Verification-Workflow-Step]]
- [[Wire-Extra-Workflow-Steps-And-Rust-Passthrough]]
- [[Configuration Services - Supabase Service]]


## 2026-04-19 — Bulk import support

### Headers (Manual Counts → Import from Clipboard)

**Required**
- `Material Number` (or `Part Number` / `material_number`)
- `Location` (= **destination B**; or `Storage Bin` / `Destination Location` / `location`)
- `System Quantity` (= what's expected at destination *before* transfer; or `Destination Qty` / `system_quantity`)

**Recommended for Found Part Transfer**
- `Count Type` = `found_part_transfer` (auto-defaulted to this when transfer columns are present and count_type is missing/`quantity_check`)
- `Source Location` (or `From Location` / `Transfer Source Location` / `Transfer From` / `transfer_source_location`) — location A
- `Qty Moved` (or `Quantity Moved` / `Transferred Quantity` / `Transfer Source Quantity` / `transfer_source_quantity`) — how many units moved A→B
- `Counted Quantity` (or `Final Qty At Destination` / `Final Destination Quantity` / `counted_quantity`) — the consolidated total at B *after* transfer (only set if you already know it; otherwise leave blank and the operator will capture it on the RF)

**Optional (any count type)**
- `Material Description`, `Warehouse`, `Unit of Measure`, `Batch Number`, `Notes`, `Counter Name`, `Count Date`, `Count Time`, `Count Number`, `Count Reason`

### Behavior
- Headers are **case-insensitive** and accept multiple aliases (friendly + raw column names).
- Tab-delimited (spreadsheet copy/paste) and comma-delimited (CSV) both auto-detected.
- If `transfer_source_location` or `transfer_source_quantity` is set but `count_type` is missing or `quantity_check`, the importer auto-promotes the row to `found_part_transfer`.
- The export CSV (`exportToCSV`) now also includes `Source Location` + `Qty Moved` columns so a round-trip is symmetric.

### Sample template (tab- or comma-delimited)

```
Material Number	Location	System Quantity	Count Type	Source Location	Qty Moved	Notes
KH11117	K4-04-08-2	5	found_part_transfer	R0-19-C-03	3	Found on incoming pallet
FW80780	K4-03-04-1	10	found_part_transfer	A1-02-01	7	
```

If `Counted Quantity` is included, the row is created already-counted (the operator only verifies); if omitted, the operator completes the transfer on the RF and the workflow records the final destination count.


## 2026-04-19 — v2: semantic flip (migration 223)

### Problem
v1 had the operator *capture* the source location on the RF. That was backwards. The admin knows both locations at task creation — the operator just executes the physical transfer.

### New data model
| Column | Meaning |
|---|---|
| `location` | **SOURCE (A)** — where the operator starts and picks |
| `transfer_destination_location` | **DESTINATION (B)** — where the operator delivers (admin sets this) |
| `system_quantity` | expected qty at A to transfer |
| `transfer_source_quantity` | **actual** qty picked by the operator |
| `counted_quantity` | final consolidated count at B after delivery |

### Migration 223
`supabase/migrations/223_fix_found_part_transfer_semantics.sql`
- `ALTER TABLE ... RENAME COLUMN transfer_source_location TO transfer_destination_location`.
- Updated the comment.
- Renamed `idx_rr_cyclecount_data_transfer_source` → `idx_rr_cyclecount_data_transfer_destination`.
- Rewrote the seeded `found_part_transfer` workflow config to relabel the `location_scan` step as "Source Location" (was "Destination Location").
- Safe because v1 hadn't been used in prod yet; no data migration needed.

### Rust + TS renames
- `CycleCountTask.transfer_destination_location: Option<String>` (was `transfer_source_location`). All 9 SELECT clauses (+ `cc.`-prefixed variant) renamed.
- `work-service/types.ts`, `database.types.ts`, `use-pushed-work.ts` synthetic task, and `use-task-workflow.test.ts` mock all renamed.

### Component rewrite
`src/components/ui/rf-steps/rf-step-found-part-transfer.tsx`

Seven-phase state machine driven by `taskData.location` (source) + `taskData.transfer_destination_location` (destination). Both locations are displayed in an always-visible "From → To" header card whose tiles subtly change border color as the operator progresses (primary = current phase, emerald = confirmed).

| Phase | What the operator does |
|---|---|
| `source_scan` | Sees source + part + expected qty; scans source barcode (or manual, or taps **Nothing Here** to short-circuit). Rejects mismatched scans with a toast. |
| `source_scan_manual` | QWERTY overlay to type the source barcode. |
| `pick_qty` | Inline keypad pre-filled to `system_quantity`; enters actual picked qty. Toasts a warning if > expected. |
| `dest_scan` | Sees destination; scans it (or manual). Rejects mismatched scans. |
| `dest_scan_manual` | QWERTY overlay for destination. |
| `final_count` | Inline keypad pre-filled to picked qty; operator enters TOTAL at destination after delivery. Blocks review if < picked. |
| `review` | Summary card (part / from / to / transferred / final). Confirm emits payload. |

A guard card blocks the operator entirely if `transfer_destination_location` isn't set on the row (with a supervisor-facing message).

### Completion payload (new shape)
```ts
{
  sourceLocation,          // = taskData.location (A)
  destinationLocation,     // = transfer_destination_location (B)
  pickedQuantity,          // actual qty moved from A
  destinationFinalQuantity,// final qty at B after consolidation
  sourceConfirmedAt, destinationConfirmedAt,
  shouldComplete: true,
  nothingFound?: true,     // only when the operator hit "Nothing Here"
}
```

### `handlePreExtraComplete` update
- Reads `sourceLocation` + `destinationLocation` from the payload (falls back to row values if missing).
- Writes only `transfer_source_quantity` (the picked qty) — the destination is already on the row.
- Writes a descriptive notes marker:
  - normal: `[Found Part Transfer] Picked N EA from A → delivered to B; final count at destination: Y.`
  - nothing found: `[Found Part Transfer] Nothing found at A; no parts moved to B.`

### View-count dialog
The transfer panel now renders when `transfer_destination_location` is set (was `transfer_source_location`). "Pick From (source)" shows `location` + picked qty; "Deliver To (destination)" shows `transfer_destination_location` + final count.

### Bulk importer
Header aliases updated to match the new semantic:
- `Location` / `Source Location` / `From Location` / `Pick From` → `location` (source A)
- `Destination Location` / `To Location` / `Deliver To` / `Transfer Destination Location` → `transfer_destination_location` (destination B)
- `Qty Picked` / `Qty Moved` / `Quantity Picked` / etc. → `transfer_source_quantity`
- `Counted Quantity` / `Final Qty At Destination` / etc. → `counted_quantity`

Export CSV columns now read `Destination Location` + `Qty Picked`.

### Tests (7 passing)
- Shows source + destination + part up front.
- Blocker card when destination missing.
- Rejects source scan that doesn't match task location.
- Full happy path with correct payload (case-insensitive scans, picked = system default, final = 12 after manual adjustment).
- **Nothing Here** short-circuit emits `nothingFound: true`.
- Review button disabled when final < picked.
- Manual entry overlay opens for both source and destination.

### Verification
- `npx tsc -b --noEmit` — 0 errors.
- `npx eslint` on touched files — 0 errors.
- `npx vitest run` — **166/168 passing** (+7 new; same 2 pre-existing env/storage baseline failures).
- `cargo check && cargo test` — 8/8.
- Live DB round-trip confirms source + destination + expected qty all persist.

### Operator walkthrough (final)
Task card shows: **Part · From A · To B · System qty at A**.

1. Confirm task.
2. Scan source A (`location_scan` step — standard).
3. **Found Part Transfer step**:
   1. Scan source A again to arrive (guards against wrong-location picks) — or tap *Nothing Here*.
   2. Keypad for picked qty (pre-filled to system qty).
   3. Scan destination B to confirm arrival.
   4. Keypad for final count at B (pre-filled to picked qty; adjust up if B already had units).
   5. Review summary → Confirm.
4. Task completes with `transfer_source_quantity` = picked, `counted_quantity` = final, notes marker auto-appended.


## 2026-04-19 — v3 hotfix: taskData projection stripped the destination

### Symptom
Operators saw "No destination configured" on every Found Part Transfer task — even when the row actually had `transfer_destination_location` populated.

### Root cause
`ExtraStepRenderer` in `rf-cycle-count-unified.tsx` projected the full `CycleCountTask` onto a narrow `taskData` object before passing it to `RFStepFoundPartTransfer`. The projection listed 10 fields but missed the two new Found Part Transfer columns. The step saw `transfer_destination_location` as `undefined` and fell through to the guard.

### Fix
- `StepProps.taskData` in `src/components/ui/rf-steps/types.ts` now declares `transfer_destination_location?: string | null` and `transfer_source_quantity?: number | null` so TypeScript surfaces the omission and the step can read the fields cleanly (no more `as unknown as` casts).
- `ExtraStepRenderer.taskData` projection now forwards both fields from `task` — the Rust work-service already includes them per migration 223.
- `RFStepFoundPartTransfer` reads `taskData.transfer_destination_location ?? ''` directly.
- Guard card now shows:
  - The specific task number + source location.
  - A diagnostic line that distinguishes "destination not set on the row" (field present in payload, value null) from "work-service payload doesn't carry the field" (field missing entirely — points at a Rust redeploy need).

### Deployment note
Because the Rust work-service owns the SELECTs that populate `CycleCountTask`, **both sides must be deployed together**:
- Migration 223 applied (database: renames `transfer_source_location → transfer_destination_location`).
- Rust work-service rebuilt + deployed (models.rs + queries.rs updated).
- Frontend rebuilt + deployed (this fix).

If the Rust service is behind the database, SELECTs will error (referring to the old column name). If the frontend is behind Rust, this projection fix is what surfaces the destination properly.

### Verification
- `npx tsc -b --noEmit` — 0 errors.
- 7/7 step tests pass; 166/168 full suite (same baseline 2 pre-existing failures).
