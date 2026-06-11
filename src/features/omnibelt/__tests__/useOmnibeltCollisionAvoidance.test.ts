// Created and developed by Jai Singh
/**
 * useOmnibeltCollisionAvoidance — DOM probe + overlap detection.
 *
 * The hook reads competing chrome rects via `document.querySelectorAll`
 * (default targets: notifications bell + Sonner toaster). We inject
 * real DOM nodes with `getBoundingClientRect` stubs so the math runs
 * end-to-end without leaning on jsdom's layout.
 */
import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useOmnibeltCollisionAvoidance } from '../hooks/useOmnibeltCollisionAvoidance'

type Rect = { x: number; y: number; w: number; h: number }

/** Append a synthetic DOM node with a stubbed bounding rect. */
function mountChrome(selectorAttr: string, rect: Rect): HTMLElement {
  const el = document.createElement('div')
  // selector e.g. `[data-testid="notifications-bell"]` → set attribute.
  // We accept the same selectors the hook scans for.
  if (selectorAttr === 'notifications-bell') {
    el.setAttribute('data-testid', 'notifications-bell')
  } else if (selectorAttr === 'sonner-toaster') {
    el.setAttribute('data-sonner-toaster', '')
  } else {
    el.setAttribute('data-other', selectorAttr)
  }
  el.getBoundingClientRect = () =>
    ({
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.w,
      bottom: rect.y + rect.h,
      width: rect.w,
      height: rect.h,
      x: rect.x,
      y: rect.y,
    }) as DOMRect
  document.body.appendChild(el)
  return el
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useOmnibeltCollisionAvoidance', () => {
  it('returns the widget unchanged when no chrome competes', () => {
    const widget: Rect = { x: 100, y: 100, w: 100, h: 50 }
    const { result } = renderHook(() =>
      useOmnibeltCollisionAvoidance({ widget })
    )
    expect(result.current.adjustedRect).toEqual(widget)
    expect(result.current.reason).toBe('no_overlap')
    expect(result.current.competing).toEqual([])
  })

  it('detects the notifications-bell rect via data-testid', () => {
    mountChrome('notifications-bell', { x: 100, y: 100, w: 100, h: 50 })
    const widget: Rect = { x: 100, y: 100, w: 100, h: 50 }
    const { result } = renderHook(() =>
      useOmnibeltCollisionAvoidance({ widget })
    )
    expect(result.current.competing).toHaveLength(1)
    expect(result.current.competing[0]).toEqual({
      x: 100,
      y: 100,
      w: 100,
      h: 50,
    })
    expect(result.current.reason).toMatch(/^avoided:/)
    expect(result.current.adjustedRect).not.toEqual(widget)
  })

  it('detects the Sonner toaster via [data-sonner-toaster]', () => {
    mountChrome('sonner-toaster', { x: 800, y: 700, w: 200, h: 60 })
    const widget: Rect = { x: 805, y: 705, w: 100, h: 50 }
    const { result } = renderHook(() =>
      useOmnibeltCollisionAvoidance({ widget })
    )
    expect(result.current.competing).toHaveLength(1)
    expect(result.current.reason).toMatch(/^avoided:/)
  })

  it('aggregates multiple competing chrome surfaces', () => {
    mountChrome('notifications-bell', { x: 0, y: 0, w: 50, h: 50 })
    mountChrome('sonner-toaster', { x: 800, y: 700, w: 200, h: 60 })
    const widget: Rect = { x: 0, y: 0, w: 100, h: 50 }
    const { result } = renderHook(() =>
      useOmnibeltCollisionAvoidance({ widget })
    )
    expect(result.current.competing).toHaveLength(2)
  })

  it('ignores overlap below the configured threshold', () => {
    // 2 px overlap; with default 4 px threshold → no avoidance.
    mountChrome('notifications-bell', { x: 198, y: 100, w: 50, h: 50 })
    const widget: Rect = { x: 100, y: 100, w: 100, h: 50 }
    const { result } = renderHook(() =>
      useOmnibeltCollisionAvoidance({ widget })
    )
    expect(result.current.reason).toBe('no_overlap')
  })

  it('accepts an extraSelectors argument for custom chrome registries', () => {
    const el = mountChrome('custom-floating', {
      x: 100,
      y: 100,
      w: 100,
      h: 50,
    })
    el.setAttribute('data-omnibelt-custom', '')
    const widget: Rect = { x: 100, y: 100, w: 100, h: 50 }
    const { result } = renderHook(() =>
      useOmnibeltCollisionAvoidance({
        widget,
        extraSelectors: ['[data-omnibelt-custom]'],
      })
    )
    expect(result.current.competing).toHaveLength(1)
  })

  it('re-probes when the widget rect changes', () => {
    mountChrome('notifications-bell', { x: 100, y: 100, w: 100, h: 50 })
    const { result, rerender } = renderHook(
      ({ widget }: { widget: Rect }) =>
        useOmnibeltCollisionAvoidance({ widget }),
      { initialProps: { widget: { x: 100, y: 100, w: 100, h: 50 } } }
    )
    expect(result.current.reason).toMatch(/^avoided:/)
    rerender({ widget: { x: 500, y: 500, w: 100, h: 50 } })
    expect(result.current.reason).toBe('no_overlap')
  })

  it('skips zero-size DOM nodes', () => {
    mountChrome('notifications-bell', { x: 100, y: 100, w: 0, h: 0 })
    const widget: Rect = { x: 100, y: 100, w: 100, h: 50 }
    const { result } = renderHook(() =>
      useOmnibeltCollisionAvoidance({ widget })
    )
    expect(result.current.competing).toEqual([])
    expect(result.current.reason).toBe('no_overlap')
  })

  it('re-runs the DOM probe on window resize', () => {
    const widget: Rect = { x: 100, y: 100, w: 100, h: 50 }
    const { result } = renderHook(() =>
      useOmnibeltCollisionAvoidance({ widget })
    )
    expect(result.current.competing).toEqual([])
    // Mount competing chrome AFTER the hook mounted, then fire resize.
    mountChrome('notifications-bell', { x: 100, y: 100, w: 100, h: 50 })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current.competing).toHaveLength(1)
  })
})

// Created and developed by Jai Singh
