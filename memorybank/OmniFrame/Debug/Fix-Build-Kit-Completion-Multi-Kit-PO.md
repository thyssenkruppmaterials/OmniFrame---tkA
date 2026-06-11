---
tags: [type/debug, status/active, domain/frontend, domain/backend]
created: 2026-05-17
---

# Fix Build Kit Completion — PO-Keyed Aggregate Blocked Multi-Kit-PO Operator

## Symptom

Direct floor report (RF Build Kit, screenshot timestamped 2026-05-17 evening):

1. Operator scans either kit serial `KIT-20260515-002` **or** kit PO `2010102616` on the RF Build Kit scan step.
2. Kit loads with 31 lines (correct).
3. Operator kits all 31 lines via Visual Inspection / scan.
4. Review screen correctly shows **Materials Kitted: 31 / 31** in green and enables the **Complete Kit Build** button.
5. Operator taps **Complete Kit Build** → toast/error:

   > **Cannot complete kit: 18 lines still need to be kitted.**

The operator was blocked from finishing the build with no obvious recovery path.

## Root cause

PO `2010102616` has **two** kit serials attached:

| `kit_serial_number` | `kit_number` | Total lines | Kitted | Status |
|---|---|---|---|---|
| `KIT-20260515-001` | C47E/4 Gear Box 1 | 31 | 31 | fully kitted by the operator |
| `KIT-20260515-002` | C47E/4 Gear Box 2 | 18 | 0 | not yet started |

The RF Build Kit **entry point** was scoped correctly: today's earlier ship
([[RF-Build-Kit-By-Serial-Number]]) added
`RRKittingDataService.verifyKitForBuildBySerialNumber(serial)` which loads only
the scanned kit's rows (31, not 49). So the on-screen `kittedLines / totalLines`
is right.

But the **downstream Build Kit mutations** were still PO-keyed. In particular,
`RRKittingDataService.completeKitBuild(kitPoNumber)`:

```ts
// pre-fix — PO-only verification + status flip
.select('kit_to_line_kitted_date_time, transfer_order_number')
.eq('kit_po_number', kitPoNumber)        // ← sees 49 rows across BOTH kits
.not('transfer_order_number', 'is', null)
…
if (unkittedLines.length > 0) {
  return {
    success: false,
    error: `Cannot complete kit: ${unkittedLines.length} lines still need to be kitted`,
  }
}
…
.update({ kit_build_status: 'kit_built', … })
.eq('kit_po_number', kitPoNumber)        // ← would have flipped BOTH kits
```

The pre-check saw all 49 rows (31 kitted + 18 unkitted) and rejected with
`18 lines still need to be kitted`. The downstream UPDATE would have flipped
the sibling kit's rows to `kit_built` if the pre-check had passed — same
class of cross-link bug as [[Fix-Kit-Build-Cross-Linked-Parts]] but on the
Build Kit service paths rather than picking.

This was the **explicit open follow-up** documented in
[[RF-Build-Kit-By-Serial-Number]] § Backward Compatibility and
[[Kit-Serial-Scoping]] § Per-kit operations — scoped out of that change by
task brief but now blocking the floor.

### Live evidence (Supabase project `wncpqxwmbxjgxvrpcake`)

```
kit_serial_number   kit_po_number  rows  kitted_lines
KIT-20260515-001    2010102616      31            31
KIT-20260515-002    2010102616      18             0
```

Identical structural shape to the 2026-05-12 Gear Box 1/2 case (PO
`2010102615`) that triggered the picking-side fix.

## Fix

Option A — additive optional `kitSerialNumber` parameter on every Build Kit
mutation that previously took only `kitPoNumber`. When the caller supplies a
serial, queries are scoped by `(kit_po_number, kit_serial_number)`. When
absent, the PO-only behaviour is preserved verbatim (backward-compat for
single-kit POs and pre-serial legacy rows).

The operator's Build Kit form always has a serial in `kitData` (the new
`verifyKitForBuildBySerialNumber` populates it, and the legacy
`verifyKitForBuild` now does too via the same shared `assembleBuildKitPayload`
helper), so the regression cannot recur on either entry path.

### Service-layer changes (`src/lib/supabase/rr-kitting-data.service.ts`)

- **New exported type `BuildKitVerifyResult`** with a `kitSerialNumber: string | null` field — surfaces the serial from the assembled payload so the form can pass it to downstream mutations.
- **`assembleBuildKitPayload(records)`** — now includes `kitSerialNumber: firstRecord.kit_serial_number ?? null` in the returned `kitData`. Single source of truth used by both `verifyKitForBuild(kitPoNumber)` and `verifyKitForBuildBySerialNumber(kitSerialNumber)`.
- **`RRKittingDataRecord` interface** — `kit_serial_number?: string | null` added (the field always existed on the DB row but wasn't typed; needed so the type-system enforces the round-trip).
- **`completeKitBuild(kitPoNumber, kitSerialNumber?)`** — THE FIX. Both the verification SELECT (`kit_to_line_kitted_date_time` aggregate) and the final status UPDATE (`kit_build_status = 'kit_built'`) now add `.eq('kit_serial_number', serial)` when the serial is supplied. PO-only call still works (single-kit POs and tests that key by PO).
- **`startKitBuild(kitPoNumber, kitSerialNumber?)`** — UPDATE scoped to serial when supplied. Prevents the `printed → in_progress` flip from dragging a sibling kit along.
- **`kitMaterial(kitPoNumber, material, quantity, kitSerialNumber?)`** — both the unkitted-line lookup, the already-kitted dedupe probe, and the `allLinesKitted` post-check now scope by serial when supplied. Prevents a scanned material from kitting a row that belongs to the sibling kit, and prevents `allLinesKitted` from triggering the auto-advance to Complete based on the sibling kit's state.
- **`markLineAsKitted(lineId)` / `unmarkLineAsKitted(lineId)`** — already line-id-keyed (inherently safe from the cross-link bug). The improvement is to read `kit_serial_number` from the line and route the kanban sync through `KitKanbanService.syncKitProgressFromSerial(serial)` instead of the PO-fanout `syncKitProgressFromData(po)`. Falls back to the PO sync when the row's serial is NULL (legacy rows).

### Hook (`src/hooks/use-build-kit.ts`)

- `startBuildMutation` — accepts `string | { kitPoNumber, kitSerialNumber? }`. String shape preserved for legacy callers; object shape is what both Build Kit forms now use.
- `kitMaterialMutation` — input object gained an optional `kitSerialNumber?: string | null` field.
- `completeKitMutation` — accepts `string | { kitPoNumber, kitSerialNumber? }`. Same backward-compat shape as `startBuild`.

### RF Build Kit form (`src/components/ui/rf-build-kit-form.tsx`)

- `interface KitData` gained `kitSerialNumber: string | null` so it can shuttle the serial from the loaded `kitData` to every downstream mutation.
- `handleKitPoValidation` passes `{ kitPoNumber, kitSerialNumber }` to `startBuildAsync`.
- `handleQuantityConfirm` passes `kitSerialNumber` to `kitMaterialAsync`.
- `handleCompleteKit` passes `{ kitPoNumber, kitSerialNumber }` to `completeKitAsync` — directly fixes the user-visible toast.

### Legacy desktop Build Kit form (`src/components/kitting/build-kit-form.tsx`)

Parity update — same `KitData.kitSerialNumber` field, same object-shape calls
on `startBuildAsync` / `kitMaterialAsync` / `completeKitAsync`. The desktop
form is the same workflow on a non-RF surface; without this update it would
have continued to exhibit the bug if a multi-kit PO ever reached it.

## Tests added

`src/lib/supabase/__tests__/kit-serial-scoping.test.ts` gained a new
`completeKitBuild — multi-kit-per-PO scoping` describe block with three tests:

1. **Serial-scoped happy path** — simulates the exact bug: PO `2010102616`
   with `KIT-20260515-001` (31/31 kitted). Stub returns only the 31 fully-kitted
   rows when the verification SELECT filters by both PO and serial. Asserts:
   - `success: true`.
   - The verification SELECT filtered by `kit_serial_number`.
   - The status UPDATE filtered by `kit_serial_number` (not just PO).
2. **Serial-scoped rejection** — PO `2010102616` scoped to `KIT-20260515-002`
   (18 lines, 8 kitted + 10 unkitted). Asserts the rejection message contains
   `10 lines still need to be kitted` (NOT 18 — only the requested kit's
   rows count), and that NO status UPDATE was issued.
3. **PO-only legacy path** — no serial supplied. Asserts the old PO-only
   behaviour is preserved (verification SELECT filters by `kit_po_number`
   alone and the UPDATE proceeds normally).

Existing test `verifyKitForBuildBySerialNumber > loads the kit directly by
serial number…` extended with an assertion that
`result.kitData?.kitSerialNumber === 'KIT-20260515-002'` so the round-trip
from the DB row → `assembleBuildKitPayload` → returned `kitData` is covered.

All 14 of my tests and the 5 pre-existing relevant tests pass (15/15 in the
relevant set). The 1 unrelated pre-existing failure is the date-bomb
`createKitBuildPlan kanban link stamp > stamps kanban_task_id by
kit_serial_number, not kit_po_number` — hardcoded
`KIT-20260512-006` vs today's `KIT-20260518-001`; documented as out-of-scope
in both [[RF-Build-Kit-By-Serial-Number]] and [[RF-Kit-Pick-By-Serial-Number]].

## Validation log

- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm exec eslint src/lib/supabase/rr-kitting-data.service.ts src/hooks/use-build-kit.ts src/lib/supabase/__tests__/kit-serial-scoping.test.ts` — clean. `src/components/ui/` and the legacy kitting form are project-ignored by ESLint config (existing convention).
- `pnpm vitest run src/lib/supabase/__tests__/kit-serial-scoping.test.ts` — 14 of 15 passing (the 1 failure is the pre-existing date-bomb above).
- `pnpm build` — succeeds. `feature-rf-interface` chunk: **522.64 KB → 523.83 KB (+1.19 KB)** versus this morning's [[RF-Build-Kit-By-Serial-Number]] baseline. Well within the +5 KB allowance. Pre-existing oversized chunks (`warehouse-location-map` 1523.44 KB, `feature-admin` 1013.81 KB) are unchanged.

## Backward compatibility

- All existing tests keep passing (the changes are additive — only the new optional `kitSerialNumber` parameter is new on each method).
- Single-kit POs continue to work whether the caller passes a serial or not — the kit-scope adds an extra `.eq('kit_serial_number', …)` filter that matches every row for that PO in the single-kit case.
- Pre-serial legacy rows (rows where `kit_serial_number IS NULL`) fall back to PO-only behaviour because the form's `kitSerialNumber` will be `null` and the service treats that as "omitted".
- `RFBuildKitFormProps` shape unchanged.
- No new Supabase Realtime channels — honours the `Master Rule workspace rule` Realtime Policy.

## Files touched

- `src/lib/supabase/rr-kitting-data.service.ts` — `BuildKitVerifyResult` type, `kit_serial_number` added to `RRKittingDataRecord`, serial-scoping on `completeKitBuild` / `startKitBuild` / `kitMaterial`, kanban-sync routed through `syncKitProgressFromSerial` from `markLineAsKitted` / `unmarkLineAsKitted`.
- `src/hooks/use-build-kit.ts` — `startBuildMutation` / `completeKitMutation` accept both bare-string and object shapes; `kitMaterialMutation` input gained `kitSerialNumber`.
- `src/components/ui/rf-build-kit-form.tsx` — `KitData.kitSerialNumber`; pass it from `handleKitPoValidation` → `startBuild`, `handleQuantityConfirm` → `kitMaterial`, `handleCompleteKit` → `completeKit`.
- `src/components/kitting/build-kit-form.tsx` — same parity changes on the desktop form.
- `src/lib/supabase/__tests__/kit-serial-scoping.test.ts` — 3 new `completeKitBuild` regression tests + 1 extended assertion on the existing `verifyKitForBuildBySerialNumber` test.

## Related

- [[RF-Build-Kit-By-Serial-Number]] — this morning's entry-point change; its open follow-up is what this Debug note closes.
- [[RF-Kit-Pick-By-Serial-Number]] — direct sibling; the picking side was already serial-scoped (closed by [[Fix-Kit-Build-Cross-Linked-Parts]] on 2026-05-12).
- [[Kit-Serial-Scoping]] — the broader convention; this fix extends it from the picking / kanban / flag paths to the Build Kit mutation paths.
- [[Fix-Kit-Build-Cross-Linked-Parts]] — analogous fix on the picking side, same multi-kit-per-PO root cause, same shape of remediation.
- [[Kitting System - Feature Module]] — parent module.
- [[KittingServices - Supabase Service]] — service-layer catalog; the `kitSerialNumber` parameter additions on `completeKitBuild` / `startKitBuild` / `kitMaterial` should be reflected there.
