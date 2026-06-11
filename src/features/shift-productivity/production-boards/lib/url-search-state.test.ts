// Created and developed by Jai Singh
/**
 * Unit tests for the cross-component URL-state helpers. The contract we
 * care about:
 *
 *  1. `writeSearchParam` updates `window.location.search`.
 *  2. `writeSearchParam` dispatches a custom event so sibling subscribers
 *     can re-read.
 *  3. `subscribeToSearchParam` fires its listener for matching writes.
 *  4. It ignores writes that target a *different* key.
 *  5. The returned cleanup function detaches both listeners.
 *
 * Together these guarantee that two `useSearchParamState` consumers of
 * the same key stay in lockstep without going through a React Context.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readSearchParam,
  subscribeToSearchParam,
  writeSearchParam,
} from './url-search-state'

function resetUrl(): void {
  // jsdom is happiest with a path-relative URL — passing a full origin
  // can trigger a SecurityError even when origin matches.
  window.history.replaceState({}, '', '/')
}

beforeEach(() => {
  resetUrl()
})

afterEach(() => {
  resetUrl()
})

describe('readSearchParam', () => {
  it('returns null when the key is absent', () => {
    expect(readSearchParam('edit')).toBeNull()
  })

  it('returns the URL value when present', () => {
    window.history.replaceState({}, '', '/?edit=1')
    expect(readSearchParam('edit')).toBe('1')
  })
})

describe('writeSearchParam', () => {
  it('sets the URL when given a value', () => {
    writeSearchParam('edit', '1')
    expect(window.location.search).toBe('?edit=1')
  })

  it('clears the URL when value is null', () => {
    window.history.replaceState({}, '', '/?edit=1')
    writeSearchParam('edit', null)
    expect(window.location.search).toBe('')
  })

  it('treats empty string the same as null (removes the key)', () => {
    window.history.replaceState({}, '', '/?board=jobs')
    writeSearchParam('board', '')
    expect(window.location.search).toBe('')
  })

  it('uses pushState when method=push', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState')
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    writeSearchParam('tv', '1', 'push')
    expect(pushSpy).toHaveBeenCalledTimes(1)
    expect(replaceSpy).not.toHaveBeenCalled()
    pushSpy.mockRestore()
    replaceSpy.mockRestore()
  })

  it('dispatches a custom event with key + value detail', () => {
    const events: Array<{ key?: string; value?: string | null }> = []
    const handler = (e: Event): void => {
      events.push((e as CustomEvent).detail)
    }
    window.addEventListener(
      'omniframe:productionboards:urlstate',
      handler as EventListener
    )
    try {
      writeSearchParam('edit', '1')
      expect(events).toEqual([{ key: 'edit', value: '1' }])
    } finally {
      window.removeEventListener(
        'omniframe:productionboards:urlstate',
        handler as EventListener
      )
    }
  })
})

describe('subscribeToSearchParam', () => {
  it('fires the listener when a write targets the same key', () => {
    const listener = vi.fn()
    const off = subscribeToSearchParam('edit', listener)
    try {
      writeSearchParam('edit', '1')
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      off()
    }
  })

  it('ignores writes that target a different key', () => {
    const listener = vi.fn()
    const off = subscribeToSearchParam('edit', listener)
    try {
      writeSearchParam('board', 'sqcdp')
      expect(listener).not.toHaveBeenCalled()
    } finally {
      off()
    }
  })

  it('also fires on browser popstate events (back/forward nav)', () => {
    const listener = vi.fn()
    const off = subscribeToSearchParam('edit', listener)
    try {
      window.dispatchEvent(new PopStateEvent('popstate'))
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      off()
    }
  })

  it('cleanup detaches both the custom-event and popstate listeners', () => {
    const listener = vi.fn()
    const off = subscribeToSearchParam('edit', listener)
    off()
    writeSearchParam('edit', '1')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps two subscribers in lockstep across a single write', () => {
    // This is the regression we're closing — multiple readers should both
    // re-read after a single writer flips the URL bit.
    const a = vi.fn()
    const b = vi.fn()
    const offA = subscribeToSearchParam('edit', a)
    const offB = subscribeToSearchParam('edit', b)
    try {
      writeSearchParam('edit', '1')
      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(1)
    } finally {
      offA()
      offB()
    }
  })
})

// Created and developed by Jai Singh
