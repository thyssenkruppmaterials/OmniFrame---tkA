---
tags: [type/implementation, status/active, domain/frontend, domain/backend]
created: 2026-05-12
---
# Authorized to Ship Short Negates Black Hat Auto-Flag

## Purpose / Context

When a kit was created via `Add to Kit Build Plan` and one of the BOM components had no matching imported TO row (i.e., the part is missing from the kit), the system auto-flagged the kit as **Black Hat** and `RFKittingPickingService.verifyKitForPicking` blocked picking with:

> Kit XXX is blocked from picking — missing BOM materials. (Auto-flagged: Missing BOM components — ...) Resolve the Black Hat flag before picking.

The **`Authorized to Ship Short`** list on the same dialog is the operator's contract that the kit is *intentionally allowed* to leave the floor without those parts (deviation, expedite-in-flight, customer concession, etc.). Prior to this change the BOM-coverage logic ignored ship-short entries, so the operator had to manually clear the Black Hat after creating the kit, defeating the point of the explicit authorization.

## Behaviour after fix

A part number listed in **Authorized to Ship Short** is now treated as a covering source for the matching BOM line:

- BOM `material` rows match if the primary `materialNumber` OR any `deviation.substituteMaterialNumber` equals one of the ship-short `partNumber` entries (case-insensitive, trimmed).
- BOM `incora_component` rows match either via INCORA reference, imported TO, OR ship-short part number.
- BOM `incora_sub_kit` rows are **not** covered by ship-short — those rows have no material number, only an `incoraReference`. To bypass coverage on a sub-kit, list the INCORA reference under `INCORA Items`.
- `coverageMode === 'informational'` rows are still always treated as covered.

When *all* otherwise-missing rows are covered by ship-short, `bomCoverage.isComplete === true` and `createKitBuildPlan` skips the auto-`addFlag('black', ...)` call. When some are still genuinely missing, the Black Hat fires only with the still-unmatched items in its note.

## Files Touched

### `src/components/ui/add-kit-build-plan-dialog.tsx`

- `BomCoverageResult` type extended with `matchedViaShipShort: BomComponent[]` so the UI can render a distinct amber `Ship Short` badge alongside the existing green `Covered` / red `Missing` states.
- The `bomCoverage` `useMemo` now builds a `shipShortPartNumbers` Set from `formData.authorizedShipShortItems` and folds it into the per-row matching logic for `material` and `incora_component` types.
- BOM Pick List row colouring: green when matched via TO/INCORA, amber when matched only via ship-short, red when truly unmatched.
- Coverage summary banner now triggers when **any** of `importedTOs`, `incoraItems`, or `authorizedShipShortItems` are populated (previously only the first two), and adds a parenthetical `(N authorized to ship short)` annotation to the green "All required BOM components covered" message when relevant.
- `Authorized to Ship Short` `FieldDescription` updated to call out the BOM-coverage interaction so operators understand the side-effect.

### `src/lib/supabase/rr-kitting-data.service.ts`

- `recheckBomCoverage` now `select`s `authorized_ship_short_items` alongside `material` and `incora_items` from `RR_Kitting_DATA`, builds `shipShortPartNumbers` from the first row, and applies the same coverage logic as the dialog. This is the path that runs after `appendTOsToKit` (and any future re-evaluation hook), so the auto-clear behaviour at the end (`clearFlagByType(kitPoNumber, 'black')` when `unmatched.length === 0`) now also kicks in when ship-short alone is what tips the kit into full coverage.

The two auto-flag callsites in `createKitBuildPlan` (with-TOs and without-TOs branches) didn't need changes — they already key off `input.bomCoverage.unmatched`, which the dialog now computes correctly.

## Data Model Notes

- `authorized_ship_short_items` lives as JSONB on **every** `RR_Kitting_DATA` row for a kit (snapshot copied from the first row by `appendTOsToKit` line ~4010), so reading it from `firstRow` in `recheckBomCoverage` is safe.
- Capped at 7 items in the dialog (existing limit).
- Match is case-insensitive + whitespace-trimmed, matching the existing `toMaterials` / `incoraValues` conventions.

## Validation

- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm exec eslint src/lib/supabase/rr-kitting-data.service.ts` — clean (the dialog file is in `src/components/ui/`, which is project-ignored by the ESLint config; this is an existing convention noted in `Implementations/Kit-BOM-Chains-Expedites-And-INCORA-Component.md`).
- Pre-existing test failures (`work-distribution-panel`, `rf-cycle-count.service`, `zone-rules.service`, `team-performance-week-view`) are unrelated Supabase-auth jsdom-storage shims — none touch BOM coverage code paths.

## Edge Cases Considered

- **Post-creation edit flow shipped same day.** See [[Edit-Ship-Short-Post-Creation-Flow]] for the `Edit Ship Short` button on the Kit Build Audit Trail dialog and the new `RRKittingDataService.updateAuthorizedShipShortItems` method, which calls `recheckBomCoverage` so the auto-Black-Hat self-clears when the saved authorisation list now covers every previously-missing BOM line.
- **`appendTOsToKit` already inherits ship-short** from the first record (line ~4010), so the recheck after appending TOs sees the current authorisation list and behaves correctly.
- **INCORA Sub-Kit rows are intentionally NOT covered by ship-short** because those rows have no material number to match against. If an operator needs to bypass an INCORA Sub-Kit row, they list the INCORA reference under `INCORA Items` instead.

## Related

- [[Kit-BOM-Chains-Expedites-And-INCORA-Component]] — Sibling enhancement that introduced `incora_component` coverage logic and the expedite workflow; same files / same matching primitives.
- [[Kitting System - Feature Module]]
- [[KittingServices - Supabase Service]]
