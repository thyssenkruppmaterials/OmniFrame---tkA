---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-04-25
---
# Redesign — Standard Work Comprehensive Rebuild

Six-phase rebuild of the Standard Work feature shipped on 2026-04-25. Touches dashboard, runner, builder, data layer, a11y, and a Supabase migration.

## Phase 0 — Foundation (data, types, invalidation)
- New `useStandardWorkOverview` selector merges dashboard-tasks + progress + upcoming queries (`src/features/standard-work/hooks/use-standard-work-overview.ts`).
- Submission-lifecycle mutations now invalidate dashboard, progress, upcoming, overdue, scheduled-tasks query keys (`src/hooks/use-standard-work.ts`).
- `startNewSubmission` computes `due_at` from template local due_time; resumes existing open drafts via `findOpenDraft`; throws structured `DUPLICATE_SUBMISSION` only on final-state duplicates (`src/lib/supabase/standard-work.service.ts`).
- `submissionMap` keyed by `templateId::workingAreaId` to prevent collisions between concurrent drafts in different areas.
- `upsertResponse` toasts on first failure and every 5th repeat instead of silently logging.
- `reorderItems` parallelized via `Promise.all`.
- `duplicateTemplate` no longer produces "undefined-copy" template codes.

## Phase 1 — Dashboard rebuild
- New `dashboard/kpi-card.tsx` primitive (Framer-motion entrance, `AnimatedNumber`, info tooltip, optional progress bar, hover lift).
- Four canonical KPIs: Today's progress / Attention needed / Streak / On-time rate. No morphing 4th card.
- Streak banner removed from `progress-stats.tsx` (deduped against KPI strip).
- Error states everywhere: `today-tasks.tsx`, `progress-stats.tsx`, `upcoming-tasks.tsx`, and a top-level dashboard alert with Retry.
- Filter chip -> real `<Button>` with `aria-label`; Refresh sets `aria-busy` and refetches all three queries.
- `AnimatePresence` + stagger on the today list when filters change; honors `prefers-reduced-motion`.
- Upcoming Schedule subtitle uses real `windowDays` and "M scheduled days" instead of conflating the two.

## Phase 2 — Checklist runner
- `photo` and `signature` upload to the new `standard-work-attachments` storage bucket via `src/lib/supabase/standard-work-attachments.service.ts`.
- New runner UI: `runner/photo-capture.tsx`, `runner/signature-pad.tsx` (HTML5 canvas, pointer events, high-DPI aware).
- True `multi_select` storing JSON array in `response_value`; resilient parser tolerates legacy comma-separated strings.
- `conditional_display` filtering enforced before rendering items.
- Functional setState in `handleResponseChange` (no stale-merge); single-seed effect so server refetch never stomps in-flight edits.
- `flushAllPending()` runs on visibilitychange, beforeunload, and Save & Exit.
- Required-only progress denominator with a small total-items sub-label.
- aria-live polite region announces save / submit transitions.
- Section headers converted to `<button aria-expanded aria-controls>`.

## Phase 3 — Templates & Settings
- `SaveStatusPill` replaces single `hasUnsavedChanges`: `Saving…` / `Saved` / `Order pending`.
- `previewMode` wired through Canvas, SectionEditor, SortableItem (read-only hides handles + delete + palette + properties).
- `generateSectionId()` UUIDs replace slug-derived IDs (no collisions on similarly-named sections).
- Palette includes `multi_select`, `photo`, `signature`.
- Builder grid stacks to single column under `lg:`.
- Scheduling panel: timezone label, next-5-occurrence preview, removed duplicate panel-level toast.
- Assignment panel: user-search failures now surface a toast.

## Phase 4 — Cross-cutting a11y + microcopy + tokens
- `aria-label` on every icon-only button (drag handle, delete, refresh, filter clear, color swatch, kebab menu, template card actions).
- Color swatches grouped as `role="radiogroup"` with `role="radio"` + `aria-checked`.
- Settings status options now use design tokens (`text-muted-foreground`) and `dark:` variants.
- Locale-aware date / time formatting (`navigator.language`) instead of hardcoded `en-US` in upcoming-tasks and submission-history.
- Microcopy: "Your standard work this period" instead of generic "Your performance metrics"; KPI explainers via tooltips.

## Phase 5 — Migration `234_standard_work_hardening.sql`
- Tighter `swr_*` responses RLS: scoped to submission ownership + supervisor/manager carve-out.
- `swt_manager_all` / `swi_manager_all` enforce the role check the original policy names implied.
- Partial index `idx_sw_submissions_open_drafts` for `findOpenDraft` lookups.
- Storage bucket `standard-work-attachments` (public read, org-prefixed write).
- Documentation header noting streak rules don't yet handle weekend skip / holiday freeze.

## Files touched

```
src/features/standard-work/
  hooks/use-standard-work-overview.ts            (new)
  components/dashboard/
    kpi-card.tsx                                  (new)
    standard-work-dashboard.tsx                   (rewritten)
    progress-stats.tsx                            (rewritten)
    upcoming-tasks.tsx                            (rewritten)
    today-tasks.tsx                               (motion + a11y + key fix + error)
    submission-history.tsx                        (motion + locale)
  components/runner/
    photo-capture.tsx                             (new)
    signature-pad.tsx                             (new)
  components/template-builder/
    types.ts                                      (added types + UUID helper)
    item-palette.tsx                              (rewritten)
    sortable-item.tsx                             (rewritten with a11y)
    canvas.tsx                                    (rewritten with readOnly)
    section-editor.tsx                            (readOnly + a11y)
    template-builder.tsx                          (rewritten with status pill + previewMode)
  components/
    standard-work-checklist.tsx                   (rewritten)
    standard-work-settings.tsx                    (a11y + tokens)
    scheduling-panel.tsx                          (timezone + preview + toast cleanup)
    assignment-panel.tsx                          (search-failure toast)
src/hooks/use-standard-work.ts                    (cache invalidation, upsert toast)
src/lib/supabase/
  standard-work.service.ts                        (due_at, findOpenDraft, parallel reorder, duplicate fix)
  standard-work-attachments.service.ts            (new)
supabase/migrations/234_standard_work_hardening.sql (new)
```

## Related
- [[Standard Work - Feature Module]]
- [[ADR-StandardWork-Single-Source-Of-Today]]
- [[Fix-StandardWork-Cache-Staleness]]
- [[StandardWorkAndOperations - Supabase Service]]
- [[React-Query-Patterns]]
- [[UI-Component-Conventions]]
- [[Dark-Mode-Opacity-Colors]]



## Follow-ups (April 25, 2026 — PM 2)

### Template card redesign (`templates/template-card.tsx`, `templates/template-list-row.tsx`)
User feedback: the prior cards were too tall and the page felt unmanageable once a few templates existed. Original card was ~280px (color-stripe block, large icon, full title + description, badges row, meta row, four-button action row). New card is ~120-140px:
- 2px color stripe (down from a full block).
- Header row: small icon + name + code + kebab.
- Single meta row: status dot + frequency + items + duration + area, all inline.
- Optional 1-line description (line-clamp-1) instead of 2 lines.
- Card body acts as a `<button>` that opens the builder; secondary actions (Assign / Schedule / Edit) live in a thin footer with icon-only ghost buttons; Duplicate / Archive in the kebab.
- Grid breakpoints expanded to `sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4` so wide screens can show ~12-16 cards without scrolling.

### List view + filter toolbar (`standard-work-settings.tsx`)
- New view toggle (Grid / List) persisted in `localStorage` under `sw-templates-view`.
- List view renders the same data via `<Table>` with a dense `TemplateListRow` (~40px tall) for power users with many templates.
- New search input filters by name / code / description.
- The pre-existing summary strip (Total / Active / Draft / Archived) is now interactive: clicking a count toggles a status filter (`all`, `active`, `draft`, `archived`).
- Empty / no-match state with a Clear-filters CTA when filters return nothing.

### Runner single-RPC load path
- New `useSubmissionBundle(submissionId)` hook in `use-standard-work.ts` wraps the existing `get_submission_with_responses` RPC.
- New service method `getSubmissionBundle()` in `standard-work.service.ts` shapes the RPC payload into `{ submission, items[], responses[] }` (hydrating `submission.template` and `submission.working_area` from the join, sorting items by `display_order`, and dropping items the template has soft-deleted since the submission was started).
- `ActiveSubmissionView` now consumes the bundle instead of three parallel queries (`useSubmission` + `useSubmissionResponses` + `useTemplateItems`). Initial runner load drops from 3 round-trips to 1.
- `submitChecklistMutation` now also invalidates `['standard-work-submission-bundle', submissionId]` so the post-submit view reflects the new status without a manual refresh.

### Files added
```
src/features/standard-work/components/templates/
  template-card.tsx       (new)
  template-list-row.tsx   (new)
```



## Follow-up: Executive-grade Checklist Dashboard redesign (April 25, 2026 — PM 3)

User feedback after the first dashboard rebuild: still wanted a more professional, executive-grade aesthetic. Refactored the dashboard into a hero + bento KPI tiles + main grid layout with mini-visualizations.

### Layout (top → bottom)
1. **Hero strip** (`dashboard/dashboard-hero.tsx`)
   - Time-aware greeting ("Good morning/afternoon/evening, {firstName}") + localized date
   - One-line summary that reflects state (e.g. "3 of 5 complete · 2 remaining" / "All caught up" / "Nothing scheduled today")
   - **Next up** pinned card on the right that surfaces the most urgent task (overdue → due-soon → later-today) with a Start/Continue button so users don't have to scroll into the list
   - Inline working-area filter + refresh icon (with tooltip)
   - Subtle gradient blob behind the heading for depth
2. **KPI tile row** (`dashboard/kpi-tiles.tsx`) — four refined tiles, each with a unique mini-visualization instead of the generic big-number-plus-icon pattern:
   - **TodayProgressTile** — animated SVG circular progress ring + completed/due
   - **AttentionTile** — count + context (next-overdue label); subtle red/amber gradient when there's pressure, neutral when calm
   - **StreakTile** — flame icon + current streak + 7-day calendar grid (driven by `userDailyCompletion` for the current user, falls back to filling N cells equal to current streak when daily data hasn't loaded yet)
   - **OnTimeRateTile** — percentage + 14-day SVG sparkline of daily completions (with subtle gradient fill); placeholder bar when there's not enough data to draw a line
3. **Main grid** — unchanged 2/3 + 1/3 layout: Today's Tasks + Upcoming Schedule on the left, My Progress + Recent Activity on the right.

### Why this reads more "executive"
- **Asymmetry**: hero is wider than the tiles, tiles each have a distinct visual signature, the main grid keeps its 2/3 + 1/3 rhythm. The page no longer reads as four identical cards stacked above two columns.
- **Action-first**: Next-up is pinned to the hero so the primary affordance is one click away.
- **Personal voice**: greeting + first name, sentence-case labels, calmer typography hierarchy (no all-caps shouting on the tiles).
- **Data density without clutter**: progress ring, weekly grid, and sparkline communicate trends a static number can't.
- **State responsiveness**: AttentionTile gradient shifts (red → amber → neutral) based on pressure; Next-up card swaps between scheduled, all-caught-up, and nothing-scheduled with appropriate copy and color.

### Files touched
```
src/features/standard-work/components/dashboard/
  dashboard-hero.tsx          (new)
  kpi-tiles.tsx               (new — TodayProgressTile, AttentionTile,
                                     StreakTile, OnTimeRateTile)
  standard-work-dashboard.tsx (rewrite to compose hero + tiles)
```

### Notes
- The previous `dashboard/kpi-card.tsx` primitive remains in the tree and is still reusable; the new tiles are purpose-built for the dashboard's bento layout.
- `userDailyCompletion` is already fetched org-wide; the dashboard now filters it down to the current user before passing into `StreakTile` / `OnTimeRateTile` (no extra round-trip).
- All animations honor `prefers-reduced-motion`.
- `tsc -b` clean, vite HMR clean.
