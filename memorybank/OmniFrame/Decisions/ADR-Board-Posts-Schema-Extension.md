---
tags: [type/decision, status/active, domain/database, domain/frontend]
created: 2026-05-17
---
# ADR — Production Boards content tables: composer extensions (migration 305)

## Purpose / Context

Production Boards' four content boards (Announcements, HR News, Jobs,
Safety Alerts) shipped in v6 (see [[Components/ProductionBoards - Feature Module]])
with per-board right-side `<Sheet>` editors backed by two tables:
`production_board_posts` (scopes: announcement / hr_news / safety_alert)
and `production_board_job_postings` (jobs). 2026-05-17 brought a brief to
build a comprehensive, resizable, *shared* post composer that hosts all
four kinds with rich extras (scheduling, attachments, per-kind sections,
drafts, priority).

The two tables already supported the shared cases (org-scoping, title /
body / colour / image_url, expires_at / closes_at, severity, ack flag),
but were missing six concerns the new composer needed:

1. **Schedule + lifecycle:** drafts vs published, plus the existing
   `expires_at` was usable but not paired with a future-dated `publish_at`
   semantically; `published_at` defaults to `now()` and serves both roles.
2. **Attachments:** multi-file uploads beyond a single image_url.
3. **Per-kind extras** that don't earn a dedicated column today (job pay
   range, safety hazard type, HR news author byline, announcement marquee
   flag, …).
4. **Curator-controlled priority** beyond the boolean `is_pinned`.
5. **Alert-timer / re-prompt** for safety alerts that need recurring
   acknowledgement.
6. **Active-only read paths** that bake the timer semantics into a view
   so each board doesn't reinvent the filter.

## Decision

Extend both tables with the same uniform columns (additive, no
destructive changes), expose two active-only views, and reuse the
existing `production-board-images` storage bucket for attachments
(extended to also accept PDFs). The composer dialog branches on `kind`
and persists to whichever underlying table that kind backs.

### Columns added to `production_board_posts`

| Column | Type | Default | Purpose |
|---|---|---|---|
| `is_published` | BOOLEAN NOT NULL | TRUE | Draft toggle |
| `priority` | TEXT NOT NULL | `'normal'` | One of low/normal/high/pinned (CHECK) |
| `attachments` | JSONB NOT NULL | `'[]'` | Ordered Attachment[] |
| `kind_data` | JSONB NOT NULL | `'{}'` | Per-kind extras bag |
| `reprompt_interval_minutes` | INTEGER | NULL | 5..10080 (CHECK) |

### Columns added to `production_board_job_postings`

Same as above MINUS `reprompt_interval_minutes` (only meaningful for
safety alerts).

### Views

- `v_active_board_posts` — filters `is_published = true AND published_at <= now() AND (expires_at IS NULL OR expires_at > now())`.
- `v_active_board_jobs` — filters `is_published = true AND posted_at <= now() AND (closes_at IS NULL OR closes_at > now())`.

Both views are declared `WITH (security_invoker = true)` so RLS is
enforced against the **calling user**, not the view owner (the default
pre-PG15 behaviour). This was flagged by the Supabase advisor on first
apply; the migration was updated to set the option explicitly.

### Storage bucket

The existing `production-board-images` bucket is reused. Its
`allowed_mime_types` whitelist is extended to also accept
`application/pdf`, and its `file_size_limit` bumped from 5 MiB to 10 MiB
to fit a 10-page toolbox-talk PDF. RLS is unchanged — still gated on
`public.has_permission('production_boards', 'edit')`.

Path convention changed from the legacy flat `{org_id}/{uuid}.{ext}` to
`{org_id}/{post_or_draft_id}/{uuid}.{ext}` so attachments cluster
per-post and a future delete-post can recursively clean up the folder.
Legacy single-image uploads still validate against the same RLS.

### Backfill

The migration runs one UPDATE: `priority = 'pinned' WHERE is_pinned = true`.
This sync keeps the composer's priority chip and the existing PostCard's
pinned badge consistent on first load. The reverse (composer setting
`priority = 'pinned'` also setting `is_pinned = true`) is handled by the
hook's update path — see [[Implement-Production-Boards-Post-Composer]] § 4.

## Alternatives considered

### A) Unify both tables into a single polymorphic table

Merging `production_board_posts` and `production_board_job_postings`
into one table with a `kind` discriminator would have shrunk the hook
surface to one mutation path. Rejected because:

- The jobs schema (department, requirements, apply_url, apply_email,
  is_internal, closes_at) is wide enough that the merged table would be
  ~25 columns, most NULL for most rows.
- The Editable-Board-Sheets pattern note explicitly calls this out:
  > Don't deduplicate the editor across boards with different schemas.
  > Jobs (`production_board_job_postings`) and posts
  > (`production_board_posts`) have very different fields; the shared
  > abstraction would have more conditional branches than each editor
  > has lines of code. — [[Patterns/Editable-Board-Sheets]] § Don't
- The SHARED part of the composer is the dialog shell + scheduling +
  attachments + draft/priority. Those are now uniform via the additive
  migration; the dialog branches at the kind layer (a 4-way switch) and
  the two tables stay distinct.

### B) Put per-kind extras in dedicated columns instead of `kind_data` JSONB

For cases where a value is well-defined and queried often (e.g. job
`closes_at` filter), JSONB hurts query performance and forfeits CHECK
constraints. For experimental / per-kind / display-only fields (job pay
range, safety hazard type, HR news author byline), JSONB is the right
shape — adding a new field is a code-only change, not a migration.

The rule we settled on: **promote a `kind_data` key to a dedicated
column the moment any board queries against it.** For v1 of the
composer, every `kind_data` field is display-only on the card, so JSONB
is the right tradeoff.

### C) Keep the legacy `<PostEditorSheet>` / `<JobEditorSheet>` and add a sibling composer

Rejected. Two editors per kind is more surface area to maintain, and the
side-by-side preview / resizable shell make sense for ALL editors, not
just the new ones. The legacy sheets were deleted in the same patch; if
a curator wants the compact side-panel UX in the future, we'll lift the
shell shape (sheet) out of the composer rather than rebuilding the
sheet's form fields.

## Consequences

- **Boards quietly inherit timer semantics** by switching their read
  paths to `v_active_board_posts` / `v_active_board_jobs`. (Not done in
  this slice — out of scope; the hooks still hit the raw tables so the
  edit mode can show drafts. A future slice will add `?showAll=1` to
  the boards and switch the public read paths to the views.)
- **Attachment storage paths** changed shape. Legacy `imageUrl` rows
  still work; new uploads land at `{org_id}/{post_id}/{uuid}.{ext}`.
- **`is_pinned` + `priority` redundancy** — the existing PostCard reads
  `is_pinned` for the badge; the composer reads `priority`. The hook's
  update path keeps them in sync (`priority === 'pinned'` ⇔
  `is_pinned = true`). Future consumers should prefer `priority`; the
  boolean is grandfathered.
- **No new Realtime channels** — the composer invalidates TanStack
  queries on save and the boards keep their 60s visibility-gated poll
  (per the workspace Realtime Policy). The view-based reads pick up
  scheduled posts on the next poll automatically.

## Related

- [[Implement-Production-Boards-Post-Composer]] — the implementation note covering the dialog + hook extensions + tests + screenshots.
- [[Patterns/Production-Boards-Post-Composer]] — the reusable recipe.
- [[Components/ProductionBoards - Feature Module]] — the surface this extension lands inside.
- [[Patterns/Editable-Board-Dialogs]] — the v12.3 side-by-side recipe the composer's shell extends.
- [[Patterns/Editable-Board-Sheets]] — the older sheet recipe; relevant for the "don't deduplicate cross-schema" rule the composer respects.
