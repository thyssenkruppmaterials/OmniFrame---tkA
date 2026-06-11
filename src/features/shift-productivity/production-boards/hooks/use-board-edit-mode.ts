// Created and developed by Jai Singh
import { useSearchParamState } from '../lib/url-search-state'

const PARAM_KEY = 'edit'

const parse = (raw: string | null): boolean => raw === '1'
const serialize = (v: boolean): string | null => (v ? '1' : null)

/**
 * Read/write `?edit=1` URL state across the Production Boards page.
 *
 * Backed by the shared `useSearchParamState` helper, which dispatches a
 * custom event on every write so sibling consumers (per-card pencils
 * across all boards) re-read the URL and re-render. Without that, the
 * `<BoardEditToggle>`'s `replaceState` call would update the URL but
 * leave every other reader stuck at `false` — that's the regression
 * being fixed.
 *
 * The component file (`board-edit-toggle.tsx`) keeps the visual toggle;
 * this hook lives next to the other URL-state hooks for discoverability
 * and to silence the `react-refresh/only-export-components` lint warning
 * the colocated hook used to trigger.
 */
export function useBoardEditMode(): [boolean, (next: boolean) => void] {
  return useSearchParamState<boolean>(PARAM_KEY, parse, serialize)
}

// Created and developed by Jai Singh
