// Created and developed by Jai Singh
import { isBoardSlug, type BoardSlug } from '../lib/boards'
import { useSearchParamState } from '../lib/url-search-state'

const PARAM_KEY = 'board'
const DEFAULT_SLUG: BoardSlug = 'hourly'

const parse = (raw: string | null): BoardSlug =>
  raw && isBoardSlug(raw) ? raw : DEFAULT_SLUG

// Default slug is normalised away to keep the URL tidy.
const serialize = (slug: BoardSlug): string | null =>
  slug === DEFAULT_SLUG ? null : slug

/**
 * Reads `?board=` from the URL and returns a setter that updates it
 * via `history.replaceState` so tab clicks don't pollute history.
 *
 * Backed by `useSearchParamState`, which dispatches a custom event on
 * each write so multiple `useBoardSearchParam` consumers (today: just
 * the page, but defensive for future tab strips) stay in lockstep.
 */
export function useBoardSearchParam(): [BoardSlug, (slug: BoardSlug) => void] {
  return useSearchParamState<BoardSlug>(PARAM_KEY, parse, serialize)
}

// Created and developed by Jai Singh
