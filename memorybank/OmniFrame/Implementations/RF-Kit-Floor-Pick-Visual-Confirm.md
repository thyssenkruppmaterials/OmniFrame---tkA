---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-05-17
---

# RF Kit Floor-Pick — Visual Confirmation (No-Barcode Bins)

## Purpose / Context

In the RF Kit Picking flow (`src/components/ui/rf-kitting-picking-form.tsx`),
the `Confirm Location` step (internal `currentStep === 'scan_location'`)
asked the operator to scan the bin barcode for **every** pick — both
**rack** picks (R bins, which DO have printed barcodes) and **floor**
picks (K/S bins, which **do not**). Floor pickers were stuck staring at
an input that could never be satisfied; the flow was soft-blocked.

The physical reality:

- **Rack bins (R…)** — individual bin labels with barcodes are printed
  and affixed on each shelf slot. Scan-to-confirm works.
- **Floor bins (K… / S…)** — large floor-level bulk locations.
  No printed barcode per bin. The operator visually identifies the bin
  by aisle / row paint / overhead signage.

The service-layer classification
(`rf-kitting-picking.service.ts`, `loadKitPayloadBySerial` — lines ~478)
already splits a kit's TO rows into `floor_pick_items` (K/S prefix) vs
`rack_pick_items` (R prefix). This change branches the form's UI on the
same prefix and replaces the scan input on the floor path with a
**press-and-hold visual confirmation** (see [[Hold-To-Confirm-Gesture]]).

## Behaviour Change (Operator's View)

| Scenario | Before | After |
|---|---|---|
| Floor pick (K1-34-03-2, no barcode) | `Confirm Location` step asked to scan the bin barcode. Operator had nothing to scan, was soft-blocked. | Giant `K1-34-03-2` label fills the screen + `Hold to Confirm — K1-34-03-2` button. Operator holds for ~800ms, advances to `scan_part`. |
| Rack pick (R… with barcode) | Scan-to-confirm. | **Unchanged.** Same scan input, same auto-advance on match, same `validateLocation` gate. |
| Bin with no recognised prefix (defensive) | Scan-to-confirm. | Same scan-to-confirm fallback. (The service would have dropped such rows from both `floor_pick_items` and `rack_pick_items` upstream — the form should never see them.) |

## Chosen Confirmation Pattern: Press-and-Hold (~800ms)

The task brief offered three candidates; here's why each was considered
and why hold-to-confirm won:

| Pattern | Why considered | Why rejected / chosen |
|---|---|---|
| **Typed-confirm** ("type last 2 digits of bin") | Strongest explicit cognitive check. | Painful on RF terminals with software keyboards. Adds keystrokes to every floor pick — amplified by the fact that floor picks dominate kit picking (most BOM materials live on the floor). |
| **Brief tap-debounce (~400ms)** | Cheapest UX. | Operators interpret a sluggish button as "broken" and tap multiple times. Doesn't actually block accidental taps — it just delays them. |
| **Press-and-hold (~800ms)** | Single-handed; visually-fed-back; hard to misfire on glove-knock or accidental scanner trigger; matches modern RF UX (Zebra / Honeywell apps). | **Chosen.** Reuses the existing `autoAdvanceDelay = 800` constant so the form has one "deliberate action" tempo across the whole flow. |

The `800ms` duration is deliberately the same constant as the form's
existing `autoAdvanceDelay` — see the inline comment near
`HOLD_TO_CONFIRM_MS`. Operators learn one "deliberate action" timing
and apply it everywhere on this surface.

### Mirror of an Existing No-Barcode Pattern

The form ALREADY has a no-barcode confirmation flow on the **part**
step: `visuallyVerifiedPart` (Checkbox + amber `Confirm Visual
Verification` button). That pattern is fine when the operator can
double-check the on-screen text (the part number) against a physical
label they're holding — a single tap is sufficient.

For the **location** step, there is no second source-of-truth to
cross-check (just bin signage on the floor), so a stronger gesture is
warranted. Press-and-hold is the natural escalation — same intent
("operator attests no-barcode action"), stronger commit gesture.

## Files Touched

### `src/components/ui/rf-kitting-picking-form.tsx`

- **New helper** `isFloorBin(sourceStorageBin)` and constant
  `FLOOR_BIN_PREFIXES = new Set(['K', 'S'])` near the top of the file.
  Matches the service-layer classification (K/S = floor) so the
  rendering branch stays in lockstep with the data slicing. Defensive
  for empty / null / non-K/S inputs — falls back to the existing scan
  UI, even though the service today filters those rows out upstream.
- **New sub-component** `HoldToConfirmButton` (and `HOLD_TO_CONFIRM_MS
  = 800`). Self-contained: takes `onConfirm`, `label`, `holdingLabel`,
  `doneLabel`, optional `disabled` / `className`. Drives the fill bar
  via `requestAnimationFrame`, cancels on `pointerUp` / `pointerLeave`
  / `pointerCancel`, latches on completion to prevent double-fire,
  defers `onConfirm` by one frame so the filled bar paints before the
  parent swaps the step. Keyboard parity via `Space` / `Enter` with
  `!e.repeat` to avoid autorepeat resetting the timer.
- **Step 4 branch.** `scan_location` JSX now branches on
  `isFloorBin(state.currentItem.source_storage_bin)`:
  - **Floor branch:** big `MapPin` icon, `Confirm Location` heading,
    "Floor bin — no barcode. Visually confirm you are at this bin."
    sub-copy, a `Card` with the bin name at `text-5xl sm:text-6xl`
    + `font-mono font-extrabold` (much larger than the today
    `text-lg` baseline — visual recognition is the only safeguard),
    a `Part` / `Qty` mini-grid below, then the `HoldToConfirmButton`
    labelled `Hold to Confirm — ${bin}`. On confirm, advances
    directly to `scan_part` and toasts `Location confirmed (visual)`
    — bypasses `validateLocation` because there is no scanned value
    to validate.
  - **Rack branch:** the existing scan-to-confirm UI verbatim,
    untouched.
- **Internal step value preserved.** Both branches use
  `currentStep === 'scan_location'` — no new step enum entry. This
  guarantees any downstream telemetry that ever reads the step value
  sees no regression. Per [[Fix-Worker-Heartbeats-Stale-Task-Type]]
  this form does not currently push task state to the parent
  (confirmed sibling-form sweep), but keeping the step name identical
  future-proofs the change against any later telemetry coupling per
  [[Decisions/ADR-RF-Activity-Telemetry]].

### No other files touched.

Database / picking service write paths are **unchanged**. The
`visual_pick_verification_flag` column in `RR_Kitting_DATA` still
tracks **part-level** visual verification (set by `markLinePicked`
when `visuallyVerifiedPart` was checked on the `scan_part` step).
Location-level visual confirmation is a UI-only gesture today — the
fact that K/S bins are floor picks is already implicit in the
`source_storage_bin` value on every row, so no new column is needed.
If an audit requirement emerges later (e.g. "prove the operator
actually held the button"), a separate `location_visual_confirm_at`
timestamp column can be added without changing this UX.

## Validation

- `pnpm exec tsc -b --noEmit` — **clean**.
- `pnpm exec eslint src/components/ui/rf-kitting-picking-form.tsx`
  returns `File ignored because of a matching ignore pattern`. The
  `src/components/ui/` folder is project-ignored by ESLint (existing
  convention noted in
  [[Kit-BOM-Chains-Expedites-And-INCORA-Component]] and the prior
  [[RF-Kit-Pick-By-Serial-Number]] session log).
- `pnpm build` — **succeeds**. `feature-rf-interface` chunk:
  `516.42 KB → 520.88 KB` (`+4.46 KB`). Measured by stashing the touched
  source file + clean rebuild, then restoring + clean rebuild.
  Within the user's stated `<5 KB` task budget. The chunk is already
  over the per-chunk 500 KB budget on `main` (pre-existing, called out
  in the task brief); existing oversized chunks
  (`warehouse-location-map` 1523.44 KB and `feature-admin` 1013.81 KB)
  remain out of scope.
- No new unit tests added — there is no existing test file for the
  form (`rf-kitting-picking-form.tsx`) and `src/components/ui/` is
  excluded from the test glob anyway. The press-and-hold gesture is
  driven by `requestAnimationFrame` and `PointerEvents` which are
  awkward to assert deterministically under `jsdom`; the gesture-only
  surface area is small and self-contained inside `HoldToConfirmButton`.
  Visual-regression / e2e coverage is the more honest gate; not in
  scope for this slice.

## Edge Cases

- **Bin with empty `source_storage_bin`.** `isFloorBin` returns `false`
  (defensive guard against null/undefined/''). The form falls through
  to the scan UI. The service today filters such rows out of both
  `floor_pick_items` and `rack_pick_items` upstream, so the form
  should never see one in production.
- **K-prefixed bin misclassified.** The K prefix is the canonical
  marker (`Bins starting with K or S` per
  [[Components/KittingServices - Supabase Service]]'s
  `RFKittingPickingService` workflow doc). If a future bin-naming
  scheme breaks the K/S ↔ floor convention, both the service
  classification AND this UI branch will need updating in lockstep —
  noting the coupling here as a discoverability anchor.
- **Operator releases the hold early.** Progress resets to 0;
  `onConfirm` is NOT fired. The operator must restart the hold.
- **Operator's finger slides off the button mid-hold.**
  `onPointerLeave` cancels. Same as above.
- **Double-tap after success.** `isDone` latches; the disabled state
  blocks any subsequent press. The parent typically unmounts the
  button on the next render anyway (`currentStep` flips to
  `scan_part`), but the latch prevents the race.
- **iOS Safari long-press magnifier / Android Chrome long-press
  menu.** Suppressed via `touch-none select-none` +
  `onContextMenu={(e) => e.preventDefault()}`. Validated mentally
  against Capacitor RF builds (the form ships inside the iOS
  Capacitor wrapper — see `ios/` directory + `Capacitor.isNativePlatform()`
  branching in `src/main.tsx`).
- **Scanner accidentally triggers while the operator is reading the
  big bin label.** Scanner input would land in the document but there
  is no focused input on the floor path — the giant bin label and
  the hold button are both inert text / button elements. Stray
  characters go nowhere. Compare with the rack-path scan input,
  which deliberately consumes the scanner's keystrokes.
- **Operator at the WRONG bin holds anyway.** This is the residual
  failure mode. The mitigation is the giant on-screen bin name —
  the operator must read it before holding. Future hardening: pair
  the visual confirmation with a downstream sanity check (e.g. flag
  when the picked part doesn't match expected at `scan_part`, which
  the form already does via `validateMaterial`). The wrong-bin failure
  is therefore caught at the part step, not the location step — the
  cost is one extra step before the operator notices.

## Backward Compatibility

- **Rack picks are bit-for-bit unchanged.** The scan UI, the auto-advance
  timer on `scannedLocation`, the `Enter` key handler, the
  `validateLocation` gate, the `Back` button — all unchanged. Operators
  on rack-only kits see no difference at all.
- **Service surface unchanged.** No new methods, no signature changes,
  no schema migrations. `markLinePicked` still receives
  `visuallyVerified` (which is the **part-level** verification flag
  written to `visual_pick_verification_flag`); location-level visual
  confirmation is a UI-only gesture today.
- **Step enum unchanged.** No new `PickingStep` value. The internal
  step name stays `'scan_location'` on both branches — preserves any
  future telemetry that reads the step value.
- **No new Realtime channels.** Per `Master Rule workspace rule`
  "Realtime Policy". This change is entirely client-side; no
  `supabase.channel(...)` callsite added.

## Related

- [[Hold-To-Confirm-Gesture]] — the pattern note distilled from this
  implementation; covers the recipe (RAF, pointer cancel, keyboard
  parity, label progression) for future consumers.
- [[Kitting System - Feature Module]] — the parent module.
- [[RF Interface - Feature Module]] — the RF surface where the form
  lives.
- [[KittingServices - Supabase Service]] — service-layer surface
  (specifically `RFKittingPickingService` and its K/S vs R bin
  classification at `loadKitPayloadBySerial`).
- [[RF-Kit-Pick-By-Serial-Number]] — today, sibling RF kit-picking
  UX work (different step: kit-scan smart-detect vs floor location
  confirmation).
- [[Fix-Worker-Heartbeats-Stale-Task-Type]] / [[Implement-RF-Activity-Telemetry-In-LiveOperatorStatus]] — the sibling-form sweep that confirmed this
  form does not currently push task state to the parent, so there is
  no `current_step` callback to keep in lockstep.
- [[UI-Component-Conventions]] — the form follows these existing
  conventions (PascalCase, Tailwind-only, `cn()` merging).
