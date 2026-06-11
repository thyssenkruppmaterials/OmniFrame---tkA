---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-17
---
# Production Boards Post Composer

## Purpose / Context

The canonical recipe for a *unified, kind-discriminated, resizable*
editor dialog shared by N boards that store related-but-not-identical
content. Surfaced from the Production Boards content boards work
(Announcements / HR News / Jobs / Safety Alerts) where four per-board
`<Sheet>` editors were collapsed into a single `<PostComposerDialog>`.

This pattern is the **third sibling** to [[Editable-Board-Sheets]]
(simple right-side Sheet, ≤ 5 fields) and
[[Editable-Board-Dialogs]] (centred Dialog, ≥ 6 fields / tabs / preview /
embedded subsystem). The third level kicks in when ALL of these hold:

1. **≥ 3 distinct content kinds share a host dialog** (here: 4 —
   announcement / hr_news / job / safety_alert).
2. **The shared parts genuinely dominate** — title, body, scheduling,
   attachments, audience, priority, accent are common; per-kind extras
   are small bags of optional fields.
3. **A live preview is in play** and reflects in-flight edits across all
   kinds.
4. **At least one kind has compositional extras** (attachments, alert
   timers, drag-to-reorder collections) that the simpler shell recipes
   would have to grow tabs / subsystems for anyway.

If < 3 kinds, prefer [[Editable-Board-Dialogs]] with a per-kind
discriminator inside the form body. If the kinds have *very different*
schemas, prefer per-kind editors (see [[Editable-Board-Sheets]] § Don't).

## The Recipe

### 1. Kind discriminator at the type layer

```ts
export type PostKind = 'announcement' | 'hr_news' | 'job' | 'safety_alert'

export interface ComposerValues {
  kind: PostKind
  // ——— Shared shell fields (every kind populates) ———
  title: string; body: string; bodyFormat: 'plain' | 'markdown'
  priority: 'low' | 'normal' | 'high' | 'pinned'
  isPublished: boolean
  accentHex: string | null
  publishAt: string | null; expiresAt: string | null
  attachments: Attachment[]
  // ——— Post-only fields (null for jobs) ———
  severity: SafetySeverity
  workingAreaId: string | null; branchId: string | null
  acknowledgmentRequired: boolean
  repromptIntervalMinutes: number | null
  // ——— Per-kind extras bag (JSON-persisted) ———
  kindData: AnnouncementKindData | HrNewsKindData | SafetyAlertKindData | JobKindData
  // ——— Job-only fields (mirror columns on the jobs table) ———
  jobDepartment: string | null; jobRequirements: string | null
  jobApplyUrl: string | null; jobApplyEmail: string | null
  jobIsInternal: boolean
}
```

Key choices:

- The shared shape is **wide** but the per-kind bag is narrow and
  typed by kind (`KindData` is a discriminated union). The composer
  passes the kind to `parseKindData(kind, raw)` so the sanitiser drops
  unknown keys *per kind*.
- Job fields live on the canonical shape (prefix `job*`) rather than
  inside `kindData` because they map 1:1 to columns on the underlying
  table. `kindData` is reserved for display-only / experimental fields
  that don't earn a column today.
- Two parse helpers: `parseAttachments(raw)` and `parseKindData(kind, raw)`.
  Both tolerate malformed input rather than throwing so a hand-edited
  row can't break the editor.

### 2. Dual-target persistence via two hooks, one switch

Different kinds write to different tables. Instantiate BOTH hooks at the
top of the component (React's rules-of-hooks require stable hook counts)
and discriminate at the persistence boundary:

```ts
const postScope: PostScope = isPostScope(kind) ? kind : 'announcement'
const { createPost, updatePost, deletePost } = useBoardPosts(postScope)
const { createJob, updateJob, deleteJob } = useJobPostings()

// At submit time:
if (kind === 'job') {
  await persistJob({ values, mode, createJob, updateJob })
} else {
  await persistPost({ values, scope: postScope, mode, createPost, updatePost })
}
```

The `postScope` for non-post kinds (`'announcement'` as a sentinel) is a
harmless instantiation — the create/update mutations are never invoked
in the job path.

### 3. Resizable shell with per-kind localStorage key

Dialog dimensions persist across sessions via a kind-keyed
localStorage entry so each kind remembers its own ideal width / height
(safety alerts often want narrower for focus; jobs need wider for the
pay-range section).

```tsx
<ComposerResizableShell
  storageKey={`omniframe.post-composer.${kind}`}
  defaultWidth={Math.min(1240, window.innerWidth - 80)}
  defaultHeight={Math.min(780, window.innerHeight - 80)}
  minWidth={760}
  minHeight={520}
  className='bg-background border-border/60 flex flex-col overflow-hidden rounded-xl border shadow-2xl'
>
  ... dialog header / form / footer ...
</ComposerResizableShell>
```

The corner handle uses `pointerdown` / `pointermove` / `pointercapture`
(not `mousedown` — touch needs to work on warehouse tablets). Persisted
size is clamped on `window resize` so a smaller monitor never strands a
big persisted size.

Why not `react-resizable-panels`? Tuned for split panes inside an app,
not one-off dialog resizing; adds ~12 KB; the corner-handle recipe is
~80 LOC. The composer's shell is the only consumer.

### 4. Side-by-side preview / controls layout

Reuses the [[Editable-Board-Dialogs]] § v12.3 "side-by-side" recipe at
`md:` breakpoint:

```
┌─────────────────────────────────────────────┐
│ Header (icon + title + status chip + tools)  │
├───────────────┬─────────────────────────────┤
│ LIVE PREVIEW  │  TABS  (Details / Media / …) │
│   (left)      │  scrolling body              │
│   sticky      │                              │
│               │                              │
├───────────────┴─────────────────────────────┤
│ Footer:  Delete | Cancel | Save draft | Save │
└─────────────────────────────────────────────┘
```

The preview is collapsible (⌘ P keyboard shortcut). The composer
doesn't pull from the real `<PostCard>` / `<JobCard>` — those depend on
`useCanEditBoards` / `useBoardEditMode` and would render edit chrome
inside the preview. A lightweight `<ComposerPreview>` mirrors the card
shape but accepts `ComposerValues` directly.

### 5. Tab layout: Details / Media / Schedule / Audience

Four tabs (the threshold for promoting to tabs per
[[Editable-Board-Dialogs]] § "When to add tabs to the dialog body"):

| Tab | Contents |
|---|---|
| **Details** | Title / Body / Severity / Priority / Accent / per-kind sections |
| **Media** | `<ComposerAttachmentUploader>` (drag-drop, preview grid, reorder via dnd-kit, caption, delete) |
| **Schedule** | `<ComposerDateTimePicker>` for Publish at / Expires at + Published toggle |
| **Audience** | Working-area / branch selects (visible based on kind) |

The Details tab branches by kind to render the appropriate `<*Section>`
below the shared rows. Each per-kind section is its own file at
`components/composer/sections/*-section.tsx` and accepts the typed
`kindData` + an `onChange(next)` callback so the parent owns the
dispatch.

### 6. Attachment uploader with dnd-kit reorder

```tsx
<ComposerAttachmentUploader
  value={values.attachments}
  onChange={(next) => patch({ attachments: next })}
  organizationId={organizationId}
  bucketScope={isEdit ? row.id : draftId}
  maxFiles={8}
/>
```

Bucket scope strategy:

- **Create mode** — a stable per-open `crypto.randomUUID()` (the
  `draftId` state) so concurrent uploads cluster under one folder. On
  save, the row id and the draftId fork — the attachments stay under
  the draftId folder (no rename), which is fine because
  `storage_path` is persisted on the row.
- **Edit mode** — the real row id, so new attachments co-locate with
  the originals.

Drag handle uses `@dnd-kit/sortable` with `rectSortingStrategy` (works
in grid layouts). Reorder commits run through `commitAttachments()`
which re-numbers `display_order` from 0, so the persisted ordering is
always dense.

Delete is **best-effort storage cleanup + always-remove row** — if the
storage delete 403s (forbidden orphan after a permission change), the
attachment still gets removed from the row.

### 7. DateTimePicker built on shadcn `<Calendar>` + native time input

`<ComposerDateTimePicker>` pairs the existing `<Calendar>` primitive
(popover) with a `<input type='time'>` so both halves are picked in one
cell. Serialises to ISO; clearing both halves sets `null`. `minDate`
prop supports the "Expires at must be after Publish at" guard.

Not promoted to `components/ui/` yet — only consumer is the composer. If
a second consumer lands (e.g. the cycle-count scheduler), lift it.

### 8. Status chip + active-window descriptor (pure functions)

`deriveStatus(values, now?)` returns one of
`'draft' | 'scheduled' | 'live' | 'expired'` with a Tailwind badge
class. `describeActiveWindow(values, now?)` returns the prose
("Live for 3d 4h", "Expired 1h ago", "Scheduled for Tomorrow 8:00 AM").

Both are pure, take an optional `now` arg, and ship with unit tests —
the dialog header and the preview pane both consume them.

### 9. Confirm-if-dirty exit + dual-confirm delete

Same as [[Editable-Board-Dialogs]] § 7. `isDirty` flips on every `patch`
call (it wraps `setValues`). `attemptClose()` short-circuits to a
`<ConfirmDialog>` when dirty. Delete also routes through `<ConfirmDialog>`
with `variant='danger'`.

### 10. Templates dropdown in the header

Small "Start from template…" select per kind. Each template is a
shallow patch over `defaultsForKind(kind)` (so applying a template
leaves attachments and audience untouched). Templates live in
`composer-templates.ts` as constants; promote to a DB table only if
curators ask for editable templates.

### 11. Keyboard shortcuts

- ⌘/Ctrl+S — submit form (routes through `handleSubmit`).
- ⌘/Ctrl+P — toggle preview.
- ESC — (Radix default) opens dirty-confirm if dirty, else closes.

Key handler attached to `window` while `open === true`.

## Don't

- **Don't write a generic post-and-job-and-anything dialog.** This
  pattern is for 3–6 *related* kinds whose shared fields are wider than
  their differences. For unrelated workflows, build per-feature editors.
- **Don't inline the kind sections in the main file.** Each section
  lives at `sections/*-section.tsx` so the main composer stays
  scannable. The shared parts of the Details tab live on the shell.
- **Don't render the dialog when `open === false`.** The form state +
  upload state get carried; pass `open={...}` so they unmount.
- **Don't reach for `react-resizable-panels` for one dialog.** The
  corner-handle is 80 LOC and one consumer; the dep is overkill.
- **Don't promote `kind_data` keys to dedicated columns prematurely.**
  Add a column the moment a board queries against the key; until then,
  JSONB is the right tradeoff.
- **Don't deduplicate the dialog for kinds whose schemas are very
  different.** This pattern works for the four post-like kinds because
  their shared shape is 70%+ of fields. If the next "kind" is a kit
  build plan, build a separate editor.
- **Don't bind the dialog state via `useId` to `<DialogTitle id={...}>`.**
  Radix manages the title id internally via the `DialogContext`; passing
  an `id` prop overrides it and breaks the `aria-labelledby` link from
  `<DialogContent>`. Just render `<DialogTitle>{...}</DialogTitle>`.
- **Don't add a new Supabase Realtime channel for the timer.** Polling
  via the active-only view (15–60s `refetchInterval`) covers it. See
  `Master Rule workspace rule` Realtime Policy.

## Reusability checklist

Likely next adopters:

- **Production Tickets editor** (if/when a Tickets board lands) — same
  shape applies: title / body / priority / scheduling / attachments +
  a per-kind extras bag for ticket-specific fields.
- **Standard Work template editor** (currently a side panel) — if it
  grows past "3 kinds of checklist", graduate to this shape.
- **Customer Portal announcement editor** — if HR + Operations + Quality
  all post announcements with slightly different extras, this shape
  applies directly.

If two consumers land outside production-boards, promote the
`ComposerResizableShell` + `ComposerDateTimePicker` to `components/ui/`
so future composers get the chrome free.

## Related

- [[Editable-Board-Sheets]] — sibling pattern (right-side Sheet, ≤5 fields).
- [[Editable-Board-Dialogs]] — sibling pattern (centred Dialog, ≥6 fields / tabs / preview / embedded subsystem). The composer's shell is a kind-multiplexed superset.
- [[Components/ProductionBoards - Feature Module]] — the surface this pattern was extracted from.
- [[Implement-Production-Boards-Post-Composer]] — the implementation note covering the file inventory + decisions + tests.
- [[ADR-Board-Posts-Schema-Extension]] — migration 305 (the additive schema this dialog rides on).
- [[Cross-Component-URL-Search-State]] — the URL-state pattern the boards use; the composer respects `?edit=1` via `useBoardEditMode`.
