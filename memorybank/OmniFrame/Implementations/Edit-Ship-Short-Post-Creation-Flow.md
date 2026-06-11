---
tags: [type/implementation, status/active, domain/frontend, domain/backend]
created: 2026-05-12
---
# Edit Ship Short — Post-Creation Flow

## Purpose / Context

The sibling note [[Authorized-Ship-Short-Negates-Black-Hat]] (earlier today) made the BOM-coverage logic honour `Authorized to Ship Short` so the auto-Black-Hat is suppressed at kit-create time. That left one open seam: a kit that was already Black Hat-flagged — either created before the matcher fix or created without realising a part would be allowed to ship short — still required a manual flag-clear because there was no UI to mutate `authorized_ship_short_items` after creation.

This note captures the post-creation editor that closes that seam: from the **Kit Build Audit Trail** dialog (the row-click dialog on the Kitting Data Manager grid), an operator can click `Edit Ship Short`, edit the list, save, and see the auto-Black-Hat self-clear if every previously-missing BOM line is now authorised.

## Architecture

```
Kitting Data Manager grid
  └─ row click → KitProductionTrackerDialog (audit trail)
        └─ "Edit Ship Short" button → EditShipShortDialog
              └─ onSubmit → RRKittingDataService.updateAuthorizedShipShortItems
                    ├─ UPDATE RR_Kitting_DATA SET authorized_ship_short_items = $1
                    │     WHERE kit_serial_number = $2  (every TO row of the kit)
                    └─ if kit_definition_id is set → recheckBomCoverage
                          └─ addFlag('black') / clearFlagByType('black')
```

The re-check is the same one used by `appendTOsToKit` and the dialog-time auto-flag, so all three paths converge on the same matcher — there is only one source of truth for whether a kit is Black-Hat-blocked.

## Files

### `src/lib/supabase/rr-kitting-data.service.ts`

New static method on `RRKittingDataService` (placed in the BOM Coverage Helpers section right after `appendTOsToKit`):

```ts
static async updateAuthorizedShipShortItems(
  kitSerialNumber: string,
  items: Array<{ partNumber: string; description?: string }>
): Promise<{
  success: boolean
  bomCoverageComplete?: boolean
  flagCleared?: boolean
  error?: string
}>
```

Responsibilities:

- **Sanitise.** Trim, drop entries with empty `partNumber`, cap at 7 items, renumber `lineNumber` 1..N to match the dialog input limit.
- **Look up kit metadata** by `kit_serial_number` to obtain `kit_po_number` and `kit_definition_id` (snapshot-replicated across every TO row of the kit).
- **Snapshot the pre-state** of any active Black Hat flag so the response can tell the caller "the flag was cleared by *this* save" via `flagCleared`.
- **UPDATE** the `authorized_ship_short_items` JSONB column on every row of the kit (matching the `appendTOsToKit` pattern at line ~4010 where new TOs inherit the value).
- **Re-check** BOM coverage via `recheckBomCoverage(kit_po_number, kit_definition_id)` if the kit is linked to a definition. The recheck calls `addFlag('black')` or `clearFlagByType('black')` as appropriate.
- **Diff the post-state** of the Black Hat flag and surface `flagCleared: true` only when the save actually transitioned the flag.

### `src/components/ui/edit-ship-short-dialog.tsx` (new)

Lightweight focused dialog. Mirrors the `Authorized to Ship Short` section pattern from `add-kit-build-plan-dialog.tsx` (same `partNumber` + `description` + 7-item cap + add/remove/edit handlers + line-number renumbering) but is purpose-built for editing an existing list.

- Re-seeds `items` from `initialItems` every time `isOpen` flips to `true` so an aborted prior session doesn't leak.
- Pre-submit guard: refuses to save when a description is filled but the part number is empty (would be silently dropped by the service sanitiser — toast nudges the operator instead).
- Disabled state during `isSubmitting`; cancel-on-overlay-click is suppressed while saving.

### `src/components/kitting/kit-production-tracker.tsx`

- `KitDetails` interface extended with `authorizedShipShortItems` (already present in the underlying `getKitBuildPlanDetailsBySerialNumber` payload — just had to flow through).
- New state: `showEditShipShort`, `savingShipShort`.
- New handler `handleSaveShipShort` calls the service, on success refreshes via `loadDetails(true)`, toasts (`Black Hat cleared — kit can now be picked.` / `BOM coverage still incomplete — Black Hat remains.` / nothing extra), and appends a system message to the chat thread so the change is captured in the audit trail.
- Header gains an amber `Edit Ship Short` button between the existing `Delete Kit` and `Refresh` buttons. Shows a tiny pill with the current count when non-empty.
- `<EditShipShortDialog>` mounted at the bottom alongside `<ConfirmDialog>` for delete.

## UX notes

- Button colour is amber to mirror the new `Ship Short` badge added in [[Authorized-Ship-Short-Negates-Black-Hat]] — visually links the two surfaces.
- The audit-trail chat-thread system message uses the same wording template as the flag add/remove messages so the audit log stays uniform.
- Toast on `flagCleared` deliberately calls out *"kit can now be picked"* because that is the operator's mental model: they came here to unblock RF picking.

## Edge cases handled

- **Kit not linked to a kit definition.** `recheckBomCoverage` is skipped; `bomCoverageComplete` is left `undefined` and the toast falls through to the generic success message. (No stale Black Hat to worry about because the auto-flag is only added when a definition existed at create time.)
- **Kit has no TO rows yet.** Update still succeeds (it's just a column update on rows keyed by serial number); recheck handles the empty `kitRows` case (returns the same `unmatched.length` as before — i.e., it'll only clear if the BOM is empty too, which would be unusual).
- **Operator submits an empty list.** Allowed; the service writes `[]`, recheck restores the original auto-flag if BOM gaps re-emerge.
- **Concurrent appendTOsToKit.** New TO rows still inherit the *current* `authorized_ship_short_items` snapshot from the existing first row at append time, so there's no race that strands new rows with a stale list.

## Validation

- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm exec eslint src/lib/supabase/rr-kitting-data.service.ts src/components/kitting/kit-production-tracker.tsx` — clean. The dialog lives in `src/components/ui/`, which is project-ignored by ESLint config (existing convention from [[Kit-BOM-Chains-Expedites-And-INCORA-Component]]).
- `pnpm build` succeeds. Total JS budget is +7.66 KB (the new dialog and a few lines on the production tracker). Pre-existing budget failures on `warehouse-location-map` and `feature-admin` chunks confirmed unchanged via `git stash` baseline comparison — unrelated to kitting work.

## Future work

- Replicate this editor on the build-kit-form / inspect-kit-form surfaces so the floor associate can authorise on the spot without bouncing back to the Kitting Data Manager. (The service method is the only piece needed; the dialog can be reused as-is.)
- Consider lifting the dialog into a shared shadcn-style primitive for any "edit JSONB array on RR_Kitting_DATA" use case (INCORA items would be a natural second consumer).

## Related

- [[Authorized-Ship-Short-Negates-Black-Hat]] — earlier today; introduced the matcher logic that this editor consumes.
- [[Kit-BOM-Chains-Expedites-And-INCORA-Component]] — sibling enhancement; same files, same matching primitives.
- [[Kitting System - Feature Module]]
- [[KittingServices - Supabase Service]]
