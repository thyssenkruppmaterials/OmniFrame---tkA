// Created and developed by Jai Singh
/**
 * Hook test for `useBoardSearchParam` — round-trip the `?board=` URL state.
 *
 * `useBoardSearchParam` reads from `window.location.search` and writes via
 * `history.replaceState`. The setter normalises away the default
 * (`hourly`) so the URL stays clean when the user lands on the canonical
 * tab. This test exercises that round-trip plus a couple of guards
 * (unknown slug → fall back to default; popstate sync).
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useBoardSearchParam } from './use-board-search-param'

function setUrl(search: string): void {
  // jsdom is happiest when given a path-relative URL string. Passing a
  // full origin sometimes triggers a SecurityError even when origin
  // matches the document's base URL.
  window.history.replaceState({}, '', search ? `/${search}` : '/')
}

beforeEach(() => {
  setUrl('')
})

afterEach(() => {
  setUrl('')
})

describe('useBoardSearchParam', () => {
  it('defaults to "hourly" when no param is present', () => {
    const { result } = renderHook(() => useBoardSearchParam())
    expect(result.current[0]).toBe('hourly')
  })

  it('reads a known slug from the URL on mount', () => {
    setUrl('?board=sqcdp')
    const { result } = renderHook(() => useBoardSearchParam())
    expect(result.current[0]).toBe('sqcdp')
  })

  it('falls back to the default when the URL value is unknown', () => {
    setUrl('?board=unknown')
    const { result } = renderHook(() => useBoardSearchParam())
    expect(result.current[0]).toBe('hourly')
  })

  it('writes the URL on set, and clears it when set back to the default', () => {
    const { result } = renderHook(() => useBoardSearchParam())

    act(() => {
      result.current[1]('jobs')
    })
    expect(result.current[0]).toBe('jobs')
    expect(window.location.search).toBe('?board=jobs')

    act(() => {
      result.current[1]('hourly')
    })
    expect(result.current[0]).toBe('hourly')
    // Default slug is normalised away to keep the URL tidy.
    expect(window.location.search).toBe('')
  })

  it('syncs the slug when the user navigates back/forward (popstate)', () => {
    const { result } = renderHook(() => useBoardSearchParam())

    act(() => {
      window.history.replaceState({}, '', '/?board=safety_alerts')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(result.current[0]).toBe('safety_alerts')
  })
})

// Created and developed by Jai Singh
