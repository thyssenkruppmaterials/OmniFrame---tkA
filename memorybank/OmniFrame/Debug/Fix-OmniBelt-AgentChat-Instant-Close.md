---
tags: [type/debug, status/active, domain/frontend]
created: 2026-05-24
---
# Fix: OmniBelt Agent Chat — instant-close on launch

## Symptom (live, user-reported)

> "When clicking into the agent chat, it instantly closes."

Reproduction: open the OmniBelt panel → click the Agent Chat tile →
the chat dialog mounts and immediately dismisses itself. The
panel collapses alongside it, returning the user to the resting
Pill / SkyStrip / Orb. Same shape would hit any future tool that
launches a Radix Portal-mounted Dialog, Sheet, or Popover (so this
fix is layered + reusable, not Agent-Chat-specific).

## Root cause (THREE compounding bugs, one symptom)

### Bug 1 — launching click bubbles to the panel's pointerdown listener

The `<OmniBeltPanel>` (Pill skin) and `<OmniBeltSkyStrip>` skins
both wire a window-level **capture-phase** `pointerdown` listener
that calls `setCollapseState('pill')` if the click target is
neither inside the panel nor inside an OmniBelt-owned overlay
(see `src/features/omnibelt/lib/overlays.ts::isOmnibeltOverlayPointerTarget`).

The user's click on `<ToolTile>` opens the shell. The shell mounts
`<AgentChatShell>` → `<AgentChatDialog open>` which renders inside
a Radix Portal at `document.body`. Radix wires its own pointerdown
handler on mount — **but the same click that triggered the open is
still propagating up the DOM** (the React click handler ran in the
same tick, bubble-phase). Because the dialog mounted AFTER the
click started, Radix's outside-click logic sees that target as
"outside the dialog" and fires `onOpenChange(false)` → cascades to
`<AgentChatShell>::onClose` → cascades to the panel's `onClose` →
panel collapses → dialog unmounts.

### Bug 2 — Radix-Portaled dialog DOM is outside the panel subtree

Even after fix #1, every subsequent click *inside* the dialog is
still treated as "outside the panel". Radix renders the dialog at
`document.body`, so its DOM tree is OUTSIDE the panel's
`[data-omnibelt-host]` subtree. The panel's outside-click handler
runs `closest('[data-omnibelt-host]')` on the click target, gets
`null`, runs `isOmnibeltOverlayPointerTarget(target)` to check for
known overlay markers, gets `false` (the helper only recognised
dropdown/tooltip portals), and fires close.

So even with Bug 1 fixed, **typing in the chat input or clicking
any control in the dialog** would close the panel underneath, then
the dialog would unmount via `<AgentChatShell>::onClose`.

### Bug 3 — Radix `modal` default verification

Confirmed not the issue: `<Dialog>` defaults to `modal={true}`
and `<DialogContent>` is wrapped in `<DialogPortal>`. We pinned
the value explicitly (`<Dialog modal>`) so a future change can't
quietly flip it.

## Layered fix

### A. Tag dialog portals as OmniBelt overlay surfaces

Extend `isOmnibeltOverlayPointerTarget` to recognise any DOM node
inside `[data-omnibelt-overlay]`. Tool shells that open a
Dialog/Sheet/Popover via Radix Portal apply the attribute to their
Content node so the panel's outside-click handler skips them.

```ts
// src/features/omnibelt/lib/overlays.ts
export function isOmnibeltOverlayPointerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest('[data-slot="dropdown-menu-content"]') ||
    target.closest('[data-slot="dropdown-menu-sub-content"]') ||
    target.closest('[data-slot="tooltip-content"]') ||
    target.closest('[role="tooltip"]') ||
    target.closest('[data-omnibelt-overlay]')   // ← NEW
  )
}
```

```tsx
// src/features/omnibelt/tools/shells/agent-chat/AgentChatDialog.tsx
<DialogContent data-omnibelt-overlay='true' ...>
```

### B. Stop the launching click from leaking

`<ToolTile>`'s click handler now calls `e.preventDefault()` +
`e.stopPropagation()` for tools with a `shell`. Navigation tools
keep the existing behaviour (the panel collapses naturally when
the route changes anyway).

```tsx
// src/features/omnibelt/panel/ToolTile.tsx
const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
  if (tool.navigationUrl) { /* navigate + close */ return }
  if (tool.shell) {
    e.preventDefault()
    e.stopPropagation()
    onLaunch(tool)
  }
}
```

### C. Confirm `modal={true}`

`<Dialog modal>` set explicitly on `<AgentChatDialog>` so the
default can't silently flip in a future Radix upgrade or local
change.

### D. Regression test

`src/features/omnibelt/tools/shells/agent-chat/__tests__/AgentChatShell.regression.test.tsx`
pins all three layers independently:

- **Layer A.** Dialog content has `data-omnibelt-overlay='true'`.
  `isOmnibeltOverlayPointerTarget` returns `true` for the dialog
  node AND for deeply-nested children (the helper walks back up
  via `closest()`).
- **Layer B.** `<ToolTile>` shell-tool click invokes `onLaunch`
  AND a window-level capture-phase pointerdown listener doesn't
  see the click bubble through (proves stopPropagation took).
- **Layer C.** Dialog content carries Radix's
  `data-state='open'` + `data-slot='dialog-content'` so the modal
  Root is properly mounted (dialog is open and attached, not
  short-circuited by `modal={false}`).
- **Integrated.** A test harness wires the same outside-click
  logic the panel skins use, mounts the shell, and asserts that
  clicks inside the dialog don't trip the close handler — while a
  click on `document.body` does (sanity check the listener is
  wired).

## Files changed

| File | Lines | Change |
|---|---|---|
| `src/features/omnibelt/lib/overlays.ts` | +17 / -1 | Extend `isOmnibeltOverlayPointerTarget` with `[data-omnibelt-overlay]` selector. Export `OMNIBELT_OVERLAY_DATA_ATTR` constant for documentation/future shells. Docstring updated. |
| `src/features/omnibelt/panel/ToolTile.tsx` | +21 / -5 | Import `MouseEvent` type; stopPropagation + preventDefault on shell-tool clicks; switch press transition to `TILE_PRESS_TRANSITION` (cinematic motion polish). |
| `src/features/omnibelt/tools/shells/agent-chat/AgentChatDialog.tsx` | +56 / -22 | Add `data-omnibelt-overlay='true'` on `<DialogContent>`. Set `modal` prop explicitly. Wrap body in two-layer motion.div (outer: cinematic spring scale + slide on mount; inner: variant-driven content stagger so header → message list → composer cascade in). |
| `src/features/omnibelt/tools/shells/agent-chat/__tests__/AgentChatShell.regression.test.tsx` | +213 (new) | Layered regression suite — A, B, C plus integrated harness. |

## Verification

- `pnpm tsc -b` — clean (28 s).
- `pnpm vitest run src/features/omnibelt` — **428/428 passing**
  (was 421/421 pre-fix; +7 new regression tests). Pre-existing
  Supabase auth-js unhandled rejection in
  `useOmnibeltConfigInvalidator.test.tsx` reproduces unchanged on
  `main` — unrelated.
- `pnpm build` — clean. `feature-omnibelt` chunk: 54.8 KB raw
  (motion + overlay constants tree-shake into the tile + dialog
  paths, no separate chunk needed). Orb skin chunk unchanged at
  7.4 KB.

## Lessons — codified

> **Any tool shell that opens a Radix Portal surface (Dialog,
> Sheet, Popover, AlertDialog, …) MUST tag its rendered Content
> with `data-omnibelt-overlay='true'` so the panel skin's
> outside-click handler treats it as OmniBelt-owned.** Without
> this, the dialog mounts in `document.body` outside the panel's
> `[data-omnibelt-host]` subtree and every click inside it is
> read as "click outside the panel" → both surfaces collapse.

> **`<ToolTile>` shell-tool launches MUST stopPropagation.** The
> launching click is still in flight when the dialog mounts; if
> it bubbles to the panel's window-level pointerdown listener,
> the dialog dismisses itself before the user even sees it.

Codified into [[OmniBelt-Floating-Launcher]] §"Tool launch
motion" (motion polish doc) and the panel-skin authoring checklist
in [[Skin-Owned-Morph-States]].

## Related

- [[Implement-OmniBelt-MVP]] — implementation log
- [[OmniBelt-Floating-Launcher]] — pattern doc
- [[Skin-Owned-Morph-States]] — pattern that documents why each
  skin owns its own outside-click handler
- [[Fix-OmniBelt-Orb-Interactivity-And-Skin-Picker]] — sibling
  post-launch fix from the same session
