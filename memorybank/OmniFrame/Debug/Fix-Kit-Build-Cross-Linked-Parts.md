---
tags: [type/debug, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-05-12
---
# Fix Kit Build — Cross-Linked Parts Across Kits Sharing a Kit PO

## Symptom

On the **Kitting Data Manager** grid ("Kit Build Plans"), the user has two
separate kits in progress that share the same `Kit PO Number = 2010102615`:

- `KIT-20260512-001` — Kit Number `C47E/4 Gear Box 1`, SAP TO `7287809`
- `KIT-20260512-002` — Kit Number `C47E/4 Gear Box 2`, SAP TOs `7287810` and
  `7287871`

The operator's report: *"on both kits in progress, the similar parts are tied
to each other when they have different TO's"*. In practice this manifests as:

- Both kits flip to `in_progress` together even though only one was started.
- The kanban progress card for `KIT-001` is stuck at `0 / 31` picks while
  `KIT-002`'s card shows `35 / 49` — which is exactly the **sum** of both
  kits' rows (27 + 8 = 35 picked, 31 + 18 = 49 lines).
- A Black Hat flag created against one kit blocks the other from picking.
- A pick made by the operator against either kit is attributed to whichever
  kit happens to come back first from `getTaskByKitPoNumber`.

The rows themselves in `RR_Kitting_DATA` are correctly *separated* per kit
(distinct `kit_serial_number`, distinct `transfer_order_number`). The bug is
in the **downstream lookups, mutations, and kanban sync** — all of which
key on `kit_po_number` alone and ignore `kit_serial_number`.

## Live evidence (Supabase project `wncpqxwmbxjgxvrpcake`)

```
kit_serial_number       kit_po_number  rows  distinct_tos  picked_lines
KIT-20260512-001        2010102615      31           1              27
KIT-20260512-002        2010102615      18           2               8
```

`kit_kanban_tasks` (one row per kit serial, both pointing at the same PO):

```
kit_serial_number       to_lines_picked / total_to_lines
KIT-20260512-001                0 / 31
KIT-20260512-002               35 / 49        ← 27+8 and 31+18
```

`kit_build_flags` is keyed on `kit_po_number` only — the active-flag row for
`2010102615` is single-row-per-PO and cannot distinguish the two serials.

`RR_Kitting_DATA` has **no unique constraint** on `kit_po_number`, only on
`id`. The schema permits two kits to share a PO; the service layer does not.

Also confirmed via `SELECT kit_po_number, COUNT(DISTINCT kit_serial_number)
... HAVING COUNT(DISTINCT kit_serial_number) > 1` — `2010102615` is the only
PO in the system today with multiple serials, which matches exactly the user's
bug report.

## Root cause

The data model treats `(kit_serial_number)` as the unique kit identity, but
the service / kanban / picking / flag code paths key on `kit_po_number`
throughout. Every place where the code says `.eq('kit_po_number', x)`
without also constraining `.eq('kit_serial_number', y)` is a cross-link
surface.

### Code-level inventory of the keying bug

All callsites below should be scoping by `kit_serial_number` (or `kit_serial_number`
+ `kit_po_number`) and currently scope by `kit_po_number` only:

| Concern | File | Line(s) | Effect |
|---|---|---|---|
| RF picking — kit lookup | `src/lib/supabase/rf-kitting-picking.service.ts` | `verifyKitForPicking` → `.eq('kit_po_number', kitPoNumber)` line ~111 | Floor/Rack pick lists are merged across all kits sharing the PO. The operator sees both kits' lines as one workflow; `firstRecord` is whichever row sorts first by bin then material. |
| RF picking — status flip | same | `updateKitStatusToInProgress` → `.update(...).eq('kit_po_number', ...)` line ~550 | First pick on either kit flips **both** kits to `in_progress`. This is precisely why the screenshot shows BOTH KIT-001 and KIT-002 marked In Progress. |
| RF picking — purple flag | same | `addPurpleHatFlag` → `.update(...).eq('kit_po_number', ...)` (legacy fallback) line ~800 | Missing-part report on one kit stamps the legacy flag on every row of the other kit. |
| Kanban sync | `src/lib/supabase/kit-kanban.service.ts` | `syncKitProgressFromData` → `.eq('kit_po_number', ...)` line ~913 + `getTaskByKitPoNumber` line ~875 | Aggregates picks across both serials, writes the combined `to_lines_picked / total_to_lines` to whichever kanban task `getTaskByKitPoNumber` returns first. This is why KIT-002's card shows 35/49 and KIT-001's card is stranded at 0/31. |
| Kit creation — kanban_task_id stamp | `src/lib/supabase/rr-kitting-data.service.ts` | `createKitBuildPlan` → `.update({ kanban_task_id }).eq('kit_po_number', input.kitPoNumber)` line ~429 | When a second kit is created with an existing PO, this update **overwrites the first kit's `kanban_task_id`** with the new kit's, severing the first kit's link to its kanban card permanently. |
| Append TOs to kit | same | `appendTOsToKit` line ~3935 | Looks up `existingData` with `.eq('kit_po_number', ...).limit(1)` — picks an arbitrary kit serial via `first` row and uses **its** `kit_serial_number` for the new rows. If the user intended to append to KIT-002 but KIT-001 was first in the result, TOs get attached to the wrong kit. |
| BOM coverage recheck | same | `recheckBomCoverage` (called from `appendTOsToKit` and `updateAuthorizedShipShortItems`) | Reads `material` / `incora_items` / `authorized_ship_short_items` via `.eq('kit_po_number', ...)` — coverage state is computed across both kits' rows and then a single Black Hat is added/cleared for the PO, affecting both. |
| Auto Black Hat flag | same | `createKitBuildPlan` line ~447 (with-TOs) + ~523 (without-TOs) | Calls `addFlag(kitPoNumber, 'black', ...)` — flag is keyed at PO scope. A `kit_number` argument is accepted but only used to dedupe duplicate-flag checks; the inserted row still keys on `kit_po_number`. |
| Flag add/clear primitives | same | `addFlag` line ~2576 / `clearFlagByType` line ~2719 | Insert/update on `kit_build_flags` using `kit_po_number` only (`kit_number` column on the table is optional metadata, not part of the unique key). A sibling primitive `addFlagBySerialNumber` exists at line ~1972 but is not what `createKitBuildPlan` / `recheckBomCoverage` actually call. |
| Verify-for-picking Black Hat gate | `src/lib/supabase/rf-kitting-picking.service.ts` | line ~169-200 (inside `verifyKitForPicking`) | `.eq('kit_po_number', kitPoNumber).eq('flag_type','black')` — one kit's auto-Black-Hat blocks the other from picking. |
| RF picking form | `src/components/ui/rf-kitting-picking-form.tsx` | line ~289 onwards (`kitPoNumber` state only) | The Scan Kit PO step asks the operator only for a Kit PO. There is no kit-serial / kit-number disambiguation when the PO has multiple kits. |

### Where the data model is fine

- The grid (`src/components/kitting-data-manager.tsx`) and the row-click detail
  dialog correctly identify kits by `kit_serial_number` (lines 73, 304).
- Picked rows themselves are updated by primary `id`
  (`markLinePicked`, `reportMissingPart`) — those are line-safe; the corruption
  is from the kit-level fan-out around them.
- `kit_kanban_tasks` has one row per `kit_serial_number` — the table is
  fine, it is the *lookup* (`getTaskByKitPoNumber`) that is wrong.
- The newer `addFlagBySerialNumber` / `updateTaskPriorityBySerialNumber` /
  `getKitBuildPlanDetailsBySerialNumber` primitives already exist in the
  codebase; the call graph just doesn't reach them from the bug-affected paths.

So this is **not a schema gap** — it's a **service / call-graph keying bug**.

## Why the gear-box pair triggers it

Two distinct kit serials (`-001` Gear Box 1, `-002` Gear Box 2) were created
against the *same* Kit PO `2010102615`. Most ECC operations use a separate
Kit PO per kit, so the existing `kit_po_number`-keyed code paths happened to
be unique-per-kit *in practice*. The C47E/4 dual-gearbox workflow violates
that implicit invariant.

## Symptom-to-callsite mapping

| Operator-visible symptom | Causing callsite |
|---|---|
| Both kits flipped to `In Progress` | `updateKitStatusToInProgress(kitPoNumber)` line ~550 in `rf-kitting-picking.service.ts` |
| KIT-002 kanban shows 35/49, KIT-001 shows 0/31 | `syncKitProgressFromData(kitPoNumber)` line ~895 in `kit-kanban.service.ts` aggregates across both serials, then writes to whichever single task `getTaskByKitPoNumber` returns |
| KIT-001's rows lost their kanban link permanently | `createKitBuildPlan` line ~429 in `rr-kitting-data.service.ts` clobbered `kanban_task_id` on every PO row when KIT-002 was created |
| Picking KIT-001 "picks for" KIT-002 (and vice versa) | `verifyKitForPicking(kitPoNumber)` line ~111 in `rf-kitting-picking.service.ts` merges floor/rack lists; the RF form has no kit-serial selector |
| Black Hat on one kit blocks the other | `addFlag(kitPoNumber, 'black', ...)` line ~2576 (PO-scoped flag) + `verifyKitForPicking` gate line ~169 |

## Proposed fix (review only — not implemented)

The right primary key for kit identity is `kit_serial_number`. The fix is
largely mechanical: re-scope every kit-level service operation and every
kit-level lookup to `kit_serial_number` (or `(kit_po_number, kit_serial_number)`
where we want defence in depth) **and** prompt the operator for a serial /
kit-number disambiguator when the same PO has multiple kits.

### Phase 1 — Service-layer rescoping (code-only)

1. `rf-kitting-picking.service.ts`
   - `verifyKitForPicking` → accept `kit_serial_number` (preferred) OR
     `(kit_po_number, kit_number)`. Add a precondition: if more than one
     serial exists for the PO and the caller passed only a PO, return a
     disambiguation error listing the available `{serial, kitNumber}` tuples.
   - `updateKitStatusToInProgress` → key by `kit_serial_number`.
   - `checkAndUpdateKitPickingStatus` → key by `kit_serial_number`.
   - `addPurpleHatFlag` (legacy fallback) → key by `kit_serial_number`.
   - `markLinePicked` already updates by row `id`, but the kanban sync it
     triggers needs the serial, so change the post-update branch to call
     `KitKanbanService.syncKitProgressFromSerial(kitSerialNumber)`.

2. `kit-kanban.service.ts`
   - Add `syncKitProgressFromSerial(kitSerialNumber)` that queries
     `RR_Kitting_DATA` with `.eq('kit_serial_number', ...)` and updates the
     kanban task by `.eq('kit_serial_number', ...)`. Leave the existing
     `syncKitProgressFromData(kitPoNumber)` in place as a thin wrapper that
     fans out to all serials for a PO (it remains useful for board-load
     reconciliation).
   - Add `getTaskBySerialNumber(kitSerialNumber)` — uses
     `.eq('kit_serial_number', ...)`.
   - Deprecate `getTaskByKitPoNumber` (it's already labelled defensive in the
     code comments). Replace all callers with the serial-keyed variant.

3. `rr-kitting-data.service.ts`
   - `createKitBuildPlan` line ~429: change the post-insert
     `kanban_task_id` stamp from `.eq('kit_po_number', input.kitPoNumber)` to
     `.eq('kit_serial_number', kitSerialNumber)` (we already generated the
     serial earlier in the function; it's in scope).
   - `appendTOsToKit`: require a `kit_serial_number` argument (the
     Kitting Data Manager already tracks `selectedKitSerialNumber` so this is
     a UI-side wiring change, not a UX regression).
   - `recheckBomCoverage`: take `(kit_serial_number)` instead of
     `(kit_po_number)`. Coverage state and Black Hat fan-out then become
     per-kit, matching operator intent.
   - Auto-Black-Hat callsites at line ~447, ~523, ~3912 should call
     `addFlagBySerialNumber` (already exists at line ~1972) instead of
     `addFlag(kitPoNumber, ...)`.
   - `updateAuthorizedShipShortItems` already takes `kitSerialNumber` —
     verify the internal `recheckBomCoverage` call uses the serial too.

### Phase 2 — UI flow disambiguation

1. `src/components/ui/rf-kitting-picking-form.tsx`
   - When the scanned PO returns more than one in-progress kit, prompt the
     operator with a kit picker (`Kit Serial / Kit Number / Engine Program`)
     before advancing to `pick_type`. Single-kit POs behave exactly as today.

2. `src/components/kitting-data-manager.tsx`
   - The `Append TOs` action should pass the `selectedKitSerialNumber` it
     already tracks (line 73) down to the service call.

### Phase 3 — Forward migration (optional but recommended)

Make the schema enforce what the service layer now assumes:

```sql
-- 303_kit_build_flags_serial_scope.sql
ALTER TABLE kit_build_flags ADD COLUMN kit_serial_number TEXT;
-- Backfill from a join via RR_Kitting_DATA (one kit serial per PO today
-- except for 2010102615; resolve manually below).
UPDATE kit_build_flags f
SET kit_serial_number = d.kit_serial_number
FROM (
  SELECT DISTINCT kit_po_number, kit_serial_number
  FROM "RR_Kitting_DATA"
  WHERE kit_serial_number IS NOT NULL
) d
WHERE d.kit_po_number = f.kit_po_number
AND ( SELECT COUNT(DISTINCT kit_serial_number)
      FROM "RR_Kitting_DATA" WHERE kit_po_number = f.kit_po_number ) = 1;
-- Then, after manual triage of the 2010102615 flag,
-- ALTER COLUMN ... SET NOT NULL;
-- + drop-and-recreate the active-flag uniqueness rule to include
--   kit_serial_number.
```

This is not a hard prerequisite — the service-layer fix alone solves the
user-visible bug. The migration just keeps the database honest if future
refactors regress.

## Data cleanup for the live KIT-001 / KIT-002 pair

After the service fix lands, two rows need surgical correction so the kanban
board matches the actual picks already recorded on `RR_Kitting_DATA`:

1. Look up KIT-001's correct `kanban_task_id` (currently `9e76f7d0-...`).
2. `UPDATE "RR_Kitting_DATA" SET kanban_task_id = '9e76f7d0-6c1b-41d0-a716-7bf4acefb6e5'
   WHERE kit_serial_number = 'KIT-20260512-001';` — restore the link clobbered
   by `createKitBuildPlan` line 429 when KIT-002 was created.
3. Run `syncKitProgressFromSerial('KIT-20260512-001')` and
   `syncKitProgressFromSerial('KIT-20260512-002')` (or the new equivalents)
   to recompute the per-kit progress.
4. Expected post-cleanup:
   - KIT-001 kanban card: 27 / 31 picks, step `picking`.
   - KIT-002 kanban card: 8 / 18 picks (or 8 / 19 if the orphan TO `7287871`
     row is counted), step `picking`.
5. Inspect the historical Black Hat (already inactive, cleared 13:55) for the
   PO and decide whether KIT-002 still needs an active flag — the BOM
   coverage logic will now compute that per-kit so simply re-running
   `recheckBomCoverage` per serial gives the right answer.

## Open questions for the user before implementing

1. **Operator-side disambiguation.** When picking a kit whose PO covers two
   kits, should we present a `Kit Serial / Kit Number / Engine` picker, or
   should we ask the operator to scan a different identifier (e.g. the
   physical Kit Serial label on the cart)? The latter is more rigorous; the
   former is faster.
2. **Are dual-kit POs intentional?** The C47E/4 Gear Box 1+2 case looks like
   it's by design (two physical gearboxes built against one SAP PO).
   Confirm that the data model is supposed to allow N kits per PO long-term
   — if so, the `kit_serial_number` rescoping below is correct. If not (i.e.,
   if dual-kit POs are an SAP import mistake), an alternative is a
   `UNIQUE (kit_po_number)` constraint and a hard import error.
3. **SAP Transfer Order scope.** SAP already issues a separate TO per kit
   (here `7287809` for Gear Box 1 and `7287810` for Gear Box 2), so the SAP
   side has the right model. Confirm whether OmniFrame should mirror SAP's
   shape (`kit_serial_number` ↔ `transfer_order_number` 1:N, never
   cross-kit) or whether some other identifier (the kit_build_number
   `854420`, which is shared) is the real anchor.
4. **Black Hat at kit-serial scope.** Today a Black Hat is one row per PO.
   After the fix it should be one row per kit serial. Confirm this matches
   the floor SOP — i.e., an operator clearing a flag on Gear Box 1 should
   not auto-clear it on Gear Box 2.

## Files needing changes

- `src/lib/supabase/rf-kitting-picking.service.ts` (verifyKitForPicking,
  updateKitStatusToInProgress, checkAndUpdateKitPickingStatus,
  addPurpleHatFlag legacy fallback)
- `src/lib/supabase/kit-kanban.service.ts` (syncKitProgressFromData,
  getTaskByKitPoNumber, getTaskByKitBuildPlanId — keep id-based path,
  syncAllInProgressTasks loop)
- `src/lib/supabase/rr-kitting-data.service.ts` (createKitBuildPlan kanban
  stamp, appendTOsToKit, recheckBomCoverage, the three auto-Black-Hat
  callsites)
- `src/components/ui/rf-kitting-picking-form.tsx` (kit-serial disambiguation
  step when verifyKitForPicking returns multi-kit error)
- `src/components/kitting-data-manager.tsx` (pass `selectedKitSerialNumber`
  through to `appendTOsToKit`)
- Optional: `supabase/migrations/303_kit_build_flags_serial_scope.sql`

## Related

- [[Kitting System - Feature Module]]
- [[KittingServices - Supabase Service]]
- [[Kit-BOM-Chains-Expedites-And-INCORA-Component]]
- [[Authorized-Ship-Short-Negates-Black-Hat]]
- [[Edit-Ship-Short-Post-Creation-Flow]]


## Resolution (2026-05-12 afternoon)

Implemented all six phases. Code is staged for review (no commit yet — user
reviews before committing).

### Files changed

- `supabase/migrations/303_kit_build_flags_serial_scope.sql` — added
  per-serial unique-active index, backfilled `kit_serial_number` for
  unambiguous PO rows, kept a legacy PO-scoped unique index for the one
  historical NULL-serial row (PO `2010102614`, ambiguous). **Applied**
  to project `wncpqxwmbxjgxvrpcake` via Supabase MCP.
- `src/lib/supabase/kit-kanban.service.ts` — added
  `getTaskByKitSerialNumber`, `syncKitProgressFromSerial`, and a private
  `computeKitProgress` helper. PO-scoped `syncKitProgressFromData` now
  fans out to every distinct kit serial under the PO so multi-kit POs
  no longer collapse into one card. `syncAllInProgressTasks` iterates by
  `kit_serial_number`. The kanban-board black-hat batch lookup now
  prefers the serial-scoped flag rows and falls back to PO-scoped only
  for legacy NULL-serial rows.
- `src/lib/supabase/rr-kitting-data.service.ts`
  - `createKitBuildPlan` (both with-TOs and without-TOs branches) — the
    post-insert `kanban_task_id` UPDATE is now `.eq('kit_serial_number',
    kitSerialNumber)` instead of `.eq('kit_po_number', …)`. This is the
    fix for the regression that clobbered KIT-001's kanban link the
    moment KIT-002 was created.
  - Both auto-Black-Hat callsites in `createKitBuildPlan` now call
    `addFlagBySerialNumber(kitSerialNumber, …)`.
  - Added `recheckBomCoverageBySerial(kitSerialNumber, kitDefinitionId)`
    as the canonical implementation; old `recheckBomCoverage` is now a
    deprecated PO-fanout wrapper.
  - Added `clearFlagByTypeBySerialNumber` (mirrors the existing
    `addFlagBySerialNumber`); old `clearFlagByType` is now deprecated.
  - `appendTOsToKit` signature changed: now requires
    `kitSerialNumber` instead of `kitPoNumber`. Duplicate-TO detection,
    the `kanban_task_id` lookup, and the BOM-coverage recheck are all
    serial-scoped. Added `findKitSerialsByPoNumber` helper for the UI
    path that needs to disambiguate before calling.
  - `updateAuthorizedShipShortItems` — the before/after Black Hat
    probes and the BOM recheck now scope by `kit_serial_number`.
- `src/lib/supabase/rf-kitting-picking.service.ts`
  - `verifyKitForPicking(kitPoNumber, kitSerialNumber?)` returns either
    `{ data }` (single kit), `{ kits }` (disambiguation list when one
    PO covers >1 active kit), or `{ error }`. Internal helper field
    `_hasValidStatus` is stripped before returning to UI.
  - `updateKitStatusToInProgress` and `checkAndUpdateKitPickingStatus`
    are now per-`kit_serial_number`.
  - `markLinePicked` reads back the row's `kit_serial_number` and routes
    the kanban sync through `syncKitProgressFromSerial`.
  - `reportMissingPart` now passes the serial through to
    `addPurpleHatFlag` and to the per-serial sync. The legacy
    `addPurpleHatFlag` writes the serial column on insert and falls back
    per-serial on the legacy `kit_flag_*` field.
  - The Black Hat picking gate inside `verifyKitForPicking` probes
    serial-scoped first and falls back to PO-scoped only for legacy
    rows whose `kit_serial_number` is still NULL.
- `src/components/ui/rf-kitting-picking-form.tsx` — added a `kit_select`
  step. When `verifyKitForPicking` returns `kits.length > 1`, the form
  renders a picker (kit serial / kit number / status / picked-of-total
  + progress bar) before advancing to `pick_type`. The picker has a
  `Cancel / Re-scan` affordance. Single-kit POs auto-advance as before
  (no UX regression). All subsequent picking calls (`markLinePicked`,
  `reportMissingPart`, status flip, refresh) now pass the chosen
  `kit_serial_number`.
- `src/components/ui/rf-picking-form.tsx` — Kit-PO detection no longer
  ignores the multi-kit case; it now treats either a `data` or a
  `kits[]` response as a confirmed Kit PO and hands off to Kit Picking.
- `src/components/kitting-data-manager.tsx` — `handleAppendTOs` resolves
  the typed Kit PO to a single `kit_serial_number` (via the new
  `findKitSerialsByPoNumber`); when the PO maps to multiple kits it
  prompts the operator to choose, then calls the (now
  serial-scoped) `appendTOsToKit`.
- `src/lib/supabase/__tests__/kit-serial-scoping.test.ts` — new test
  file covering `verifyKitForPicking` (single-kit + multi-kit
  disambiguation), `addFlagBySerialNumber` (insert payload includes the
  serial; dedupe rejects duplicate active flag), `syncKitProgressFromSerial`
  (filters by serial; updates the per-serial task), and the
  `createKitBuildPlan` regression (the `kanban_task_id` stamp now keys
  by `kit_serial_number` and never by `kit_po_number`). 6/6 pass.

### Migration application

Applied `303_kit_build_flags_serial_scope` against
`wncpqxwmbxjgxvrpcake`:
- The unique-active index split into `idx_kit_build_flags_unique_active_by_serial`
  (the new canonical rule) + `idx_kit_build_flags_unique_active_legacy_po`
  (covers historical NULL-serial rows so duplicate-active inserts still
  fail at the DB layer).
- Two new query indexes: `idx_kit_build_flags_serial_flag_type` and
  `idx_kit_build_flags_active_by_serial`.
- Backfill ran but found nothing to populate — the only ambiguous PO
  (`2010102615`, KIT-001 + KIT-002) was correctly left NULL by the
  `HAVING COUNT(DISTINCT kit_serial_number) = 1` clause; the other
  active row (PO `2010102614`) has no matching `RR_Kitting_DATA` rows
  any more, so it stayed NULL by design.

### Live-data cleanup performed

Via Supabase MCP `execute_sql`:

1. `UPDATE "RR_Kitting_DATA" SET kanban_task_id = '9e76f7d0-6c1b-41d0-a716-7bf4acefb6e5' WHERE kit_serial_number = 'KIT-20260512-001';` — restored
   the kanban link clobbered by `createKitBuildPlan` when KIT-002 was
   created. (All 31 rows for KIT-001 were pointing at KIT-002's task id
   `6a303c41-…`.)
2. `UPDATE kit_kanban_tasks SET to_lines_picked = 27, total_to_lines = 31, current_step = 'picking' WHERE kit_serial_number = 'KIT-20260512-001';`
3. `UPDATE kit_kanban_tasks SET to_lines_picked = 8, total_to_lines = 18, current_step = 'picking' WHERE kit_serial_number = 'KIT-20260512-002';`

Verified post-cleanup: KIT-001 card 27/31, KIT-002 card 8/18. The
orphan TO `7287871` was already attached to KIT-002 (so KIT-002 totals
as 17 + 1 = 18 lines, not 19); no further triage needed there.

The historical Black Hat for PO `2010102615` is `is_active=false` and
`kit_serial_number IS NULL` — already cleared at 13:55 UTC, no action
required. The active Black Hat on PO `2010102614` was left untouched
(no matching `RR_Kitting_DATA` rows for that PO any more, so the
backfill couldn't resolve a serial; the legacy PO-scoped unique index
still prevents duplicates).

### Manual follow-up still needed (surface to user)

- Re-run `recheckBomCoverageBySerial` for KIT-001 and KIT-002 in the UI
  (open each row's audit-trail dialog → it will now compute coverage
  per kit). Cannot run from MCP because the service uses the browser's
  authenticated session for the flag write. Likely no-op given the
  historical Black Hat is already cleared, but confirm.

### Test results

- `pnpm vitest run src/lib/supabase/__tests__/kit-serial-scoping.test.ts` —
  6/6 pass.
- `pnpm test:unit` — 456/480 pass; 24 failures are all pre-existing
  jsdom/Supabase-auth storage shim issues + pre-existing security &
  rbac tests (none touch kitting). Same set as documented in this
  morning's session log.

### Lint / build / format

- `pnpm exec prettier --check` on all 7 changed/added files — all clean.
- `pnpm build` — clean (no new TS errors). Pre-existing bundle-size
  warnings on `warehouse-location-map`, `feature-admin`, `exceljs`,
  `feature-rf-interface` are unchanged.
- `pnpm lint:check` — 0 errors, 91 warnings (pre-existing baseline
  failure of 91 warnings vs ratchet baseline 16 — confirmed unchanged
  by stashing my changes). Lint ratchet was already failing on a clean
  tree before this work; not introduced here.

### Status

- `status/active` retained on this note pending production verification
  by the floor team. The implementation is DONE; mark `status/resolved`
  once the operator on the floor confirms KIT-001 and KIT-002 behave
  independently in the next pick session.
