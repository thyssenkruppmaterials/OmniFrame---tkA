---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-24
---
# OmniBelt motion language — three-tier spring system

## Purpose
OmniBelt morphs between four collapse states (orb ↔ pill ↔ panel ↔ nub) and three skins (pill / orb / skystrip). Different surfaces need different perceived weights — the pill-to-panel morph should feel heavy and considered; tool-tile hover should feel light and responsive. A single spring across all of them either makes the morph feel rushed or makes the micro-interactions feel sluggish.

## Pattern
Named springs + tween constants in `src/features/omnibelt/lib/motion.ts`:

```ts
HOUSE_SPRING        = { stiffness: 420, damping: 32, mass: 0.9 }                     // big morphs (pill↔panel↔orb↔nub)
ISLAND_SPRING       = { stiffness: 600, damping: 38, mass: 0.85, restDelta: 0.001 }  // SkyStrip strip↔panel bloom
LIQUID_SPRING       = { stiffness: 320, damping: 26, mass: 0.7 }                     // drag pickup
SNAP_SPRING         = { stiffness: 520, damping: 38, mass: 0.6 }                     // content fades, tile stagger entry
TOOL_LAUNCH_SPRING  = { stiffness: 380, damping: 32, mass: 0.9, restDelta: 0.001 }   // tool-launch surfaces (Dialog/Sheet/Popover/in-panel shell swap)
TILE_PRESS_TRANSITION = { stiffness: 600, damping: 30, mass: 0.5 }                   // tile press / hover feedback
BACKDROP_FADE       = { duration: 0.22, ease: HOUSE_EASE }                            // scrim / overlay fade (parallel with TOOL_LAUNCH_SPRING)
CONTENT_STAGGER     = { delayChildren: 0.08, staggerChildren: 0.04 }                  // child cascade after a launched surface settles
```

### Rules
1. **Layout morphs use `HOUSE_SPRING`** — the same instance is shared across every `<motion.div layoutId='omnibelt-host'>` so the morph reads as one continuous object, not three crossfades.
2. **SkyStrip strip↔panel uses `ISLAND_SPRING`** — opt-in stiffer spring for the Dynamic-Island bloom only. Other skins keep `HOUSE_SPRING`.
3. **Drag pickup uses `LIQUID_SPRING`** — softer, with visible elasticity. Pair with `whileDrag={{ scale: 1.04 }}` style props on `motion.button`.
4. **Tile hover/press uses `TILE_PRESS_TRANSITION`** — stiffer than `LIQUID_SPRING` so the press reads as a tactile tick before the launch fires, not a soft squish that competes with the launch animation. Replaces `LIQUID_SPRING` for `whileHover` / `whileTap` on `<ToolTile>` post-2026-05-24 PM.
5. **Stagger entry / opacity fades use `SNAP_SPRING`** — faster than HOUSE so secondary motion never drags behind the morph.
6. **Tool-launch surfaces use `TOOL_LAUNCH_SPRING`** — slightly slower + more damped than `HOUSE_SPRING` so dialog-sized rects settle cleanly without overshoot. Used on the panel grid ↔ active-tool-shell swap, `<AgentChatDialog>` mount, `<OrbShellPopover>` mount, future Sheet/Popover tool surfaces.
7. **Inner-section reveal uses `CONTENT_STAGGER`** — applied to the parent of staggered children so header → body → footer cascade in after a launched surface has settled.
8. **Scrim / overlay fades use `BACKDROP_FADE`** — duration tween (not spring) so framer collapses cleanly under `prefers-reduced-motion: reduce`.
9. **Reduced-motion** — every consumer of these springs should branch on `useReducedMotion()` and pass `undefined` to `whileHover`/`whileTap`/`whileDrag` when reduced is true. The host wraps everything in `<MotionConfig reducedMotion='user'>` so springs collapse automatically; the per-node `useReducedMotion()` shortcut is belt + suspenders for `initial`/`animate`/`exit` shapes that aren't variant names.

## How to apply
- **Why:** Big-morph spring values from earlier work (`stiffness: 420, damping: 28, mass: 0.85`) felt slightly bouncy; tightening damping/mass to 32/0.9 settles cleaner without sacrificing snap. Tested on Pill ↔ Panel morph at 1920×1080.
- **How to apply:** Import the named spring from `'../lib/motion'`, pass as `transition` prop directly. Never write inline `{ type: 'spring', stiffness: ... }` — duplicating the magic numbers breaks the orchestrated feel.

## Tile stagger orchestration
The Panel grid uses framer's variants API to stagger tile entry:

```tsx
<motion.div initial='hidden' animate='show' variants={{
  hidden: {},
  show: { transition: { staggerChildren: 0.025, delayChildren: 0.04 } }
}}>
  {tools.map((t, i) => <ToolTile index={i} ... />)}
</motion.div>
```

Each `ToolTile` is a `motion.button` with `variants={{ hidden: { opacity: 0, y: 6, scale: 0.94 }, show: { opacity: 1, y: 0, scale: 1, transition: SNAP_SPRING } }}`. The stagger feels fluid without dragging the pill→panel layout morph.

## Drag feedback
Pill uses `whileDrag={{ scale: 1.04 }}` with LIQUID_SPRING so the user feels the pickup. `dragMomentum={false}` keeps the snap-to-anchor behaviour deterministic; framer's internal x/y motion values reset on render after `onDragEnd` writes the new resolved position to the store.

## Tool launch motion (2026-05-24 PM)

Picking a tool from the panel grid (or any alternate expansion surface) should feel like a cinematic reveal — not a snap. Recipe:

1. Wrap the parent of the grid ↔ shell swap in `<AnimatePresence mode='wait'>` with a single `<motion.div>` keyed by `activeTool?.id ?? 'grid'`. Spring with `TOOL_LAUNCH_SPRING`. Outgoing scales 1 → 0.98 + slides up 4 px while fading; incoming scales 0.96 → 1 + slides up 4 px while fading.
2. For Radix-Portaled tool shells (Dialog/Sheet/Popover), wrap `<DialogContent>`'s body in TWO motion.divs: outer object-literal `initial`/`animate` for the spring scale + slide; inner `initial='hidden' animate='show' variants={{ hidden, show: { transition: CONTENT_STAGGER } }}` so child sections cascade in. Framer only propagates variants to children when the parent's `initial`/`animate` are variant *names*, hence the split.
3. Tag the dialog content with `data-omnibelt-overlay='true'` so the panel skin's outside-click handler skips it (Radix Portal renders at `document.body`, outside the panel's `[data-omnibelt-host]` subtree). See [[Fix-OmniBelt-AgentChat-Instant-Close]] for the failure mode this prevents.
4. Tool tiles get `whileTap={{ scale: 0.97 }}` + `whileHover={{ scale: 1.03, y: -2 }}` with `TILE_PRESS_TRANSITION` so the press reads as tactile feedback before the launch fires.

Reference impl: `src/features/omnibelt/panel/PanelContent.tsx` (in-panel grid ↔ shell swap), `src/features/omnibelt/tools/shells/agent-chat/AgentChatDialog.tsx` (Dialog-based tool shell), `src/features/omnibelt/skins/orb/OrbShellPopover.tsx` (popover-based tool shell). Full recipes + anti-patterns in [[OmniBelt-Floating-Launcher]] §"Tool launch motion".

## Related
- [[OmniBelt-Floating-Launcher]]
- [[Cinematic-Tab-Rotation]] — original house-spring source
- [[Fix-OmniBelt-Halo-Wrapper-Blocks-Pill-Drag]]
- [[Fix-OmniBelt-AgentChat-Instant-Close]] — instant-close bug fix that paired with the motion polish
- [[ADR-OmniBelt-Site-Chrome]]
