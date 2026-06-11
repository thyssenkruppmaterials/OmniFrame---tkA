---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-10
---
# Cross-Component URL Search State

## Purpose / Context

Whenever a feature surfaces user-controlled state in `?key=value` form (filters, edit-mode toggles, deep-linkable tabs, fullscreen overlays), and **two or more components in the same render tree need to react to that state**, the obvious `useState` + `popstate` pattern is silently broken:

```ts
// ⛔ The footgun
const [v, setV] = useState(() => readUrl())
useEffect(() => {
  const onPop = () => setV(readUrl())
  window.addEventListener('popstate', onPop)
  return () => window.removeEventListener('popstate', onPop)
}, [])
const write = (next: T) => {
  setV(next)
  history.replaceState({}, '', urlWith(next))
}
```

**Why it's broken:** `history.replaceState` and `history.pushState` do **not** fire `popstate`. Per the HTML spec, `popstate` only fires for actual back/forward navigation. The writer's `setV` updates its own component, but every other component that called the same hook stays at the value it captured on mount.

This is the bug the Production Boards v7 fix closed (see [[Fix-Production-Boards-Edit-Toggle-No-Op]] and [[Implement-Production-Boards-Hourly-Grid]] § v7). With the editable-board recipe, the toggle button is one writer and **every per-card pencil + `+ Add` CTA across six boards** is a reader — they all sat stuck at `false` forever.

The single-consumer-by-accident case (page is both writer and reader) hides the bug for months. Don't let the next URL-state hook walk into the same trap.

## The Recipe

### 1. Module-level write → broadcast

```ts
const URL_STATE_EVENT = 'omniframe:<feature>:urlstate'

export function writeSearchParam(
  key: string,
  value: string | null,
  method: 'replace' | 'push' = 'replace'
): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (value === null || value === '') url.searchParams.delete(key)
  else url.searchParams.set(key, value)
  if (method === 'push') window.history.pushState({}, '', url.toString())
  else window.history.replaceState({}, '', url.toString())
  window.dispatchEvent(
    new CustomEvent(URL_STATE_EVENT, { detail: { key, value } })
  )
}
```

Namespace the event per-feature (`omniframe:productionboards:urlstate`, `omniframe:inventory:urlstate`) so a multi-feature page with two URL-state systems doesn't cross-fire listeners.

### 2. Subscribe to BOTH the custom event AND `popstate`

```ts
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
```

`popstate` is still required: it's the only signal you get for browser back/forward, hash navigation, and `<a href>` clicks that change the search.

### 3. Generic React hook

```ts
export function useSearchParamState<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string | null,
  options: { method?: 'replace' | 'push' } = {}
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
      setValue(next)  // optimistic; the listener will also fire and reconcile.
    },
    [key, serialize, method]
  )

  return [value, setter]
}
```

The optimistic local update keeps the writer's UI snappy across React's batched renders. The event listener that fires on the next tick re-reads the URL and overwrites with the canonical value — cheap, idempotent.

### 4. Per-feature key hooks are one-liners

```ts
// hooks/use-board-edit-mode.ts
const parse = (raw: string | null): boolean => raw === '1'
const serialize = (v: boolean): string | null => (v ? '1' : null)
export function useBoardEditMode(): [boolean, (next: boolean) => void] {
  return useSearchParamState<boolean>('edit', parse, serialize)
}
```

Keep the per-key hook as a thin wrapper so callers stay readable (`useBoardEditMode()` is more discoverable than `useSearchParamState('edit', parseEdit, serializeEdit)`).

## When to use `method: 'replace'` vs `'push'`

- `'replace'` (default) for **filter / tab / edit-mode** state that the user adjusts dozens of times per session. Don't pollute history.
- `'push'` for **modal-like overlays** (TV mode, fullscreen viewers) where the browser Back button should drop the overlay. Browser back → `popstate` → hook reconciles → overlay closes.

## SSR / non-browser safety

Every helper guards `typeof window === 'undefined'`. Per-key hooks should rely on the helper for that — don't duplicate the check.

## Don't

- **Don't listen only to `popstate`.** That's the bug this pattern exists to close.
- **Don't use a global Zustand store for URL state.** The URL is the source of truth (deep-linkable, refresh-safe). Local state in a store has to be re-synced from the URL on mount, which puts you back where you started.
- **Don't share one event name across features.** Namespace it (`omniframe:<feature>:urlstate`) so a page that mounts two URL-state systems can't cross-fire.
- **Don't write to the URL inside `useEffect` based on local state.** Let the user-action handler write directly via `setter`. Effects firing on initial render can clobber the URL the user navigated in with.
- **Don't set `value === ''` and expect the key to drop — do `value === null`.** The helper treats both as removal but a serialise function returning `''` is ambiguous; prefer explicit `null`.
- **Don't add a fallback `useEffect(() => readUrl(), [pathname])`.** That's polling; the custom event makes it unnecessary and the deps array on `pathname` doesn't fire when only the search changes.

## Audit checklist for new URL-state hooks

Before landing a new `useState(() => readSearchParam(...))` hook, verify:

- [ ] Is there a custom-event subscribe path (or equivalent), not just `popstate`?
- [ ] Does the writer dispatch the same event the readers listen for?
- [ ] Is the cleanup function detaching **both** listeners?
- [ ] Is the event name namespaced per feature?
- [ ] Does at least one regression test mount two consumers in the same tree and click the writer? (See [[Fix-Production-Boards-Edit-Toggle-No-Op]] for the canonical smoke test.)

## Related

- [[Fix-Production-Boards-Edit-Toggle-No-Op]] — the bug that motivated this pattern.
- [[Implement-Production-Boards-Hourly-Grid]] § v7 — the implementation note that promotes the helper.
- [[Editable-Board-Sheets]] — uses `useBoardEditMode` internally; the recipe that exposes the most readers.
- [[ProductionBoards - Feature Module]] — the surface area where the pattern was extracted.
