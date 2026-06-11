---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-17
---

# Hold-To-Confirm Gesture

## Purpose / Context

A deliberate-confirmation pattern for UI actions that have **no other
verification gate** (no barcode to scan, no second-factor check, no
system-side cross-reference) and where a single accidental tap would
cause a meaningful operator-side error.

The canonical use case is the **RF Kit Picking floor-bin confirmation
step**: floor bins (`K…` / `S…`) have no printed barcode, so the only
correctness gate between the operator and a wrong-bin pick is visual
recognition. A normal button is too easy to misfire (glove-knock,
accidental scanner trigger, pocket tap). A modal `Are you sure?` slows
down the loop and is hand-wavy. A typed challenge ("type the last 2
digits") adds keystrokes that are painful on RF terminals with software
keyboards.

**Press-and-hold for ~800ms** sits in the sweet spot: single-handed,
impossible to misfire, gives strong visual feedback as the button fills,
and reuses muscle memory operators already have from native phone/tablet
long-press gestures.

## When to Use

- The action commits an operator decision that the **server cannot
  validate** (e.g. "I am physically at this bin").
- A single tap would be wrong if misfired.
- The screen real estate / UX cost of a typed confirmation or modal is
  too high (RF terminals, gloves, time pressure).

## When NOT to Use

- The action is **scan-validated** by the server — the scan IS the
  safeguard. Use a regular button + `Enter` auto-advance.
- The action is reversible with no side-effect downstream (e.g.
  navigation back, opening a panel).
- The action is happening on a **mouse-only** desktop surface where
  pointer-leave during a 1-second hold is very common (use a typed
  confirmation or `Tab → Enter` two-key path instead).

## Implementation Recipe

1. **Hold duration.** Use `800ms` (`HOLD_TO_CONFIRM_MS` in
   `rf-kitting-picking-form.tsx`). This is the same value as
   `autoAdvanceDelay` in the kit-picking form — semantically
   consistent "deliberate confirmation" timing across the surface. Do
   not go below `500ms` (too easy to misfire) or above `1500ms`
   (operators think it's broken).

2. **Progress bar must be visible during the hold.** A flat-fill bar
   spanning the button's surface (`absolute inset-y-0 left-0` + dynamic
   `width: ${progress}%`) is enough. Drive the progress via
   `requestAnimationFrame` for a smooth fill — `setInterval(60ms)`
   stutters on slower RF hardware.

3. **Cancel on release.** `onPointerUp`, `onPointerLeave`,
   `onPointerCancel` all reset progress to `0`. Releasing the finger
   early is a deliberate "cancel" gesture — do not commit on a partial
   hold.

4. **Keyboard parity.** `Space` / `Enter` on `keyDown` starts the hold,
   `keyUp` cancels. Use `!e.repeat` on `keyDown` so autorepeat doesn't
   reset the timer.

5. **Latch on completion.** Set `isDone = true` once the timer fires.
   Disable the button so a fast double-press cannot accidentally fire
   the parent callback twice (the parent will likely swap the step on
   the next render, but defensive latching prevents the race).

6. **Defer the callback by one frame.** `setTimeout(onConfirm, 30)`
   after `setIsDone(true)` so the filled progress bar paints once
   before the parent unmounts the button. Without this, the button
   snaps to its swap state mid-animation and operators see a jarring
   half-fill.

7. **Disable native gestures on the button surface.**
   `select-none touch-none` + `onContextMenu={(e) => e.preventDefault()}`
   to suppress text selection, iOS Safari magnification, and Android
   Chrome long-press menus.

8. **Label progression.** Three states: idle (`Hold to Confirm — K1-34-03-2`),
   holding (`Keep Holding…`), done (`Location Confirmed` + `CheckCircle`
   icon). The bin label inside the idle text is critical — it lets
   the operator double-check the bin name they're about to commit to
   without taking their eyes off the button.

## Reference Implementation

See the `HoldToConfirmButton` sub-component in
`src/components/ui/rf-kitting-picking-form.tsx` (~lines 219-345).
Self-contained: takes only `onConfirm`, `label`, `holdingLabel`,
`doneLabel`, `disabled`, and an optional `className`. Manages its own
progress / done / holding state via local `useState` + `useRef` for the
rAF id.

## Related

- [[RF-Kit-Floor-Pick-Visual-Confirm]] — the canonical consumer.
- [[UI-Component-Conventions]] — broader UI conventions; this pattern
  follows the same `data-slot` / `cn()` / Tailwind-only conventions.
- [[RF Interface - Feature Module]] — the RF surface where this pattern
  is currently the only consumer.
