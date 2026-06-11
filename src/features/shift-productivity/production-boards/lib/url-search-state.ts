// Created and developed by Jai Singh
/**
 * Cross-component URL `?key=` state for the Production Boards feature.
 *
 * ## Why this exists
 *
 * The four URL-state hooks shipped with v6 (`useBoardEditMode`,
 * `useBoardSearchParam`, `useTvSearchParam`, `useAreaSearchParam`) each
 * followed the same pattern:
 *
 *   1. `useState(() => readSearchParam(...))` — initialise from the URL once.
 *   2. `popstate` listener — re-read the URL on browser back/forward.
 *   3. Setter writes via `history.replaceState` (or `pushState`).
 *
 * This is silently broken whenever **two or more components subscribe to
 * the same URL bit**. `replaceState` / `pushState` do **not** fire
 * `popstate` (per the HTML spec — `popstate` only fires on actual
 * back/forward navigation), so the writer's local state advances but
 * sibling readers stay frozen at the value they captured on mount.
 *
 * For `?board=` and `?area=` the bug is masked because there's only one
 * writer + one reader. For `?edit=` the bug is the user-visible "clicking
 * does nothing" report — every per-card pencil reader (`<SqcdpCard>`,
 * `<PostCard>`, `<JobCard>`, ...) re-reads the URL exactly once per
 * mount and then sits at `editMode = false` forever.
 *
 * ## Fix shape
 *
 * `writeSearchParam` updates the URL **and** dispatches a custom event that
 * `subscribeToSearchParam` listens for, so writers and readers in the same
 * SPA session stay in lockstep without a Provider tree refactor. We still
 * listen for `popstate` so browser back/forward keeps working.
 *
 * `useSearchParamState` is the React-facing wrapper: identical public API
 * to the four hooks it replaces (`[value, setter]`) so callers don't need
 * to change.
 */
import { useCallback, useEffect, useState } from 'react'

const URL_STATE_EVENT = 'omniframe:productionboards:urlstate'

type Method = 'replace' | 'push'

/** Read `?key=` from the current URL. SSR-safe (returns `null`). */
export function readSearchParam(key: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(key)
}

/**
 * Write `?key=value` to the URL via `history.replaceState`/`pushState`,
 * then dispatch a custom event so other subscribers in the same session
 * can re-read. Pass `value === null` (or `''`) to remove the key.
 */
export function writeSearchParam(
  key: string,
  value: string | null,
  method: Method = 'replace'
): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (value === null || value === '') {
    url.searchParams.delete(key)
  } else {
    url.searchParams.set(key, value)
  }
  if (method === 'push') {
    window.history.pushState({}, '', url.toString())
  } else {
    window.history.replaceState({}, '', url.toString())
  }
  window.dispatchEvent(
    new CustomEvent(URL_STATE_EVENT, { detail: { key, value } })
  )
}

/**
 * Subscribe to URL-state changes for a given key. Listens to both the
 * custom event (intra-SPA writes) and `popstate` (browser nav). Returns
 * an unsubscribe function that detaches both listeners.
 */
export function subscribeToSearchParam(
  key: string,
  listener: () => void
): () => void {
  if (typeof window === 'undefined') return () => {}
  const handleCustom = (e: Event): void => {
    const ce = e as CustomEvent<{ key?: string }>
    if (ce.detail?.key === key) listener()
  }
  window.addEventListener(URL_STATE_EVENT, handleCustom as EventListener)
  window.addEventListener('popstate', listener)
  return () => {
    window.removeEventListener(URL_STATE_EVENT, handleCustom as EventListener)
    window.removeEventListener('popstate', listener)
  }
}

/**
 * Generic React hook for `?key=` URL state. Returns `[value, setter]`
 * with the same shape as the per-key hooks it replaces. The optimistic
 * `setValue` keeps the caller's UI responsive across React's batched
 * renders; the event listener also fires and re-reads the URL so the
 * cached value matches whatever ended up in the address bar.
 */
export function useSearchParamState<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string | null,
  options: { method?: Method } = {}
): [T, (next: T) => void] {
  const method = options.method ?? 'replace'
  const [value, setValue] = useState<T>(() => parse(readSearchParam(key)))

  useEffect(() => {
    return subscribeToSearchParam(key, () => {
      setValue(parse(readSearchParam(key)))
    })
  }, [key, parse])

  const setter = useCallback(
    (next: T) => {
      writeSearchParam(key, serialize(next), method)
      setValue(next)
    },
    [key, serialize, method]
  )

  return [value, setter]
}

// Created and developed by Jai Singh
