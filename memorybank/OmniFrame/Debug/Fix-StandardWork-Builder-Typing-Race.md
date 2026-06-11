---
tags: [type/debug, status/active, domain/frontend]
created: 2026-05-19
---
# Fix — Standard Work Template Builder Typing Race & Hardening

## Purpose / Context
Users reported "typing issues" in the Standard Work template builder when editing item fields (title, description, options, placeholder, etc.). Characters would disappear mid-keystroke when the debounced auto-save round-tripped, especially on slower networks. Tab-close also silently discarded pending structural reorders, and accidental clicks on the delete icon irrecoverably soft-deleted items.

This note documents the root cause + fixes shipped 2026-05-19 to make the builder world-class.

## Root cause — typing characters lost
The `PropertiesPanel` (`src/features/standard-work/components/template-builder/properties-panel.tsx`) used to sync its local editor state from the `item` prop on **every** prop reference change:

```ts
useEffect(() => {
  if (item) { setLocalItem({ ...item }); setOptionsText(...) }
}, [item])
```

The parent `TemplateBuilder` rebuilds the `sections` array (and therefore the `item` reference handed to PropertiesPanel) every time the TanStack Query `['standard-work-items', tId]` query refetches. Refetches fire after every successful debounced auto-save. The race:

1. T0 — user pauses → 600ms debounce fires → mutation starts
2. T0+50ms — user resumes typing (`localItem.title = 'Hellow'`)
3. T0+200ms — mutation completes → invalidate → refetch starts
4. T0+400ms — refetch returns; `items` reference changes; `sections` rebuilt; `selectedItem` is a new object reference (`item.id` unchanged, but identity is different)
5. PropertiesPanel `useEffect` fires → resets `localItem` to the **server** value ("Hello") → user's "w" character is lost

## Fix — id-keyed sync guard
Sync local state **only when `item.id` changes** (i.e. a different item was selected), not on every prop identity change. Implementation uses a ref:

```ts
const lastSyncedIdRef = useRef<string | null>(null)
useEffect(() => {
  if (!item) { setLocalItem(null); lastSyncedIdRef.current = null; return }
  if (item.id !== lastSyncedIdRef.current) {
    setLocalItem({ ...item })
    setOptionsText(item.options?.map(o => o.label).join('\n') || '')
    lastSyncedIdRef.current = item.id
  }
}, [item])
```

This is the same pattern as the runner's single-seed effect from the April 25 rebuild (see [[Redesign-StandardWork-Comprehensive]] Phase 2: "single-seed effect so server refetch never stomps in-flight edits"). It belongs in any controlled editor that owns local state while a parent refetches.

Regression test in `src/features/standard-work/components/template-builder/__tests__/properties-panel.test.tsx` simulates a refetch storm by re-rendering with a fresh `{ ...item }` reference between keystrokes and asserts the typed text survives.

## Other fixes shipped in the same pass

### 1. Toggle-collapse no longer dirties the template
`SectionEditor` collapse/expand routed through the same `onSectionsChange` callback as structural edits, which set `orderPending = true` in the parent. UI-only state was therefore showing the amber "Order pending" pill and demanding a save round-trip. Split into:
- `onSectionsChange(next)` — structural (add / rename / delete section, item moves), dirties state
- `onSectionsUIChange(next)` — UI-only (collapse / expand), no dirty

Collapsed-ness is now also persisted in a `collapsedMapRef` so refetches don't reset the user's expand/collapse choices.

### 2. Number input accepts 0 as min/max
Old: `e.target.value ? parseFloat(...) : undefined` would coerce empty string to undefined and was brittle around NaN. New: explicit empty-string check + `Number.isFinite`; also **drops the key entirely** from `validation_rules` when cleared so we don't persist `{ min: undefined }` payloads.

### 3. Options-textarea preserves existing option keys
The old code recomputed every option `value` from the label on each keystroke, so renaming "Yes" → "Yess" silently broke any historical responses keyed by `"yes"`. New code maps the previous label → value cache and only generates new values for genuinely new labels.

### 4. Delete item — confirmation + undo
- Items with only the default title and no other configuration delete immediately (a misclick from the palette is the common case).
- Items with content open an `AlertDialog` confirm.
- After delete, a `sonner` toast with an Undo action calls `restoreItem` (new service method) to flip `is_active` back to `true`, preserving the row's `display_order` / `section_name`.

### 5. beforeunload + close-confirm guard for pending reorders
`window.addEventListener('beforeunload', ...)` while `orderPending` is true. The Back button also surfaces a `window.confirm` before unmounting. Closes the "left the page with unsaved changes" footgun.

### 6. Cmd/Ctrl-S to save order
Document-level keydown listener wired to the same `handleSaveOrder` the toolbar button uses. Title attribute on the save button advertises the shortcut.

### 7. Visible save-error state with retry
New `SaveStatusPill` states: `saving-order`, `order-error`, `field-error`. Errors render as clickable destructive pills that re-fire the failing mutation; the last in-flight payload is stashed in `lastFieldPayloadRef` so field saves can retry without the user re-typing.

### 8. Duplicate item action
New `StandardWorkService.duplicateItem(itemId)`:
1. Reads the source item + same-section siblings
2. Shifts everyone with `display_order >= source.display_order + 1` down by one in parallel
3. Inserts a clone titled `"<Source> (Copy)"` at `source.display_order + 1`

Lands in the row's kebab menu alongside delete, matching the Typeform / Google Forms expectation.

### 9. Conditional-display UI
The schema's `conditional_display: { depends_on, condition, value }` was supported by the runner but un-configurable from the builder. Added a section to `PropertiesPanel` that:
- Lists every other item in the template as candidates (`checkbox` / `text` / `number` / `select` / `multi_select` only — types with predictable comparable values)
- Renders the value field appropriately for the dependent item's type (checkbox → Checked/Unchecked dropdown; select / multi_select → option dropdown; everything else → free text)
- Flips off the rule and drops the field entirely when the user disables the toggle, so we don't persist stub `{ depends_on: '' }` rules

SortableItem shows an `EyeOff` glyph on rows that have a conditional rule so admins can scan the canvas and spot conditionally-displayed items at a glance.

### 10. Auto-focus new items + better validation surface
- Newly created items via drag receive an `autoFocusOnCreate` token from the parent. `PropertiesPanel` focuses + selects the title input on the next RAF tick.
- Empty-title state surfaces an inline `role="alert"` instead of silently saving garbage. Auto-save is short-circuited while the title is empty so we don't 400 every keystroke.
- SortableItem shows untitled items in muted italic so they're easy to spot before they're saved.
- Refresh button on the toolbar (`itemsFetching` aware) for the rare case where another tab is editing in parallel.

## Files touched
```
src/features/standard-work/components/template-builder/
  template-builder.tsx        (rewritten — UI/structural split, error states,
                                cmd-s, beforeunload, delete confirm/undo,
                                duplicate wiring, auto-focus, retry)
  properties-panel.tsx        (rewritten — id-keyed sync, validation,
                                conditional display, options key preservation,
                                number 0 fix)
  canvas.tsx                  (split onSectionsChange vs onSectionsUIChange,
                                onDuplicateItem prop)
  section-editor.tsx          (forward onDuplicateItem)
  sortable-item.tsx           (kebab menu with Duplicate / Delete,
                                conditional glyph, untitled fallback)
  __tests__/properties-panel.test.tsx   (new — 7 regression tests)
src/hooks/use-standard-work.ts
  Added restoreItem + duplicateItem mutations; suppressed legacy delete toast
src/lib/supabase/standard-work.service.ts
  Added restoreItem() + duplicateItem() (parallel-shift + insert + clone)
```

## Patterns reused / introduced
- **id-keyed local sync guard** — pin this as a project-wide pattern any time a controlled editor sits next to a TanStack Query that may refetch mid-edit. Same shape as the runner's `handleResponseChange` single-seed effect.
- **Split UI vs structural change channels** — when one parent state spans "user moved something we need to save" *and* "user toggled a panel that's pure UI", route them through separate callbacks so a single dirty flag doesn't end up always true.
- **Sonner action toasts for soft-delete undo** — preferred over a confirmation modal for default-content rows; the modal is reserved for items with actual content.

## Follow-ups (not in this pass)
- Drag-reorder of sections themselves. Currently sections sort alphabetically with `General` first. Doing this cleanly requires either a `section_order` table column or making `display_order` global instead of per-section. Filed for a future pass.
- Bulk operations (multi-select rows for delete / move). Useful once a template grows past ~30 items.
- Item library / reusable building blocks. Several customers asked for templates of templates.
- Mobile / medium breakpoint: properties panel stacks below the canvas, which means scrolling to edit. A `<Sheet>` could open as a drawer on `lg:` breakpoints.

## Related
- [[Redesign-StandardWork-Comprehensive]]
- [[StandardWorkAndOperations - Supabase Service]]
- [[Standard Work - Feature Module]]
- [[Fix-StandardWork-Cache-Staleness]]
