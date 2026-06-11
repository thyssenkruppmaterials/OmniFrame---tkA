---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-19
---
# Pattern — ID-Keyed Local Sync Guard

## Purpose / Context
A controlled editor (form panel, inline edit row, side rail) often owns local `useState` for inputs so users can type without round-tripping every keystroke. When that editor sits next to a TanStack Query that auto-refetches after a debounced save, the **new server-side data flowing back through props will stomp the user's in-flight edits** if local state syncs unconditionally on prop changes.

This is the same class of bug fixed twice in Standard Work:
- 2026-04-25 — runner (`standard-work-checklist.tsx`) — "single-seed effect so server refetch never stomps in-flight edits" ([[Redesign-StandardWork-Comprehensive]] Phase 2)
- 2026-05-19 — builder (`properties-panel.tsx`) — [[Fix-StandardWork-Builder-Typing-Race]]

## Details

### Anti-pattern (what causes character loss)
```ts
useEffect(() => {
  if (item) setLocalItem({ ...item })
}, [item])
```
Every refetch produces a new `item` object reference → effect fires → local state overwritten.

### Pattern
```ts
const lastSyncedIdRef = useRef<string | null>(null)

useEffect(() => {
  if (!item) {
    setLocalItem(null)
    lastSyncedIdRef.current = null
    return
  }
  if (item.id !== lastSyncedIdRef.current) {
    // Different item selected — sync local state from props.
    setLocalItem({ ...item })
    lastSyncedIdRef.current = item.id
  }
  // Otherwise: same item, just a fresh reference from refetch.
  // Leave local state alone so in-flight edits survive.
}, [item])
```

### When to use
- The component edits a single "thing" identified by a stable id.
- Edits flow through a debounced save to a mutation that invalidates the source query.
- The user actively types into the inputs (lots of small state updates).

### When NOT to use
- Display-only components (no local state).
- Cases where you genuinely want server state to win (e.g. another user updated the record and you want to discard local edits). In that case, add an explicit "discard local changes" UX instead of silently overwriting.

### Edge cases to consider
- **Errors during save**: local state still holds the user's edits; the retry path can re-send `lastSyncedIdRef`-keyed payloads.
- **Concurrent edits from another tab**: server state changes silently; local user sees their version. Cross-tab presence/conflict UX is a separate concern — don't paper over it with auto-sync.
- **`item.id` switching mid-keystroke** (e.g. user clicks another row): sync fires — correct behaviour, this is a deliberate selection change.

### Companion: short-circuit save while invalid
Pair the guard with a soft-validation gate so empty / invalid drafts don't generate 400-storm round trips:

```ts
if (!updatedItem.item_title.trim()) {
  if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
  setSaveState('idle')
  return
}
```

## Code references
- `src/features/standard-work/components/template-builder/properties-panel.tsx` — builder
- `src/features/standard-work/components/standard-work-checklist.tsx` — runner (`handleResponseChange`)

## Related
- [[Fix-StandardWork-Builder-Typing-Race]]
- [[Redesign-StandardWork-Comprehensive]]
- [[React-Query-Patterns]]
