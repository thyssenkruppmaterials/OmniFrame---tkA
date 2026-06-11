---
tags: [type/decision, status/active, domain/frontend, domain/database]
created: 2026-05-17
---
# ADR — Production Boards Bento Card Layout Persistence (migration 307)

## Purpose / Context

2026-05-17 brought a brief on top of the same-day Post Composer slice
([[Implement-Production-Boards-Post-Composer]]): the four secondary
Production Boards (Announcements / HR News / Jobs / Safety Alerts)
rendered as a plain `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` strip
of identical PostCards. The user request was for a **resizable,
draggable, multi-variant bento mosaic** with banners, rotating
image galleries, spotlight cards, pull-quotes, and a curator-editable
per-card grid placement.

This ADR records the schema + library decisions made to ship the
bento. Implementation lives at
[[Implement-Production-Boards-Bento-Layout]] and the reusable recipe
at [[Patterns/Bento-Grid-Layout]].

## Decision

Three decisions land together:

1. **One per-org table** (`production_board_card_layouts`) keyed by
   `(organization_id, board_kind, scope, post_kind, post_id)`. Stores
   `grid_x/y/w/h`, `card_variant`, `variant_config JSONB`,
   timestamps. RLS mirrors `production_board_posts` (org-scoped read,
   `production_boards:edit` for writes). Polymorphic `post_id` (no FK)
   with a pair of `AFTER DELETE` triggers on the two posts tables to
   clean orphans.
2. **`@dnd-kit/core` + hand-rolled pointer-event resize handles** for
   the BentoGrid surface, instead of `react-grid-layout`. Lazy-loaded
   via a new `feature-production-boards-bento` chunk (~75 KB).
3. **Per-board × per-scope layouts** (`scope` defaults to `'all'`, but
   the table accepts any per-org-meaningful key — e.g. a working area
   code, a branch slug). The four boards currently all use `'all'`;
   the column was provisioned so the per-area variant we already see
   in the Hourly board can be implemented for the content boards
   without another migration.

## Schema — migration 307

Full migration body in `supabase/migrations/307_production_boards_card_layouts.sql`.
Key shape:

```sql
CREATE TABLE production_board_card_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  board_kind TEXT NOT NULL CHECK (board_kind IN
    ('announcement','hr_news','job','safety_alert')),
  scope TEXT NOT NULL DEFAULT 'all',
  post_id UUID NOT NULL,  -- intentional: no FK (see below)
  post_kind TEXT NOT NULL CHECK (post_kind IN ('post','job')),
  grid_x INTEGER NOT NULL DEFAULT 0,
  grid_y INTEGER NOT NULL DEFAULT 0,
  grid_w INTEGER NOT NULL DEFAULT 3,
  grid_h INTEGER NOT NULL DEFAULT 2,
  card_variant TEXT NOT NULL DEFAULT 'classic'
    CHECK (card_variant IN ('classic','banner','gallery','spotlight','quote')),
  variant_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT production_board_card_layouts_unique
    UNIQUE (organization_id, board_kind, scope, post_kind, post_id)
);
```

### Orphan cleanup

`post_id` deliberately has no FK because it must reference either
`production_board_posts` OR `production_board_job_postings`. Two
`AFTER DELETE` triggers on those tables call
`cleanup_orphan_{post,job}_card_layouts()` which delete by
`(organization_id, post_kind='post'|'job', post_id)`. Both functions
are `SECURITY DEFINER` with `SET search_path = public, pg_temp` and
`REVOKE EXECUTE FROM PUBLIC, anon, authenticated` (silences the same
advisor warnings the SQCDP migration 306 cleared).

### `variant_config` JSONB shape

Narrow per-variant:

- `banner`: `{ cover_position?: 'top' | 'center' | 'bottom' }`
- `gallery`: `{ rotate_interval_seconds?: 3..30 }`
- `classic` / `spotlight` / `quote`: `{}` (no config keys today)

Parsed defensively by `parseVariantConfig(variant, raw)` —
unknown keys / out-of-range values are dropped rather than thrown.

## Alternatives considered

### A) Store layout inline as `card_layout` JSONB on the posts tables

Would have required two `ALTER`s (one on `production_board_posts`,
one on `production_board_job_postings`) AND the per-scope dimension
(`'all'` vs `area_code`) wouldn't fit naturally on a single-row
post — we'd either have to store an array of layouts per row
(unwieldy) or accept one layout per post (loses the per-area
flexibility).

The dedicated table also lets us implement "reset board layout" with
a single `DELETE … WHERE organization_id = ? AND board_kind = ? AND
scope = ?` instead of running an `UPDATE posts SET card_layout = NULL`
across two tables.

### B) `react-grid-layout` instead of `@dnd-kit` + hand-rolled resize

`react-grid-layout` is battle-tested with built-in resize handles
and multi-breakpoint support. Rejected because:

- ~70 KB gzip would push `feature-shift-productivity` over the 500 KB
  per-chunk budget (currently at 473 KB) AND would force a vendor
  carve-out for the library itself.
- Known React 19 strict-mode issues with the library's internal
  `ReactDOM.findDOMNode` calls — the project ships React 19, so we'd
  have to either suppress warnings or pin to a fork.
- `@dnd-kit/core` + `@dnd-kit/sortable` are already in the project's
  dep tree (used by the composer's attachment uploader and the SQCDP
  sub-metrics editor) — no new dep, no bundle inflation.
- The hand-rolled resize handle is ~80 LOC of pointer-events code
  shaped just like the existing `composer-resizable-shell.tsx`
  (which the composer uses for the same kind of drag-to-resize).

The trade-off is that the multi-axis drag and the resize affordance
are two separate primitives instead of one library's unified API.
The `<BentoGrid>` component encapsulates both behind one prop
surface; consumers don't see the seam.

### C) Unified polymorphic posts table

Would obviate the polymorphic `post_id` problem. Rejected for the
same reason migration 305's [[ADR-Board-Posts-Schema-Extension]] §
Alternatives § A rejected it: jobs have ~25 fields most of which are
NULL for non-job posts, the editor's per-kind branching would balloon,
and the schemas have diverged enough that one table loses more than
it gains.

### D) Single `card_variant` column on the posts tables, separate `layouts` table for x/y/w/h only

Would let the composer write the variant choice directly to the
posts table (no separate upsert). Rejected because the variant
choice can be **per-board-area** in the future (the same post showing
as a `banner` on the area-wide TV but as a `classic` on the per-shift
rotation, say). Keeping the variant on `production_board_card_layouts`
alongside the placement keeps the per-scope dimension consistent
across the variant + the geometry.

The composer still writes a *hint* to `kind_data.card_variant` so
the first-paint default (before any layout row exists for a brand-
new post) matches the curator's pick. The bento shell consumes that
hint via `variantHintFromPost(post)` and persists the actual choice
to `production_board_card_layouts` on the next drag.

## Consequences

- **Per-board read paths gain one extra query** (the layouts hook).
  Same 60s visibility-gated polling cadence as the posts hooks, no
  realtime channel (per the workspace Realtime Policy in
  `Master Rule workspace rule`).
- **A future area-scoped variant of the content boards** (the way
  the Hourly board already cycles areas) lands by just passing a
  different `scope` value to `useBoardCardLayouts(boardKind, scope)`.
  No schema change needed.
- **The composer's preview pane still renders a single "classic"-
  shaped card** — the bento variants only kick in on the board
  surface. The trade-off is a minor preview / production mismatch
  for `banner` and `gallery` curators; the picker's tiny visual
  sketches in the Details tab carry most of the explanation, and
  the curator can navigate to the actual board to see the full
  variant render.
- **Drag affordances are gated on `editMode && !isTv`** — TV mode
  inherits the read-only render path so the chrome never appears on
  shop floor displays.
- **Reset is destructive but recoverable** — "Reset layout" deletes
  every layout row for `(board, scope)`. The next render falls back
  to the default auto-place. Posts themselves are untouched.

## Related

- [[Implementations/Implement-Production-Boards-Bento-Layout]] — the implementation note (files, hook shape, lazy chunk, tests).
- [[Patterns/Bento-Grid-Layout]] — the reusable recipe extracted from this work.
- [[Implementations/Implement-Production-Boards-Post-Composer]] — sibling slice from earlier the same day; the variant picker mounts inside its Details tab.
- [[Decisions/ADR-Board-Posts-Schema-Extension]] — migration 305 (sibling additive schema; this one is its content-display companion).
- [[Components/ProductionBoards - Feature Module]] — the surface the bento lives on.
- [[Patterns/TV-Viewport-Fit-Grid]] — pattern the bento extends (the TV-rendered bento inherits the column-flex viewport-fit chain).
- [[Patterns/Editable-Board-Dialogs]] — pattern the composer uses; the variant picker is a Section inside that dialog's Details tab.
