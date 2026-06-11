---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-05-18
---

# Black Hat Ship-Short Authorization Panel

## Purpose / Context

Kits that the BOM-coverage matcher cannot fully cover via imported TO
rows / INCORA items / existing ship-short entries are auto-flagged
**Black Hat** by `recheckBomCoverageBySerial` and **RF Kit Picking is
blocked** until the flag clears
([[Authorized-Ship-Short-Negates-Black-Hat]]).

The sibling note [[Edit-Ship-Short-Post-Creation-Flow]] added an
`Edit Ship Short` button to the Kit Build Audit Trail (Quick View) so
an operator can authorize ship-shorts after the fact and let the
auto-Black-Hat self-clear. That button works but it's _buried_ in the
top-bar of a wide dialog and operators on the kanban board don't
inherently connect the "Black Hat — Picking Blocked" badge on the
kit card to the small amber button in the dialog header.

This implementation closes that UX gap with an **inline panel** that
renders only when (a) the kit has an active Black Hat flag, AND (b)
the org has the policy enabled. The panel:

1. Lists the exact BOM components driving the Black Hat (one row each).
2. Lets the operator authorize ship-short **line by line** with a
   per-line justification field.
3. Saves into the kit's `authorized_ship_short_items` (merging with
   any pre-existing entries), which re-runs BOM coverage and
   auto-clears the Black Hat the moment every missing line is
   covered.

The legacy top-bar `Edit Ship Short` button stays — it remains the
power-user shortcut for free-form authorizations.

## Architecture

```
Kanban card → Quick View (KitProductionTrackerDialog)
  └─ Active Black Hat? + policy.enabled?
        └─ <BlackHatShipShortPanel>
              ├─ getMissingBomComponentsBySerial(serial)
              │     → structured list of unmatched BOM components
              ├─ Per-row Authorize checkbox + Justification input
              ├─ Optional "Authorize All Missing" button
              │     (hidden when requireLineByLineApproval = true)
              └─ Save
                    └─ merge with existing → updateAuthorizedShipShortItems
                          └─ recheckBomCoverageBySerial
                                └─ addFlag('black') / clearFlagByType('black')
```

## Files

### Database

- **`supabase/migrations/312_kitting_workflow_settings_black_hat_ship_short.sql` (NEW)** —
  Adds three boolean columns to `kitting_workflow_settings`:
  - `black_hat_ship_short_authorization_enabled` (DEFAULT TRUE)
  - `black_hat_ship_short_require_justification` (DEFAULT TRUE)
  - `black_hat_ship_short_require_line_by_line_approval` (DEFAULT TRUE)

  All NOT NULL with sensible defaults so every existing row
  auto-picks up the policy. Pattern matches
  [[Optional-Kit-Inspection-Toggle]] — same table, sibling flags,
  no new table per setting. Applied to `wncpqxwmbxjgxvrpcake` via
  Supabase MCP `apply_migration`; schema verified via
  `information_schema.columns`.

### Service / Hooks

- **`src/lib/supabase/kitting-workflow-settings.service.ts`** —
  `KittingWorkflowSettings` interface extended with the three new
  flags; `KITTING_WORKFLOW_DEFAULTS` updated. Introduced a new
  exported `KittingWorkflowSettingsUpdate` type so the service
  signature and the hook's mutation share one source of truth.
- **`src/hooks/use-kitting-workflow-settings.ts`** — exposes
  `blackHatShipShortPolicy: { enabled, requireJustification,
  requireLineByLineApproval }` and three setter functions. Added a
  convenience read-only hook `useBlackHatShipShortPolicy()` for the
  panel.
- **`src/lib/supabase/rr-kitting-data.service.ts`** — New static
  method `getMissingBomComponentsBySerial(kitSerialNumber)` returns
  the structured list of unmatched BOM components driving the
  Black Hat. Resolves `kit_definition_id` from any TO row on the
  kit so the panel only needs the serial. Mirrors the matching
  logic in `recheckBomCoverageBySerial` (the function that
  _mutates_ the flag) but does not write — pure read sibling.

### UI

- **`src/components/kitting/black-hat-ship-short-panel.tsx` (NEW)** —
  The panel component. Self-hides when `policy.enabled === false`
  OR `hasActiveBlackHat === false`. Pre-seeds rows that are already
  in `authorized_ship_short_items` as "checked" (with their
  existing description) so opening the panel on a partially-authorized
  kit shows the operator's prior work. Pre-submit guard blocks
  saves when `policy.requireJustification === true` and any
  selected line has an empty description.

  Per-row UI distinguishes three BOM component types:
  - **material** — vanilla material number, freely authorizable.
  - **incora_component** — material number tagged with `INCORA
    Component` badge.
  - **incora_sub_kit** — `INCORA Sub-Kit` badge, **checkbox
    disabled** with explanatory copy: "INCORA Sub-Kit rows cannot
    be cleared via ship-short — add the INCORA reference to the
    kit's INCORA Items list instead." Matches the matcher logic
    in `recheckBomCoverageBySerial` which explicitly excludes
    sub-kits from ship-short coverage.

  Merges new authorizations with existing `authorized_ship_short_items`
  (dedup by `partNumber` uppercased + trimmed) and caps at 7 to
  honour the existing service-side cap. Calls
  `updateAuthorizedShipShortItems` which re-runs BOM coverage; toast
  variants honour `flagCleared` / `bomCoverageComplete` exactly
  like the legacy [[Edit-Ship-Short-Post-Creation-Flow]] dialog so
  operators get one consistent mental model.

- **`src/components/kitting/kit-production-tracker.tsx`** — Added
  `hasActiveBlackHat` derived from `activeFlags`; mounted the
  `<BlackHatShipShortPanel>` between the Kit Information card and
  the Timeline & Dates card (so the operator sees it _first_ when
  they scroll, which is the right priority for a picking-blocked
  kit). New `handleBlackHatPanelSaved` callback appends an audit-trail
  chat message and reloads the kit details.

- **`src/components/kitting/kitting-option-manager.tsx`** — Extended
  the existing Workflow Settings card with a new
  **Black Hat Ship-Short Authorization** sub-section containing
  three switches (matching the three new policy columns). Child
  controls are disabled when the master toggle is off so the UI
  reflects the cascading semantic.

## Policy semantics

| Flag | Default | Effect when ON | Effect when OFF |
|---|---|---|---|
| `enabled` | TRUE | Inline panel renders in Quick View for Black-Hat kits | Panel hidden; only legacy `Edit Ship Short` button works |
| `requireJustification` | TRUE | Empty description blocks the save; UI nudges with `border-destructive` styling | Description is optional; empty saves succeed |
| `requireLineByLineApproval` | TRUE | No bulk button; each line must be ticked individually | `Authorize All Missing` button pre-selects every authorizable row |

All three default TRUE so a never-touched org sees the strictest
behaviour out of the box — matches operator-team intent ("approved
line by line for everything that is considered a black hat") and
makes the implicit audit trail (mandatory justification) the
default.

## Edge cases handled

- **Kit has no linked `kit_definition_id`.**
  `getMissingBomComponentsBySerial` returns an empty list with
  `success: true`. Panel shows the "Could not resolve" amber
  fallback alongside an explanation that points to the legacy
  button + manual flag-clear path. (This case is rare — a kit
  with no linked definition cannot have been auto-Black-Hatted in
  the first place; only manual Black Hat flags hit this branch.)
- **INCORA Sub-Kit rows.** Disabled with explanatory copy (see
  above). The matcher in `recheckBomCoverageBySerial` already
  excludes these from ship-short coverage.
- **Pre-authorized rows.** Re-rendering the panel after a
  partial save pre-seeds the prior rows as `authorized` with the
  saved description, so the operator can see what's already on
  the list without leaving the panel.
- **Service-side cap of 7 items.** The merge logic
  (`...existingPreserved, ...newlyAuthorized`) is `slice(0, 7)`'d
  before the service call. This matches
  `updateAuthorizedShipShortItems`'s sanitiser which also caps
  at 7 (defensive — both sides enforce).
- **Race vs. `appendTOsToKit`.** New TO rows always inherit the
  current `authorized_ship_short_items` snapshot from the first
  row at append time (line ~4010 of `rr-kitting-data.service.ts`),
  so concurrent authorizations don't strand new TOs with a stale
  list.
- **Policy flipped OFF after partial authorizations.** Existing
  `authorized_ship_short_items` are preserved — the panel just
  hides. The legacy `Edit Ship Short` button continues to honour
  the list. Coverage logic doesn't care about the policy flag.

## Validation

- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm exec eslint <touched files>` — clean.
- `pnpm exec vitest run src/lib/supabase/__tests__/kit-serial-scoping.test.ts`
  — **25 of 26 pass**. The 1 failure is the pre-existing
  `createKitBuildPlan kanban link stamp` date-bomb (hardcoded
  `KIT-20260512-006` vs today's `KIT-20260518-001`) noted in
  [[Optional-Kit-Inspection-Toggle]] and [[RF-Build-Kit-By-Serial-Number]]
  as out-of-scope.
- `pnpm build` — succeeds. `kit-bom-settings` chunk:
  **42.59 → 45.46 KB (+2.87 KB)**. Settings surface is lazy-loaded
  so this is off the RF hot path. Bundle-budget pre-existing
  failures on `warehouse-location-map`, `feature-admin`, and
  `feature-rf-interface` chunks are unrelated (same baseline as
  [[Optional-Kit-Inspection-Toggle]]).
- **Migration applied** to `wncpqxwmbxjgxvrpcake` via Supabase
  MCP `apply_migration`. Schema verified via
  `information_schema.columns` — all three new boolean columns
  present with `is_nullable = NO` and `column_default = true`.

## Realtime policy compliance

No new `supabase.channel(...)` callsites. The policy values are
fetched via the existing TanStack Query cache key
`['kitting-workflow-settings', orgId]` (5-min `staleTime`) and
invalidated on the mutation that flips them, matching the
realtime exemption pattern documented in [[Master Rule]]
→ Realtime Policy.

## Future work

- **RF surface.** Replicate the panel on the RF Kit Picking blocked
  screen so operators can authorize on the spot from the device
  without bouncing back to the desktop Audit Trail. Reuse the new
  service method as-is and inline a touch-friendly variant of the
  panel.
- **Bulk authorize across kits.** A team-lead screen that shows
  every Black-Hat-blocked kit in the queue and allows a single
  authorization to cover the same part number across multiple
  kits in one round-trip. Service method would be a thin loop over
  the existing per-kit one.
- **Approver role.** If audit pushes back on operators self-
  authorizing, add a `black_hat_ship_short_require_supervisor_approval`
  flag (same table) that gates the save behind a supervisor-tier
  permission check.

## Related

- [[Authorized-Ship-Short-Negates-Black-Hat]] — the matcher that
  this panel relies on to auto-clear the Black Hat.
- [[Edit-Ship-Short-Post-Creation-Flow]] — the legacy power-user
  button that this panel sits alongside (intentionally additive).
- [[Optional-Kit-Inspection-Toggle]] — same table
  (`kitting_workflow_settings`), same sibling-flag pattern.
- [[Kit-Serial-Scoping]] — the per-serial convention every kit
  mutation now follows; the panel's service calls all key on
  `kit_serial_number`.
- [[Kitting System - Feature Module]] — parent module overview.
- [[KittingServices - Supabase Service]] — service catalogue;
  the new `getMissingBomComponentsBySerial` method should be
  added there.
