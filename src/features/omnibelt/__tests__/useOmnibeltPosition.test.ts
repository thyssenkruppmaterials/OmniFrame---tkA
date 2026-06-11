// Created and developed by Jai Singh
/**
 * useOmnibeltPosition — anchor lookup by route class, drag-end snap,
 * PINNED drag disable, reduced-motion path.
 *
 * The store throws if consumed before `initOmnibeltStore(...)`, so each
 * test re-initialises with a fresh per-user key. `useLocation` and
 * framer-motion's `useReducedMotion` are mocked at module scope to keep
 * the assertions deterministic.
 */
import { act, renderHook } from '@testing-library/react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest'

// ---- localStorage shim BEFORE the runtime module loads ---------------------

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

// ---- Mocks ----------------------------------------------------------------

vi.mock('@tanstack/react-router', () => ({
  useLocation: vi.fn(),
}))

vi.mock('framer-motion', () => ({
  useReducedMotion: vi.fn(),
  useDragControls: vi.fn(() => ({ start: vi.fn() })),
}))

const { __resetOmnibeltStoreForTests, initOmnibeltStore } =
  await import('../store/omnibeltStore')
const { useLocation } = await import('@tanstack/react-router')
const { useReducedMotion } = await import('framer-motion')
const { useOmnibeltPosition } = await import('../hooks/useOmnibeltPosition')

const USER_ID = '00000000-0000-0000-0000-000000000aaa'

function setupViewport(width = 1024, height = 768) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  })
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: height,
  })
}

beforeEach(() => {
  __resetOmnibeltStoreForTests()
  _lsStore.clear()
  ;(useLocation as unknown as Mock).mockReturnValue('/admin/users')
  ;(useReducedMotion as unknown as Mock).mockReturnValue(false)
  setupViewport()
})

afterEach(() => {
  __resetOmnibeltStoreForTests()
  _lsStore.clear()
})

describe('useOmnibeltPosition — defaults', () => {
  it('returns BR-anchored position when no stored entry exists', () => {
    initOmnibeltStore(USER_ID)
    const { result } = renderHook(() =>
      useOmnibeltPosition({ widgetW: 220, widgetH: 44 })
    )
    expect(result.current.anchor).toBe('BR')
    expect(result.current.isDraggable).toBe(true)
    // BR canonical top-left: viewportW - widgetW - gutter
    expect(result.current.x).toBe(1024 - 220 - 24)
    expect(result.current.y).toBe(768 - 44 - 24)
  })

  it('reports the current route class', () => {
    ;(useLocation as unknown as Mock).mockReturnValue('/reports/sales')
    initOmnibeltStore(USER_ID)
    const { result } = renderHook(() =>
      useOmnibeltPosition({ widgetW: 100, widgetH: 50 })
    )
    expect(result.current.routeClass).toBe('reports')
  })
})

describe('useOmnibeltPosition — route-class lookup', () => {
  it('reads the stored anchor for the current route class', () => {
    const store = initOmnibeltStore(USER_ID)
    store
      .getState()
      .setPositionForRoute('admin', { anchor: 'TL', offset: { x: 0, y: 0 } })
    const { result } = renderHook(() =>
      useOmnibeltPosition({ widgetW: 100, widgetH: 50 })
    )
    expect(result.current.anchor).toBe('TL')
    expect(result.current.x).toBe(24)
    expect(result.current.y).toBe(24)
  })

  it('isolates positions across route classes', () => {
    const store = initOmnibeltStore(USER_ID)
    store
      .getState()
      .setPositionForRoute('admin', { anchor: 'TL', offset: { x: 0, y: 0 } })
    store
      .getState()
      .setPositionForRoute('reports', { anchor: 'TC', offset: { x: 0, y: 0 } })
    ;(useLocation as unknown as Mock).mockReturnValue('/admin/users')
    const { result: admin } = renderHook(() =>
      useOmnibeltPosition({ widgetW: 100, widgetH: 50 })
    )
    expect(admin.current.anchor).toBe('TL')
    ;(useLocation as unknown as Mock).mockReturnValue('/reports/p1')
    const { result: reports } = renderHook(() =>
      useOmnibeltPosition({ widgetW: 100, widgetH: 50 })
    )
    expect(reports.current.anchor).toBe('TC')
  })
})

describe('useOmnibeltPosition — onDragEnd', () => {
  it('snaps a near-anchor drop and writes back to the store', () => {
    const store = initOmnibeltStore(USER_ID)
    const { result } = renderHook(() =>
      useOmnibeltPosition({ widgetW: 220, widgetH: 44 })
    )
    // Pointer up near the TL anchor center → expect TL snap.
    act(() => {
      // The Pill body translates pointer.x/y into widget-top-left for us,
      // but here we test the hook in isolation so we pass the top-left.
      result.current.onDragEnd({ x: 30, y: 30 })
    })
    expect(store.getState().positionByRoute.admin).toEqual({
      anchor: 'TL',
      offset: { x: 0, y: 0 },
    })
  })

  it('writes FREE with the drop point when far from every anchor', () => {
    const store = initOmnibeltStore(USER_ID)
    const { result } = renderHook(() =>
      useOmnibeltPosition({ widgetW: 220, widgetH: 44 })
    )
    act(() => {
      result.current.onDragEnd({ x: 400, y: 300 })
    })
    expect(store.getState().positionByRoute.admin?.anchor).toBe('FREE')
    expect(store.getState().positionByRoute.admin?.offset).toEqual({
      x: 400,
      y: 300,
    })
  })

  it('clears `dragging` runtime flag on drag-end', () => {
    const store = initOmnibeltStore(USER_ID)
    store.getState().setDragging(true)
    const { result } = renderHook(() =>
      useOmnibeltPosition({ widgetW: 100, widgetH: 50 })
    )
    act(() => {
      result.current.onDragEnd({ x: 100, y: 100 })
    })
    expect(store.getState().dragging).toBe(false)
  })

  it('sets `dragging` runtime flag on drag-start', () => {
    const store = initOmnibeltStore(USER_ID)
    const { result } = renderHook(() =>
      useOmnibeltPosition({ widgetW: 100, widgetH: 50 })
    )
    act(() => {
      result.current.onDragStart()
    })
    expect(store.getState().dragging).toBe(true)
  })
})

describe('useOmnibeltPosition — PINNED', () => {
  it('reports isDraggable=false when anchor is PINNED', () => {
    const store = initOmnibeltStore(USER_ID)
    store.getState().setPinned('admin', true)
    const { result } = renderHook(() =>
      useOmnibeltPosition({ widgetW: 100, widgetH: 50 })
    )
    expect(result.current.anchor).toBe('PINNED')
    expect(result.current.isDraggable).toBe(false)
  })

  it('setPinned(false) drops the route back to BR with a fresh offset', () => {
    const store = initOmnibeltStore(USER_ID)
    store.getState().setPinned('admin', true)
    const { result } = renderHook(() =>
      useOmnibeltPosition({ widgetW: 100, widgetH: 50 })
    )
    act(() => {
      result.current.setPinned(false)
    })
    expect(store.getState().positionByRoute.admin).toEqual({
      anchor: 'BR',
      offset: { x: 0, y: 0 },
    })
  })
})

describe('useOmnibeltPosition — setAnchor', () => {
  it('writes the chosen anchor for the current route class', () => {
    const store = initOmnibeltStore(USER_ID)
    const { result } = renderHook(() =>
      useOmnibeltPosition({ widgetW: 100, widgetH: 50 })
    )
    act(() => {
      result.current.setAnchor('TR')
    })
    expect(store.getState().positionByRoute.admin?.anchor).toBe('TR')
  })
})

describe('useOmnibeltPosition — reduced motion', () => {
  it('mirrors `useReducedMotion()` in the returned flag', () => {
    ;(useReducedMotion as unknown as Mock).mockReturnValue(true)
    initOmnibeltStore(USER_ID)
    const { result } = renderHook(() =>
      useOmnibeltPosition({ widgetW: 100, widgetH: 50 })
    )
    expect(result.current.reducedMotion).toBe(true)
  })

  it('false when prefers-reduced-motion is unset', () => {
    ;(useReducedMotion as unknown as Mock).mockReturnValue(false)
    initOmnibeltStore(USER_ID)
    const { result } = renderHook(() =>
      useOmnibeltPosition({ widgetW: 100, widgetH: 50 })
    )
    expect(result.current.reducedMotion).toBe(false)
  })
})

describe('useOmnibeltPosition — forceAnchor', () => {
  it('overrides the stored anchor (used by the Edge Nub)', () => {
    const store = initOmnibeltStore(USER_ID)
    store
      .getState()
      .setPositionForRoute('admin', { anchor: 'BR', offset: { x: 0, y: 0 } })
    const { result } = renderHook(() =>
      useOmnibeltPosition({ widgetW: 6, widgetH: 48, forceAnchor: 'NUB_R' })
    )
    expect(result.current.anchor).toBe('NUB_R')
    // NUB_R sits flush against the right edge.
    expect(result.current.x).toBe(1024 - 6)
  })
})

// Created and developed by Jai Singh
