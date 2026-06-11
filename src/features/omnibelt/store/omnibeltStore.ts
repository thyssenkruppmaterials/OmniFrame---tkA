// Created and developed by Jai Singh
/**
 * OmniBelt — Zustand store
 *
 * Tier 1 (global UI) per [State-Management-Patterns]
 * (memorybank/OmniFrame/Patterns/State-Management-Patterns.md). No middleware
 * beyond `persist + partialize`. Per-user localStorage key:
 *   `omniframe.omnibelt.${userId}.v1`
 *
 * Per-user isolation requires the userId at store-creation time. Stores are
 * global singletons by nature, so we expose a lazy `initOmnibeltStore(userId)`
 * factory that the Host component (P3) calls once on mount, plus a
 * `useOmnibeltStore` selector hook that throws if the store is consumed
 * before init. A `__resetOmnibeltStoreForTests` escape hatch lets unit tests
 * exercise the per-user key isolation without relying on module reloads.
 *
 * Persisted fields (spec §6.2):
 *   - collapseState
 *   - positionByRoute (keyed by routeClass)
 *   - skin
 *   - pinnedToolIds, hiddenToolIds, toolOrder
 *   - mach3Behavior
 *   - autoHideAfterSeconds
 *   - userHidden
 *
 * Runtime-only (deliberately excluded from `partialize`):
 *   - activeJobs, panelOpen, trayOpen, dragging
 *
 * No new Supabase realtime channels are created here (banned by
 * `realtime-policy.mdc`); the bootstrap query and config invalidator land
 * in P2 / P3.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
// `AnchorName` is the discriminator for the 12 anchors + 2 modes; its
// canonical home is `lib/anchors.ts` (P6) which also owns the pure
// snap / clamp math. We import the type here so the store stays the
// single source of truth for *persisted* shapes without duplicating the
// anchor vocabulary.
import type { AnchorName } from '../lib/anchors'
import type { RouteClass } from '../lib/routeClass'

// ---- Types -----------------------------------------------------------------

export type CollapseState = 'orb' | 'pill' | 'panel' | 'nub'
export type Skin = 'pill' | 'orb' | 'skystrip'
export type Mach3Behavior =
  | 'halo_only'
  | 'halo_plus_autoexpand'
  | 'halo_plus_morph'
  | 'halo_plus_tray_pinned'

export type { AnchorName }

export type AnchorPosition = {
  anchor: AnchorName
  offset: { x: number; y: number }
}

export type ActiveJobType =
  | 'sap_import'
  | 'sap_export'
  | 'agent_job'
  | 'report'
  | 'scheduled'
  | 'other'

export type ActiveJob = {
  id: string
  type: ActiveJobType
  label: string
  /** 0..1 */
  progress: number
  startedAt: number
  startedByCurrentUser: boolean
  cancelable: boolean
  cancelUrl?: string
}

export type OmnibeltPersistedState = {
  collapseState: CollapseState
  positionByRoute: Partial<Record<RouteClass, AnchorPosition>>
  skin: Skin
  pinnedToolIds: string[]
  hiddenToolIds: string[]
  toolOrder: string[]
  mach3Behavior: Mach3Behavior
  autoHideAfterSeconds: number
  userHidden: boolean
}

export type OmnibeltRuntimeState = {
  activeJobs: ActiveJob[]
  panelOpen: boolean
  trayOpen: boolean
  dragging: boolean
}

export type OmnibeltActions = {
  setCollapseState: (state: CollapseState) => void
  setSkin: (skin: Skin) => void
  togglePin: (toolId: string) => void
  hideTool: (toolId: string) => void
  unhideTool: (toolId: string) => void
  setToolOrder: (toolIds: string[]) => void
  setPositionForRoute: (route: RouteClass, position: AnchorPosition) => void
  /**
   * Clear the persisted position for one route class so the next render
   * falls back to the default anchor (BR). Used by the "Reset position"
   * affordance in the right-click menu.
   */
  clearPositionForRoute: (route: RouteClass) => void
  /**
   * Toggle PINNED on the *current* route class. When `pinned === true`
   * the resolved anchor becomes `PINNED` and `useOmnibeltPosition`
   * disables drag. Re-toggling unpins back to whatever anchor was
   * stored before pin (best-effort — falls back to BR if the prior
   * state can't be recovered).
   */
  setPinned: (route: RouteClass, pinned: boolean) => void
  setMach3Behavior: (behavior: Mach3Behavior) => void
  setAutoHideAfterSeconds: (seconds: number) => void
  setUserHidden: (hidden: boolean) => void
  setActiveJobs: (jobs: ActiveJob[]) => void
  setPanelOpen: (open: boolean) => void
  setTrayOpen: (open: boolean) => void
  setDragging: (dragging: boolean) => void
  /** Replace persisted slice atomically — used by bootstrap hydration in P2. */
  hydrateFromServer: (next: Partial<OmnibeltPersistedState>) => void
  reset: () => void
}

export type OmnibeltState = OmnibeltPersistedState &
  OmnibeltRuntimeState &
  OmnibeltActions

// ---- Defaults --------------------------------------------------------------

// `skin` defaults to `'skystrip'` (2026-05-24): the Dynamic-Island Sky
// Strip is the new flagship resting chrome. `collapseState` defaults to
// `'pill'` rather than `'orb'` because `'pill'` is the canonical
// "resting collapsed" state across all three skins:
//   - Pill skin    → renders the full horizontal pill body
//   - SkyStrip     → renders the bottom-center strip
//   - Orb          → falls through to its `<RadialOrb>` resting form
// Using `'pill'` keeps the cross-skin morph continuous when the user
// flips skins from the panel menu (vs. landing in `'orb'` which has
// no SkyStrip render path). Server-side, migration 330 sets the
// `omnibelt_role_config.default_skin` column DEFAULT to `'skystrip'`
// so new rows match the client; admins who explicitly chose another
// skin keep their value (the migration intentionally does not
// overwrite existing rows).
export const DEFAULT_PERSISTED_STATE: OmnibeltPersistedState = {
  collapseState: 'pill',
  positionByRoute: {},
  skin: 'skystrip',
  pinnedToolIds: [],
  hiddenToolIds: [],
  toolOrder: [],
  mach3Behavior: 'halo_plus_autoexpand',
  autoHideAfterSeconds: 15,
  userHidden: false,
}

const DEFAULT_RUNTIME_STATE: OmnibeltRuntimeState = {
  activeJobs: [],
  panelOpen: false,
  trayOpen: false,
  dragging: false,
}

// ---- Store factory ---------------------------------------------------------

const STORAGE_KEY_PREFIX = 'omniframe.omnibelt.'
const STORAGE_KEY_SUFFIX = '.v1'

export function omnibeltStorageKeyFor(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}${STORAGE_KEY_SUFFIX}`
}

type OmnibeltStoreHook = UseBoundStore<StoreApi<OmnibeltState>>

function createOmnibeltStore(userId: string): OmnibeltStoreHook {
  return create<OmnibeltState>()(
    persist(
      (set, get) => ({
        ...DEFAULT_PERSISTED_STATE,
        ...DEFAULT_RUNTIME_STATE,

        setCollapseState: (collapseState) => set({ collapseState }),

        setSkin: (skin) => set({ skin }),

        togglePin: (toolId) => {
          const { pinnedToolIds } = get()
          const isPinned = pinnedToolIds.includes(toolId)
          set({
            pinnedToolIds: isPinned
              ? pinnedToolIds.filter((id) => id !== toolId)
              : [...pinnedToolIds, toolId],
          })
        },

        hideTool: (toolId) => {
          const { hiddenToolIds } = get()
          if (hiddenToolIds.includes(toolId)) return
          set({ hiddenToolIds: [...hiddenToolIds, toolId] })
        },

        unhideTool: (toolId) => {
          const { hiddenToolIds } = get()
          if (!hiddenToolIds.includes(toolId)) return
          set({ hiddenToolIds: hiddenToolIds.filter((id) => id !== toolId) })
        },

        setToolOrder: (toolOrder) => set({ toolOrder }),

        setPositionForRoute: (route, position) => {
          const { positionByRoute } = get()
          set({ positionByRoute: { ...positionByRoute, [route]: position } })
        },

        clearPositionForRoute: (route) => {
          const { positionByRoute } = get()
          if (!(route in positionByRoute)) return
          // Reconstruct without the cleared key; `omit` via destructuring
          // keeps the resulting object referentially distinct so
          // selectors re-fire.
          const next: typeof positionByRoute = { ...positionByRoute }
          delete next[route]
          set({ positionByRoute: next })
        },

        setPinned: (route, pinned) => {
          const { positionByRoute } = get()
          const current = positionByRoute[route]
          if (pinned) {
            // Locking: capture the *resolved* position so unpinning later
            // returns the user to where they pinned. We store the offset
            // as-is; if the consumer hasn't yet supplied a resolved (x,y)
            // we keep whatever offset is there (default {0,0}).
            const next: AnchorPosition = {
              anchor: 'PINNED',
              offset: current?.offset ?? { x: 0, y: 0 },
            }
            set({ positionByRoute: { ...positionByRoute, [route]: next } })
            return
          }
          // Unlocking: drop back to BR with a clean offset. The previous
          // anchor is not persisted (we only kept PINNED+offset), so BR
          // is the safest default — matches the P3 baseline.
          const next: AnchorPosition = {
            anchor: 'BR',
            offset: { x: 0, y: 0 },
          }
          set({ positionByRoute: { ...positionByRoute, [route]: next } })
        },

        setMach3Behavior: (mach3Behavior) => set({ mach3Behavior }),

        setAutoHideAfterSeconds: (autoHideAfterSeconds) =>
          set({ autoHideAfterSeconds }),

        setUserHidden: (userHidden) => set({ userHidden }),

        setActiveJobs: (activeJobs) => set({ activeJobs }),

        setPanelOpen: (panelOpen) => set({ panelOpen }),

        setTrayOpen: (trayOpen) => set({ trayOpen }),

        setDragging: (dragging) => set({ dragging }),

        hydrateFromServer: (next) => {
          set((prev) => ({ ...prev, ...next }))
        },

        reset: () => {
          set({ ...DEFAULT_PERSISTED_STATE, ...DEFAULT_RUNTIME_STATE })
        },
      }),
      {
        name: omnibeltStorageKeyFor(userId),
        storage: createJSONStorage(() => localStorage),
        version: 1,
        // Persist only the user-preference slice. Runtime fields
        // (activeJobs, panelOpen, trayOpen, dragging) are intentionally
        // excluded — they're rehydrated on mount from workServiceWs / UI
        // interaction and persisting them would re-open panels on reload.
        partialize: (state): OmnibeltPersistedState => ({
          collapseState: state.collapseState,
          positionByRoute: state.positionByRoute,
          skin: state.skin,
          pinnedToolIds: state.pinnedToolIds,
          hiddenToolIds: state.hiddenToolIds,
          toolOrder: state.toolOrder,
          mach3Behavior: state.mach3Behavior,
          autoHideAfterSeconds: state.autoHideAfterSeconds,
          userHidden: state.userHidden,
        }),
      }
    )
  )
}

// ---- Module-singleton + lazy init ------------------------------------------
//
// Stores are global by convention (consumers import `useOmnibeltStore` from
// the same module reference). To honor per-user localStorage isolation we
// hold the bound store in a module-scoped variable and instantiate it on
// first `initOmnibeltStore(userId)`. Subsequent calls with the same userId
// return the same instance; calls with a different userId rebuild it (e.g.
// after sign-out → sign-in as a different user without a full reload).

let _store: OmnibeltStoreHook | null = null
let _storeUserId: string | null = null

export function initOmnibeltStore(userId: string): OmnibeltStoreHook {
  if (_store && _storeUserId === userId) return _store
  _store = createOmnibeltStore(userId)
  _storeUserId = userId
  return _store
}

export function getOmnibeltStoreUserId(): string | null {
  return _storeUserId
}

/** Test-only escape hatch — clears the singleton so per-user isolation
 *  scenarios can be exercised without faking module reloads. */
export function __resetOmnibeltStoreForTests(): void {
  _store = null
  _storeUserId = null
}

/**
 * Selector hook. Throws if the store hasn't been initialized — surface
 * an obvious error rather than silently rendering with default state when
 * the auth bootstrap order is wrong.
 */
export function useOmnibeltStore<T>(selector: (s: OmnibeltState) => T): T {
  if (!_store) {
    throw new Error(
      'OmnibeltStore not initialized — call initOmnibeltStore(userId) first'
    )
  }
  return _store(selector)
}

/** Non-React accessor for module-scope code (e.g. telemetry helpers). */
export function getOmnibeltStore(): OmnibeltStoreHook | null {
  return _store
}

// Created and developed by Jai Singh
