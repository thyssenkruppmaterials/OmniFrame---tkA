---
tags: [type/debug, status/active, domain/frontend, kitting]
created: 2026-06-02
---
# Fix Cover Sheet Showing The Wrong Kit On A Shared PO

## Symptom

Printing a kit's cover sheet (the printable `KitBuildSheet`) rendered a
**sibling kit's** data when two kits shared the same `kit_po_number`.

Reported example — PO `2009708223`:
- `KIT-20260526-001` — Kit Number `415 Interstage #1`
- `KIT-20260526-002` — Kit Number `415 Interstage #2`

Printing **KIT-20260526-002** produced the cover sheet for
**KIT-20260526-001**, and the printed **QR scanned as "already picked"** —
because the QR encodes the *loaded* kit's serial (`details.kitSerialNumber ||
details.kitPoNumber`), so the wrong (already-picked) kit's serial was baked
into 002's sheet.

## Root cause

Same multi-kit-per-PO class as [[Fix-Kit-Build-Cross-Linked-Parts]] /
[[Kit-Serial-Scoping]]: the cover-sheet print path resolved by **PO only**.

`KitBuildSheet.loadKitData` called
`RRKittingDataService.getKitBuildPlanDetails(kitPoNumber)`, which resolves a
PO to whichever kit comes back first (the earliest by `created_at`). The
[[Print-Cover-Sheet-From-Audit-Trail]] change had already taught the sheet
to accept a `kitSerialNumber`, but the **kanban Start-Kit flow**
(`kit-kanban-board.tsx`) still passed PO-only:

```
KitBuildSheet kitPoNumber={buildSheetKitPoNumber}   // no serial → PO resolution
```

A second, sibling bug in the same flow: `markKitAsPrinted(kitPoNumber)`
updates `.eq('kit_po_number', po)`, so starting/printing one kit flipped
**every** sibling kit on the PO to `kit_build_status = 'printed'`.

## Fix

`src/components/kitting/kit-kanban-board.tsx`:
- Thread the kit serial through the Start-Kit → cover-sheet flow: new
  `pendingStartKitSerialNumber` + `buildSheetKitSerialNumber` state, captured
  from `task.kitSerialNumber` in `handleStartKit`, passed to `<KitBuildSheet
  kitSerialNumber=…>`. (Reset alongside the PO on dialog close.)
- STEP 4 now calls the new serial-scoped
  `markKitAsPrintedBySerialNumber(serial)` (PO variant kept as a fallback
  only when no serial is available).

`src/lib/supabase/rr-kitting-data.service.ts`:
- New `markKitAsPrintedBySerialNumber(kitSerialNumber)` — identical to
  `markKitAsPrinted` but scoped `.eq('kit_serial_number', …)`.

The audit-trail reprint button ([[Print-Cover-Sheet-From-Audit-Trail]])
already passed the serial, so both print entry points are now serial-scoped.
`KitBuildSheet` loads via `getKitBuildPlanDetailsBySerialNumber` whenever a
serial is present (which fixes both the rendered data **and** the QR payload).

## Verification

- New regression test `markKitAsPrintedBySerialNumber` in
  `kit-serial-scoping.test.ts` asserts the UPDATE filters by
  `kit_serial_number` and never by `kit_po_number`. 26 pass; the 1 failure is
  the unrelated pre-existing date-bomb (`createKitBuildPlan … kanban_task_id`,
  `generateKitSerialNumber` daily reset).
- `tsc -b` clean; ESLint clean (only pre-existing `flex-shrink-0` warnings).

## Deploy

FE + service-layer only, no schema/migration — ships with the next frontend
deploy.

## Related
- [[Kit-Serial-Scoping]]
- [[Implementations/Print-Cover-Sheet-From-Audit-Trail]]
- [[Fix-Kit-Build-Cross-Linked-Parts]]
- [[Fix-Build-Kit-Completion-Multi-Kit-PO]]
