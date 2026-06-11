---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-05-19
---

# Add TO to Clear Black Hat

## Purpose / Context

[[Black-Hat-Ship-Short-Authorization-Panel]] (2026-05-18) gave operators
one way to unblock a Black-Hat-flagged kit from inside the Quick View:
**authorize ship short** for each missing BOM component, line by line.

That covered the "we'll ship the kit without these parts and reconcile
on the back end" case. The other valid resolution — **add a Transfer
Order that physically supplies the missing material** — was only
available through the top-level Kitting Data Manager's `Append TOs to
Kit` action, which puts an operator three clicks away from the kit
they're already looking at and offers no per-component coverage
preview.

This implementation adds a sibling on-ramp to the panel: a new **Add TO
to Clear Black Hat** button next to **Authorize All Missing**. Clicking
opens a dialog where the operator pastes SAP-export TO rows and sees
which of them satisfy currently-missing BOM components. The two paths
are additive: a kit with two missing materials can be cleared by
authorizing one and adding a TO for the other, or by doing the same
thing for both via either method — the BOM-coverage matcher ORs
together TOs, INCORA items, and ship-short authorizations and only
clears the Black Hat when every non-informational BOM line is covered
by *something*.

## Architecture

```
BlackHatShipShortPanel (Quick View, when kit is Black-Hat-flagged)
  ├─ Authorize Selected ──────────► updateAuthorizedShipShortItems
  │   (per-line checkbox flow,       └─ recheckBomCoverageBySerial
  │    existing 2026-05-18 slice)         └─ clearFlagByType('black')
  │
  └─ Add TO to Clear Black Hat ──► AddTOForBlackHatDialog (NEW)
        clipboard paste → parsed TO preview with coverage indicators
        + reused NonWarehouseBinNotice for plant-bin acknowledgement
        └─ Submit → RRKittingDataService.appendTOsToKit
              └─ recheckBomCoverageBySerial (same matcher)
                    └─ clearFlagByType('black') if all covered

Either path resolves to the same matcher — there is exactly one
source of truth for whether a kit is Black-Hat-blocked, defined by
`recheckBomCoverageBySerial`.
```

## Files

### New component

- **`src/components/kitting/add-to-for-black-hat-dialog.tsx` (NEW)** —
  - Renders the currently-missing materials at the top of the dialog
    (formatted as a reference list, INCORA Sub-Kit rows intentionally
    excluded by the caller because they can't be matched by TO).
  - Clipboard paste reuses `parseClipboardData` from the Add Kit Build
    Plan dialog so SAP-export rows paste identically to kit-creation
    time.
  - Per-row preview labels each parsed TO as either
    `Covers missing` (green tint) or `Extra` (gray), based on a
    case-insensitive uppercase match between the TO's `material`
    column and the missing-materials set.
  - Summary banner: `N TOs parsed · Covers X of M missing`.
  - Reuses `<NonWarehouseBinNotice>` from
    [[Non-Warehouse-Bin-Acknowledgment]] so any pasted row whose
    `sourceStorageBin` matches a configured non-warehouse pattern
    (e.g. `NEEDBIN`) forces an explicit acknowledgement before
    submit — same UX contract as the Add Kit Build Plan dialog.
  - Submit calls `RRKittingDataService.appendTOsToKit`, which:
    - Dedupes against the kit's existing TO numbers (per-serial),
    - Snapshots `kit_definition_id`, `authorized_ship_short_items`,
      `incora_items`, `kanban_task_id`, and friends from the existing
      first row,
    - Inserts new TO rows,
    - Resyncs the kanban task totals, and
    - Runs `recheckBomCoverageBySerial` which either re-stamps the
      Black Hat with the narrowed missing list or clears it outright.
  - On success, calls the dialog's `onSubmitted` with
    `{ insertedCount, coversCount }` so the panel can refetch.

### Updated component

- **`src/components/kitting/black-hat-ship-short-panel.tsx`** —
  - Header now hosts a button cluster:
    - `Authorize All Missing` (existing, only when
      `!policy.requireLineByLineApproval`)
    - **`Add TO to Clear Black Hat`** (NEW — always visible when
      authorizable rows exist, regardless of the line-by-line
      approval policy — adding a TO is itself a per-line action, not
      a bulk approval shortcut).
  - New local state:
    - `showAddTODialog` — modal open flag for the new dialog.
    - `missingRefreshCounter` — incremented when a successful Add-TO
      lands so the existing "fetch missing components" `useEffect`
      re-runs and the panel reflects the narrowed Black-Hat state
      (or self-hides if every gap is now covered).
  - `missingMaterialsForTO` memo derives the TO-eligible subset from
    `authorizableRows` — INCORA Sub-Kits are filtered out at the
    `authorizableRows` step already (the existing matcher excludes
    them from ship-short coverage too).
  - The `onSaved` callback shape was extended with a discriminated
    `event: 'ship_short_authorized' | 'to_added'` field plus an
    optional `coversCount` so the parent (Kit Build Audit Trail
    dialog) can stamp a context-appropriate audit-trail system note.

### Parent dialog

- **`src/components/kitting/kit-production-tracker.tsx`** —
  - `handleBlackHatPanelSaved` now branches on `result.event`:
    - `ship_short_authorized` → existing wording template, unchanged.
    - `to_added` → new wording template:
      `"N Transfer Orders imported via Picking Blocked panel — X
      missing components now covered."`
    - Both still call `loadDetails(true)` so the active-flags chip
      + TO Lines table + chat thread refresh.

## UX details

- The new button is always visible when there are authorizable rows
  (i.e. when the panel is rendered at all). It is intentionally
  decoupled from `policy.requireLineByLineApproval` — that policy
  governs the bulk-authorize shortcut, not the choice of resolution
  method.
- Clipboard parse failure is handled the same way as the Add Kit Build
  Plan dialog (toast on empty / no-valid-rows / clipboard-denied).
- When the operator pastes TOs that cover **zero** missing materials,
  the dialog still allows submit but renders an amber hint above the
  bins notice: "*None of the pasted TOs match a currently-missing
  material. Adding them anyway will still expand the kit, but the
  Black Hat will remain active.*"
- When the operator pastes TOs that cover **some but not all** missing
  materials, the hint reads: "*These TOs cover X of M missing
  components — the Black Hat will narrow but stay active until the
  remaining N are also covered (via additional TOs or Ship-Short
  authorizations).*"
- All three Black-Hat-resolution surfaces (per-line authorize,
  bulk authorize, add TO) now write through services that call
  `recheckBomCoverageBySerial`, so there is no path that can leave
  the flag stale.
- Cross-user updates: the Kit Notes thread refreshes via the existing
  10s `refetchInterval` on `useKitNotes`
  ([[Persist-Kit-Notes-Chat-Thread]]), no new Supabase Realtime
  channel.

## Edge cases handled

- **Kit not found / serial blank.** `appendTOsToKit` returns
  `{ success: false, error: 'Kit not found' }`; dialog toasts and
  stays open.
- **All TOs already exist.** Service returns
  `{ success: true, insertedCount: 0 }` and the dialog toast reads
  "All N TOs already exist for this kit — nothing to insert."
- **Operator pastes TOs with non-warehouse bins.** Reused
  `NonWarehouseBinNotice` enforces the same acknowledgement contract
  as the Add Kit Build Plan dialog (see
  [[Non-Warehouse-Bin-Acknowledgment]]). The ack reseeds to false
  every time the dialog opens or the parsed-TO fingerprint changes.
- **Missing component list changes mid-session.** The panel's
  `missingRefreshCounter` causes a refetch every time the Add-TO
  flow lands. If the parent dialog closes mid-flow, the dialog's own
  `isOpen` guard prevents any stale submit.
- **Partial coverage.** Black Hat note re-stamps with only the
  still-missing materials, courtesy of the existing
  `recheckBomCoverageBySerial` behaviour ([[Authorized-Ship-Short-Negates-Black-Hat]]).
- **INCORA Sub-Kit row.** Not surfaced in the new dialog (no
  materialNumber to match against). The existing per-line panel
  already disables those rows with explanatory copy.

## Validation

- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm exec eslint <touched files>` — clean.
- `pnpm exec vitest run src/lib/kitting/__tests__/non-warehouse-bins.test.ts
  src/lib/supabase/__tests__/kit-serial-scoping.test.ts` — **35/36
  pass**; the lone failure is the pre-existing `KIT-20260512-006`
  date-bomb noted in [[Optional-Kit-Inspection-Toggle]].
- `pnpm build` — succeeds. The new dialog lives in the same
  `feature-admin` chunk as the existing Black-Hat panel (lazy-loaded
  with the Kit Build Audit Trail surface); bundle delta is minor.

## Future work

- **Server-side stamp** of the Black-Hat resolution method on
  `kit_build_flags` (`cleared_via: 'ship_short' | 'to_import' | …`)
  so the Production Boards / leadership reports can show how kits
  unblocked over time. Today the data is implicit in the Kit Notes
  audit thread (event_kinds `black_hat_panel_authorized` vs
  `black_hat_panel_to_added`).
- **Manual-entry mode** for sites without SAP clipboard access —
  per-missing-material rows with inline TO number / bin / qty
  inputs. Wire the same `appendTOsToKit` call.
- **SAP query** integration — query LX12 / LT24 for outstanding TOs
  for the missing materials directly, surfacing them as
  pre-populated rows in the dialog. Would route through the existing
  agent stack instead of clipboard paste.
- **Add-Expedite recheck gap** ([[Black-Hat-Ship-Short-Authorization-Panel]]
  § Recommendation): same Black-Hat clearing should fire after
  `addExpediteToKit` — today it does not, so adding an expedite that
  satisfies the missing material doesn't auto-clear the flag without
  another path (Edit Ship Short save / Add TO / etc.) firing the
  recheck. Out of scope for this slice; documented as a follow-up.

## Related

- [[Black-Hat-Ship-Short-Authorization-Panel]] — the per-line
  Ship-Short on-ramp that this implementation pairs with.
  Same panel, sibling button + dialog.
- [[Authorized-Ship-Short-Negates-Black-Hat]] — the matcher
  semantics that make these on-ramps converge on one source of
  truth.
- [[Edit-Ship-Short-Post-Creation-Flow]] — the legacy power-user
  Ship-Short editor; still available in the dialog header.
- [[Non-Warehouse-Bin-Acknowledgment]] — the bin-acknowledgement
  card the new dialog reuses verbatim.
- [[Persist-Kit-Notes-Chat-Thread]] — the audit-trail surface
  that captures system notes for both on-ramps (event kinds:
  `black_hat_panel_authorized`, `black_hat_panel_to_added`).
- [[Kit-Serial-Scoping]] — the per-serial convention every
  service call follows.
- [[Kitting System - Feature Module]] — parent module overview.
