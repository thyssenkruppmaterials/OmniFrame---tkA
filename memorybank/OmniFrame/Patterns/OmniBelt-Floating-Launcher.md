---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-24
---
# Pattern — OmniBelt Floating Launcher

Site-wide floating tool launcher pattern. Mounts at the route root,
self-gates per route, persists per user, and morphs between three
collapse states using a single `framer-motion` `layoutId`.

## When to use

- A surface needs to be reachable from every authenticated page (or
  most pages) without taking layout space when idle.
- The launcher has multiple visual states (resting / hover / expanded)
  that should feel like one continuous object.
- The launcher must be drag-positionable with magnetic snap to anchor
  zones AND remember position per route class.
- The launcher integrates ambient status (background jobs) without
  losing its primary action affordance.

If only one of these is true, prefer a simpler shape — Radix `Popover`
on a static FAB, or a fixed status bar.

## Mount discipline

Mount in [`src/routes/__root.tsx`](../../../src/routes/__root.tsx)
between `<Outlet />` and `<Toaster />`. Self-gate via a visibility hook
that checks (in order, fail-closed):

1. Build-time env disable flag
2. Capacitor native platform
3. Route exclusion regex list (mirroring
   [[Realtime-Presence-Browser-Hardening]]'s kiosk pattern)
4. Authentication state
5. Org-level setting (TanStack Query against the `settings` table)
6. Per-user hide flag

Each early-return logs at `debug` level for forensic clarity ("why isn't
OmniBelt showing up?" is a frequent admin question).

## Tri-state collapse via `layoutId`

```tsx
<MotionConfig reducedMotion='user'>
  <LayoutGroup id='omnibelt'>
    {state === 'orb' && <motion.div layoutId='omnibelt-host' /* small */ />}
    {state === 'pill' && <motion.div layoutId='omnibelt-host' /* medium */ />}
    {state === 'panel' && <motion.div layoutId='omnibelt-host' /* large */ />}
  </LayoutGroup>
</MotionConfig>
```

`framer-motion` interpolates size, border-radius, and position
automatically. Same primitive that powers iOS Dynamic Island. Cross-skin
preference changes also morph because each skin component renders the
same `layoutId`.

## Anchor zones + snap math

12 zones: 4 corners + 4 edge midpoints + free-float + pinned + 4 edge
nubs (auto-hide endpoints). Drag via framer's `drag` +
`dragConstraints={viewportRef}`. `onDragEnd` evaluates the nearest snap
zone within a 32px deadzone using a pure `lib/anchors.ts` module.

House motion language (established by [[Cinematic-Tab-Rotation]]):
- Spring: `{ stiffness: 420, damping: 28, mass: 0.85 }`
- Easing (non-spring): `[0.22, 1, 0.36, 1]`

## Tool launch motion (added 2026-05-24 PM)

When the user picks a tool from the panel grid (or from any
alternate expansion surface — radial fan, search dropdown, ⌘B
keyboard hotkey when implemented), the surface that opens should
feel like a cinematic reveal — not a snap. The OmniBelt motion
language exposes four constants in
`src/features/omnibelt/lib/motion.ts` for this:

| Constant | What it's for | Tuning |
|---|---|---|
| `TOOL_LAUNCH_SPRING` | The launching surface itself (Dialog Content, Sheet panel, Popover card, in-panel shell). Single spring per surface. | `stiffness: 380, damping: 32, mass: 0.9, restDelta: 0.001`. Slightly slower + more damped than `HOUSE_SPRING` so dialog-sized rects settle cleanly without overshoot wobble. |
| `BACKDROP_FADE` | The scrim / overlay that darkens the page behind the surface. Runs in parallel with the spring above. | `duration: 0.22, ease: HOUSE_EASE`. Duration-based so it collapses cleanly under `prefers-reduced-motion: reduce`. |
| `CONTENT_STAGGER` | Inner-section reveal cascade (header → body → footer). Used on the parent of the staggered children. | `delayChildren: 0.08, staggerChildren: 0.04`. Caps the cascade at ~320 ms for 8 children. |
| `TILE_PRESS_TRANSITION` | The press-down feedback on the tool tile itself, before the launch fires. | `stiffness: 600, damping: 30, mass: 0.5`. Stiffer than `LIQUID_SPRING` so the press reads as a tactile tick. |

### Recipe — Dialog-based tool shell

```tsx
import { motion, useReducedMotion } from 'framer-motion'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  CONTENT_STAGGER,
  HOUSE_EASE,
  TOOL_LAUNCH_SPRING,
} from '../lib/motion'

export function MyToolDialog({ open, onOpenChange }) {
  const reduced = useReducedMotion() ?? false
  const sectionVariants = reduced
    ? { hidden: { opacity: 0 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: 6 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.28, ease: HOUSE_EASE },
        },
      }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal>
      <DialogContent
        // CRITICAL: tag every Radix Portal surface so the panel
        // skin's outside-click handler treats it as OmniBelt-owned.
        // Without this, every click inside the dialog dismisses the
        // panel underneath. See [[Fix-OmniBelt-AgentChat-Instant-Close]].
        data-omnibelt-overlay='true'
      >
        <motion.div
          // Outer: cinematic spring scale + slide on mount.
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 8 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 4 }}
          transition={TOOL_LAUNCH_SPRING}
        >
          <motion.div
            // Inner: variant-driven cascade for child sections.
            initial='hidden'
            animate='show'
            variants={{ hidden: {}, show: { transition: CONTENT_STAGGER } }}
          >
            <motion.div variants={sectionVariants}>
              <DialogHeader><DialogTitle>My Tool</DialogTitle></DialogHeader>
            </motion.div>
            <motion.div variants={sectionVariants}>
              {/* main body */}
            </motion.div>
            <motion.div variants={sectionVariants}>
              {/* footer / composer / actions */}
            </motion.div>
          </motion.div>
        </motion.div>
      </DialogContent>
    </Dialog>
  )
}
```

### Recipe — In-panel shell swap

```tsx
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CONTENT_STAGGER, TOOL_LAUNCH_SPRING } from '../lib/motion'

export function PanelContent({ activeTool, onClose }) {
  const reduced = useReducedMotion() ?? false
  return (
    <AnimatePresence mode='wait' initial={false}>
      <motion.div
        key={activeTool ? `shell:${activeTool.id}` : 'grid'}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 4 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -4 }}
        transition={TOOL_LAUNCH_SPRING}
        variants={{ hidden: {}, show: { transition: CONTENT_STAGGER } }}
      >
        {/* render either the grid OR the active tool shell */}
      </motion.div>
    </AnimatePresence>
  )
}
```

### Tile press feedback

```tsx
import { motion, useReducedMotion } from 'framer-motion'
import { TILE_PRESS_TRANSITION } from '../lib/motion'

const reduced = useReducedMotion() ?? false
<motion.button
  whileHover={reduced ? undefined : { scale: 1.03, y: -2 }}
  whileTap={reduced ? undefined : { scale: 0.97 }}
  transition={TILE_PRESS_TRANSITION}
/>
```

### Anti-patterns

- ❌ Putting the launching click handler on a non-React DOM
  listener that bubbles to `window` BEFORE the React click finishes
  propagating. The panel's outside-click handler (`pointerdown`,
  capture phase) will see the click as outside-the-panel and
  dismiss before the surface mounts. Use React's `onClick` with
  `e.stopPropagation()` for shell-tool tiles. See
  [[Fix-OmniBelt-AgentChat-Instant-Close]] §"Bug 1".
- ❌ Forgetting `data-omnibelt-overlay='true'` on a Radix-Portaled
  Dialog/Sheet/Popover Content node. The portal renders at
  `document.body`, outside the panel's `[data-omnibelt-host]`
  subtree, so every click inside it reads as outside-the-panel and
  collapses both. See [[Fix-OmniBelt-AgentChat-Instant-Close]]
  §"Bug 2".
- ❌ Using `HOUSE_SPRING` for tool launches. It's tuned for the
  resting-chrome morphs (pill ↔ panel) where the rect already
  exists. For mounting a brand-new dialog-sized surface, use
  `TOOL_LAUNCH_SPRING` — slightly slower + more damped so the
  larger rect settles cleanly.
- ❌ Mixing `initial={objectLiteral}` with child variant
  orchestration on the same `motion.div`. Framer only propagates
  variants to children when the parent's `initial`/`animate` are
  variant *names*. Use the two-layer outer-spring / inner-stagger
  recipe above instead.

## Per-route position memory

Key positions by **route class**, not exact pathname:

```ts
function routeClass(pathname: string): RouteClass {
  if (pathname.startsWith('/_authenticated/admin')) return 'admin';
  if (pathname.startsWith('/_authenticated/operations')) return 'ops';
  // ... bounded set of ≤10 classes
  return 'default';
}
```

This bounds `omnibelt_user_prefs.position_by_route` to a tiny dictionary
even if the app grows to hundreds of dynamic routes.

## Collision avoidance with other floating chrome

On every drag-end and `window.resize`:
- Read bounding rects of competing chrome (e.g. `NotificationsPanel`
  bell in the auth layout's action bar, `Sonner` toaster position from
  `useToastSettings()`).
- If the launcher's resting rect overlaps by ≥4px, offset 56px in the
  closest free direction.

If new floating chrome lands later, register it with a hypothetical
`<ChromeSlot />` registry — OmniBelt subtracts those rects without
hard-coding which bell/toast it knows about.

## Skin polymorphism

The launcher is a polymorphic `<Skin />` component consuming the same
Zustand store. Each skin (`pill`, `orb`, `skystrip`) is lazy-loaded:

```ts
const SKIN_REGISTRY = {
  pill: lazy(() => import('./skins/pill/OmniBeltPill')),
  orb: lazy(() => import('./skins/orb/OmniBeltOrb')),
  skystrip: lazy(() => import('./skins/skystrip/OmniBeltSkyStrip')),
};
```

Panel and Status Tray are skin-agnostic and shared. All skins render
the same `layoutId='omnibelt-host'` so the cross-skin transition is also
a morph.

## State management

Tier 1 (global UI) per [[State-Management-Patterns]]. Zustand with
`persist + partialize`. Per-user localStorage key:
`omniframe.omnibelt.${userId}.v1`. No devtools middleware (matches
existing UI-state stores like `warehouse-map-store`,
`deviceManagerStore`).

Hydration sequence:
1. Mount: load persisted state from localStorage (instant).
2. Bootstrap query resolves: merge server prefs + role defaults +
   allow-list (overwrite ONLY if server value is newer by `updated_at`).
3. Debounced (500ms) write-back to Supabase on every mutation.

## Realtime hygiene

- Subscribe to ambient state (background jobs, config changes) via
  `workServiceWs` singleton — **never** create a new
  `supabase.channel(...)` (banned by [[realtime-policy]]).
- Diff push payloads before re-rendering (e.g. 1%-progress threshold on
  halo rings) to avoid re-render storms at scale.
- No new `setInterval` / `refetchInterval`. Use WS event invalidations.

## Bundle discipline

- One `manualChunks` slice for the host + default skin + panel + tray.
  Target <60 KB gzipped per [[ADR-Scaling-Roadmap-To-100k-Concurrent]]
  pressure.
- Alt skins lazy-loaded only on first switch.
- Each tool shell lazy-loaded on first open.

## RBAC

Each tool definition declares `permission: { action, resource }` and is
filtered via `usePermissionStore.hasPermission(...)` — same pattern as
[`CommandPalette`](../../../src/components/layout/command-palette.tsx).
Unknown permission strings fail closed.

## Telemetry

Frontend emitter batches events in a 10s rolling window, flushed on
`visibilitychange` + `beforeunload`. Hard caps:
- 50 events/user/min client-side (drops with debug log)
- Redis sliding window server-side mirrors the cap

Insert into `omnibelt_tool_events` via primary; analytics dashboard
reads the 24h materialized view via `supabaseRead`.

## Accessibility

- `<MotionConfig reducedMotion='user'>` wraps the whole subtree.
- Orb/pill is `role='button'` with `aria-expanded` + `aria-label`.
- Panel is `role='dialog' aria-modal='false'` (non-blocking).
- Tool tiles are `role='grid' / role='gridcell'` for keyboard
  arrow-key navigation.
- Halo rings expose `<title>` per ring with job label + percent.
- Status tray uses `aria-live='polite'` for job-complete announcements.
- Keyboard alternative to drag: right-click menu with "Move to corner"
  submenu (12 zones reachable without a pointer).

## Anti-patterns

- ❌ Mounting the launcher inside `authenticated-layout.tsx`. It misses
  any future non-auth surfaces and stutters across route changes
  because the layout unmounts during the auth transition.
- ❌ Storing exact pathname in `position_by_route`. Unbounded growth.
- ❌ One `<motion.div>` per skin without `layoutId`. Cross-skin
  preference change becomes a crossfade, not a morph.
- ❌ Creating a new `supabase.channel('omnibelt_*')` for config
  hot-reload. Use `WsEvent::OmnibeltConfigChanged` on the existing
  `rust-work-service /ws`.
- ❌ `setInterval` to refresh bootstrap. Use the WS invalidator.

## Related

- [[ADR-OmniBelt-Site-Chrome]] — the decision record
- [[OmniBelt - Site Tool Launcher]] — component anatomy
- [[Implement-OmniBelt-MVP]] — implementation log
- [[State-Management-Patterns]]
- [[Sidebar-Pin-Lock]] — sibling pin/persistence pattern
- [[Cinematic-Tab-Rotation]] — motion language
- [[Realtime-Presence-Browser-Hardening]] — kill-switch precedent
- [[Supabase-Read-Replica-Routing]] — read-path discipline
- [[realtime-policy]] — no new Supabase channels
