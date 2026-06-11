// Created and developed by Jai Singh
import { useSearchParamState } from '../lib/url-search-state'

const PARAM_KEY = 'tv'

const parse = (raw: string | null): boolean => raw === '1'
const serialize = (v: boolean): string | null => (v ? '1' : null)

/**
 * Read/write `?tv=1` URL state. Uses `pushState` (rather than
 * `replaceState`) so entering and exiting TV mode each add a history
 * entry — that lets a curator press the browser Back button to leave
 * TV mode the same way the in-frame Exit button does.
 *
 * Backed by `useSearchParamState`, which dispatches a custom event on
 * each write so the page-level reader and the per-board readers stay
 * in lockstep without going through React Context.
 */
export function useTvSearchParam(): [boolean, (next: boolean) => void] {
  return useSearchParamState<boolean>(PARAM_KEY, parse, serialize, {
    method: 'push',
  })
}

// Created and developed by Jai Singh
