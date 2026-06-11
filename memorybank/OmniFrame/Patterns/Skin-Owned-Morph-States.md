---
tags: [type/pattern, status/active, domain/frontend, domain/animation, scope/omnibelt]
created: 2026-05-24
related: [[OmniBelt-Floating-Launcher]], [[Cinematic-Tab-Rotation]], [[Implement-OmniBelt-MVP]]
---
# Skin-Owned Morph States

## When to use

Use this pattern when a UI surface has **multiple visual states**
(collapsed / expanded / nub / orb / etc.) AND those states are tied
to a **specific skin/anchor**, AND you want the transition between
states to feel like one continuous physical object morphing — the
iOS Dynamic Island primitive.

Concrete triggers:

- You need a `motion.div layoutId={X}` morph between two distinct
  shapes (e.g. a 220×40 strip → 760×380 panel).
- The two shapes anchor in skin-specific positions (bottom-center
  for SkyStrip, top-center for a hypothetical "TopBar" skin, etc.)
  — i.e. the singleton "shared expanded surface" can't decide where
  to render without skin-specific knowledge.
- You want to avoid coordinating mount/unmount across two
  independent components (the parent host + the singleton panel).
- The skin's expanded form reuses an extractable inner UI but its
  positioning/chrome differs from any other skin.

## When NOT to use

- The expanded form is **identical** across all skins (a true
  singleton panel that just anchors to a per-skin handle). Use the
  Pill-skin pattern instead: one `<OmniBeltPanel>` rendered by the
  host, anchored via `useOmnibeltPosition`.
- There's only one state (no morph) — use a plain `motion.div`
  with `initial`/`animate`/`exit` props.
- The skins fundamentally don't share inner UI — then each skin
  owning its own panel is just normal "no-shared-component"
  architecture, not this pattern.

## The pattern

**A skin component owns all of its visual states.** When the user
flips between collapsed and expanded, the SAME skin component
renders the appropriate form inside an `<AnimatePresence mode='wait'>`
tree, with both forms sharing a single `layoutId`. The shared
expanded surface (if one exists for other skins) is **not** mounted
by the host for this skin.

### Recipe

```tsx
// 1. Extract the inner UI into a presentational component so multiple
//    skins can reuse it without owning each other's chrome.
//    e.g. src/features/omnibelt/panel/PanelContent.tsx
function PanelContent({ onClose }: { onClose: () => void }) {
  // header / search / tabs / grid / etc. — zero positioning chrome
}

// 2. Define the shared layoutId in a central motion module.
//    e.g. src/features/omnibelt/lib/motion.ts
export const COLLAPSE_LAYOUT_ID = 'omnibelt-host' as const

// 3. The skin renders BOTH states in one AnimatePresence tree.
function OmniBeltMySkin() {
  const collapseState = useOmnibeltStore((s) => s.collapseState)
  const setCollapseState = useOmnibeltStore((s) => s.setCollapseState)
  const isOpen = collapseState === 'panel'

  return (
    <AnimatePresence mode='wait' initial={false}>
      {isOpen ? (
        <motion.div
          key='expanded'
          layoutId={COLLAPSE_LAYOUT_ID}
          layout
          data-omnibelt-host
          transition={ISLAND_SPRING}
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            translateX: '-50%',
            width: 760,
            borderRadius: 24,
          }}
        >
          <PanelContent onClose={() => setCollapseState('pill')} />
        </motion.div>
      ) : (
        <motion.button
          key='collapsed'
          layoutId={COLLAPSE_LAYOUT_ID}
          layout
          data-omnibelt-host
          transition={ISLAND_SPRING}
          onClick={() => setCollapseState('panel')}
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            translateX: '-50%',
            width: 220,
            height: 40,
            borderRadius: 9999,
          }}
        >
          {/* compact resting content */}
        </motion.button>
      )}
    </AnimatePresence>
  )
}

// 4. Host suppresses the shared panel for this skin.
const SKINS_USING_SHARED_PANEL = new Set<Skin>(['pill'])

function OmniBeltHost() {
  // ...
  const mountSharedPanel = SKINS_USING_SHARED_PANEL.has(skin)
  return (
    <LayoutGroup id={COLLAPSE_LAYOUT_GROUP_ID}>
      <SkinComponent />
      {mountSharedPanel && <OmniBeltPanel />}
    </LayoutGroup>
  )
}
```

### Key constraints

1. **One `layoutId` target per tick.** AnimatePresence `mode='wait'`
   enforces this — the outgoing form unmounts before the incoming
   one mounts. Without it, both forms briefly co-exist and framer
   warns + picks one arbitrarily (the v1 bug: the morph silently
   teleported because two `motion.div`s claimed `'omnibelt-host'`).
2. **Both forms anchor in compatible positions** so the morph reads
   as continuous physical movement. If the strip anchored top-center
   and the panel bottom-right, the morph would fly diagonally
   across the viewport. Pick a single baseline edge (e.g. both
   anchored at `bottom: 24px; left: 50%`) and let framer interpolate
   width / height / border-radius from there.
3. **Both forms carry `data-omnibelt-host`** so outside-click
   detection in other surfaces (Radix-portaled menus, the standalone
   panel for other skins) treats them as OmniBelt chrome and doesn't
   trigger a double-dismiss when the user clicks the morphed form.
4. **The skin owns dismissal lifecycle** (Esc + click-outside)
   because only the skin knows its expanded form's bounding box.
   Mirror the handler from the singleton panel; don't try to share.
5. **Inner content cross-fade is a SEPARATE animation** from the
   morph. Wrap the inner content in its own `motion.div` keyed by
   form (`key='strip-content'` ↔ `key='panel-content'`) with a fast
   `HOUSE_EASE` opacity transition. Keep the content swap subtle —
   the morph is the headline animation; the content is supporting
   cast. ~150 ms duration is the sweet spot.

### Spring tuning

The default house spring is good for general layout morphs. For
Dynamic-Island-style snappiness, use a stiffer spring opt-in only
for the morph itself:

```ts
export const ISLAND_SPRING: Transition = {
  type: 'spring',
  stiffness: 600,
  damping: 38,
  mass: 0.85,
  restDelta: 0.001,
}
```

Keep `HOUSE_SPRING` (stiffness 420, damping 32) as the default for
hover micro-interactions, tray expansion, drag feedback, etc.

## Anti-patterns

- **Two `motion.div`s with the same `layoutId` mounted at once.**
  framer warns + picks one arbitrarily. Always wrap in
  `<AnimatePresence mode='wait'>`.
- **Singleton panel hardcoded to one anchor.** A panel that always
  renders bottom-right means a top-anchored skin's morph teleports.
  Either teach the panel about per-skin anchors (Option 2: pass an
  `anchorTo` prop) OR move the expanded form into the skin (Option
  1: this pattern). Don't ship "panel always bottom-right" with a
  top-center skin.
- **Mounting both the skin and the shared panel for a
  skin-owns-both-states skin.** Two surfaces compete for the same
  `layoutId`. The fix is a host-level gate
  (`SKINS_USING_SHARED_PANEL`) that excludes morph-owning skins.
- **Animating positioning via `top`/`left` writes during the morph.**
  Layout thrash + jank. Use `transform: translate3d(...)` or the
  framer-handled `layout` prop only.
- **Using `update` trigger for state changes.** Nested
  `<ViewTransition>`s steal the mutation. Use `key` + shared
  `layoutId` instead.
- **Putting Esc / click-outside handlers in a parent.** The parent
  doesn't know which skin's surface is open. Each skin's morphed
  panel owns its own dismissal.
- **Forgetting the `data-omnibelt-host` tag on the expanded form.**
  Other surfaces' outside-click detection treats clicks on the
  morphed panel as "outside an OmniBelt surface" and double-fires
  dismissal.

## Reference implementation

- Strip → panel morph:
  `src/features/omnibelt/skins/skystrip/OmniBeltSkyStrip.tsx`
  (commit `feat/omnibelt-skystrip-default-bottom-morph`, 2026-05-24)
- Shared inner UI: `src/features/omnibelt/panel/PanelContent.tsx`
- Spring constant: `src/features/omnibelt/lib/motion.ts`
  (`ISLAND_SPRING`)
- Host gate:
  `src/features/omnibelt/OmniBeltHost.tsx`
  (`SKINS_USING_SHARED_PANEL` set)
- Integration test:
  `src/features/omnibelt/skins/skystrip/__tests__/morph-skystrip-to-panel.test.tsx`

## v1.5 follow-up candidates

- **Orb skin's "more" tile.** When we exceed 8 tools in the radial
  fan, the overflow needs a "more" tile that expands into a grid
  view. Same pattern applies: the Orb skin owns both its 8-tile
  fan state AND its grid-overflow expanded state, with a shared
  `layoutId='omnibelt-host'` morph between them. The standalone
  `<OmniBeltPanel>` stays Pill-only.
- **Top-anchored skins.** If we ship a TopBar / NotchStrip / etc.
  variant, the same recipe applies — anchor both forms at
  `top: <gutter>; left: 50%; translateX(-50%)`, swap downward.
