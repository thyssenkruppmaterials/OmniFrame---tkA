// Created and developed by Jai Singh
import { useSearchParamState } from '../../../lib/url-search-state'

const PARAM_KEY = 'area'
export const ALL_AREAS_VALUE = 'all'

const parse = (raw: string | null): string =>
  raw && raw !== '' ? raw : ALL_AREAS_VALUE

// Aggregate tab is the default — normalise it away to keep the URL tidy.
const serialize = (next: string): string | null =>
  !next || next === ALL_AREAS_VALUE ? null : next

/**
 * Read/write `?area=` URL state for the hourly board's per-area tabs.
 *
 * Backed by `useSearchParamState`, which dispatches a custom event on
 * each write so the rotation effect inside the hourly board (which both
 * reads and writes via the same hook) stays in lockstep with sibling
 * consumers — and so future board features that key off `?area=` won't
 * silently regress the way the v6 inlined version did.
 */
export function useAreaSearchParam(): [string, (next: string) => void] {
  return useSearchParamState<string>(PARAM_KEY, parse, serialize)
}

// Created and developed by Jai Singh
