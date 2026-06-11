---
tags: [type/implementation, status/active, domain/frontend, domain/database]
created: 2026-05-17
---
# Implement — Production Boards Bento Layout

## Purpose / Context

Replaced the flat `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` strip
of PostCards on the four secondary Production Boards (Announcements,
HR News, Jobs, Safety Alerts) with a **resizable, draggable,
multi-variant bento mosaic**. Curators (gated on
`production_boards:edit`) can drag cards by a grip handle to
rearrange, drag the bottom-right corner to resize, pick from five
visual variants (`classic` / `banner` / `gallery` / `spotlight` /
`quote`), and reset the board's layout to defaults.

Reference component: [[Components/ProductionBoards - Feature Module]].
Pattern note: [[Patterns/Bento-Grid-Layout]].
Schema ADR: [[Decisions/ADR-Production-Boards-Bento-Layout-Persistence]].

Sibling slice from the same day: [[Implement-Production-Boards-Post-Composer]]
(the editor surface). The bento is the *display* side; the composer
remains the editing surface. The only composer change in this slice is
a new `<BoardCardVariantPicker>` section in its Details tab.

## Files

### Added

```
supabase/migrations/307_production_boards_card_layouts.sql
src/features/shift-productivity/production-boards/
  components/bento/
    bento-grid.tsx                    — generic CSS-grid surface, dnd-kit move + hand-rolled resize
    bento-board-shell.tsx             — joins posts+layouts, mounts <BentoGrid>, owns reset CTA
    bento-layout.ts                   — pure helpers (autoPlace, findFreeSlot, clampDragTo)
    bento-layout.test.ts              — 13 unit tests
    card-variant.ts                   — variant types, default sizes, parsers, breakpoints
    card-variant.test.ts              — 18 unit tests
    card-variant-picker.tsx           — radio-group picker mounted in composer Details tab
    card-variant-picker.test.tsx      — 7 smoke tests
    card-renderer.tsx                 — dispatch by variant
    card-renderer.test.tsx            — 6 smoke tests
    cards/
      card-shared.tsx                 — React components (EditPencil, PinnedBadge, SeverityBadge, AckPill, IconBubble)
      card-shared-utils.ts            — constants + selectors + types
      storage-helpers.ts              — publicImageUrl, imageAttachmentsOf, firstImageUrlOf
      classic-card.tsx                — compact summary (default 3×2)
      banner-card.tsx                 — full-width hero with cover image + marquee (default 12×3)
      gallery-card.tsx                — framer-motion crossfade rotation (default 6×4)
      gallery-card.test.tsx           — 6 smoke tests
      spotlight-card.tsx              — single-attribute hero (default 6×3)
      quote-card.tsx                  — pull-quote (default 6×2)
  hooks/
    use-board-card-layouts.ts         — TanStack hook + upsert/delete/reset
    use-board-card-layouts.test.tsx   — 6 unit tests
```

### Modified

```
src/features/shift-productivity/production-boards/
  components/
    post-composer-dialog.tsx          — + <BoardCardVariantPicker> in Details tab (single new section)
    composer/composer-types.ts        — + card_variant / card_variant_config keys on every KindData
  boards/
    announcements/announcements-board.tsx  — swap grid → lazy <BentoBoardShell> (read + edit)
    hr-news/hr-news-board.tsx              — same swap
    jobs/jobs-board.tsx                    — same swap
    safety-alerts/safety-alerts-board.tsx  — same swap
  index.ts                            — + BentoBoardShell / BentoGrid / CardRenderer / BoardCardVariantPicker / useBoardCardLayouts / type exports
vite.config.ts                        — + 'feature-production-boards-bento' manual chunk
```

### Deleted

None. The existing `<PostCard>` + `<JobCard>` components stay as the
canonical "v6 sibling" surfaces (still referenced by the composer's
preview pane and the existing tests). The bento variants are
co-located but independent so the migration can be staged.

## Schema migration (307) at a glance

Additive only. One new table, one updated_at trigger, two
orphan-cleanup triggers on the two posts tables. Full reasoning in
[[Decisions/ADR-Production-Boards-Bento-Layout-Persistence]].

```sql
CREATE TABLE production_board_card_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  board_kind TEXT NOT NULL CHECK (board_kind IN
    ('announcement','hr_news','job','safety_alert')),
  scope TEXT NOT NULL DEFAULT 'all',
  post_id UUID NOT NULL,
  post_kind TEXT NOT NULL CHECK (post_kind IN ('post','job')),
  grid_x INTEGER NOT NULL DEFAULT 0,
  grid_y INTEGER NOT NULL DEFAULT 0,
  grid_w INTEGER NOT NULL DEFAULT 3,
  grid_h INTEGER NOT NULL DEFAULT 2,
  card_variant TEXT NOT NULL DEFAULT 'classic'
    CHECK (card_variant IN ('classic','banner','gallery','spotlight','quote')),
  variant_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- + timestamps + grid-pos CHECK + scope-length CHECK + unique key
);
```

RLS mirrors `production_board_posts` (org-scoped reads via
`user_profiles.organization_id`, writes also gated on
`public.has_permission('production_boards', 'edit')`). Triggers
`SET search_path = public, pg_temp` + `REVOKE EXECUTE FROM PUBLIC,
anon, authenticated` on the `SECURITY DEFINER` cleanup functions —
same hardening as migration 306 used to clear the advisor warnings.

**Applied via Supabase MCP `apply_migration` against dev project
`wncpqxwmbxjgxvrpcake`. Advisor clean for the new table + triggers.**

## Frontend architecture

### Library decision — `@dnd-kit` + hand-rolled resize

Not `react-grid-layout`. The ADR (§ Alternatives § B) covers the
reasoning: bundle weight, React 19 strict-mode compatibility, and
`@dnd-kit/core` already being in the project's dep tree. The
hand-rolled corner-resize handle is ~80 LOC of pointer-events code
shaped like `composer-resizable-shell.tsx`.

### `<BentoGrid>` — the surface

CSS grid (`display: grid`, `gridTemplateColumns: repeat(cols, minmax(0,1fr))`,
`gridAutoRows: ${cellPx.h}px`). Each tile occupies
`grid-column: ${x+1} / span ${w}` and `grid-row: ${y+1} / span ${h}`.

Cell width / height are measured at mount + re-measured on container
resize via a `useResponsiveBreakpoint()` hook (window-resize
listener) so drag-cell math stays accurate after viewport changes.

Drag-to-move uses `@dnd-kit/core`'s `useDraggable` per tile plus
`<DragOverlay>` for the ghost render. Drop computes delta cells from
`event.delta.{x,y}` / `(cellPx.w + cellPx.gap)` and commits via
`onLayoutChange`.

Drag-to-resize is hand-rolled: the corner button captures `pointerdown`
+ `pointermove` + `pointerup` via `setPointerCapture(e.pointerId)`,
live-previews via CSS variable updates on the dragged tile, commits
on `pointerup`. `e.stopPropagation()` keeps the dnd-kit listener out.

Drag affordances render only when `editMode && !isTv` — TV inherits
the read-only render path.

A scoped `<style>` element at the top of `<BentoGrid>` declares the
`@keyframes bento-marquee` rule consumed by `<BannerCard>` when
`marquee && isTv`.

### Per-variant cards

Five variants under `cards/`. All five accept the same
`SharedCardProps` shape and dispatch through `<CardRenderer>`:

| Variant | Default size | Highlights |
|---|---|---|
| `classic` | 3×2 | Severity-coloured left stripe, optional cover image at top, badges + ack pill |
| `banner` | 12×3 | Full-bleed cover image with `cover_position` crop, accent radial glow, optional marquee on TV |
| `gallery` | 6×4 | Framer-motion `AnimatePresence` crossfade, dot pager, hover chevrons (non-TV), pause-on-hover w/ 2s resume delay, falls back to `<ClassicCard>` when < 2 images |
| `spotlight` | 6×3 | Icon bubble + scope eyebrow + corrective-action callout for safety alerts |
| `quote` | 6×2 | Large pull-quote (`text-4xl md:text-5xl` light italic), subtle background quote glyph |

Shared scaffolding split across two files for fast-refresh hygiene:

- `card-shared.tsx` — components only (`EditPencil`, `PinnedBadge`,
  `SeverityBadge`, `AckPill`, `IconBubble`). Components-only files
  let `react-refresh/only-export-components` work.
- `card-shared-utils.ts` — constants, selectors, types (
  `SEVERITY_BORDER`, `accentColorOf`, `severityOf`, `isPostKind`,
  `cardShell`, etc).

Storage URL retrieval lives in `cards/storage-helpers.ts` via
`supabase.storage.from('production-board-images').getPublicUrl(path)`.

### `<CardRenderer>` — the dispatch seam

Single switch on `card.cardVariant` that constructs the right variant
component. The only seam between layout (`<BentoGrid>`) and
presentation (variant cards) — adding a sixth variant just means
registering it in `card-variant.ts` + adding a case here + adding a
swatch in the picker.

### `useBoardCardLayouts(boardKind, scope = 'all')`

TanStack Query hook. Returns:

- `layouts: Map<post_id, CardLayoutRow>` — indexed by post id for
  O(1) lookup in the shell.
- `upsertLayout` — mutation; uses Supabase `.upsert(row, { onConflict:
  '...' })` so a per-card commit is idempotent on the unique key.
- `deleteLayout` — drops a single row; the card falls back to its
  default placement on the next render.
- `resetBoardLayout` — bulk delete by `(org, board, scope)`. Guarded
  by a `window.confirm` in the shell.

Polling 60s, visibility-gated. NO new Supabase Realtime channel —
honours the workspace Realtime Policy in `Master Rule workspace rule`.

### `<BentoBoardShell>` — the per-board wiring

Thin shell that joins `items[]` (posts or jobs) with `layouts` (from
the layout hook) into `BoardCard[]` and renders `<BentoGrid>`. Used
identically by all four boards. Owns the "Reset layout" affordance
(visible in edit mode, hidden on TV).

For each item, if a persisted layout row exists, it's used verbatim.
Otherwise the shell falls back to the variant hint stored in
`kind_data.card_variant` / `card_variant_config` (written by the
composer's variant picker) and the variant's default size.

### Variant picker in the composer

Added as a new `<Section title='Card layout'>` in the post composer's
Details tab, mounted between Headline and Severity & priority. The
picker is a 5-radio button group of tiny visual sketches (CSS-only)
+ a description line + conditional config row:

- `gallery` → slide-interval slider (3..30s)
- `banner` → cover-focus radio (Top / Center / Bottom)
- Others → no config

Writes to `kind_data.card_variant` + `kind_data.card_variant_config`
so the FIRST render of a brand-new post picks the right variant
before any row exists in `production_board_card_layouts`. The bento
shell then persists the actual choice on the next drag.

### Boards (`announcements-board`, `hr-news-board`, `jobs-board`,
`safety-alerts-board`)

Each board's non-TV body collapses from

```tsx
<div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'>
  {posts.map((p) => <PostCard key={p.id} post={p} ... />)}
</div>
```

to

```tsx
<Suspense fallback={null}>
  <BentoBoardShell
    boardKind='announcement'
    items={bentoItems}
    editMode={showEditAffordances}
    isTv={false}
    onEditPost={(_, post) => setEditor({ open: true, post })}
    onAcknowledgePost={(p) => acknowledgePost.mutate(p.id)}
  />
</Suspense>
```

TV-mode path collapses the same way with `editMode={false}` and
`isTv`. The `<EmptyState>` and the per-board chrome (filter chips,
"+ New" button, "Display on TV" button, working-area / branch
filter) are unchanged.

## Validation

- `pnpm vitest run src/features/shift-productivity/production-boards/`
  — **30 test files, 343 tests, all passing** (was 281 before; +62
  new across bento-layout, card-variant, card-variant-picker,
  card-renderer, gallery-card, use-board-card-layouts).
- `pnpm eslint src/features/shift-productivity/production-boards/` —
  clean (zero new warnings; lint-ratchet not exercised because no
  new warnings landed).
- `pnpm tsc -b --noEmit` — clean on touched files. (Pre-existing TS
  errors in `sqcdp-editor-dialog.tsx` from a concurrent SQCDP-editor
  session are unrelated.)
- `pnpm build` — successful. Bundle:
  - `feature-production-boards-bento-CJaZ8ajk.js`: **76.74 KB raw /
    23.73 KB gzip** (new, lazy).
  - `feature-shift-productivity-DVJTKyb0.js`: **473.88 KB raw /
    100.75 KB gzip** (was ~470 KB pre-change — net +3 KB).
  - `feature-production-boards-composer-CJ0rfdGa.js`: **77.63 KB**
    (unchanged — the composer carve-out kept it stable through the
    variant picker addition).
- Migration 307 applied via `apply_migration` against dev project
  `wncpqxwmbxjgxvrpcake`. Schema verified via `execute_sql` on
  `information_schema.columns`; advisor clean for the new objects.
- Three pre-existing chunks remain over budget (warehouse-location-map,
  feature-admin, feature-rf-interface) — unrelated to this slice.

## Open follow-ups

- **Per-scope layouts** (e.g. an Announcements board that cycles by
  working-area, mirroring the Hourly board's area rotation). The
  schema already carries `scope`; the boards just need to pass a
  non-`'all'` value through. Defer until a curator asks.
- **Composer preview parity** — the preview pane in the post
  composer still renders a single classic-shaped card. For
  `banner` / `gallery` curators a visual mismatch lingers between the
  preview and the actual board. Defer until curators report
  confusion; the picker's tiny sketches in the Details tab cover most
  of the explanation.
- **TV viewport-fit chain on the bento.** [[Patterns/TV-Viewport-Fit-Grid]]
  documents the column-flex `flex-N min-h-0 auto-rows-fr` chain that
  SQCDP applies. The bento's variant cards manage their own height
  via `flex-1`; if a TV display ever overflows the viewport, swap
  `gridAutoRows: ${cellPx.h}px` for `1fr` + wrap the grid in `flex
  h-full flex-col` per the pattern.
- **Per-card border colour from `accent_hex`** is already shipped
  (every variant respects `accentColorOf(card)`). Promoting a
  whole-card "recommended variant" hint based on attachments would be
  the natural next step (e.g. "this post has 4 images — try Gallery?"
  as a one-click upgrade in the composer).

## Canonical handles for future tweaks

- **Add a sixth variant**: register in `card-variant.ts` + add a case
  in `<CardRenderer>` + add a swatch in `<BoardCardVariantPicker>` →
  `<VariantPreview>` + extend the CHECK in migration 307.
- **Change a variant's default size**: edit `VARIANT_DEFAULT_SIZE` in
  `card-variant.ts`. Persisted layouts are untouched; only first-paint
  defaults change.
- **Change the grid breakpoints**: edit `BENTO_BREAKPOINTS` and the
  `useResponsiveBreakpoint()` boundary table in `bento-grid.tsx`.
- **Re-tune the gallery interval bounds**: edit
  `GALLERY_MIN_INTERVAL_S` / `GALLERY_MAX_INTERVAL_S` /
  `GALLERY_DEFAULT_INTERVAL_S` in `card-variant.ts` and the slider's
  `min`/`max` in `card-variant-picker.tsx`.
- **Change the chunk policy**: edit the `feature-production-boards-bento`
  rule in `vite.config.ts`'s `manualChunks`.

## Related

- [[Patterns/Bento-Grid-Layout]] — the recipe extracted from this work.
- [[Decisions/ADR-Production-Boards-Bento-Layout-Persistence]] — the schema + library decisions.
- [[Implementations/Implement-Production-Boards-Post-Composer]] — sibling slice from the same day; the variant picker mounts inside its Details tab.
- [[Patterns/Production-Boards-Post-Composer]] — composer pattern.
- [[Patterns/Editable-Board-Dialogs]] — dialog pattern the composer uses.
- [[Patterns/TV-Viewport-Fit-Grid]] — viewport-fit chain to apply if the bento needs TV no-scroll snapshot.
- [[Components/ProductionBoards - Feature Module]] — the surface this lands on.
