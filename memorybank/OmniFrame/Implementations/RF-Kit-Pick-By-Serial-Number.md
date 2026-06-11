---
tags: [type/implementation, status/active, domain/frontend, domain/backend]
created: 2026-05-17
---

# RF Kit Pick by Serial Number — Bypass the Select-a-Kit Screen

## Purpose / Context

Before this change, the RF Kit Picking entry step accepted only a
`kit_po_number`. Whenever the scanned PO covered more than one active
kit (the canonical case: PO `2010102616` → KIT-20260515-001 +
KIT-20260515-002 for Build 854421), the operator landed on the
`kit_select` disambiguation step shipped on 2026-05-12 with
[[Fix-Kit-Build-Cross-Linked-Parts]] and [[Kit-Serial-Scoping]]. That
extra screen was the explicit-correctness fix for the cross-link bug,
but on the floor it adds a click on every multi-kit PO.

The `kit_serial_number` is the **globally unique PK** on
`RR_Kitting_DATA` (format `KIT-YYYYMMDD-NNN`) — so making the scan
input accept a serial directly lets the operator skip the picker on
every multi-kit PO without giving up the correctness gains. The legacy
PO scan path is preserved verbatim (with the same multi-kit picker)
for backward compatibility with PO-labelled prints already on the
floor.

## Behaviour Change

| Scenario | Before | After |
|---|---|---|
| Scan a `KIT-…` serial (new printed label) | Did not work — service queried by `kit_po_number` only, returned `Kit PO … not found`. | Drops the operator straight into `pick_type`. Never sees the Select-a-Kit screen. |
| Scan a PO that covers ONE kit | Auto-resolved → `pick_type`. | Unchanged. |
| Scan a PO that covers MULTIPLE kits (legacy) | Showed the `kit_select` picker → tap kit → `pick_type`. | Unchanged. |
| Scan a Kit serial in the regular RF Picking (delivery) screen | The auto-detect inside `rf-picking-form.tsx` called `verifyKitForPicking(serial)`, which queried by PO and returned no match, so the smart-detect failed and fell through to delivery validation. | Auto-detect now probes the serial path first; valid serials hand off to the Kit Picking form just like PO scans. |
| Reprint a Kit Build Sheet | QR code encoded the `kit_po_number`. | QR code encodes the `kit_serial_number`. The PO stays visible in the big text header for SAP processes. The kit serial is also rendered as a small mono caption beneath the PO for human readability. Falls back to the PO if the kit has no serial (legacy / pre-`createKitBuildPlan` rows). |

## Files Touched

### `src/lib/supabase/rf-kitting-picking.service.ts`

- **Refactor.** Extracted the existing "fetch all rows for a serial → Black-Hat probe → user-name lookup → assemble `KittingPickData`" body of `verifyKitForPicking` into a private helper `loadKitPayloadBySerial(resolvedSerial)`. Single source of truth so the PO path and the new serial path behave identically once a serial is resolved (Black-Hat gate, status sanity check, floor / rack split, user-name decoration).
- **New public method** `verifyKitForPickingBySerialNumber(kitSerialNumber)`. Direct PK lookup — skips the PO-meta disambiguation pre-flight, never returns a `kits[]` picker payload. Returns the same `VerifyKitForPickingResult` shape so callers stay symmetric with the PO path.
- **New exported helper** `isPotentialKitSerialNumber(input)`. Case-insensitive `KIT-` prefix check. Deliberately requires the hyphen to keep legacy `KIT12345`-style PO labels routing through `isPotentialKitPoNumber`.
- **Generalised** the validator formerly named only-for-PO: `validateKitPoNumber(kitIdentifier)` now accepts either shape and surfaces a neutral error message (`Kit serial number or PO …`). Function name retained for backward compatibility with the two existing callers.
- **Preserved verbatim:** the `verifyKitForPicking(kitPoNumber, kitSerialNumber?)` signature, the disambiguation logic, the Black-Hat probe order (`kit_build_flags.kit_serial_number` first → legacy PO-scoped flags as fallback), and the legacy `kit_flag_type === 'black'` fallback inside the catch block.

### `src/components/ui/rf-kitting-picking-form.tsx`

- **Smart-detect at scan time** inside `handleKitPoValidation`. If the scanned value passes `isPotentialKitSerialNumber`, route to the new serial path (`runSerialPathValidation`); otherwise route to the legacy PO path (`runPoPathValidation`). Both paths land at `pick_type`; only the PO path can land at `kit_select`.
- **Scan-step copy:** heading renamed `Scan Kit Serial Number`, helper text now explains both shapes (`Scan the kit serial number (KIT-…) to drop straight into picking. Legacy Kit PO numbers are still accepted.`), placeholder updated to `Scan KIT-YYYYMMDD-NNN or Kit PO`, label updated to `Kit Serial Number or PO`.
- **`initialKitPoNumber` prop kept** for backward compatibility with the existing handoff from `rf-picking-form.tsx` and `rf-interface.tsx` (`kittingPickingKitPo` state). Doc-comment clarifies the prop now accepts either identifier.
- The `kit_select` disambiguation step (Layers icon, kit-cards list, progress-per-option, Cancel/Re-scan button) is **unchanged**. It still only renders on the PO fallback path when `kits.length > 1`.

### `src/components/ui/rf-picking-form.tsx` (delivery scan)

- Imports `isPotentialKitSerialNumber` and runs it BEFORE `isPotentialKitPoNumber`. If the scanned value is a serial, calls `verifyKitForPickingBySerialNumber` (direct PK lookup, no `kits[]`) and hands off to Kit Picking on a `data && !error` result. PO-shaped scans still go through the existing `verifyKitForPicking(deliveryNumber)` probe (which returns `data` for single-kit POs and `kits[]` for multi-kit POs — both confirm the input is a kit).
- Toast and log messages neutralised from "Kit PO Number" → "Kit identifier".

### `src/components/kitting/kit-build-sheet.tsx`

- The `QRCode.toDataURL(...)` call now encodes `details.kitSerialNumber || details.kitPoNumber` (defensive fallback for legacy rows without a serial). The kit PO number stays as the big text header. A small `font-mono text-xs text-gray-600` caption beneath the PO surfaces the serial in human-readable form so floor staff can cross-check the QR target without scanning it. Alt text on the `<img>` updated accordingly.

### `src/lib/supabase/__tests__/kit-serial-scoping.test.ts`

- Three new tests under the existing supabase-stub harness:
  - `verifyKitForPickingBySerialNumber > loads the kit directly by serial number without any PO meta lookup` — verifies the single RR_Kitting_DATA select is keyed on `kit_serial_number`, never on `kit_po_number`.
  - `… > returns an error (not a kits[] picker) when the serial is unknown` — guards against accidentally surfacing the disambiguation list on the serial path.
  - `… > trims whitespace and rejects empty input gracefully` — input-validation guardrail.
- Pre-existing 5 tests (multi-kit disambiguation × 2, addFlagBySerialNumber × 2, syncKitProgressFromSerial × 1) all still pass under the refactored service.

## Smart-Detect Rationale

The simplest reliable cue for a `kit_serial_number` is its canonical `KIT-` prefix. Per [[Kit-Serial-Scoping]], serials are generated by `RRKittingDataService.generateKitSerialNumber` in the format `KIT-YYYYMMDD-NNN`. A `startsWith('KIT-')` check (case-insensitive, post-trim) is unambiguous against:

- SAP PO numbers (10-digit numeric, e.g. `2010102616` or `45XXXXXXXX`).
- Delivery numbers (8–12 pure digits).
- Legacy PO-prefixed labels like `KIT12345` — these lack the hyphen and continue to route through `isPotentialKitPoNumber`, which intentionally matches both `KIT-` and bare `KIT` prefixes.

No false positives in the legacy data because every other kit-related identifier in the system is either purely numeric or uses different prefix conventions.

## Backward Compatibility

- The public `verifyKitForPicking(kitPoNumber, kitSerialNumber?)` signature and behaviour are unchanged. All existing callers (`rf-kitting-picking-form.tsx` × 5 callsites for PO-with-serial-after-picker, `rf-picking-form.tsx` for the kit-detect probe, and the regression test file) continue to work.
- `validateKitPoNumber` keeps the same name and signature; only the error message text changed. The two callers (`rf-kitting-picking-form.tsx` and self-reference inside the service) pick up the neutral copy automatically.
- The kit-serial disambiguation `kit_select` step is left in place verbatim so any in-flight legacy PO scan still resolves correctly. The improvement is additive: serial scans BYPASS it, PO scans BEHAVE EXACTLY AS BEFORE.
- Kit Build Sheet falls back to the PO in the QR if `kitSerialNumber` is empty (defensive — every kit created by `createKitBuildPlan` has a serial, but the codepath gracefully handles any historical row).

## Validation

- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm exec eslint src/lib/supabase/rf-kitting-picking.service.ts src/components/kitting/kit-build-sheet.tsx` — clean. `src/components/ui/` is project-ignored by ESLint config (existing convention).
- `pnpm vitest run src/lib/supabase/__tests__/kit-serial-scoping.test.ts` — 8 of 9 passing. The one failure (`createKitBuildPlan kanban link stamp > stamps kanban_task_id by kit_serial_number, not kit_po_number`) is a **pre-existing date-bomb** — the test hardcoded `KIT-20260512-006` but `generateKitSerialNumber()` derives the serial from `new Date()` so today (2026-05-17) it returns `KIT-20260517-001`. Independently reproducible by running the test on `git stash`'d main with no kitting changes; the same failure mode triggers. Out of scope for this UX work; fix is a one-line dynamic prefix in the test.
- `pnpm build` — succeeds. Bundle budget delta: `feature-rf-interface` chunk went from **503.53 KB → 505.04 KB** (+1.51 KB), `Total JS` from **10163.45 KB → 10165.15 KB** (+1.70 KB). Both budgets were already over the limit before this change (per-chunk 500 KB / total 7500 KB); the existing oversized chunks (`warehouse-location-map` at 1487.74 KB and `feature-admin` at 990.05 KB) are pre-flagged out of scope by the user's task brief, and `feature-rf-interface` was at 503.53 KB on the baseline. Verified via a `git stash` of the four touched source files + clean rebuild.

## Edge Cases

- **Operator scans a serial that doesn't exist.** Service returns `data: null, error: 'Kit serial KIT-XXX not found'`. UI toast surfaces the error message; the operator stays on the scan step.
- **Operator scans a Black-Hat-blocked kit by serial.** `loadKitPayloadBySerial` runs the same Black-Hat probe as the PO path (per-serial flag → legacy PO-scoped fallback). The error path is identical: `Kit … is blocked from picking — missing BOM materials. … Resolve the Black Hat flag before picking.`
- **Operator scans a serial that maps to a non-pickable status (e.g. `inspecting`).** Same status sanity check — `Kit … is not ready for picking. Current status: …`.
- **Concurrent prints of the same kit.** Each print uses the same `kit_serial_number`, so the QR code is stable across reprints. No print-time mutation.
- **Kit serial with whitespace from the scanner.** Trimmed in `verifyKitForPickingBySerialNumber` before the DB read.
- **Kit with no serial number yet** (pre-`createKitBuildPlan` legacy rows). Kit Build Sheet QR falls back to the PO. The new serial-scan path simply returns `not found` for such kits — the operator can still scan the PO instead.

## Related

- [[Kitting System - Feature Module]] — the parent module.
- [[RF Interface - Feature Module]] — where `RFKittingPickingForm` lives.
- [[KittingServices - Supabase Service]] — service-layer surface (the new `verifyKitForPickingBySerialNumber` should be added to that catalog).
- [[Kit-Serial-Scoping]] — the per-kit-serial convention this builds on top of; the `kit_select` disambiguation step it bypasses ships in the same wave.
- [[Fix-Kit-Build-Cross-Linked-Parts]] — the 2026-05-12 cross-link fix that made serial-keyed lookups safe across sibling kits.
- [[Authorized-Ship-Short-Negates-Black-Hat]] — same-day-yesterday work on the matcher that the Black-Hat probe inside this flow respects.
- [[Edit-Ship-Short-Post-Creation-Flow]] — sibling work; different surface (Kitting Data Manager audit-trail dialog), different service path.
