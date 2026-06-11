---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-10
---
# Editable Board Dialogs

## Purpose / Context

Production Boards' v10 SQCDP slice graduated the editor from the [[Editable-Board-Sheets]] right-side `<Sheet>` recipe to a centred `<Dialog>` because the form needed:

1. A **2-column layout** — the metric form has 12 fields and a single-column tall scroll forces curators to lose context between the title and the chart-type select.
2. A **live chart preview** at full width below the form so the geometry / colour / markers all render at the size they'll appear on the card — not the cramped 80 px wedge that fits in a 480 px sheet.
3. An **embedded CRUD subsystem** (`<SqcdpHistoryEditor>` — 26-week history points table with inline edit + delete + add + generate-sample) that needs a shadcn `<Table>` and a `<DatePicker>` per row.

None of those three fit in a 480 px right-side sheet without painful compromises. The `~820 px` modal dialog gives the editor enough horizontal real estate to pair the form columns alongside the preview and host the history editor below.

The pattern's three jobs (same as Sheets):

1. Keep the read-only view free of edit chrome for normal viewers.
2. Let privileged users opt-in to an edit mode that survives a refresh.
3. Open a focused editor that doesn't navigate away from the board.

## When to choose Dialog over Sheet

| Form shape | Pattern |
|------------|---------|
| ≤ 5 fields, no embedded subsystem | [[Editable-Board-Sheets]] |
| ≥ 6 fields **OR** 2-column layout **OR** live preview **OR** embedded CRUD subsystem | **Editable-Board-Dialogs** (this note) |
| Anything that needs to keep the board visible while editing | [[Editable-Board-Sheets]] |
| Anything that needs the user's full attention (destructive / sign-off / multi-step) | **Editable-Board-Dialogs** (this note) |

The board behind a dialog is dimmed by the modal overlay — use the dialog when the curator should be focused on the form (and any embedded subsystem) and not split-attention scanning the board behind it. Use the sheet when the curator is reasoning about the board's state and the editor is a side panel they're consulting.

## The Recipe

### 1. Permission gate at the user layer

Unchanged from [[Editable-Board-Sheets]] § 1. The `useCanEditBoards()` hook gates the toggle button + per-card pencils; RLS at the row level enforces the actual security boundary.

### 2. URL-bit edit-mode toggle

Unchanged from [[Editable-Board-Sheets]] § 2. `useBoardEditMode()` (URL state via `useSearchParamState<boolean>`) flips the cosmetic edit affordances on every editable surface.

### 3. Per-card pencil (hover-revealed)

Unchanged from [[Editable-Board-Sheets]] § 3. The pencil button is hover-revealed via `opacity-0 group-hover:opacity-100` and bubbles `onEdit?(metric)` up to the board.

### 4. The dialog shell

```tsx
<Dialog open={open} onOpenChange={(next) => !next && attemptClose()}>
  <DialogContent className='max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-[820px]'>
    <DialogHeader className='border-border/40 border-b px-6 py-4'>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>
    <div className='max-h-[calc(88vh-7rem)] overflow-y-auto px-6 py-5'>
      {/* form + preview + embedded subsystem */}
    </div>
  </DialogContent>
</Dialog>
```

Key details:

- `sm:max-w-[820px]` — wide enough for a 2-column form alongside the preview, not so wide that it overwhelms the board on a 13" laptop (where it lands at ≈60% of viewport width).
- `max-h-[88vh] overflow-hidden p-0` on the outer content + `max-h-[calc(88vh-7rem)] overflow-y-auto` on the inner body — the header stays pinned while long forms scroll.
- `gap-0` on `<DialogContent>` cancels the default `gap-4` so the header's bottom border lands flush against the scrolling body.
- ESC key + outside-click both fire `onOpenChange(false)` — route through `attemptClose()` so the confirm-if-dirty gate (§ 7 below) still applies.

### 5. 2-column body + full-width preview + embedded subsystem

```tsx
<form className='flex flex-col gap-5'>
  <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
    <div className='flex flex-col gap-3'>{/* left column */}</div>
    <div className='flex flex-col gap-3'>{/* right column */}</div>
  </div>
  <ChartPreview {...} />
  <SqcdpHistoryEditor metric={...} />
  <DialogFooter className='gap-2'>{/* Delete | Cancel | Save */}</DialogFooter>
</form>
```

Why this stack:

- The 2-column grid collapses to one column on `< md` so phone curators see the same form, just taller.
- The preview is full-width below the columns so the chart geometry renders at a representative size (140 px vs the 80 px the v6 sheet's cramped preview managed).
- The embedded subsystem (history editor) lands below the preview at full width with its own internal scroll (`max-h-[280px] overflow-y-auto`) so it never blows out the dialog's body height.
- `<DialogFooter>` has `Delete | Cancel | Save` left-to-right on `sm:` — Delete sits left because it's the destructive-and-rare action (matches the Sheet pattern).

### 6. react-hook-form + zod + live preview

```tsx
const form = useForm<MetricFormValues>({
  resolver: zodResolver(metricSchema) as never, // RHF + zod 4 type clash — narrow `as never` is canonical
  defaultValues: useMemo(() => ({...}), [metric, category]),
})

const watchedChartType = form.watch('chartType')
const watchedShowMarkers = form.watch('showMarkers')
const watchedColorHex = form.watch('colorHex') ?? ''
// ...
<ChartPreview chartType={watchedChartType} showMarkers={watchedShowMarkers} colorHex={watchedColorHex} ... />
```

- `form.watch(...)` for live preview reactivity beats `useWatch` for a small handful of fields — the latter pays a per-render cost for the entire component tree.
- `formState.isDirty` powers the confirm-if-dirty exit gate (§ 7).
- `defaultValues` inside `useMemo` keyed on the row prop so reopening the editor on a different row resets cleanly. The dialog's outer wrapper also bumps a `renderKey` on `mode` change so the form fully remounts when the mode discriminator switches between e.g. metric → problem.

### 7. Confirm-if-dirty exit

```tsx
const [isDirty, setIsDirty] = useState(false)
const [confirmExit, setConfirmExit] = useState(false)
const attemptClose = () => {
  if (isDirty) { setConfirmExit(true); return }
  onClose()
}

<ConfirmDialog
  isOpen={confirmExit}
  title='Discard unsaved changes?'
  message='Your edits will be lost.'
  variant='warning'
  confirmText='Discard'
  cancelText='Keep editing'
  onCancel={() => setConfirmExit(false)}
  onConfirm={() => { setConfirmExit(false); setIsDirty(false); onClose() }}
/>
```

The inner form effects `setIsDirty(form.formState.isDirty)` so the parent dialog can short-circuit close attempts. Beats a global `beforeunload` prompt because it's scoped to in-app close attempts — page navigation away from the route is still allowed (the curator has more context for that decision).

### 8. Live preview component reads in-flight subsystem state

If the dialog hosts an embedded CRUD subsystem (the SQCDP case is `<SqcdpHistoryEditor>` over the last-180-day history), the preview should pull from the **subsystem's** live data — not from the parent metric snapshot — so edits in the subsystem surface in the preview without waiting for the parent query to invalidate.

The SQCDP recipe:

```tsx
const { points: livePoints } = useSqcdpMetricHistory(metric.id ?? null)
const livePointsForPreview = useMemo(
  () => livePoints.map(p => ({ recordedAt: p.recordedAt, value: p.value })),
  [livePoints]
)
<SqcdpChart metric={previewMetric} overrideHistory={livePointsForPreview} ... />
```

The `<SqcdpChart>` accepted a new `overrideHistory` prop that takes precedence over `metric.history`. Other dialogs that host embedded subsystems should expose a similar override hook on their preview component.

### 9. Optimistic mutations with cross-cache invalidation

When the embedded subsystem mutations affect the parent grid's data (e.g. SQCDP history points feed the card chart strip), invalidate **both** caches on settle. The history hook does this in every mutation's `onSettled`:

```ts
onSettled: () => {
  void queryClient.invalidateQueries({ queryKey: historyKey(metricId) })
  void queryClient.invalidateQueries({ queryKey: metricsListKey(orgId) })
}
```

Mirror the parent's queryKey shape inside the subsystem hook (don't import a `metricsKey` factory — it creates a circular module dependency). Document the invariant so future refactors keep the keys aligned.

### 10. ConfirmDialog for destructive ops (delete) AND for opt-in side-effects (sample data)

Two `<ConfirmDialog>` instances per editor are common:

- **Delete the row** — `variant='danger'`, `confirmText='Delete metric'`. Routes through the parent dialog's `onClose()` after success.
- **Generate sample data** — `variant='info'`, `confirmText='Generate'`. Gates the bulk-insert so users opt in.

Don't roll your own confirm UX. Reuse `<ConfirmDialog>` from `src/components/ui/confirm-dialog.tsx`.

## Don't

- **Don't open a dialog over another dialog without explicit confirm-routing.** The confirm-if-dirty + delete-confirm + sample-data-confirm pattern stacks three potential dialogs. Keep the routing through `attemptClose()` so they don't fight for focus.
- **Don't render the form whenever the parent component mounts.** Pass `open={...}` so the form doesn't pre-mount and pre-validate before the curator clicks the pencil. (Same rule as the Sheet pattern.)
- **Don't use a dialog for a 3-field form.** A 480 px sheet beats a 820 px modal for compactness; the sheet's right-side anchor preserves the board context.
- **Don't put the history editor (or any embedded subsystem) ABOVE the live preview.** The preview is the curator's confidence-check on what they're configuring; the history table is the bulk-data manipulation step. Preview-then-table reads top-down as "see what you'll get" → "adjust the data behind it."
- **Don't omit the confirm-if-dirty gate.** ESC + outside-click + the X button are all easy to fire; losing 90 seconds of metric configuration to an accidental click is a usability footgun.
- **Don't bind `onOpenChange={(next) => !next && onClose()}`** without routing through `attemptClose()`. Direct `onClose()` skips the dirty check.
- **Don't share queryKeys between the embedded subsystem hook and the parent list hook.** Mutations on the subsystem will invalidate the parent on settle (see § 9), but their queryKeys must be distinct so the polling cadences and stale-times stay independent.
- **Don't pass `useWatch` for more than ≈3 watched fields** — the per-render cost adds up. `form.watch(...)` is fine for live-preview reactivity at this scale.
- **Don't reuse the same `<Dialog>` instance for two different mode discriminators** without bumping a `renderKey`. react-hook-form's `defaultValues` are sticky and will bleed values between e.g. "edit metric A" and "create problem in C".

## When to add tabs to the dialog body

Added as part of the SQCDP v12 editor work (2026-05-10) when the metric editor's flat form crossed roughly four distinct sections of unrelated form fields and started feeling unscannable. Decision rule:

- **≤ 3 logical sections** — keep the body flat. Two-column layout + the embedded subsystem (history editor) is plenty.
- **≥ 4 logical sections of unrelated form fields** — promote the body to shadcn `<Tabs>` and group sections by the curator's mental model.
- **A live preview is in play** — lift the preview ABOVE the tab strip with `position: sticky` so it stays visible while the curator switches tabs (otherwise the preview only validates the tab the curator's looking at).
- **An embedded CRUD subsystem (e.g. the history editor)** — give it its own tab so the bulk-data work doesn't push the rest of the form past a scroll boundary.

### Canonical example: SQCDP v12 metric editor

4 tabs at `sm:max-w-[920px]` (was `sm:max-w-[820px]` pre-v12; bumped to accommodate the tab strip + the sticky card preview):

- **Basics** — Category, Title, Subtitle, Format, Period, Current value, Target, Unit, Notes, Visible toggle.
- **Style** — Color override, Accent color, Chart type, Show markers, per-input typography (Family / Size / Weight per text field).
- **Advanced** — Prefix, Suffix, Decimal places, Lower-is-better, sub-metrics editor (drag-to-reorder list).
- **History** — the existing `<SqcdpHistoryEditor>` (moved out of the bottom of the dialog into its own tab so it no longer scrolls past the form on the way to the footer). Tab is `disabled` in create-mode (no metric ID to attach history to yet).

### Sticky preview alongside tabs

```tsx
<form className='flex flex-col gap-4'>
  <LivePreview values={liveValues} initial={initial} />  {/* sticky top-0 z-10 */}
  <Tabs value={activeTab} onValueChange={setActiveTab}>
    <TabsList className='h-9 w-full'>
      <TabsTrigger value='basics'>Basics</TabsTrigger>
      <TabsTrigger value='style'>Style</TabsTrigger>
      <TabsTrigger value='advanced'>Advanced</TabsTrigger>
      <TabsTrigger value='history' disabled={!isEdit}>History</TabsTrigger>
    </TabsList>
    <TabsContent value='basics' className='mt-3'>…</TabsContent>
    {/* … */}
  </Tabs>
  <DialogFooter className='gap-2'>…</DialogFooter>
</form>
```

Key details:

- `<LivePreview>` uses `useWatch({ control })` once at the form level (cheaper than 25+ individual `form.watch(...)` calls).
- The preview wraps the rendered card in `pointer-events-none` so the per-card pencil affordance doesn't fire during editing.
- `<TabsList>` width is `w-full` (full-width strip) for visual weight equal to the form sections it indexes.
- `disabled` on a tab is honoured by Radix; the History tab in create-mode prevents curators from trying to attach history to a metric that doesn't exist yet.

A 2-tab dialog reads as fragmented for no reason. The decision rule is concrete: count the logical sections of unrelated form fields. If you're at 3, stay flat with a 2-column grid. If you're at 4+, tabs.

See [[Implementations/Implement-Production-Boards-Hourly-Grid]] § v12 for the full diff and decision log.

## Reusability checklist

Likely next adopters:

- **Jobs board editor** (`<JobEditorSheet>`) — currently a sheet; the field count (8+ fields including a body textarea + apply URL/email pair) is at the boundary. If a future slice adds requirements / department / closing-date pair to a 2-column layout, graduate to this pattern.
- **Standard work template builder** — the per-checklist editor would benefit from a 2-column layout + live preview of the rendered checklist.
- **Kit Definition editor** — the multi-tab kit definition + chain editor is currently routed through a side-panel; graduating to a dialog with a 2-column form + live preview would match this recipe.

If two consumers land outside production-boards/sqcdp, promote the dialog shell (header pinning + body scroll + confirm-if-dirty wrapper) to a `src/components/ui/editor-dialog.tsx` so future editors get the chrome free.

## Related

- [[Editable-Board-Sheets]] — the older sheet pattern (still applies for editors with ≤ 5 fields and no embedded subsystem). The dialog pattern is a sibling, not a deprecation.
- [[ProductionBoards - Feature Module]] — the surface this pattern was extracted from; v10 history.
- [[Implement-Production-Boards-Hourly-Grid]] — v10 implementation note; full file inventory.
- [[Selectable-Chart-Variants]] — the chart pattern the live preview hosts.
- [[Elevated-KPI-Stat-Cards]] — the SQCDP card recipe extends; the dialog is the editor surface for cards built on this pattern.
- [[Dark-Mode-Opacity-Colors]] — severity / status badge token convention used in the editor + confirm dialogs.


## Bordered sections + column headers for dense forms

Added as part of the SQCDP v12.2 editor polish (2026-05-10). The v12 tabs solved the "too many fields in one scroll" problem by splitting the form by concern. v12.2 solves the **next** problem that surfaces once each tab itself crosses 6+ controls: the tab body reads as a flat sequence of unlabeled rows.

The rule: once a tab body has ≥ 3 logical groups of related controls, wrap each group in a subtle bordered "section" panel with a header + optional description + optional right-aligned action.

### The `<Section>` helper

A small in-file component (no need to promote to `components/ui` until two consumers land outside the SQCDP editor):

```tsx
function Section({
  title, description, action, children,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className='border-border/50 bg-muted/20 rounded-lg border p-4'>
      <header className='border-border/40 mb-4 flex items-start justify-between gap-4 border-b pb-2'>
        <div className='flex flex-col gap-0.5'>
          <h3 className='text-foreground text-sm font-semibold'>{title}</h3>
          {description ? <p className='text-muted-foreground text-xs'>{description}</p> : null}
        </div>
        {action ? <div className='flex shrink-0 items-center'>{action}</div> : null}
      </header>
      <div className='flex flex-col gap-3'>{children}</div>
    </section>
  )
}
```

Key details:

- **`bg-muted/20` background** — enough contrast against the dialog body to read as a panel, not enough to fight the live preview's saturation. Stay below `bg-muted/30` or it competes with category-header colour bands.
- **`border-border/50`** for the panel outline + **`border-border/40`** for the internal header divider — the inner divider is one notch lighter so it reads as "hairline under the title" not "second outer border".
- **`p-4`** outer padding + **`mb-4 pb-2`** on the header + **`gap-3`** between rows inside — leaves enough air so dense rows of selects don't cram against the panel edges.
- **`action` slot** is optional and right-aligned — used for things like the SQCDP Style tab's `Reset all` ghost button. Sits at the same vertical line as the title so the eye groups them.

### Tab-level spacing

At the tab level, sections are separated by `gap-5` (one notch larger than the `gap-3` between rows inside a section, so the panel boundary is the dominant visual rhythm). The form wrapper uses `flex flex-col gap-5 pb-2` so the last section breathes against the sticky footer.

### Column-header row for dense input grids

When a section hosts ≥ 3 rows of identically-shaped inputs (e.g. "3 typography rows, each with Family / Size / Weight"), add a small column-header row above the data rows. Mirrors the same grid template so the columns line up:

```tsx
const TYPOGRAPHY_GRID_CLASS =
  'grid items-center gap-3 grid-cols-[minmax(0,3fr)_minmax(0,3fr)_minmax(0,3fr)_minmax(0,3fr)_auto]'

<div
  className={`${TYPOGRAPHY_GRID_CLASS} text-muted-foreground px-1 pb-1 text-[11px] font-medium tracking-wide uppercase`}
  aria-hidden='true'
>
  <span>Field</span>
  <span>Family</span>
  <span>Size</span>
  <span>Weight</span>
  <span className='w-14' />
</div>
```

Key details:

- **`text-[11px] font-medium uppercase tracking-wide text-muted-foreground`** — the spreadsheet/table header convention. Big enough to read, small enough not to compete with the data rows.
- **`aria-hidden='true'`** — the column titles repeat what the `<Label>` in each row already announces ("Title", "Subtitle", "Primary value"). Hiding from AT avoids double-announcing.
- **Same grid template as the data rows** — use a `const` for the class string so header + data rows share the source of truth. Drift between the two = visible misalignment.
- **`auto` 5th column** for a per-row action button (e.g. inline Reset). The header's 5th cell is an empty `w-14` placeholder so the column widths match.

Don't bother with the column-header row for sections that have ≤ 2 rows or rows of dissimilar shapes. The convention is for *grid-shaped* sections specifically.

### Inline per-row action button

The Reset button in the typography section sits at the END of each row in a tiny ghost variant, only visible when that row is dirty:

```tsx
<div className='flex w-14 justify-end'>
  {isDirtyRow ? (
    <Button
      type='button'
      variant='ghost'
      size='sm'
      className='text-muted-foreground hover:text-foreground h-7 px-2 text-xs'
      onClick={onReset}
    >
      Reset
    </Button>
  ) : null}
</div>
```

- **`variant='ghost' size='sm' h-7 px-2 text-xs`** — minimum visual weight so it doesn't compete with the row's primary controls. Curators look at the data column first; the Reset is a quiet escape hatch.
- **Hidden when not dirty** — a row showing default values has nothing to reset. Hiding eliminates a no-op click.
- **`text-muted-foreground hover:text-foreground`** — the button reveals on hover even though it's always present in the DOM (saves a layout shift when toggling between dirty/non-dirty rows).

### Section-level "Reset all" companion

For sections where the per-row reset makes sense, also add a section-level "Reset all" in the section header's `action` slot:

```tsx
<Section
  title='Typography'
  description='Customise typography for each text field. Reset to use the SQCDP defaults.'
  action={
    <Button
      type='button'
      variant='ghost'
      size='sm'
      className='h-7 px-2 text-xs'
      disabled={!isAnyOverridden}
      onClick={() => setValue('styleConfig', {}, { shouldDirty: true })}
    >
      Reset all
    </Button>
  }
>
  ...
</Section>
```

- **`disabled` when no row is dirty** — the button is informative even when no-op ("there's a way to reset everything"); disabling avoids confusion when nothing changes after click.
- **One shared `useWatch` at the tab level** powers both the disabled state AND any inline preview that consumes the same form slice. Per-row dirty checks subscribe through their own `<Controller>` so they don't pay extra.

### Inline reinforcement preview (when fields control a visual property)

When the section's controls dictate a visible style (e.g. typography size / family / weight), add a tiny inline preview at the bottom of the section so the curator sees the chosen style render before they save:

```tsx
function PrimaryValuePreview({ styleConfig }: { styleConfig: StyleConfig }) {
  const cls = fieldClasses(styleConfig.primary, DEFAULT_STYLES.primary)
  return (
    <div className='border-border/30 mt-1 flex items-center gap-3 border-t pt-3'>
      <span className='text-muted-foreground text-[11px] tracking-wide uppercase'>
        Primary value preview
      </span>
      <span className={`${cls} leading-none tabular-nums`}>123</span>
    </div>
  )
}
```

This is **in addition to**, not a replacement for, the sticky-top live preview card. The tab-bottom inline preview lives directly under the picker so the curator's eye doesn't have to flick up to the sticky preview while picking sizes. They serve different jobs:

- **Sticky top card preview** — "Will the whole card render correctly?"
- **Inline section preview** — "Does this size / weight / family look right at the picked size?"

Don't add inline previews for non-visual sections (e.g. "Number formatting" — the prefix/suffix already echo through the sticky card preview's primary value).

### When to apply this pattern

Decision rule:

- **≤ 2 logical groups per tab** — keep the tab body flat with a 2-column grid (the v12 shape). Bordered sections add visual chrome that doesn't earn its weight.
- **≥ 3 logical groups per tab** — wrap each group in `<Section>`. The visual rhythm of "panel → panel → panel" makes a long tab body scannable.
- **Switch / toggle controls inside a section** — give them their own mini-card (`border-border/40 bg-background flex items-center justify-between gap-2 rounded-md border p-3`) inside the section so the toggle reads as a control, not a label-with-checkbox.
- **Description copy in the section header** — keep it to ONE short sentence. Two-sentence descriptions push the panel header tall enough to fight the data rows. If a section needs more explanation, link to the relevant pattern note ([[Per-Field-Style-Overrides]] etc.) from the Implementation log instead.

### Canonical example: SQCDP v12.2 metric editor

All three editable tabs (Basics / Style / Advanced) use the section pattern; the History tab is unchanged because it's already a self-contained component.

- **Basics** (3 sections) — *Identity* (Category + Title + Subtitle) → *Value* (Format + Period + Current + Target + Unit) → *Notes & visibility* (Notes + Visible-on-board switch).
- **Style** (3 sections) — *Card colors* (Color override + Accent) → *Chart appearance* (Chart type + Show-data-points switch) → *Typography* (column-header row + 3 inline-Reset rows + inline preview, with section-level *Reset all* in the header `action` slot).
- **Advanced** (3 sections) — *Number formatting* (Prefix + Suffix + Decimal places) → *Trend behaviour* (Show trend arrow + Lower is better, both as toggle mini-cards) → *Stacked sub-metrics* (wraps the existing `<SqcdpSubMetricsEditor>`).

See [[Implementations/Implement-Production-Boards-Hourly-Grid]] § v12.2 for the full diff and decision log.



## v12.3 update (2026-05-13) — Side-by-side preview / controls layout

The v12 "sticky-top live preview" recipe (above) used `bg-muted/20 backdrop-blur-sm` translucency so the preview floated visually above the scrolling form body. This silently broke once a user scrolled the body — form labels and inputs ghosted through the translucent backdrop (most visible on the SQCDP Basics tab where Subtitle / Format / Period / Current value / Target stacked into the scroll axis).

The v12.3 SQCDP editor reshapes the dialog body into a **side-by-side split** at the `md:` breakpoint instead. There's no scroll overlap to bleed through and the preview is always fully visible at native size.

### Layout shape

```tsx
<DialogContent className='flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1040px]'>
  <DialogHeader className='border-border/40 shrink-0 border-b px-6 py-4'>...</DialogHeader>

  <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
    <form className='flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden'>
      {/* Left pane: live preview only. */}
      <aside className='border-border/40 bg-muted/20 shrink-0 border-b px-5 py-5
                        md:w-[380px] md:overflow-y-auto md:border-r md:border-b-0'>
        <LivePreview ... />
      </aside>

      {/* Right pane: tabs + sticky footer. */}
      <div className='flex flex-1 flex-col md:min-w-0 md:overflow-hidden'>
        <div className='flex-1 px-6 py-5 md:overflow-y-auto'>
          <Tabs ... />
        </div>
        <DialogFooter className='border-border/40 bg-background sticky bottom-0 z-10 shrink-0
                                  gap-2 border-t px-6 py-3 md:static'>
          ...
        </DialogFooter>
      </div>
    </form>
  </div>
</DialogContent>
```

Key details:

- **`sm:max-w-[1040px]`** (was `920px` in v12) — left pane is `380 px` + 1 px divider; right pane lands at ≈ 660 px which keeps two-column form grids comfortable. Drop further only if the consuming editor has fewer than ≈ 8 controls per tab.
- **`flex` not `grid` on `<DialogContent>`** — we want the body to fill the remaining vertical space and have its own `min-h-0` so children with `overflow-y-auto` actually scroll. The shadcn primitive defaults to `grid`; tailwind-merge resolves the override.
- **Mobile collapses to a single scroll column.** Below `md`, the form is `flex-col overflow-y-auto`; the aside loses its width / border-r and stacks above the right pane with a `border-b` divider. The footer stays reachable via `sticky bottom-0 z-10` (becomes `md:static` once the right pane is its own scroll container).
- **Sticky footer at md+ is purely structural.** The right pane is `flex flex-col md:overflow-hidden` with `flex-1` on the scrolling tabs container and `shrink-0` on the footer — the footer naturally lands at the bottom. Sticky styling only matters on mobile.
- **Drop the translucent chrome from `<LivePreview>`.** Because the preview now lives in its own committed column there's no overlap to bleed through. The wrapper goes from `border-border/50 bg-muted/20 sticky top-0 z-10 rounded-md border p-3 backdrop-blur-sm` to a plain `flex flex-col gap-3` — the background colour comes from the aside's `bg-muted/20`.
- **Drop the `mx-auto max-w-md` from the inner card wrapper.** The card now fills the column width (≈ 340 px after the aside's `px-5 py-5` padding). Centering an artificially narrowed card inside a 380 px column wastes the real estate the side-by-side layout was meant to recover.

### When to apply this variant

- The dialog hosts a **live preview** of the row being edited.
- AND the form body has multiple sections / tabs the curator switches between.
- AND `sm:max-w-[1040px]` (or close) is acceptable — the desktop dialog gets noticeably wider.

If the form body fits in one short scroll (no tabs, three or four fields, no embedded subsystem) and the live preview is small (< 200 px tall), the v12 sticky-top variant is still acceptable provided the sticky background is fully opaque (`bg-background`, no `backdrop-blur-*`). The v12.3 split is the right shape once any of: 4+ sections, embedded CRUD subsystem, tabs interface, preview taller than ≈ 240 px.

### Failure mode this fixes

See [[Fix-SQCDP-Editor-Live-Preview-Bleed-Through]] for the SQCDP debug write-up. The same anti-pattern would land in any future editor that copies the v12 sticky-top recipe verbatim — explicitly note `bg-muted/20 backdrop-blur-sm` is intentionally translucent and will bleed-through if there's any scrollable content under it.

### Related (added)

- [[Fix-SQCDP-Editor-Live-Preview-Bleed-Through]] — the SQCDP failure mode that drove this update.



## v14 (2026-05-17) — Dirty-aware tab strip + footer indicator

The v14 SQCDP editor pass added two affordances on top of the v12.3 side-by-side layout that future tabbed editors should adopt when their forms are long enough to surface unsaved edits in tabs the curator isn't currently looking at.

### Custom tab strip with dirty badges

Replaces shadcn's default `<TabsList>` (which doesn't expose a slot for per-tab metadata) with a roomier secondary-nav strip. Each tab is a `<button>` that:

- Shows the tab label.
- Renders a 1.5px coloured dot when any of its associated `formState.dirtyFields` is set — amber when the tab is inactive, the primary accent when the tab is active.
- Carries an `aria-selected` + `aria-disabled` attribute so the strip is still a real tablist for AT.
- A one-line description under the strip (`text-muted-foreground text-xs`) reinforces what the active tab is for.

Driven by a static `TabDescriptor[]` table that maps each tab to the form fields that belong to it:

```ts
interface TabDescriptor {
  id: TabId
  label: string
  description: string
  fields: readonly (keyof FormValues)[]
}

const TAB_DESCRIPTORS: readonly TabDescriptor[] = [
  { id: 'basics', label: 'Basics', fields: ['title', 'subtitle', ...] },
  { id: 'style',  label: 'Style',  fields: ['colorHex', 'styleConfig'] },
  // …
]
```

The strip subscribes to `form.formState.dirtyFields` once at the parent level and derives `dirty` per-tab via `tab.fields.some(f => dirtyFields[f])`. One subscription powers the entire row.

**When to apply.** Use this strip variant when the tab body is rich enough that the curator might leave dirty state on a tab they're not currently looking at — typically 3+ form sections per tab. A 2-tab editor with 3 fields each doesn't need it.

### Footer "Unsaved changes" indicator

A small left-of-Save indicator that surfaces `formState.isDirty` at the footer level. Same dot + label idiom as the tab badges, but at the dialog scope:

```tsx
{isDirty && (
  <span className='text-muted-foreground hidden items-center gap-1.5 text-xs sm:flex'>
    <span className='inline-block h-1.5 w-1.5 rounded-full bg-amber-500' />
    Unsaved changes
  </span>
)}
```

Hidden on mobile to keep the footer dense. The confirm-on-dirty-exit dialog (§ 7 of this pattern) is still the canonical safety net — the indicator is a passive cue, not a control.

### Decision: dot badge vs count badge

The spec for the v14 pass discussed surfacing a *count* badge ("3 dirty fields") next to each tab. We landed on a *binary dot* instead because (a) the count rarely tells the curator anything actionable ("I changed Y fields on tab X"), (b) the dot scans better at the tab-strip's small size, and (c) we already surface the form-wide "Unsaved changes" pill in the footer for the global signal. Future editors should follow the dot convention unless they have a specific reason to count.

### Width bump for richer bodies

When the tab bodies pick up enough new sections that a 1040px dialog feels cramped (the SQCDP v14 added 5 new chart-tab sections + a header-band section + a More disclosure inside each typography row), bump `<DialogContent>` to `sm:max-w-[1180px]`. Stay under ~1280px so the dialog doesn't dominate a 13" laptop viewport (~1366px wide).

### Related (added)

- [[Implementations/Implement-SQCDP-Editor-Fine-Grained-Controls]] — first application of the v14 tab-strip + footer-indicator recipe.
