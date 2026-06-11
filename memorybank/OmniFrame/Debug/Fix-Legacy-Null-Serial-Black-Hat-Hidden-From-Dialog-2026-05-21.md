---
tags: [type/debug, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-05-21
---
# Fix — Legacy NULL-serial Black Hat hidden from Kit Build Audit Trail

## Symptom

User opened the Kit Build Audit Trail for `KIT-20260518-005` (PO `2010102614`) and reported:

> "It's showing a black hat, but I don't see where I can clear it with importing a TO."

The kanban card displayed `Black Hat — Picking Blocked…` but inside the dialog:

- The Build Flags inline pill bar in the Production Progress header was **empty** (no Black Hat chip).
- The `BlackHatShipShortPanel` (the inline card that hosts both `Add TO to Clear Black Hat` and per-line ship-short authorise) **never rendered**.
- Result: the operator could see the kit was blocked but had no recovery affordance inside the dialog.

## Root cause

A single legacy row in `kit_build_flags` with `kit_serial_number IS NULL` and `kit_po_number = '2010102614'`. Set on **2026-05-11 16:16 UTC** by the auto-flag path with notes:

```
Auto-flagged: Missing BOM components — M250-10296 (1),
  23086020 (INTEGRAL SEAL, TYPE XI ENGINE ACCESSORY),
  M250-10858 (INTEGRAL SEAL, OIL FILTER HOUSING)
```

The flag pre-dates the [[Kit-Serial-Scoping]] / migration 303 per-serial scoping rollout. The flag itself is real and correct — the kit's 14 imported TOs do not cover those three required BOM materials.

The Kit Build Audit Trail dialog reads flags via `RRKittingDataService.getActiveFlagsBySerialNumber`, which is strictly per-serial:

```ts
.select('id, kit_serial_number, flag_type, set_by_user, set_date_time, notes')
.eq('kit_serial_number', kitSerialNumber)
.eq('is_active', true)
```

Because the legacy flag has `kit_serial_number = NULL`, the predicate excluded it. The `BlackHatShipShortPanel` is gated on `hasActiveBlackHat = activeFlags.some(f => f.flagType === 'black')`, so when the dialog couldn't see the flag, the panel hid itself — taking the `Add TO to Clear Black Hat` and the per-line `Authorize Ship Short` affordances with it.

The kanban card's flag chip uses a different path that joins on `kit_po_number` and tolerates NULL `kit_serial_number`, which is why the chip *was* visible there.

## Why only this one kit

A scan of the production DB confirmed exactly **one** row in this state:

```sql
SELECT COUNT(*) AS legacy_flags_with_null_serial
FROM kit_build_flags
WHERE is_active = true AND kit_serial_number IS NULL AND flag_type = 'black';
-- → 1
```

Not a systemic issue — a single historical row that didn't get backfilled when the per-serial scoping rolled out. Every flag created since migration 303 carries a non-NULL `kit_serial_number`.

## Fix

Targeted one-row backfill:

```sql
UPDATE kit_build_flags
SET kit_serial_number = 'KIT-20260518-005',
    updated_at = NOW()
WHERE id = '99b2f7cd-07ff-4b55-964f-e77e705250ed'
  AND kit_serial_number IS NULL
  AND kit_po_number = '2010102614'
  AND is_active = true
  AND flag_type = 'black'
RETURNING *;
```

Applied via Supabase MCP `execute_sql` against `wncpqxwmbxjgxvrpcake`. 1 row affected. Post-fix verification:

```sql
SELECT COUNT(*) AS remaining_null_serial_active_flags
FROM kit_build_flags
WHERE is_active = true AND kit_serial_number IS NULL;
-- → 0
```

All five qualifying predicates were included in the WHERE so the UPDATE could only ever target this exact row — it was a no-op had any of them not matched.

## After-fix UX

With the flag now correctly scoped to `kit_serial_number = 'KIT-20260518-005'`:

1. Reopening the Kit Build Audit Trail dialog renders a `Black Hat` pill in the inline Build Flags bar in the Production Progress header.
2. The `BlackHatShipShortPanel` mounts immediately above the Production Progress card and surfaces the three missing BOM components: `M250-10296`, `23086020`, `M250-10858`.
3. The operator's two recovery paths become accessible:
   - **Add TO to Clear Black Hat** (panel's `Add TO` button) — paste TOs for the missing materials. Routes through `RRKittingDataService.appendTOsToKit` which dedupes by transfer-order-number per-serial, syncs the kanban totals, and re-runs `recheckBomCoverageBySerial`. See [[Add-TO-To-Clear-Black-Hat]].
   - **Edit Ship Short** — authorise those three part numbers as ship-short. Routes through `updateAuthorizedShipShortItems` which writes the column on every TO row of the kit and re-runs BOM coverage. See [[Edit-Ship-Short-Post-Creation-Flow]] and [[Authorized-Ship-Short-Negates-Black-Hat]].

## Defence-in-depth (deferred)

The alternative considered was making `getActiveFlagsBySerialNumber` tolerant of NULL-serial legacy rows by falling back to a `kit_po_number` match when the strict per-serial query returns nothing. Skipped this round because:

- The DB scan confirms only one such row ever existed in production, and it's now fixed.
- A PO-fallback would re-introduce the cross-kit-flag-bleed bug that motivated the per-serial scoping in the first place — two kits sharing a PO would both surface the same legacy flag.
- Better long-term plan: add a forward-looking guard in [[Add-Kit-Build-Plan]] / `RRKittingDataService.createKitBuildPlan` that asserts every flag insert carries a non-NULL `kit_serial_number`, plus an Edge Function nightly task that scans for orphaned NULL-serial active flags and emits a warning to ops.

If another legacy NULL-serial flag surfaces in the future, the same one-row UPDATE template applies (substitute the `id` + serial). This note is the runbook.

## Related

- [[Kit-Serial-Scoping]] — the per-serial scoping convention that the legacy row pre-dated.
- [[Black-Hat-Ship-Short-Authorization-Panel]] — the panel whose visibility was gated on `hasActiveBlackHat` and so couldn't render.
- [[Add-TO-To-Clear-Black-Hat]] — first recovery path the operator can now access.
- [[Edit-Ship-Short-Post-Creation-Flow]] / [[Authorized-Ship-Short-Negates-Black-Hat]] — second recovery path.
- [[Persist-Kit-Notes-Chat-Thread]] — the audit trail will get its system note for whichever recovery path the operator picks.
