---
tags: [type/implementation, status/active, domain/frontend, kitting]
created: 2026-06-02
---

# Print Cover Sheet From Kit Build Audit Trail

## Purpose / Context

Operators sometimes need to **reprint a kit's cover sheet** (the printable
`KitBuildSheet` / build sheet) — e.g. the original print jammed or was
lost. The cover sheet was previously only reachable from the kanban
**Start Kit** flow. Added a **Print Cover Sheet** button to the sticky
footer of the **Kit Build Audit Trail** dialog (`KitProductionTrackerDialog`),
beside the existing **Delete Kit** button, for a quick reprint without
leaving the audit trail.

## Changes

`src/components/kitting/kit-production-tracker.tsx`:

- New `isCoverSheetOpen` state.
- Footer's lone Delete button is now wrapped in a right-aligned
  `flex gap-2` group: **Print Cover Sheet** (`Printer` icon, neutral
  outline) + **Delete Kit** (unchanged destructive outline).
- Renders `<KitBuildSheet>` alongside the other sibling dialogs
  (`ConfirmDialog` / `EditShipShortDialog` / `CancelTOLineDialog`),
  passing **both** `kitPoNumber` and `kitSerialNumber`.

`src/components/kitting/kit-build-sheet.tsx`:

- New optional `kitSerialNumber?: string | null` prop. When provided,
  `loadKitData` loads via `getKitBuildPlanDetailsBySerialNumber(serial)`
  instead of the PO-resolving `getKitBuildPlanDetails(po)` — multi-kit-per-PO
  correctness per [[Kit-Serial-Scoping]] (a PO can host sibling kits; the
  audit trail is opened per-serial, so reprinting must hit the exact kit).
- The "load once per open" guard (`loadedKitPoRef`) and the open-effect now
  key on `loadKey = kitSerialNumber ?? kitPoNumber`. Backward-compatible:
  the kanban Start-Kit flow still passes PO-only and resolves the same way
  as before.

## Notes / Decisions

- `KitBuildSheet` is a Radix `Dialog`; rendering it nested inside the
  audit-trail `DialogContent` is the same established pattern as the other
  sibling dialogs (Radix portals to `document.body`, so nesting is fine).
- Both detail fetchers return the identical shape, so no transform changes
  were needed on the sheet's data mapping (verified by `tsc -b`).

## Verification

- `tsc -b` clean. ESLint clean (only a pre-existing `flex-shrink-0`
  warning in `kit-build-sheet.tsx`, unrelated to this change).

## Deploy

FE-only — ships with the next frontend deploy.

## Follow-up

The kanban **Start-Kit** print path still passed PO-only after this change,
so multi-kit POs printed the wrong sibling kit (and the QR scanned as the
wrong kit). Fixed in [[Debug/Fix-Cover-Sheet-Wrong-Kit-Shared-PO]] by
threading the serial through that flow too + a serial-scoped
`markKitAsPrintedBySerialNumber`.

## Related
- [[Components/Kitting System - Feature Module]]
- [[Redesign-Kit-Build-Audit-Trail-Layout-2026-05-20]]
- [[Kit-Serial-Scoping]]
- [[Kit-Number-On-Kanban-Card]]
- [[Debug/Fix-Cover-Sheet-Wrong-Kit-Shared-PO]]
