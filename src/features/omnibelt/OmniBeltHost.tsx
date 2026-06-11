// Created and developed by Jai Singh
/**
 * OmniBelt — Host component (P3 / P7)
 *
 * Single mount-point per route root (see `src/routes/__root.tsx`).
 * Owns lifecycle for the visibility gate, store init, WS
 * invalidator, keyboard shortcuts and the active skin + shared
 * Panel.
 *
 * Mount order matters (spec §6.2, §15.6):
 *   1. Capture `userId` from `useUnifiedAuth`.
 *   2. If missing, bail before touching the store (the store's
 *      `useOmnibeltStore` selector throws when not initialized —
 *      see `store/omnibeltStore.ts`).
 *   3. Synchronously call `initOmnibeltStore(userId)` (idempotent
 *      for the same userId, rebuilds on userId change). Done via
 *      `useState`'s lazy initializer so the first render of the
 *      body already has a live store.
 *   4. Render `<OmniBeltHostBody />` which evaluates the visibility
 *      gate and, only when visible, mounts `<OmniBeltActiveSurface />`.
 *      The side-effecting hooks (WS invalidator, WS job aggregator,
 *      global keyboard listener) live in the active surface so they
 *      never run while the launcher is hidden.
 *
 * P7 extends the host with a `SKIN_REGISTRY` so the user can switch
 * between `pill`, `orb` (radial fan), or `skystrip` (Dynamic-Island
 * morph — the default) from the in-panel skin picker. The default
 * skin is statically imported for a zero-latency first paint; the
 * alternates stay `React.lazy(...)` so only the active skin's bytes
 * are fetched when a user switches away. Each skin still renders a
 * `<motion.div layoutId='omnibelt-host'>` at its root so cross-skin
 * transitions are continuous morphs (spec §7).
 *
 * The shared `<OmniBeltPanel>` is rendered for every skin EXCEPT
 * `orb` — the Compass Orb's expanded surface is its own
 * `<RadialFan>` (see `skins/orb/OmniBeltOrb.tsx`). The skystrip
 * skin keeps the standard Panel for v1; v1.5 re-anchors it under
 * the strip via a Panel position-override prop.
 *
 * Bootstrap hydration: the bootstrap query auto-runs from
 * `useResolvedTools` (inside Pill / Panel) — there's no separate
 * hydrate-into-store call yet. P4/P5/P6 layer richer hydration
 * (skin/position/pinned merges) once the corresponding UI lands.
 */
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { LayoutGroup, MotionConfig } from 'framer-motion'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { useOmnibeltConfigInvalidator } from './hooks/useOmnibeltConfigInvalidator'
import { useOmnibeltJobs } from './hooks/useOmnibeltJobs'
import { useOmnibeltKeyboard } from './hooks/useOmnibeltKeyboard'
import { useOmnibeltVisibility } from './hooks/useOmnibeltVisibility'
import { COLLAPSE_LAYOUT_GROUP_ID } from './lib/motion'
import { OmniBeltPanel } from './panel/OmniBeltPanel'
import OmniBeltSkyStrip from './skins/skystrip/OmniBeltSkyStrip'
import {
  getOmnibeltStore,
  initOmnibeltStore,
  useOmnibeltStore,
  type ActiveJob,
  type Skin,
} from './store/omnibeltStore'
import { OmniBeltStatusTray } from './tray/OmniBeltStatusTray'

// Skin registry. The default skin (`skystrip`, per
// `DEFAULT_PERSISTED_STATE.skin`) is statically imported so the
// resting chrome paints on the FIRST frame — eagerly loaded as a
// static dependency of the host (preloaded in parallel with
// `feature-omnibelt`) rather than fetched on demand through a lazy
// chunk + Suspense gap, which delayed the launcher's first appearance
// on every cold load. It still emits its own
// `feature-omnibelt-skin-skystrip` chunk via vite manualChunks, so the
// bundle slice is unchanged — only its load timing moves earlier.
//
// The alternate skins stay `React.lazy(...)` so only the active skin's
// bytes are fetched when a user switches away from the default.
const SKIN_REGISTRY: Record<Skin, ComponentType> = {
  pill: lazy(() => import('./skins/pill/OmniBeltPill')),
  orb: lazy(() => import('./skins/orb/OmniBeltOrb')),
  skystrip: OmniBeltSkyStrip,
}

/** Skins for which the host mounts the shared `<OmniBeltPanel>`.
 *
 *  - `pill` → standard floating panel anchored to the pill's corner.
 *  - `orb` → owns its own `<RadialFan>` expanded surface.
 *  - `skystrip` → owns its own bottom-center morph (the skin renders
 *    both collapsed and expanded forms so the strip → panel
 *    transition is a single `layoutId` bloom; see
 *    [[Skin-Owned-Morph-States]]).
 *
 *  Only Pill uses the shared panel today. */
const SKINS_USING_SHARED_PANEL: ReadonlySet<Skin> = new Set<Skin>(['pill'])

export function OmniBeltHost() {
  const { authState } = useUnifiedAuth()
  const userId = authState.user?.id ?? null

  // Guard before any other OmniBelt hook touches the per-user store.
  // The store throws when consumed before `initOmnibeltStore(...)`,
  // and `useOmnibeltVisibility` reads `userHidden` from it.
  if (!userId) return null

  return <OmniBeltHostBody userId={userId} />
}

function OmniBeltHostBody({ userId }: { userId: string }) {
  // `initOmnibeltStore` is idempotent for the same userId and
  // rebuilds against a fresh localStorage key when the userId
  // changes (sign-out → sign-in as a different user). useState's
  // lazy initializer runs once per mount; the parent guards
  // re-mounts via the userId key in `OmniBeltHost` indirectly
  // (a userId change makes `OmniBeltHost` re-render and call
  // `OmniBeltHostBody` with a new userId prop).
  useState(() => initOmnibeltStore(userId))

  // Visibility gate (six layers, spec §13).
  const { visible } = useOmnibeltVisibility()

  // Test-only window hook — Playwright e2e drives state changes
  // through Zustand directly to avoid flake on animated/layered
  // pointer paths. Vite tree-shakes the body in production builds
  // because `import.meta.env.PROD` is inlined as a literal.
  useEffect(() => {
    if (import.meta.env.PROD) return
    const w = window as Window & {
      __ONEBOX_omnibelt?: Record<string, unknown>
    }
    const store = getOmnibeltStore()
    if (!store) return
    w.__ONEBOX_omnibelt = {
      setCollapseState: (v: 'orb' | 'pill' | 'panel' | 'nub') =>
        store.getState().setCollapseState(v),
      setSkin: (v: Skin) => store.getState().setSkin(v),
      setUserHidden: (v: boolean) => store.getState().setUserHidden(v),
      setActiveJobs: (jobs: ActiveJob[]) =>
        store.getState().setActiveJobs(jobs),
      getState: () => store.getState(),
    }
    return () => {
      delete w.__ONEBOX_omnibelt
    }
  }, [])

  if (!visible) return null

  return <OmniBeltActiveSurface />
}

/**
 * The live OmniBelt subtree, mounted only while the launcher is
 * actually visible.
 *
 * The side-effecting hooks (WS background-job aggregator, WS config
 * invalidator, global ⌘B keyboard listener) live here rather than in
 * `OmniBeltHostBody` so they DON'T run when the launcher is hidden —
 * org kill switch, per-user hide, route exclusion, or a native build.
 * Previously they mounted on every authenticated page and self-gated
 * internally, which still opened a `workServiceWs` connection and a
 * `window` keydown listener for users who never see the launcher.
 * Now visibility flipping true mounts these effects; flipping false
 * tears them down.
 */
function OmniBeltActiveSurface() {
  // WS-driven bootstrap invalidator + global ⌘B shortcut.
  useOmnibeltConfigInvalidator()
  // P5 — Mach 3 background-job aggregator. Owns its own
  // `workServiceWs` subscription lifecycle and writes to the store's
  // `activeJobs` runtime field. Mount-once per active surface so the
  // halo / tray stay in sync regardless of which skin is active.
  useOmnibeltJobs()
  useOmnibeltKeyboard()

  // Subscribe to the user's skin preference. Stays in sync with both
  // the in-panel picker and any persisted/server-hydrated value (P4+).
  const skin = useOmnibeltStore((s) => s.skin)
  const SkinComponent = SKIN_REGISTRY[skin] ?? SKIN_REGISTRY.pill
  const mountSharedPanel = SKINS_USING_SHARED_PANEL.has(skin)

  return (
    <MotionConfig reducedMotion='user'>
      <LayoutGroup id={COLLAPSE_LAYOUT_GROUP_ID}>
        <Suspense fallback={null}>
          <SkinComponent />
        </Suspense>
        {mountSharedPanel && <OmniBeltPanel />}
        {/* P5 — Mach 3 status tray. Sibling of the skin so both
         *   surfaces re-render independently and the tray's
         *   `position: fixed` placement is unaffected by the
         *   skin's drag transform. */}
        <OmniBeltStatusTray />
      </LayoutGroup>
    </MotionConfig>
  )
}

// Created and developed by Jai Singh
