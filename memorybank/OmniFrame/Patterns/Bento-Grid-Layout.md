---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-17
---
# Bento Grid Layout

## Purpose / Context

Reusable recipe for a **curator-editable bento grid** that lets
privileged users drag cards to rearrange, drag corners to resize,
and pick per-card visual variants — while staying TV-display-grade
(no drag chrome on TV, gallery rotation runs, banners scale).

First surfaced from the 2026-05-17 Production Boards bento pass
(see [[Implementations/Implement-Production-Boards-Bento-Layout]]).
The complaint that crystallised the recipe:

> "Card is not what I imagined for the announcements, HR news, jobs,
> or safety alerts. I would like to make this resizable, be allowed
> to show banners, have a canvas, rotating images, all kinds of
> things, and have a grid layout where I can rearrange as needed
> and however I want to."

Use this when:

- A board / page renders a list of items that *should not* all look
  the same. Each item benefits from a curator-picked visual treatment
  (banner / gallery / pull-quote / spotlight / compact summary).
- The list is curator-edited often enough that drag-to-rearrange is
  worth the affordance cost.
- The same surface needs to render on a TV viewport without scroll,
  with the same layout.

Do NOT use this when:

- The list is sorted by a deterministic rule (severity, score, time)
  and the order has semantic meaning. Use a plain grid instead and
  expose the sort knob.
- Every item carries the same visual treatment by design (e.g. SQCDP
  scorecards — every category is a `<SqcdpCard>`; the variant choice
  there would dilute the at-a-glance read).
- The drag would put items into an order that fights another
  primary sort (e.g. a Kanban where cards must stay in their column).

## The Recipe

### 1. Schema — one dedicated table per board family

```sql
CREATE TABLE production_board_card_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  board_kind TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'all',
  post_id UUID NOT NULL,
  post_kind TEXT NOT NULL,
  grid_x INTEGER NOT NULL DEFAULT 0,
  grid_y INTEGER NOT NULL DEFAULT 0,
  grid_w INTEGER NOT NULL DEFAULT 3,
  grid_h INTEGER NOT NULL DEFAULT 2,
  card_variant TEXT NOT NULL DEFAULT 'classic',
  variant_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- … + timestamps + checks + unique on (org, board, scope, post_kind, post_id)
);
```

Key choices:

- **Per-org, per-board-kind, per-scope, per-(post-kind, post-id)**
  uniqueness. The `scope` column gives a free per-area variant
  dimension without a future migration.
- **Polymorphic `post_id`** when the underlying content lives in two
  tables (posts vs jobs). Pair with `AFTER DELETE` triggers to clean
  orphans — see [[Decisions/ADR-Production-Boards-Bento-Layout-Persistence]]
  for the trigger shape.
- **JSONB `variant_config`** for per-variant tunables (banner cover
  position, gallery rotate interval). Parse defensively — drop bad
  values, don't throw.
- **RLS reads org-scoped, writes gated on the board's edit
  permission** (e.g. `production_boards:edit`) — mirror the source
  posts table's policies.

### 2. Hook — `useBoardCardLayouts(boardKind, scope = 'all')`

```ts
const { layouts, upsertLayout, deleteLayout, resetBoardLayout } =
  useBoardCardLayouts(boardKind, scope)
```

Returns `Map<post_id, CardLayoutRow>` + three mutations. Polling 60s,
visibility-gated (matches the project's standard board hook cadence).
Mutations invalidate the layouts query on success; they DO NOT need
realtime — layout changes are curator-driven, so a single editor's
refetch is sufficient and the org-wide poll picks up the change within
60s.

**No new Supabase Realtime channel** — honours the workspace Realtime
Policy in `Master Rule workspace rule`.

### 3. Component — `<BentoGrid>`

The generic surface. Accepts `cards: BoardCard[]` and renders a CSS
grid via `display: grid` + `gridTemplateColumns: repeat(cols, minmax(0,1fr))`
+ `gridAutoRows: ${cellPx.h}px`. Each card occupies
`grid-column: ${x+1} / span ${w}` and `grid-row: ${y+1} / span ${h}`.

Drag-to-move runs through `@dnd-kit/core` (`useDraggable` per tile,
`<DragOverlay>` for the ghost render). Drag-to-resize is hand-rolled
via `pointerdown` / `pointermove` / `pointerup` + `setPointerCapture`
— the corner handle button computes a cell delta from the pixel delta
and commits on `pointerup`.

Key choices in the grid:

- **Cell width / height are measured at mount** (via
  `ResizeObserver`-equivalent on container resize) so drag cell
  conversion stays accurate after viewport changes.
- **Two pointer-event paths** (dnd-kit move, hand-rolled resize)
  cohabit without conflict because resize handles get
  `e.stopPropagation()` and `setPointerCapture`. Move handles use
  dnd-kit's `activationConstraint: { distance: 6 }` so single clicks
  on edit buttons don't accidentally start a drag.
- **Drag affordances render only when `editMode && !isTv`.** TV mode
  inherits the read-only render path; drag handles never appear.
- **Live preview during drag** (semi-transparent ghost via
  `<DragOverlay>`); drop reflows the grid; persist on drop end.

### 4. Pure-function layout helpers — `bento-layout.ts`

Keep all placement math in a separate file so it's unit-testable
without mounting React:

- `autoPlaceCards(cards, cols)` — two-phase pack. Phase 1: accept
  persisted positions verbatim (clamped to grid). Phase 2: walk
  default-layout cards top-to-bottom, left-to-right; place each
  into the first free slot.
- `findFreeSlot(placed, cols, w, h)` — stable nested-loop shelf.
- `clampDragTo(variant, px, py, w, h, cols)` — clamp drop coords
  to the grid + per-variant min/max.
- `defaultLayoutForVariant(variant)` — returns `{ x:0, y:0, w, h }`
  using the variant's canonical default size.

Unit tests cover empty grids, persisted-card collisions, default
fall-through, x/w clamping, and per-variant size clamping.

### 5. Per-variant cards (the visual catalogue)

Five variants in this first slice, each in its own file under
`components/bento/cards/`:

| Variant | Default size | Use case |
|---|---|---|
| `classic` | 3×2 | Compact summary card (the v6 PostCard recipe). Accent stripe on the left, optional cover image at top. |
| `banner` | 12×3 | Full-width hero. Cover image with adjustable `cover_position`. Marquee scroll on TV when `kindData.marquee = true`. Accent radial glow. |
| `gallery` | 6×4 | Auto-rotating image carousel. Cross-fade between attachments every `rotate_interval_seconds` (default 6, range 3..30). Falls back to classic when < 2 image attachments. Pause-on-hover; chevrons + dot pager. |
| `spotlight` | 6×3 | Single-attribute hero. Big icon + scope eyebrow + corrective-action box (for safety alerts). |
| `quote` | 6×2 | Large pull-quote. Body rendered at `text-3xl` light italic. Subtle background quote glyph. |

Shared scaffolding lives in `cards/card-shared.tsx` (components like
`<EditPencil>`, `<PinnedBadge>`, `<SeverityBadge>`, `<AckPill>`,
`<IconBubble>`) and `cards/card-shared-utils.ts` (constants +
selectors like `accentColorOf(card)`, `severityOf(card)`,
`isPostKind(card)`). Splitting components from utils is required
by `react-refresh/only-export-components` — components-only files
allow fast-refresh, mixed files break it.

Dispatch happens in `<CardRenderer>` — a single switch on
`card.cardVariant` that constructs the right per-variant component.
Adding a sixth variant = adding a case here + registering in
`card-variant.ts` (`CARD_VARIANTS`, `VARIANT_DEFAULT_SIZE`,
`VARIANT_LABEL`, `VARIANT_DESCRIPTION`, `VARIANT_MAX_W`, `VARIANT_MIN_W`,
`VARIANT_MAX_H`, `VARIANT_MIN_H`) + a swatch case in
`<BoardCardVariantPicker>` → `<VariantPreview>`.

### 6. Variant picker in the editor

A radio-group of 5 small visual sketches mounted inside the
upstream editor (in our case the post composer's Details tab, as a
new `<Section title='Card layout'>`). Each sketch is a 12-row CSS
grid mockup of the variant's structure. Active variant gets a
`border-primary/60` ring. Variant-specific config rows render
conditionally under the picker (`gallery` shows a slider for
`rotate_interval_seconds`, `banner` shows a `cover_position`
radio).

The editor writes the *hint* into the post / job row's `kind_data`
as `card_variant` + `card_variant_config` keys so the FIRST render
of a brand-new post (before any row exists in
`production_board_card_layouts`) picks the right default variant.
The bento `<BentoGrid>` then persists the actual placement to the
layouts table on the next drag.

### 7. Wiring per board — `<BentoBoardShell>`

Thin shell that joins the data list (from the post / job hook) with
the layout map (from `useBoardCardLayouts`) into `BoardCard[]` and
renders a `<BentoGrid>` with the upsert / reset wiring. Each board
lazy-imports this shell via `React.lazy(...)` so the bento + variant
cards land in a separate chunk that's only fetched once a content
board is navigated to.

```tsx
<Suspense fallback={null}>
  <BentoBoardShell
    boardKind='announcement'
    items={posts.map((p) => ({ postKind: 'post', post: p }))}
    editMode={showEditAffordances}
    isTv={false}
    onEditPost={(_, post) => setEditor({ open: true, post })}
    onAcknowledgePost={(p) => acknowledgePost.mutate(p.id)}
  />
</Suspense>
```

The shell also renders the "Reset layout" affordance in edit mode
(behind a `window.confirm` because layout reset is destructive).

### 8. TV rendering

The TV chrome (`<TvFrame>`) wraps the board exactly as before; the
bento shell is rendered inside with `isTv={true}` and `editMode={false}`.
The grid forces a 12-col layout in TV mode regardless of viewport
(consistent across TV sizes), and the cell height bumps to `cellW * 0.75`
so the cards have a TV-friendly aspect ratio.

The bento doesn't yet adopt the column-flex `flex-N min-h-0
auto-rows-fr` chain from [[Patterns/TV-Viewport-Fit-Grid]] because
the per-card variant content already controls its own height via
`flex-1` inside the variant components. If a future tweak needs the
bento to fit a single viewport snapshot without scroll, the same
chain applies: wrap the grid in `flex h-full flex-col`, set the grid
`flex-N` weight, drop `gridAutoRows` to `1fr`. See the TV pattern for
the full chain.

Gallery rotation runs in TV mode too — that's exactly the use case
(rotating screen art). Banner marquee scrolls (CSS keyframe declared
at the top of `<BentoGrid>` via a scoped `<style>` element).

### 9. Bundle chunking

```js
// vite.config.ts manualChunks
if (id.includes('/components/bento/'))
  return 'feature-production-boards-bento'
```

Landed at ~75 KB raw / ~24 KB gzip in the first slice. Pin via
`React.lazy()` in the board entry files so the chunk fetches at
first content-board navigation, not on the page mount.

## Don't

- **Don't reach for `react-grid-layout` without checking your bundle
  budget.** It's ~70 KB gzip and would bust the 500 KB per-chunk
  guard on `feature-shift-productivity`. The hand-rolled
  pointer-event resize handle is ~80 LOC and sits comfortably
  inside the lazy chunk.
- **Don't add a Supabase Realtime channel for layout sync.** Per
  the workspace Realtime Policy, polling on the 60s board cadence
  is sufficient — curator-driven layout changes don't need
  sub-second sync across viewers.
- **Don't mix the utility helpers and React components in one
  file.** `react-refresh/only-export-components` will flag every
  non-component export. Split into `*-utils.ts` (constants + pure
  functions + types) and `*.tsx` (components only).
- **Don't put a foreign key on `post_id` if it can reference more
  than one table.** Use a `post_kind` discriminator + cleanup
  triggers on the source tables to keep orphans out.
- **Don't render drag handles on TV.** Curators only edit in-app;
  the TV is a read-only display. Gate every handle on `editMode
  && !isTv`.
- **Don't tie the variant choice to the post's content shape.**
  Every variant should render every post (even if it falls back —
  e.g. `gallery` collapses to `classic` when < 2 image attachments
  exist). Curators pick freely; the variant is a presentation
  choice, not a content constraint.
- **Don't write a new variant without registering it in EVERY
  table** — `CARD_VARIANTS`, `VARIANT_DEFAULT_SIZE`,
  `VARIANT_LABEL`, `VARIANT_DESCRIPTION`, `VARIANT_MAX_W`,
  `VARIANT_MIN_W`, `VARIANT_MAX_H`, `VARIANT_MIN_H`, the
  `<CardRenderer>` switch, the picker preview, the migration's
  CHECK constraint. Miss one and the build will be fine, but
  the curator's pick won't render.

## Reusability checklist

Likely next adopters inside OmniFrame:

- **A future Standard Work template browser** that wants per-template
  hero / banner / spotlight variants.
- **Cycle Count work-queue "chooser" surfaces** — if the per-zone
  list grows beyond a flat strip, a bento with banner-for-priority
  and gallery-for-photo-rich-tasks reads better.
- **Customer Portal announcement / ticket-spotlight surface** —
  same shape applies: list of heterogeneous items, curator-edited,
  variant choice per item.

When graduating to a second consumer, lift the dedicated table to
a generic shape (rename `production_board_card_layouts` columns to
drop the `board_kind` enum constraint and accept any string) OR
spin a parallel `<feature>_card_layouts` table if RLS divergences
don't justify a shared table.

The `<BentoGrid>` + variant cards are already feature-generic; only
the shell (`<BentoBoardShell>`) is production-boards-specific.

## Related

- [[Implementations/Implement-Production-Boards-Bento-Layout]] — first application, full file inventory + diff.
- [[Decisions/ADR-Production-Boards-Bento-Layout-Persistence]] — schema decision + library decision.
- [[Patterns/Production-Boards-Post-Composer]] — the editor pattern the variant picker mounts inside.
- [[Patterns/Editable-Board-Dialogs]] — the dialog the variant picker section lives inside.
- [[Patterns/Editable-Board-Sheets]] — the older sibling pattern for simpler editors.
- [[Patterns/TV-Viewport-Fit-Grid]] — viewport-fit chain to apply if the bento needs to fit a TV snapshot without scroll.
- [[Components/ProductionBoards - Feature Module]] — the host feature module.


---

## v2 aesthetic overhaul (2026-05-17)

Same-day follow-on. The v1 engineering above (schema, drag/resize, variants, picker, composer integration) is preserved verbatim — v2 is a **visual-only** layer on top.

The visual recipe lives in the sibling pattern [[Premium-Board-Aesthetic]] (typography, per-kind accents, depth/glass, motion, atmosphere, empty state, header chrome). The ADR with reference designs + anti-patterns is [[Decisions/ADR-Production-Boards-Aesthetic-Overhaul]]; the implementation note is [[Implement-Production-Boards-Aesthetic-Overhaul]].

What changed inside this pattern's surface area:

- **Variant cards** rebuilt with the editorial cascade (eyebrow → headline → support → meta). Banner adds an 18s Ken Burns + kind-tinted 4th hover-shadow stop + edge-faded marquee. Gallery jumps from 300ms opacity crossfade to 600ms `blur+opacity` + glass caption panel + accent-painted dot-pager. Spotlight redesigned as an Apple-style featured tile (icon bubble + halo + display headline). Quote refined into a true display blockquote.
- **BentoGrid surface** — gap bumped to `gap-5 lg:gap-6`, cell-height multiplier tuned for more "tile" / less "row" feel, mount stagger via `motion-safe:animate-in` + inline `animationDelay` per tile (60ms × idx, capped at 8), drag-grip + resize-corner handles redesigned with glass + accent ring (still hover-revealed only).
- **Atmosphere layer** — new `<BoardAtmosphere boardKind={...}>` paints a slow-rotating conic mesh + two drifting radial blooms + SVG turbulent grain at `-z-10` behind the grid. Pure CSS keyframes, zero JS, zero bundle cost. Renders inside the per-board container. The atmosphere is what makes a board with zero/one card feel intentional rather than desolate — pair it with `<BoardEmptyState>`.
- **Empty state** — `<BoardEmptyState boardKind={...} onCompose={...}>` replaces the tiny shadcn `<Card>` + one-line "No items" treatment with a 32rem accent halo + concentric-rings artwork + display headline + support paragraph + gradient CTA.
- **Header chrome** — `<BoardHeader>` + `<BoardFilterChips>` + `<LivePulse>` primitives replace the per-board duplicated header markup. The page header collapses to a slim h-12 inline row; the global tab strip drops its heavy container and becomes an inline segmented control with per-kind gradient underlines.
- **Per-kind palette** — `board-kind-accent.ts` is the single source of truth. Four kinds × `from / mid / to` hex + glow soft/strong rgba + Tailwind class strings (eyebrow / pulse / tab). The same palette feeds the atmosphere mesh, the empty-state artwork, the active tab underline, the banner hover shadow, the compose CTA, the "Display on TV" button.

When extending the bento to a new feature outside production-boards (e.g. customer-portal announcements, HR self-service company news), pair the v1 layout recipe above with the v2 aesthetic recipe in [[Premium-Board-Aesthetic]]. The two patterns are designed to be adopted together — the bento handles *layout* (grid, drag, variants, schema); the premium aesthetic handles *voice* (typography, color, depth, motion, atmosphere).

