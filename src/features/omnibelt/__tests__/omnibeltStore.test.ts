// Created and developed by Jai Singh
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Install an in-memory localStorage shim BEFORE the runtime module
// loads. The vitest jsdom env in this repo registers `--localstorage-file`
// without a path, which leaves `window.localStorage.clear()` undefined
// and breaks any test that touches storage. Same pattern as
// `src/hooks/__tests__/use-operator-task-queue-order.test.ts` and
// `src/hooks/__tests__/draft-migration.test.ts`.
const _lsStore = new Map<string, string>()
const localStorageStub: Storage = {
  get length() {
    return _lsStore.size
  },
  clear: () => _lsStore.clear(),
  getItem: (k) => _lsStore.get(k) ?? null,
  setItem: (k, v) => {
    _lsStore.set(k, String(v))
  },
  removeItem: (k) => {
    _lsStore.delete(k)
  },
  key: (i) => Array.from(_lsStore.keys())[i] ?? null,
}
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageStub,
  writable: true,
  configurable: true,
})
Object.defineProperty(window, 'localStorage', {
  value: localStorageStub,
  writable: true,
  configurable: true,
})

const {
  __resetOmnibeltStoreForTests,
  DEFAULT_PERSISTED_STATE,
  initOmnibeltStore,
  omnibeltStorageKeyFor,
  useOmnibeltStore,
} = await import('../store/omnibeltStore')

const USER_A = '00000000-0000-0000-0000-000000000aaa'
const USER_B = '00000000-0000-0000-0000-000000000bbb'

beforeEach(() => {
  // Each test starts from a clean slate: no module-singleton, no stored
  // state. localStorage is provided by jsdom (vitest unit env).
  __resetOmnibeltStoreForTests()
  localStorage.clear()
})

afterEach(() => {
  __resetOmnibeltStoreForTests()
  localStorage.clear()
})

describe('OmniBelt store — selector hook safety', () => {
  it('throws when used before initOmnibeltStore', () => {
    expect(() => useOmnibeltStore((s) => s.skin)).toThrow(
      /OmnibeltStore not initialized/
    )
  })

  it('returns same instance for repeat init with same userId', () => {
    const a1 = initOmnibeltStore(USER_A)
    const a2 = initOmnibeltStore(USER_A)
    expect(a1).toBe(a2)
  })

  it('rebuilds the store on userId change', () => {
    const a = initOmnibeltStore(USER_A)
    const b = initOmnibeltStore(USER_B)
    expect(a).not.toBe(b)
  })
})

describe('OmniBelt store — defaults', () => {
  it('seeds the persisted slice with documented defaults', () => {
    const store = initOmnibeltStore(USER_A)
    const state = store.getState()
    expect(state.collapseState).toBe(DEFAULT_PERSISTED_STATE.collapseState)
    expect(state.skin).toBe(DEFAULT_PERSISTED_STATE.skin)
    expect(state.mach3Behavior).toBe(DEFAULT_PERSISTED_STATE.mach3Behavior)
    expect(state.autoHideAfterSeconds).toBe(
      DEFAULT_PERSISTED_STATE.autoHideAfterSeconds
    )
    expect(state.userHidden).toBe(false)
    expect(state.positionByRoute).toEqual({})
    expect(state.pinnedToolIds).toEqual([])
    expect(state.hiddenToolIds).toEqual([])
    expect(state.toolOrder).toEqual([])
  })

  it('defaults to the Sky Strip skin (2026-05-24 promotion)', () => {
    // Locked-in expectation: brand-new clients without a persisted
    // pref and without server hydration land on the SkyStrip skin.
    // Pairs with migration 330 (server-side column DEFAULT).
    const store = initOmnibeltStore(USER_A)
    expect(store.getState().skin).toBe('skystrip')
  })

  it('defaults collapseState to "pill" so every skin renders its resting form', () => {
    // 'pill' is the canonical "resting collapsed" state across all
    // three skins (Pill → full body, SkyStrip → strip, Orb → falls
    // through to its own resting form). Defaulting to 'orb' would
    // strand SkyStrip users in a no-render state on first paint.
    const store = initOmnibeltStore(USER_A)
    expect(store.getState().collapseState).toBe('pill')
  })

  it('seeds the runtime slice empty (not persisted)', () => {
    const store = initOmnibeltStore(USER_A)
    const state = store.getState()
    expect(state.activeJobs).toEqual([])
    expect(state.panelOpen).toBe(false)
    expect(state.trayOpen).toBe(false)
    expect(state.dragging).toBe(false)
  })
})

describe('OmniBelt store — actions', () => {
  it('togglePin adds then removes a tool id', () => {
    const store = initOmnibeltStore(USER_A)
    store.getState().togglePin('quick_pick')
    expect(store.getState().pinnedToolIds).toEqual(['quick_pick'])
    store.getState().togglePin('quick_pick')
    expect(store.getState().pinnedToolIds).toEqual([])
  })

  it('hideTool / unhideTool are idempotent', () => {
    const store = initOmnibeltStore(USER_A)
    store.getState().hideTool('quick_note')
    store.getState().hideTool('quick_note') // double-hide
    expect(store.getState().hiddenToolIds).toEqual(['quick_note'])
    store.getState().unhideTool('quick_note')
    store.getState().unhideTool('quick_note') // double-unhide
    expect(store.getState().hiddenToolIds).toEqual([])
  })

  it('setPositionForRoute writes per-routeClass entries', () => {
    const store = initOmnibeltStore(USER_A)
    store
      .getState()
      .setPositionForRoute('admin', { anchor: 'BR', offset: { x: 24, y: 24 } })
    store
      .getState()
      .setPositionForRoute('reports', { anchor: 'TC', offset: { x: 0, y: 12 } })
    expect(store.getState().positionByRoute).toEqual({
      admin: { anchor: 'BR', offset: { x: 24, y: 24 } },
      reports: { anchor: 'TC', offset: { x: 0, y: 12 } },
    })
  })

  it('clearPositionForRoute removes the keyed entry', () => {
    const store = initOmnibeltStore(USER_A)
    store
      .getState()
      .setPositionForRoute('admin', { anchor: 'TL', offset: { x: 0, y: 0 } })
    store
      .getState()
      .setPositionForRoute('reports', { anchor: 'TC', offset: { x: 0, y: 0 } })
    store.getState().clearPositionForRoute('admin')
    expect(store.getState().positionByRoute).toEqual({
      reports: { anchor: 'TC', offset: { x: 0, y: 0 } },
    })
  })

  it('clearPositionForRoute is a no-op when the entry is missing', () => {
    const store = initOmnibeltStore(USER_A)
    const before = store.getState().positionByRoute
    store.getState().clearPositionForRoute('admin')
    // Reference equality preserved when nothing changes.
    expect(store.getState().positionByRoute).toBe(before)
  })

  it('setPinned(true) writes a PINNED entry for that route class', () => {
    const store = initOmnibeltStore(USER_A)
    store.getState().setPinned('admin', true)
    expect(store.getState().positionByRoute.admin).toEqual({
      anchor: 'PINNED',
      offset: { x: 0, y: 0 },
    })
  })

  it('setPinned preserves the prior offset when pinning', () => {
    const store = initOmnibeltStore(USER_A)
    store.getState().setPositionForRoute('admin', {
      anchor: 'FREE',
      offset: { x: 200, y: 150 },
    })
    store.getState().setPinned('admin', true)
    expect(store.getState().positionByRoute.admin).toEqual({
      anchor: 'PINNED',
      offset: { x: 200, y: 150 },
    })
  })

  it('setPinned(false) returns the route to BR with a fresh offset', () => {
    const store = initOmnibeltStore(USER_A)
    store.getState().setPinned('admin', true)
    store.getState().setPinned('admin', false)
    expect(store.getState().positionByRoute.admin).toEqual({
      anchor: 'BR',
      offset: { x: 0, y: 0 },
    })
  })

  it('hydrateFromServer merges the persisted slice', () => {
    const store = initOmnibeltStore(USER_A)
    store.getState().hydrateFromServer({
      skin: 'orb',
      mach3Behavior: 'halo_only',
      pinnedToolIds: ['sap_status'],
    })
    const s = store.getState()
    expect(s.skin).toBe('orb')
    expect(s.mach3Behavior).toBe('halo_only')
    expect(s.pinnedToolIds).toEqual(['sap_status'])
    // Untouched defaults remain — collapseState defaults to 'pill'
    // post-2026-05-24 (was 'orb' pre-SkyStrip-promotion).
    expect(s.collapseState).toBe(DEFAULT_PERSISTED_STATE.collapseState)
    expect(s.autoHideAfterSeconds).toBe(15)
  })

  it('reset returns the store to documented defaults', () => {
    const store = initOmnibeltStore(USER_A)
    // Pick a non-default skin so the assertion proves reset() restored it.
    // Defaults moved to 'skystrip' on 2026-05-24 (migration 330), so use
    // 'pill' for the dirty value.
    store.getState().setSkin('pill')
    store.getState().togglePin('quick_pick')
    store.getState().setUserHidden(true)
    store.getState().setPanelOpen(true)
    store.getState().reset()
    const s = store.getState()
    expect(s.skin).toBe(DEFAULT_PERSISTED_STATE.skin)
    expect(s.pinnedToolIds).toEqual([])
    expect(s.userHidden).toBe(false)
    expect(s.panelOpen).toBe(false)
  })
})

describe('OmniBelt store — persist', () => {
  it('writes to a per-user localStorage key', () => {
    const store = initOmnibeltStore(USER_A)
    store.getState().setSkin('orb')
    const key = omnibeltStorageKeyFor(USER_A)
    const raw = localStorage.getItem(key)
    expect(raw).toBeTruthy()
    expect(key).toBe(`omniframe.omnibelt.${USER_A}.v1`)
  })

  it('partialize excludes runtime-only fields', () => {
    const store = initOmnibeltStore(USER_A)
    store.getState().setPanelOpen(true)
    store.getState().setTrayOpen(true)
    store.getState().setDragging(true)
    store.getState().setActiveJobs([
      {
        id: 'j1',
        type: 'sap_import',
        label: 'SAP import',
        progress: 0.42,
        startedAt: Date.now(),
        startedByCurrentUser: true,
        cancelable: false,
      },
    ])
    store.getState().setSkin('orb') // forces a persist write
    const raw = localStorage.getItem(omnibeltStorageKeyFor(USER_A))
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    const persistedKeys = Object.keys(parsed.state) as string[]
    // Documented persisted keys present.
    expect(persistedKeys).toEqual(
      expect.arrayContaining([
        'collapseState',
        'positionByRoute',
        'skin',
        'pinnedToolIds',
        'hiddenToolIds',
        'toolOrder',
        'mach3Behavior',
        'autoHideAfterSeconds',
        'userHidden',
      ])
    )
    // Runtime fields explicitly absent.
    expect(persistedKeys).not.toContain('panelOpen')
    expect(persistedKeys).not.toContain('trayOpen')
    expect(persistedKeys).not.toContain('dragging')
    expect(persistedKeys).not.toContain('activeJobs')
  })

  it('roundtrip: setPosition → hydrate from JSON → state matches', () => {
    const store = initOmnibeltStore(USER_A)
    store
      .getState()
      .setPositionForRoute('admin', { anchor: 'BR', offset: { x: 24, y: 24 } })
    store.getState().setSkin('orb')
    store.getState().setUserHidden(true)

    const raw = localStorage.getItem(omnibeltStorageKeyFor(USER_A))
    expect(raw).toBeTruthy()

    // Tear down + re-initialize the singleton — Zustand's `persist`
    // middleware rehydrates from the same localStorage key automatically.
    __resetOmnibeltStoreForTests()
    const reborn = initOmnibeltStore(USER_A)
    const s = reborn.getState()
    expect(s.skin).toBe('orb')
    expect(s.userHidden).toBe(true)
    expect(s.positionByRoute.admin).toEqual({
      anchor: 'BR',
      offset: { x: 24, y: 24 },
    })
  })

  it('per-user key isolation: USER_A state does NOT leak into USER_B', () => {
    const a = initOmnibeltStore(USER_A)
    a.getState().setSkin('orb')
    a.getState().setUserHidden(true)
    expect(a.getState().skin).toBe('orb')

    // Switch user — store is rebuilt against a different key.
    __resetOmnibeltStoreForTests()
    const b = initOmnibeltStore(USER_B)
    const sB = b.getState()
    expect(sB.skin).toBe(DEFAULT_PERSISTED_STATE.skin)
    expect(sB.userHidden).toBe(false)
    // USER_A's row remains in localStorage untouched.
    expect(localStorage.getItem(omnibeltStorageKeyFor(USER_A))).toBeTruthy()
    expect(localStorage.getItem(omnibeltStorageKeyFor(USER_B))).toBe(null)
  })
})

// Created and developed by Jai Singh
