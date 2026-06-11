---
tags: [type/pattern, status/active, domain/frontend, domain/database]
created: 2026-05-12
---
# Pattern — Kit Identity is `kit_serial_number`, never `kit_po_number`

## Purpose / Context

A Kit PO Number is a **group identifier** issued by SAP. One PO can
legitimately cover multiple physical kits (the C47E/4 dual-gearbox flow
is the canonical example: PO `2010102615` covers KIT-20260512-001
“Gear Box 1” and KIT-20260512-002 “Gear Box 2”). The unique kit identity
is therefore `kit_serial_number`, generated per kit at
`createKitBuildPlan` time (format `KIT-YYYYMMDD-NNN`).

This pattern was extracted from the regression captured in
[[Fix-Kit-Build-Cross-Linked-Parts]]: every place the service layer keyed
by `kit_po_number` alone silently merged unrelated kits the moment a
second kit was created against the same PO — cross-linking pick lists,
clobbering kanban links, broadcasting flag clears across siblings, and
aggregating kanban progress.

## Rule

**Anywhere code identifies or mutates a single kit, key by
`kit_serial_number`. Reserve `kit_po_number` for PO-group operations
only.**

### Per-kit operations — must use `kit_serial_number`

- Kanban task lookup / progress sync
  (`KitKanbanService.syncKitProgressFromSerial`,
  `KitKanbanService.getTaskByKitSerialNumber`).
- Kit Build Flag insert / clear
  (`RRKittingDataService.addFlagBySerialNumber`,
  `RRKittingDataService.clearFlagByTypeBySerialNumber`).
- BOM coverage re-check
  (`RRKittingDataService.recheckBomCoverageBySerial`).
- Picking status flip
  (`RFKittingPickingService.updateKitStatusToInProgress(kitSerialNumber)`).
- Picking completion check
  (`RFKittingPickingService.checkAndUpdateKitPickingStatus(kitPoNumber, kitSerialNumber)`).
- Append TOs to a kit
  (`RRKittingDataService.appendTOsToKit(kitSerialNumber, …)`).
- The post-insert `kanban_task_id` stamp inside `createKitBuildPlan`
  (the original regression — keying by PO clobbered the existing
  kit's link).
- Authorized Ship-Short list update
  (`RRKittingDataService.updateAuthorizedShipShortItems(kitSerialNumber, …)`).
- Picking Black-Hat gate inside `RFKittingPickingService.verifyKitForPicking`.
- Cover-sheet (build sheet) load — `KitBuildSheet` must be passed
  `kitSerialNumber` so it loads via
  `RRKittingDataService.getKitBuildPlanDetailsBySerialNumber`; PO-only
  resolution renders a sibling kit's sheet (and bakes the wrong serial into
  the printed QR). See [[Fix-Cover-Sheet-Wrong-Kit-Shared-PO]].
- Mark-as-printed (`RRKittingDataService.markKitAsPrintedBySerialNumber`) —
  the PO variant flips every sibling kit on the PO to `printed`.

### PO-group operations — acceptable to use `kit_po_number`

- Bulk view filters in the Kitting Data Manager grid that explicitly
  want to show every kit under a PO.
- The legacy `RRKittingDataService.setKitFlag` / `clearKitFlag` paths
  on `RR_Kitting_DATA` (these write the legacy single-flag column on
  every row of a PO; per-kit replacements live in the `kit_build_flags`
  primitives).
- The deprecated PO-scoped wrappers
  (`KitKanbanService.syncKitProgressFromData`,
  `RRKittingDataService.recheckBomCoverage`,
  `RRKittingDataService.clearFlagByType`,
  `KitKanbanService.getTaskByKitPoNumber`) — these now fan out
  per-serial internally so they are safe, but new code should call the
  serial-scoped variant directly.

## Disambiguation UX (RF Kit Picking)

When the operator scans a Kit PO that covers multiple active kits,
`RFKittingPickingService.verifyKitForPicking(kitPoNumber)` returns a
`{ kits: KitDisambiguationOption[] }` payload instead of `{ data }`.
The `RFKittingPickingForm` then renders the `kit_select` step (kit
serial / kit number / status / picked-of-total + progress bar). Selection
calls `verifyKitForPicking(kitPoNumber, kitSerialNumber)` again — the
second call short-circuits to the chosen kit. Single-kit POs auto-resolve
and never see the picker, preserving the common-case UX.

## Database invariants (from `303_kit_build_flags_serial_scope`)

- `kit_build_flags(kit_serial_number, flag_type) WHERE is_active = true`
  is the canonical unique-active rule.
- A second partial unique index keyed only on `(kit_po_number,
  flag_type) WHERE is_active = true AND kit_serial_number IS NULL`
  exists purely to keep the legacy NULL-serial rows from going
  duplicate while we migrate them; new inserts always set the serial.
- Composite index `(kit_serial_number, flag_type)` exists for the
  hot-path lookup used by `addFlagBySerialNumber` and
  `clearFlagByTypeBySerialNumber`.

## Code-review checklist

When reviewing kitting code, reject any new use of:

- `.eq('kit_po_number', …)` followed by an UPDATE/INSERT/DELETE — must
  also constrain by `.eq('kit_serial_number', …)` or use a serial-scoped
  service primitive.
- `KitKanbanService.getTaskByKitPoNumber` in a flag/progress path.
- `RRKittingDataService.addFlag(kitPoNumber, …)` in a per-kit context
  (use `addFlagBySerialNumber` instead).
- `RFKittingPickingService.verifyKitForPicking(kitPoNumber)` in a
  picking-mutation path without first checking the `kits[]` field for
  the multi-kit case.

## Related

- [[Fix-Kit-Build-Cross-Linked-Parts]]
- [[Fix-Cover-Sheet-Wrong-Kit-Shared-PO]]
- [[Kitting System - Feature Module]]
- [[KittingServices - Supabase Service]]
- [[Authorized-Ship-Short-Negates-Black-Hat]]
- [[Edit-Ship-Short-Post-Creation-Flow]]
