---
tags: [type/debug, status/active, domain/frontend]
created: 2026-05-10
---
# Fix: Production Boards Edit Toggle Was a No-Op

## Symptom

User report (2026-05-10): “Going through each of the new tabs and the current hourly tab, clicking on the editing button does absolutely nothing.”

The `<BoardEditToggle>` button visibly toggled its own pressed state and the URL bar updated to `?edit=1`, but no per-card pencil icons or `+ Add` CTAs appeared on any of the six boards (Hourly / SQCDP / Announcements / HR News / Jobs / Safety Alerts).

## Root cause

The four URL-state hooks shipped with v6 each followed the same broken pattern:

1. `useState(() => readSearchParam(...))` — initialise from `window.location.search` once on mount.
2. `useEffect(() => addEventListener('popstate', ...))` — re-sync on browser back/forward.
3. Setter writes via `history.replaceState` (or `pushState`).

**`history.replaceState` and `history.pushState` do NOT fire `popstate`.** Per the HTML spec, `popstate` only fires when the browser navigates between two history entries (back/forward, in-page hash navigation). Programmatic state changes are deliberately silent so the writer doesn't loop on its own write.

Result: every time a sibling component subscribed to the same URL bit, it re-read on mount and then never re-rendered when another component flipped the bit.

For `?board=`, `?tv=`, `?area=` the bug was masked because there was only one writer + one reader. For `?edit=` there are many readers — every per-card pencil and every `+ Add` CTA across all six boards calls `useBoardEditMode()` itself — and they all sat at `editMode = false` forever.

Affected hooks:

- `useBoardEditMode` (was inline in `components/board-edit-toggle.tsx`)
- `useBoardSearchParam` (`hooks/use-board-search-param.ts`)
- `useTvSearchParam` (was inline in `production-boards-page.tsx`)
- `useAreaSearchParam` (was inline in `boards/hourly/hourly-board.tsx`)

## Remediation

Introduced a tiny module-level **subscriber + custom-event broadcast** so writers notify readers within the same SPA session:

- `production-boards/lib/url-search-state.ts` exposes `readSearchParam`, `writeSearchParam`, `subscribeToSearchParam`, and a generic React hook `useSearchParamState<T>(key, parse, serialize, options?)`.
- Every `writeSearchParam` call dispatches a `CustomEvent('omniframe:productionboards:urlstate', { detail: { key, value } })` after the `history` write.
- `subscribeToSearchParam` attaches both a custom-event listener (intra-SPA writes) and a `popstate` listener (browser nav). Cleanup detaches both.

All four hooks were rewritten as 5–10-line wrappers around `useSearchParamState`. Public API preserved exactly (`[value, setter]`).

The `useBoardEditMode` hook was extracted from `board-edit-toggle.tsx` into its own file (`hooks/use-board-edit-mode.ts`) so the component file exports only a component — this also silences the `react-refresh/only-export-components` lint warning the colocated hook used to trigger.

## Verification

The canonical regression test is `components/board-edit-toggle.test.tsx`:

1. Mount `<BoardEditToggle>` alongside a tiny `<EditModeProbe>` that calls `useBoardEditMode()` and renders the boolean.
2. Click the toggle → assert the probe re-renders to `editing` AND `window.location.search === '?edit=1'`.
3. Click again → assert the probe re-renders to `idle` AND the URL is cleared.

Without the custom-event broadcast, step 2 fails: the URL flips but the probe stays at `idle`.

## Lessons

- **`history.{replace,push}State` is silent by design.** If you need cross-component reactivity from URL state, you need a side channel — a custom event, a context, or an external store.
- **Single-consumer accidents mask the bug.** `?board=` and `?tv=` worked because the page was both writer and reader; `?edit=` exposed the issue because many sibling readers subscribe.
- **The `popstate`-only pattern lives in the wild.** Audit any other in-app `useSearchParamState`-style hooks for the same shape — see [[Cross-Component-URL-Search-State]] for the cross-feature pattern.

## Related

- [[Implement-Production-Boards-Hourly-Grid]] — v7 entry has the full file inventory.
- [[Cross-Component-URL-Search-State]] — promoted pattern; reusable by Inventory, Customer Tickets, etc.
- [[Editable-Board-Sheets]] — the v6 recipe whose URL-bit toggle pulled the bug to the surface.
- [[ProductionBoards - Feature Module]] — the surface this regression appeared on.
