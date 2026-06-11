---
tags: [type/debug, status/active, domain/frontend]
created: 2026-05-24
---
# Fix: OmniBelt Orb — interactivity + skin-picker escape hatch

## Symptom (live, user-reported)

> "When in orb mode, none of the buttons work, and there is no way for
> me to change it back to another skin."

Two distinct issues, one report. The user picked the Compass Orb skin
from the standard panel's `<PanelMenu>` and got trapped:

1. Clicking shell-backed tool tiles in the radial fan appeared to do
   nothing — the fan just closed silently.
2. There was no UI on the Orb skin itself to switch back to Pill /
   SkyStrip. Closing the fan still left them in Orb-land with the same
   non-working buttons next time.

## Root cause (TWO bugs, one symptom)

### Bug 1 — Radial fan shell-tile clicks were no-ops

`src/features/omnibelt/skins/orb/RadialFan.tsx::launch(tool)` shipped
in P7 as:

```ts
const launch = (tool: ToolDef) => {
  if (tool.navigationUrl) {
    navigate({ to: tool.navigationUrl })
    close()
    return
  }
  // For shell-based tools, the v1 fan deep-links to the OmniBelt
  // admin surface (v1.5 will swap in an inline shell launcher).
  // For now we just collapse, allowing the user to re-open into the
  // Pill skin's Panel grid.
  close()
}
```

That comment block was the bug. **6 of 9 v1 tools are shell-backed**
(`sap_status`, `inventory_lookup`, `background_jobs`, `agent_chat`,
`quick_note`, `build_info`). For all six, `launch()` just called
`close()` — the fan disappeared and nothing else happened. The
fallback ("re-open into the Pill skin's Panel grid") never actually
fires because the user is *on the Orb skin*, not the Pill skin; the
standard panel is suppressed for Orb (see Bug 2's mechanism below).

The orb's own click handler and the fan-tile button handlers both
worked correctly — they fired exactly as wired. The bug was that the
wired behaviour for shell tools was "do nothing useful".

### Bug 2 — Orb suppressed the only UI path to `<PanelMenu>`

`src/features/omnibelt/OmniBeltHost.tsx`:

```ts
const SKINS_USING_SHARED_PANEL: ReadonlySet<Skin> = new Set<Skin>(['pill'])
```

Per spec §7 the Orb skin owns its own `<RadialFan>` expanded surface
and the standard `<OmniBeltPanel>` doesn't render for it. But
`<PanelMenu>` (the `⋮` dropdown with the skin picker + Hide toggle)
lives **inside** the standard panel header:

```tsx
// src/features/omnibelt/panel/PanelContent.tsx
<header className='flex items-center justify-between gap-2'>
  <h2 className='text-sm font-semibold'>OmniBelt</h2>
  <div className='flex items-center gap-1'>
    <PanelMenu />     {/* ← only mount point pre-fix */}
    ...
  </div>
</header>
```

Pill renders the panel → users can pick the skin → flipping to Orb
removes the panel → `<PanelMenu>` unmounts → no more skin picker. The
user is trapped in Orb until they wipe localStorage or sign out.

## Architectural lesson

> **Any skin that opts out of the standard Panel MUST provide its own
> path to skin/visibility settings — otherwise users get trapped in
> that skin.**

The Sky Strip skin doesn't suffer from this because it keeps
`<PanelContent>` (which contains `<PanelMenu>`) in its expanded form
via the [[Skin-Owned-Morph-States]] pattern. The Compass Orb skin
deliberately uses a `<RadialFan>` instead of a full panel grid, which
made Bug 2 inevitable for v1.

Going forward: any new skin's checklist must include "skin picker
reachable from the skin's resting chrome".

## Fix

### Approach selected — Approach A from the task brief

Add a small `⋮` overflow button to the orb's top-right corner that
opens the same skin picker. Sidesteps both bugs:

- Bug 2 directly: the skin picker is always one click away from the
  orb.
- Bug 1 indirectly: even if a shell tool's tile didn't launch
  anything useful, the user could always escape back to Pill (which
  does work). The fix also addresses Bug 1 head-on (see below).

Rejected approaches:

- Approach B (settings tile in the radial fan) — less discoverable;
  the user has to know to expand first.
- Approach C (extend the right-click "Move to corner" menu) — the
  Orb doesn't currently expose a right-click menu, and right-click
  discoverability is poor.
- Approach D (mount `<PanelMenu>` at the host level above every
  skin) — biggest refactor; bleeds the panel's chrome into the host
  layer.

### Changes landed

| File | Lines | Change |
|---|---|---|
| `src/features/omnibelt/panel/PanelMenu.tsx` | +30 / -10 | Extract `<PanelMenuContent />` (the body) from `<PanelMenu>` so the orb can mount the same menu items under its own trigger. `<PanelMenu>` now thinly wraps it via `<DropdownMenu>` + default trigger. |
| `src/features/omnibelt/panel/PanelContent.tsx` | +18 / -2 | Add optional `initialActiveTool?: ToolDef \| null` prop so the orb's shell popover can boot straight into the chosen shell instead of redundantly rendering the grid first. |
| `src/features/omnibelt/skins/orb/OmniBeltOrb.tsx` | +90 / -30 | Wrap the orb in a positioning anchor div, mount the orb button + a sibling overflow trigger inside it (HTML disallows nested `<button>`s). Overflow opens a `<DropdownMenu>` whose content is the shared `<PanelMenuContent />`. Move the status dot to the top-LEFT to leave the top-right corner clear. Manage local `activeShellTool` state; mount `<OrbShellPopover>` when a shell tool is launched. Pass `onLaunchShell` callback into the fan. |
| `src/features/omnibelt/skins/orb/RadialFan.tsx` | +20 / -6 | Accept optional `onLaunchShell?: (tool: ToolDef) => void`. For shell-backed tools, delegate to the host skin instead of silent `close()`. Navigation tools still navigate+close as before. |
| `src/features/omnibelt/skins/orb/OrbShellPopover.tsx` | +130 / 0 | NEW. Glass card popover anchored above the orb that renders `<PanelContent initialActiveTool={tool}>`. Esc + click-outside dismissal mirrors `<OmniBeltPanel>` and `<RadialFan>`. Lazy-imported from `<OmniBeltOrb>` so the popover (and the lazy tool shell it eventually loads) stay out of the orb skin's first-paint cost. |

Tests updated:

- `OmniBeltOrb.test.tsx` — added DOM-structure regression
  (`omnibelt-orb-anchor` wraps both the orb button and the overflow
  trigger), overflow a11y label assertion, full skin-picker
  round-trip (renders pill/orb/skystrip options; clicking pill/
  skystrip dispatches `setSkin`), `e.stopPropagation()` guard
  assertion (clicking the overflow button does NOT also fire the
  orb's `setCollapseState` toggle).
- `RadialFan.test.tsx` — added "each tile is a real `<button>` with
  role=menuitem" structural assertion, navigation-tool-ignores-
  callback assertion, shell-tool-invokes-callback assertion (the
  Bug 1C regression test), legacy-fallback assertion (no callback
  supplied → fan still collapses cleanly).
- `PanelMenu.test.tsx` — added `<PanelMenuContent />` standalone test
  block proving it renders the skin radio group + dispatches
  `setSkin` / `setUserHidden` without the surrounding `<DropdownMenu>`
  wrapper. A regression that would re-couple `<PanelMenuContent />`
  to Radix's menu context fails this test.

## Why the e.stopPropagation guard matters

The orb is a `<button>` and the overflow is a sibling `<button>` inside
the same `width: ORB_SIZE × ORB_SIZE` positioning wrapper. The orb's
hit area is the full bounding box rect (not the visible
`rounded-full` circle), so the top-right corner where the overflow
sits is ALSO inside the orb's hit area.

Without `e.stopPropagation()` on the overflow's `onClick`, clicking
it would:

1. Fire the overflow button's `onClick` → opens the dropdown
   (via Radix).
2. Bubble through the wrapper → React's synthetic event delegation
   sees the click as also targeting the orb button (because they
   share the same wrapper coordinate space).

Actually — synthetic events bubble from `event.target` up through
`event.target`'s ancestors, not through siblings. The orb is a
sibling of the overflow, not an ancestor. So a sibling-click doesn't
strictly bubble to the orb. **BUT**: framer-motion's `motion.button`
has its own pointer-event normalisation, and Radix DropdownMenu's
trigger may dispatch synthetic events on the trigger button itself.
Adding `stopPropagation` is cheap insurance against either runtime
re-dispatching the click in a way that lands on the orb.

The OmniBeltOrb test pins this guard in place with an explicit
assertion (`clicking the overflow button does not also fire the orb
toggle`) so a future "simplification" that removes it fails loudly.

## Verification

```bash
cd /Users/jaisingh/Documents/Projects/OneBoxFullStack
pnpm tsc -b                                   # exit 0
pnpm vitest run src/features/omnibelt        # 421 passed (28 files)
pnpm build                                   # exit 0
ls -la dist/assets/ | grep omnibelt
# feature-omnibelt-skin-orb-*.js              7,360 bytes (~3 KB gzip)
```

Pre-existing failures (NOT caused by this fix):

- `pnpm vitest run` shows one unhandled rejection from
  `@supabase/auth-js` inside
  `src/features/omnibelt/__tests__/useOmnibeltConfigInvalidator.test.tsx`
  (`storage.getItem is not a function` from
  `SupabaseAuthClient.__loadSession`). Pre-existing — comes from
  the test's fake storage shim missing `getItem`. Unrelated to the
  orb skin.
- `pnpm lint:check` reports 98 warnings against the 16-warning lint
  ratchet baseline. Pre-existing — the baseline is stale (snapshot
  from 2026-02-28). No new warnings were introduced by this fix
  (verified via the per-file ReadLints check: only the pre-existing
  `z-[55]`, `z-[58]`, and `bg-gradient-to-br` Tailwind-v4-idiom
  warnings remain).
- `scripts/check-bundle-budget.mjs` reports 3 chunks over the 500 KB
  limit (`warehouse-location-map`, `feature-admin`,
  `feature-rf-interface`). Pre-existing, no orb chunk involved.
  Orb chunk is 7.4 KB raw (well under the 20 KB ceiling the fix
  brief allowed for the overflow button + PanelMenu reuse +
  shell-popover delegation).

## Bonus polish

While in the file:

- Moved the status dot from top-RIGHT to top-LEFT so it no longer
  competes with the overflow button for the prime corner. Status dot
  is still a 10 px teal-400 pulsing dot, just on the opposite side.
- The popover gets the same `data-omnibelt-host` short-circuit on its
  click-outside handler that `<OmniBeltPanel>` uses, so clicking the
  orb after a shell launch toggles back to a clean state instead of
  double-firing (once for the popover dismissal, once for the orb's
  own toggle).

## Related

- [[Implement-OmniBelt-MVP]] — Post-launch fixes section updated
- [[Skin-Owned-Morph-States]] — SkyStrip's pattern that the Orb
  deliberately doesn't follow (it owns radial-fan + popover instead
  of a single layoutId morph). The trade-off is per-skin: radial
  fan reads as discrete quick-launch tiles; layoutId morph reads as
  a single chrome that grows. Both are valid; Orb chose discrete.
- [[OmniBelt-Floating-Launcher]] — Site-wide launcher pattern;
  this fix extends the "every skin must have an escape hatch"
  invariant.
- `src/features/omnibelt/skins/orb/OmniBeltOrb.tsx` — Implementation
