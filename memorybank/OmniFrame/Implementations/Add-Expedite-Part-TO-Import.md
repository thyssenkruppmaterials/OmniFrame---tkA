---
tags: [type/implementation, status/active, domain/frontend, domain/backend, kitting]
created: 2026-06-06
---

# Add Expedite Part — TO Import Flow

## Request

The "Add Expedites to Kit Build Plan" dialog should use the **same clipboard
TO import** as the normal "Add to Kit Build Plan", drop the manual part
number / quantity / description fields (that data comes from the TO), treat
**each imported TO row as one expedite part** (a row in the Expedites tab),
and be renamed to **"Add Expedite Part"**.

## Changes

`src/components/ui/add-expedite-dialog.tsx` (rewritten):
- Title/button → **Add Expedite Part**.
- New `ExpediteFormData`: `{ importedTOs: TransferOrderRecord[], deliveryTime,
  reasonCode, requestedByDate }`. Removed `kitPoNumber` / `partNumber` /
  `quantity` / `description` and the `kitPoOptions` / `defaultKitPoNumber`
  props.
- Reuses `parseClipboardData` + `TransferOrderRecord` from
  `add-kit-build-plan-dialog` for an "Import TOs from Clipboard" button
  (badges show the imported part numbers; clear button). Delivery time
  (required, default Critical) + reason code + requested-by date are the only
  inputs and apply to every imported part. Submit gated on ≥1 imported TO.

`src/lib/supabase/rr-kitting-data.service.ts`:
- `addExpediteToKit` gained an optional `transferOrderNumber` → stored as
  `transfer_order_number` on the stand-alone row (traceability).
- New `addExpeditePartsFromTOs(records, shared)` — loops `addExpediteToKit`
  (stand-alone mode) once per TO row: `material` → part number,
  `materialDescription` → description, `sourceTargetQty` → quantity, plus the
  shared delivery time / reason / date. Sequential awaits so each row's
  `generateKitSerialNumber` sees the prior insert. Returns
  `{ success, created, failed }` for the toast. Rows with no material are
  skipped (counted as failed).

`src/components/kitting-data-manager.tsx`:
- Button → **Add Expedite Part**; `handleAddExpedite` now maps
  `formData.importedTOs` → `addExpeditePartsFromTOs`; toast reports the
  created/skipped counts. Removed the `expediteKitPoOptions` memo and the
  dialog's `kitPoOptions` prop. Expedites tab empty-state copy updated.

Each created row is a stand-alone expedite (`engine_program = 'EXPEDITE'`,
`kit_po_number = 'EXP-<serial>'`) and therefore lands in the **Expedites**
tab ([[Kit-Build-Plans-Expedites-Tab]]) with its own kanban card.

## Scope decisions

- **Removed the "attach to existing Kit PO" option** — the new flow is about
  creating stand-alone expedite parts for the Expedites tab. (Appending TOs
  to an existing kit is still available via the grid's More → "Append TOs to
  Kit".)
- **No non-warehouse-bin acknowledgement** on this flow (the kit dialog gates
  on it for RF picking; expedites are loose parts) — can add later if needed.
- Reused `addExpediteToKit` per row rather than a bulk insert: simpler and
  reuses the tested serial/kanban path; N TOs = N sequential inserts (fine
  for an operator action).

## Verification

`tsc -b` clean; ESLint clean. FE + service only, no schema change
(`transfer_order_number` + `part_expedite_*` columns already exist). Dev
server HMR-applied.

## Related
- [[Kit-Build-Plans-Expedites-Tab]] — the tab these land in
- [[Kit-BOM-Chains-Expedites-And-INCORA-Component]] — expedite data model
- [[Non-Warehouse-Bin-Acknowledgment]] — the ack flow intentionally not reused here
