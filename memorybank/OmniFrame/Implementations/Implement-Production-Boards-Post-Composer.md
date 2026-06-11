---
tags: [type/implementation, status/active, domain/frontend, domain/database]
created: 2026-05-17
---
# Implement — Production Boards Post Composer

## Purpose / Context

Unified the four per-board editors (Announcements / HR News / Jobs /
Safety Alerts) on the Production Boards page into a single, resizable
`<PostComposerDialog>` with rich extras: drag-drop attachments,
schedule / expire DateTimePickers, draft / publish lifecycle,
curator-controlled priority, per-kind sections (announcement marquee +
CTA / HR news author byline / job pay range / safety alert hazard type +
corrective action), templates, live preview, dirty-exit gate, and
keyboard shortcuts.

Reference component: [[Components/ProductionBoards - Feature Module]].
Pattern note: [[Patterns/Production-Boards-Post-Composer]].
Schema ADR: [[ADR-Board-Posts-Schema-Extension]].

Replaces the v6 `<PostEditorSheet>` and `<JobEditorSheet>` (both
deleted in the same patch). Both legacy sheets had ≈30 LOC of unique
UX logic each; the new dialog absorbs both into ~1100 LOC of shared
shell + 4 thin per-kind sections (≈ 80–150 LOC each).

## Files

### Added

```
supabase/migrations/305_production_boards_composer_extensions.sql      — see ADR
src/features/shift-productivity/production-boards/
  components/
    post-composer-dialog.tsx                            — the dialog (≈1080 LOC)
    post-composer-dialog.test.tsx                       — 7 smoke tests
    composer/
      composer-types.ts                                 — ComposerValues, parsers, status helpers
      composer-types.test.ts                            — 20 unit tests (status / defaults / parsers)
      composer-templates.ts                             — starter templates per kind
      composer-attachment-uploader.tsx                  — drag-drop + dnd-kit reorder
      composer-date-time-picker.tsx                     — Calendar + time input pair
      composer-resizable-shell.tsx                      — corner-handle resize + localStorage
      composer-preview.tsx                              — live preview card mirror
      section.tsx                                       — the bordered-section helper
      sections/
        announcement-section.tsx                        — marquee + CTA URL/label
        hr-news-section.tsx                             — author + category toggle
        job-section.tsx                                 — dept + employment type + pay + apply + requirements
        safety-alert-section.tsx                        — hazard + affected areas + corrective action
```

### Modified

```
src/features/shift-productivity/production-boards/
  hooks/use-board-posts.ts                              — PostRow + CreatePostInput gain attachments/kindData/priority/isPublished/repromptIntervalMinutes
  boards/jobs/hooks/use-job-postings.ts                 — same set of fields
  boards/announcements/announcements-board.tsx          — swap PostEditorSheet → PostComposerDialog
  boards/hr-news/hr-news-board.tsx                      — same swap
  boards/jobs/jobs-board.tsx                            — swap JobEditorSheet → PostComposerDialog (kind='job')
  boards/safety-alerts/safety-alerts-board.tsx          — same swap
  index.ts                                              — export PostComposerDialog, drop PostEditorSheet
```

### Deleted

```
src/features/shift-productivity/production-boards/components/post-editor-sheet.tsx
src/features/shift-productivity/production-boards/boards/jobs/components/job-editor-sheet.tsx
```

## Schema migration (305) at a glance

Additive only. Two tables gain the same columns; one view per kind
bakes in the active-only filter; the existing storage bucket is
extended to accept PDFs. Full reasoning is in
[[ADR-Board-Posts-Schema-Extension]].

```sql
ALTER TABLE production_board_posts
  ADD COLUMN is_published BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN kind_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN reprompt_interval_minutes INTEGER;
-- plus matching CHECK constraints (priority enum-like, reprompt 5..10080)

ALTER TABLE production_board_job_postings
  ADD COLUMN is_published BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN kind_data JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE VIEW v_active_board_posts WITH (security_invoker = true) AS
  SELECT * FROM production_board_posts
  WHERE is_published = TRUE AND published_at <= NOW()
    AND (expires_at IS NULL OR expires_at > NOW());

CREATE VIEW v_active_board_jobs WITH (security_invoker = true) AS
  SELECT * FROM production_board_job_postings
  WHERE is_published = TRUE AND posted_at <= NOW()
    AND (closes_at IS NULL OR closes_at > NOW());

UPDATE storage.buckets
  SET allowed_mime_types = ARRAY[
        'image/jpeg','image/png','image/webp','image/gif','application/pdf'
      ]::text[],
      file_size_limit = 10485760
  WHERE id = 'production-board-images';
```

Backfill: `priority = 'pinned' WHERE is_pinned = true` so the composer's
priority chip and the existing PostCard pinned badge stay consistent
on first load. The composer's update path then keeps both in sync
(`priority === 'pinned'` ⇔ `is_pinned = true`).

**Security-invoker note:** the views were initially created without the
explicit `WITH (security_invoker = true)` option. The Supabase advisor
flagged this as a `security_definer_view` ERROR because pre-PG15 views
run with owner privileges (bypassing RLS). The migration was updated
before landing to set the option explicitly so the views inherit the
underlying table's RLS against the *calling* user.

## Frontend architecture

### Discriminated union for mode

```ts
type ComposerMode =
  | { type: 'create' }
  | { type: 'edit'; post: PostRow }
  | { type: 'edit-job'; job: JobPostingRow }
```

The initial-values builder branches on `mode.type`; the persistence
layer branches on `kind` + `mode.type`. Hooks are instantiated
unconditionally at the top of the component (React's rules-of-hooks);
the wrong-table hook is just never invoked.

### Shared types live in `composer-types.ts`

- `ComposerValues` is the canonical in-memory shape (16 fields + a
  per-kind bag + 5 job-only mirror fields). The hook adapters at
  persistence translate to the per-table column shapes.
- Parsers: `parseAttachments(raw)` and `parseKindData(kind, raw)` are
  *tolerant of partial / malformed input* — they drop unknown / typed-
  incorrectly fields rather than throwing, so a hand-edited row can't
  break the editor.
- Status helpers: `deriveStatus(values, now?)` and
  `describeActiveWindow(values, now?)` are pure and unit-tested. The
  dialog header chip + preview card both consume them.
- Default factories: `defaultsForKind(kind)` and `defaultKindData(kind)`
  encode per-kind opinions (safety alerts default to ack-required +
  warning severity, jobs default to full-time + internal, etc.).

### Resizable shell

`ComposerResizableShell` uses pointer events (not mouse) so the corner
handle works on warehouse tablets. Persisted size is clamped on every
`window resize` so a smaller monitor never strands a big persisted
size. localStorage key is `omniframe.post-composer.${kind}` so each
kind remembers its own ideal dimensions.

Why not `react-resizable-panels`? Tuned for split panes inside an app,
not one-off dialog resizing; adds ~12 KB; the corner-handle recipe is
~80 LOC. The composer's shell is the only consumer.

### Attachments

- Drag-drop zone + click-to-browse.
- `@dnd-kit/core` + `@dnd-kit/sortable` for reorder (already in deps
  via SQCDP). `rectSortingStrategy` because the preview is a grid.
- Per-item caption (`<Input>`).
- Storage path convention: `{org_id}/{post_or_draft_id}/{uuid}.{ext}`
  so attachments cluster per-post.
- Bucket scope: real `row.id` on edit, stable `crypto.randomUUID()`
  generated once per composer open on create.
- Delete is best-effort storage cleanup + always-remove row so a
  forbidden orphan can still be cleared from the row.
- Image dimensions measured via `URL.createObjectURL` + `Image`
  (best-effort; stored on the attachment for future layout hints).

### DateTimePicker

Thin pair of shadcn `<Calendar>` (popover) + native `<input type='time'>`.
Serialises to ISO. `minDate` prop powers the "Expires at must be after
Publish at" guard (the Expires picker passes
`new Date(values.publishAt ?? Date.now())`).

Not promoted to `components/ui/` yet — only consumer is the composer.

### Tabs

Four tabs cross the
[[Editable-Board-Dialogs]] § "When to add tabs to the dialog body"
threshold (4+ sections of unrelated form fields):

- **Details** — title + body + severity + priority + accent + per-kind
  section(s).
- **Media** — the attachment uploader.
- **Schedule** — publish at / expires at / published toggle.
- **Audience** — working area / branch.

Attachment count appears as a small chip on the Media tab trigger
when > 0.

### Status chip + active window

Header renders:

- Kind icon + "Edit / New {kind}" title.
- Active-window descriptor as the dialog description ("Live for 3d 4h"
  / "Scheduled for Tue, May 19 · 8:00 AM" / etc.).
- Status chip (Draft / Scheduled / Live / Expired) with kind-coloured
  badge variants.
- Preview toggle (⌘ P).
- Templates dropdown (per kind).
- Close button (routes through dirty-confirm).

### Per-kind sections

Four files, all roughly the same shape: accept `kindData` + `onChange`,
render the kind-specific fields in `<Section>` blocks.

- **AnnouncementSection** — marquee toggle + CTA URL/label.
- **HrNewsSection** — category ToggleGroup + author name + avatar URL.
- **JobSection** — 4 sections (Job details / Pay range / How to apply /
  Requirements); also receives `onShellChange` for the job-shell
  fields that live on `ComposerValues` directly (department, apply
  URL/email, requirements, is_internal).
- **SafetyAlertSection** — hazard type Select + affected-areas
  MultiSelect + corrective action Textarea.

Safety alerts ALSO get an Acknowledgement section in the Details tab
(re-prompt interval input gated on `acknowledgmentRequired === true`).

## Hook extensions

`useBoardPosts` + `useJobPostings` both gained:

- New row-type fields: `isPublished`, `priority`, `attachments[]`,
  `kindData`, plus `repromptIntervalMinutes` (posts only).
- New `RawPost` / `RawJob` columns + SELECT cols.
- `parseAttachmentsLoose` / `parsePriority` (private to each hook).
- INSERT + UPDATE mutations forward all new fields. The post UPDATE
  also keeps `is_pinned` in sync with `priority === 'pinned'` when the
  caller sets priority but not the boolean explicitly.

The hooks still poll at 60s (visibility-gated, unchanged) and still
hit the raw tables (not the new views) so the admin / editor flow can
see scheduled and expired posts. A follow-up slice will switch the
public read paths to `v_active_board_posts` / `v_active_board_jobs`
and add a `?showAll=1` admin toggle.

## Validation

- `pnpm tsc -b --noEmit` clean.
- `pnpm eslint src/features/shift-productivity/production-boards/` clean.
- `pnpm vitest run src/features/shift-productivity/production-boards/`
  — **20 test files, 242 tests, all passing**. Includes:
  - 20 new `composer-types.test.ts` cases (status / defaults / parsers).
  - 7 new `post-composer-dialog.test.tsx` smoke cases (renders per-
    kind sections, resize handle, preview card, dirty gate).
- Full repo `pnpm vitest run` shows 25 pre-existing failures in the
  RBAC / security suites (confirmed via `git stash --keep-index`); none
  are related to this work.
- Supabase advisor: the two new views were flagged as
  `security_definer_view` on first apply; fixed in the migration via
  `WITH (security_invoker = true)`.
- No new ESLint warnings (lint-ratchet not exercised; touched files
  are clean).

### Bundle budget impact

The composer landed as its own lazy-loaded chunk via a `manualChunks`
carve-out in `vite.config.ts`:

```
feature-production-boards-composer-<hash>.js   119.90 kB   gzip:  37.16 kB    (lazy, NEW)
feature-shift-productivity-<hash>.js           470.77 kB   gzip: 100.03 kB    (parent, was 478.42 KB pre-change)
```

Without the carve-out, the composer code would have collapsed into
`feature-shift-productivity` and busted the 500 KB first-party chunk
budget (587 KB observed during the first build pass). The carve-out
matches both `post-composer-dialog.tsx` and the `composer/` subdir so
the attachment uploader / preview / per-kind sections / DateTimePicker
all land in the same lazy chunk.

The four boards use `React.lazy(() => import(...).then(m => ({ default: m.PostComposerDialog })))`
and only render the `<Suspense>`-wrapped composer when `editor.open === true`,
so the chunk fetch happens at click-time, not on board navigation.

Three pre-existing chunks remain over budget (`warehouse-location-map`,
`feature-admin`, `feature-rf-interface`) — unrelated to this slice.



## Open follow-ups

- **Switch the public board read paths to the new views** so timer
  semantics apply for free. Pair with a `?showAll=1` admin toggle so
  editors can still see drafts / scheduled / expired posts.
- **Reactions / read counts** — out of scope for v1. The `attachments`
  + `kind_data` shapes are forward-compatible.
- **Promote `ComposerResizableShell` + `ComposerDateTimePicker` to
  `components/ui/`** if a second consumer lands (cycle-count scheduler
  is a likely candidate).
- **Promote `<Section>` to `components/ui/section.tsx`** if a third
  consumer beyond the SQCDP editor + this composer adopts it.
- **Rich-text body** — currently `<Textarea>` with whitespace preserved.
  Tiptap would be ≈ 80 KB additional bundle weight; defer until
  curators ask. The `bodyFormat` field on `ComposerValues` is reserved
  for the eventual `'markdown'` flag.
- **Templates** are file-constants today; persist to a DB table only if
  curators ask for editable templates.
- **Image alt text override** — today the alt is `caption ?? file_name`.
  A future a11y pass could add a dedicated alt-text input for screen-
  reader-critical content.

## Related

- [[Patterns/Production-Boards-Post-Composer]] — the recipe extracted
  from this work.
- [[ADR-Board-Posts-Schema-Extension]] — the migration decision.
- [[Components/ProductionBoards - Feature Module]] — the surface this
  lands on.
- [[Patterns/Editable-Board-Dialogs]] — the v12.3 side-by-side recipe
  the shell extends.
- [[Patterns/Editable-Board-Sheets]] — the v6 sheet recipe the
  composer replaces for these four boards.
- [[Realtime-Subscription-Hygiene]] — why the composer doesn't add a
  realtime channel for the alert-timer reprompt.
