---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-10
---
# Editable Board Sheets

## Purpose / Context

Production Boards (and any future TV-display surface that mixes read-only public viewing with curator-only editing) needs a uniform pattern for letting privileged users edit content in-place without sacrificing the calm, glanceable read-only view that the floor needs. v6 of the Production Boards crystallised the recipe used by SQCDP metric cards, the SQCDP problems table, the shared post editor (announcements / HR / safety), and the jobs editor.

The pattern's three jobs:

1. Keep the read-only view free of edit chrome for normal viewers.
2. Let privileged users opt-in to an edit mode that survives a refresh.
3. Open a focused right-side editor that doesn't navigate away from the board.

## The Recipe

### 1. Permission gate at the user layer

```ts
export function useCanEditBoards(): { canEdit: boolean; isLoading: boolean } {
  const { authState } = useUnifiedAuth()
  const userId = authState.user?.id ?? null
  const query = useQuery({
    queryKey: ['can-edit', 'production_boards', userId],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return false
      const result = await authService.checkPermission(userId, 'production_boards', 'edit')
      return result.granted
    },
    staleTime: 5 * 60 * 1000,
  })
  return { canEdit: query.data === true, isLoading: query.isLoading }
}
```

Cache aggressively (5 min staleTime). The frontend gate is purely cosmetic — RLS at the row level enforces the actual security boundary.

### 2. URL-bit edit-mode toggle

```ts
export function useBoardEditMode(): [boolean, (next: boolean) => void] {
  const [edit, setEdit] = useState<boolean>(readEditFromUrl)
  // ...popstate sync + history.replaceState writer
}
```

Why URL state, not React state:
- Survives a hard reload — a curator who is mid-edit and accidentally refreshes returns to the same mode.
- Deep-linkable — a manager can hand off `?board=sqcdp&edit=1` directly.
- Cheap to share between sibling components (every per-card pencil reads the same URL bit).

The toggle button (`<BoardEditToggle>`) is rendered only when `canEdit === true` so non-privileged users never see edit chrome at all.

### 3. Per-card pencil (hover-revealed)

```tsx
{canEdit && editMode && (
  <Button
    type='button'
    variant='ghost'
    size='icon'
    className='h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100'
    onClick={() => onEdit?.(metric)}
    aria-label={`Edit ${metric.title}`}
  >
    <IconPencil className='h-4 w-4' aria-hidden />
  </Button>
)}
```

- Hover-revealed via `opacity-0 group-hover:opacity-100` — keeps the read-only view calm.
- `aria-label` always specific ("Edit Recordable Incidents") so screen readers can disambiguate stacked cards.
- The wrapping card needs `group` on the surface div so the hover state cascades.
- Use `onEdit` / `onCreate` callback props rather than embedding the editor open-state in the card — the editor sheet is owned by the board, not the card.

### 4. Right-side `<Sheet>` editor

```tsx
<Sheet open={open} onOpenChange={(next) => !next && onClose()}>
  <SheetContent side='right' className='w-[480px] sm:max-w-[480px] overflow-hidden'>
    <SheetHeader>
      <SheetTitle>{isEdit ? 'Edit metric' : 'New metric'}</SheetTitle>
      <SheetDescription>...</SheetDescription>
    </SheetHeader>
    <Form {...form}>
      <form onSubmit={onSubmit} className='flex h-full flex-col gap-4 overflow-y-auto pb-24'>
        {/* react-hook-form + zod fields */}
        <SheetFooter className='mt-auto'>
          {isEdit && <Button variant='destructive' onClick={() => setConfirmOpen(true)}>Delete</Button>}
          <Button variant='outline' onClick={onClose}>Cancel</Button>
          <Button type='submit' disabled={createMut.isPending || updateMut.isPending}>
            {isEdit ? 'Save changes' : 'Create'}
          </Button>
        </SheetFooter>
      </form>
    </Form>
  </SheetContent>
</Sheet>
```

- Always `side='right'` — it's the muscle memory across the app.
- Width: `480 px` for editors with ≤8 fields; widen to `560 px` when a body textarea or image preview dominates.
- `overflow-hidden` on `<SheetContent>` + `overflow-y-auto` on the inner form so the SheetHeader stays pinned.
- Always render Cancel / Save / Delete in the footer in that order (left-to-right). Delete sits left because it's the destructive-and-rare action.

### 5. react-hook-form + zod

```tsx
const metricSchema = z.object({
  category: z.enum([...SQCDP_CATEGORIES.map(c => c.id) as [string, ...string[]]]),
  title: z.string().min(1, 'Title is required'),
  // numeric fields stay as strings in the form, parsed at submit — keeps the
  // <Input type='number'> UX clean and avoids RHF "NaN" leaking into onChange.
  currentValue: z.string().optional().nullable(),
  // ...
})
const form = useForm<z.infer<typeof metricSchema>>({
  resolver: zodResolver(metricSchema) as never, // RHF/zod 4 type clash — narrow `as never` is the canonical workaround
  defaultValues: useMemo(() => ({...}), [metric, category]),
})
```

Why:
- `zod` v4 + RHF type clash today requires `as never` on the resolver. Document it inline.
- `defaultValues` inside `useMemo` keyed on the row prop so reopening the editor on a different row resets cleanly. Alternatively, `key={renderKey}` on the form container with a `useEffect(() => setRenderKey(k => k + 1), [mode])` works the same way — see `<SqcdpEditorSheet>` for that variant.

### 6. ColorPickerInput for accent overrides

The shared `<ColorPickerInput>` from `src/components/ui/color-picker-input.tsx` accepts `value` (hex string) + `onChange` and renders an inline hex input + popover with HTML5 `<input type='color'>` + optional preset swatches. Use it directly as the `<FormControl>` child:

```tsx
<FormField
  control={form.control}
  name='colorHex'
  render={({ field }) => (
    <FormItem>
      <FormLabel>Color override</FormLabel>
      <FormControl>
        <ColorPickerInput value={field.value ?? ''} onChange={field.onChange} />
      </FormControl>
    </FormItem>
  )}
/>
```

Never roll your own color input — the existing component already handles invalid-hex hints, the clear button, and the "normalize input" UX corner-cases (`#FFF`, lowercase, missing `#`, etc.).

### 7. Optimistic mutation + sonner toast

```ts
const updateMetric = useMutation({
  mutationFn: (...) => supabase.from(...).update(...),
  onMutate: async ({ id, patch }) => {
    await queryClient.cancelQueries({ queryKey: metricsKey(orgId) })
    const previous = queryClient.getQueryData(metricsKey(orgId))
    queryClient.setQueryData(metricsKey(orgId), (old) => old?.map(m => m.id === id ? { ...m, ...patch } : m))
    return { previous }
  },
  onError: (err, _vars, ctx) => {
    if (ctx?.previous) queryClient.setQueryData(metricsKey(orgId), ctx.previous)
    toast.error(`Failed to update: ${err.message}`)
  },
  onSuccess: () => toast.success('Metric updated'),
  onSettled: () => queryClient.invalidateQueries({ queryKey: metricsKey(orgId) }),
})
```

Why each piece:
- Optimistic update so the card flips to the new value before the server round-trip lands.
- Snapshot in `onMutate` so `onError` can roll back.
- `onSettled` invalidates regardless of outcome so the cache reconciles with the server's authoritative state.
- `toast.success` only on real success, not on the optimistic apply (otherwise a failure shows a contradicting error toast right after).

### 8. ConfirmDialog for destructive ops

```tsx
<ConfirmDialog
  isOpen={confirmOpen}
  title='Delete metric?'
  message='This permanently removes the metric and all of its history. This cannot be undone.'
  variant='danger'
  confirmText='Delete metric'
  onCancel={() => setConfirmOpen(false)}
  onConfirm={async () => {
    await deleteMetric.mutateAsync(id)
    setConfirmOpen(false)
    onClose()  // close the parent sheet too
  }}
  isProcessing={deleteMetric.isPending}
/>
```

Use `<ConfirmDialog>` from `src/components/ui/confirm-dialog.tsx` — don't roll your own. The `variant='danger'` styling is consistent across the app.

## Don't

- **Don't render edit chrome based on `canEdit` alone.** The user has the permission, but they didn't ask to edit — wait for `canEdit && editMode` so the read-only view stays calm.
- **Don't store edit-mode in React state without a URL bit.** Refreshes lose it; deep-links break.
- **Don't open the editor as a `<Dialog>` for content this dense.** A modal dialog over a board pulls focus from the surrounding context the curator was reasoning about. The right-side `<Sheet>` keeps the board visible.
- **Don't use `<Tooltip>` to hold the pencil button.** Hover-revealed `opacity-0 group-hover:opacity-100` is enough; tooltips fire on touch and confuse mouse-and-touch hybrid devices (warehouse Surface tablets).
- **Don't skip the optimistic update for `update` mutations.** A 200–400 ms server round-trip is enough to feel sluggish on a mobile-tethered floor TV.
- **Don't confuse `<Sheet side='right'>` with the side='left' app-sidebar.** The shadcn primitive is the same component but the user's mental model splits them — right = ephemeral editor, left = persistent navigation.
- **Don't reach into another board's editor sheet from a sibling board.** Each board owns its own sheet state. The shared `<PostEditorSheet>` is an exception because the underlying data table is shared (`production_board_posts`) — it's parameterised on `scope`.
- **Don't deduplicate the editor across boards with different schemas.** Jobs (`production_board_job_postings`) and posts (`production_board_posts`) have very different fields; the shared abstraction would have more conditional branches than each editor has lines of code. They each get their own `<JobEditorSheet>` and `<PostEditorSheet>`.
- **Don't add an alt-text-less `<img>` to a post in production.** Add an alt input to the editor; today's PostCard renders `alt=''` (decorative) but that doesn't scale to safety-critical posts that lean on the image.
- **Don't render the Sheet whenever the parent component mounts.** Pass `open={...}` so the form doesn't pre-mount and pre-validate before the curator clicks the pencil.

## Related

- [[ProductionBoards - Feature Module]] — the surface this pattern was extracted from; v6 history.
- [[Implement-Production-Boards-Hourly-Grid]] — v6 implementation note; full file inventory.
- [[Elevated-KPI-Stat-Cards]] — the SQCDP card recipe extends the v5 KPI surface; the pencil + sheet wiring sits on top of it.
- [[Dark-Mode-Opacity-Colors]] — severity / status badge token convention used in the editor sheets and confirm dialogs.



## v7 update (2026-05-10) — URL-bit edit-mode toggle: cross-component sync

The § 2 “URL-bit edit-mode toggle” snippet above sketched a `useState` + `popstate` reader, which is silently broken when more than one component subscribes to the same URL bit (every per-card pencil reader on the page). The shipped `useBoardEditMode` was rewritten as a thin wrapper around `useSearchParamState` from `production-boards/lib/url-search-state.ts`, which dispatches a namespaced `CustomEvent` on every write so sibling consumers re-read the URL.

See [[Cross-Component-URL-Search-State]] for the reusable recipe (use it for any new `?key=` hook in any feature that has more than one consumer in the same render tree). Failure mode write-up: [[Fix-Production-Boards-Edit-Toggle-No-Op]].

### Related (added)

- [[Cross-Component-URL-Search-State]] — the reusable URL-state subscriber pattern this recipe now relies on.



## When to choose Dialog over Sheet (v10, 2026-05-10)

The v10 SQCDP editor graduated to a centred `<Dialog>` recipe ([[Editable-Board-Dialogs]]) because the metric form needed a 2-column layout, a full-width live chart preview, and an embedded `<SqcdpHistoryEditor>` CRUD subsystem — none of which fit comfortably in a 480 px sheet. The two patterns are siblings, not a deprecation — use the right tool for the form shape.

### Decision tree

| Form shape | Pattern |
|------------|---------|
| ≤ 5 fields, no embedded subsystem | **Editable-Board-Sheets** (this note) |
| ≥ 6 fields **OR** 2-column layout **OR** live preview **OR** embedded CRUD subsystem | [[Editable-Board-Dialogs]] |
| Editor side-panel that the curator references while reasoning about the board | **Editable-Board-Sheets** (this note) |
| Editor that demands the curator's full attention (destructive / sign-off / multi-step) | [[Editable-Board-Dialogs]] |

The board behind a sheet stays visible (right-side anchor) so the curator can keep their attention split between editor + board context. The board behind a dialog is dimmed by the modal overlay so the curator focuses on the form (and any embedded subsystem).

Existing sheet-based editors that still fit the recipe — `<JobEditorSheet>`, `<PostEditorSheet>`, the v6 problem sub-editor (now hosted inside the v10 dialog as a discriminator branch but with the same simpler field set) — stay on this pattern. Don't graduate them to a dialog without a clear field-count or embedded-subsystem reason.

### Related (added)

- [[Editable-Board-Dialogs]] — the new dialog-style sibling pattern; the canonical recipe for editors with ≥ 6 fields, 2-column layout, live preview, or embedded CRUD subsystems.
