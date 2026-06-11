---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database, domain/auth]
created: 2026-05-18
---

# Persist Kit Notes Chat Thread

## Purpose / Context

The **Kit Notes** chat panel inside the Kit Build Audit Trail (Quick
View) was implemented as decorative client-only state — two hard-coded
"Kit build plan created" / "Ready for picking" entries seeded via
`useState`, with `handleSendMessage` pushing into the same local array
and every system event (flag add/remove, ship-short authorize via
[[Edit-Ship-Short-Post-Creation-Flow]] / [[Black-Hat-Ship-Short-Authorization-Panel]])
calling `setMessages((prev) => [...prev, ...])`.

Consequence: every typed message disappeared the moment the dialog
closed, no message was attached to a specific kit, no user was
tracked, and there was no audit trail across sessions / users / shifts.

This implementation makes the chat real: persistent, kit-scoped, user-
attributed, and immutable. No new Supabase Realtime channel (per
[[Master Rule]] § Realtime Policy) — cross-user freshness comes from
a 10s `refetchInterval` on the TanStack Query while the dialog is
mounted.

## Architecture

```
KitProductionTrackerDialog (Quick View)
  └─ useKitNotes(kitSerialNumber)              ← TanStack Query
        ├─ kitNotesService.getNotes            ← SELECT (RLS by org)
        ├─ kitNotesService.addUserNote         ← INSERT typed message
        └─ kitNotesService.addSystemNote       ← INSERT event marker

In-dialog events (each wired to addSystemNote):
  - handleAddFlag           → event_kind = 'flag_added'
  - handleRemoveFlag        → event_kind = 'flag_cleared'
  - handleClearFlag         → event_kind = 'flag_cleared'
  - handleSaveShipShort     → event_kind = 'ship_short_authorized'
  - handleBlackHatPanelSaved→ event_kind = 'black_hat_panel_authorized'

Synthetic "Kit build plan created" entry derived from
`details.addedBy` + `details.addedAt` is prepended at render time
when no persisted `kit_created` note exists — covers pre-existing
kits without needing a one-shot backfill, and self-dedupes if we
later stamp a real `kit_created` note server-side.
```

## Files

### Database

- **`supabase/migrations/313_kit_notes.sql` (NEW)** —
  Creates `public.kit_notes` with columns
  `id` UUID PK, `kit_serial_number` TEXT, `organization_id` UUID FK
  cascade, `sender_type` TEXT CHECK in ('user', 'system'),
  `sender_user_id` UUID FK to `user_profiles` (SET NULL on user
  delete), `sender_name` TEXT (snapshot at write time so the chat
  reads correctly after a user is renamed/deactivated), `body` TEXT
  CHECK 1..4000 chars, `event_kind` TEXT (free-form categorisation),
  `created_at` TIMESTAMPTZ.

  RLS enabled with two policies:
  - `kit_notes_select_org` — same-org read
  - `kit_notes_insert_org` — same-org append

  **No UPDATE / DELETE policy** — audit-trail immutability. A typed
  message cannot be edited or redacted from this surface.

  Indexes on `(kit_serial_number, created_at)` and `organization_id`.

  `kit_serial_number` is _not_ a hard FK to `RR_Kitting_DATA` because
  that column is snapshot-replicated across every TO row of a kit
  (not unique). Same convention `kit_build_flags` uses (303).

  Applied to `wncpqxwmbxjgxvrpcake` via Supabase MCP
  `apply_migration`; schema + policies verified via
  `information_schema.columns` + `pg_policies`.

### Service

- **`src/lib/supabase/kit-notes.service.ts` (NEW)** —
  `KitNotesService` singleton with `getNotes(serial)`,
  `addUserNote(serial, body)`, `addSystemNote(serial, body, eventKind?)`.

  Both insert methods resolve `organization_id` from the caller's
  `user_profiles` row before INSERT, so a misbehaving client cannot
  cross-tenant via a forged payload. The SELECT RLS policy also
  org-scopes reads.

  Display-name resolution mirrors the existing pattern in
  `rr-kitting-data.service.ts` (`full_name || first+last ||
  email-localpart || null`) so the snapshot is consistent with the
  rest of the kitting surface.

  `addUserNote` throws on auth/profile/DB error (the mutation toast
  surfaces). `addSystemNote` swallows errors and returns `null` —
  system notes are non-blocking audit metadata; a notes-table outage
  must not roll back the primary action that triggered the note.

### Hook

- **`src/hooks/use-kit-notes.ts` (NEW)** —
  `useKitNotes(kitSerialNumber)` exposes `{ notes, isLoading,
  isSending, addUserNote, addUserNoteAsync, addSystemNote, refetch }`.

  TanStack Query with `staleTime: 5s` and `refetchInterval: 10s`
  while enabled — gives cross-user freshness without Realtime
  channels. `enabled` flips on the `kitSerialNumber` arg so the
  hook is no-op when the dialog is closed (callers pass
  `open ? kitSerialNumber : null` to gate the query).

  `addSystemNote` is wrapped in a stable `useCallback` so consumers
  can pass it into effect deps without thrashing.

### UI

- **`src/components/kitting/kit-production-tracker.tsx`** —
  - Dropped the 2-entry hard-coded `useState<ChatMessage[]>`.
  - Replaced with the hook, gated by `open` so the query only fires
    while the dialog is mounted: `useKitNotes(open ? kitSerialNumber
    : null)`.
  - Render maps `KitNote[]` → `ChatMessage[]` via `useMemo`. New
    `isMine` field distinguishes "this signed-in user wrote it" from
    "another user did", and `isSynthetic` flags the derived
    "Kit build plan created" entry.
  - Bubble colour now keys on `isMine` (blue right-aligned) vs
    everyone else (gray left-aligned). System messages get a
    distinct `italic` treatment so they read as audit-trail markers,
    not chat.
  - All five system-message callsites
    (`handleAddFlag` / `handleRemoveFlag` / `handleClearFlag` /
    `handleSaveShipShort` / `handleBlackHatPanelSaved`) now persist
    via `addSystemNote(body, event_kind)` instead of pushing into
    local state.
  - Input + send button disable while saving / no kit selected; the
    `Enter` handler now suppresses `Shift+Enter` so a future
    multi-line input can opt in without breaking submit.
  - `formatChatTime` upgraded to 'Just now' / 'Xm ago' / 'Xh ago' /
    'Xd ago' / localised date so fresh messages don't all read
    'Just now' for an hour.

## Realtime policy compliance

No new `supabase.channel(...)` callsites. The TanStack Query
`refetchInterval` (10s while the dialog is open) gives cross-user
freshness; on `windowFocus` the query refetches via
`refetchOnWindowFocus: true`. Local writes invalidate the cache so
the writer sees their own message immediately.

If future requirements need exact-RTT presence on the chat (e.g. a
team-lead seeing live typing indicators from the floor), the
`workServiceWs` `WsEvent` enum is the documented expansion point
([[ADR-Presence-Architecture-Next-Steps]]) — no new
`supabase.channel` callsite is permitted.

## Edge cases handled

- **Dialog closed.** `kitSerialNumber` is gated to `null` while the
  dialog is closed; the query is `enabled: false`, no network
  traffic.
- **Anonymous viewer.** `addUserNote` rejects with
  "Not authenticated" — the mutation toast surfaces; the UI input
  is also disabled when `!kitSerialNumber`.
- **Profile lookup fails.** `addUserNote` throws with a clear
  message; `addSystemNote` logs and returns `null` so the primary
  flag/ship-short action isn't rolled back.
- **Empty message.** `handleSendMessage` guards on `.trim()` and
  the service double-checks.
- **Long message.** Schema CHECK at 4000 chars; the input gets
  `maxLength={4000}`; service `.slice(0, 4000)` is a third defence
  for system notes that compose strings.
- **Synthetic creation entry duplicates a real one.** When a
  future `createKitBuildPlan` server-side path stamps an
  `event_kind = 'kit_created'` note, the synthetic entry suppresses
  itself (`!notes.some(n => n.event_kind === 'kit_created')`).
- **User renamed / deactivated.** `sender_name` is snapshotted at
  write time so the chat reads coherent regardless of subsequent
  profile changes. `sender_user_id` is `SET NULL` on user delete
  (FK clause) so the row survives.
- **Multiple users in the same dialog.** 10s refetch picks up
  others' messages; the writer's own message appears immediately
  via the invalidation on success.

## Validation

- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm exec eslint <touched files>` — clean.
- `pnpm exec vitest run src/lib/supabase/__tests__/kit-serial-scoping.test.ts`
  — **25 of 26 pass**. The 1 failure is the pre-existing
  `KIT-20260512-006` date-bomb noted in
  [[Optional-Kit-Inspection-Toggle]] / [[RF-Build-Kit-By-Serial-Number]]
  as out-of-scope.
- `pnpm build` — succeeds. Bundle delta is minor (`feature-admin`
  chunk +~3 KB for the new hook/service indirect imports — settings
  surface is lazy-loaded). Pre-existing oversize chunks (
  `warehouse-location-map`, `feature-admin`, `feature-rf-interface`)
  unchanged in nature.
- **Migration applied** to `wncpqxwmbxjgxvrpcake` via Supabase MCP
  `apply_migration`. Schema verified via
  `information_schema.columns` (9 columns, correct types/nullable).
  RLS verified via `pg_policies` (`kit_notes_select_org` +
  `kit_notes_insert_org` present, `cmd` = SELECT / INSERT
  respectively).

## Future work

- **Server-side `kit_created` note.** On `createKitBuildPlan`,
  also INSERT a `kit_notes` row with `event_kind = 'kit_created'`
  so the creation entry is real (and trips the synthetic-entry
  suppression in the render memo). Same for `appendTOsToKit`,
  `completeKitBuild`, `stageKitToDock`.
- **Mentions / @-tags.** Parse `@username` on user notes and store
  a `kit_note_mentions` row pointing at `kit_notes.id` so the
  Production Boards / My Productivity surfaces can show "you were
  mentioned on KIT-XYZ".
- **Photo / file attachments.** Add an `attachments` JSONB column
  + a Storage bucket — operators on the floor often want to
  attach a photo of a damaged part to the kit's note thread.
- **Pin / star a note.** Add a `is_pinned` boolean so a team-lead
  can pin the canonical "what's blocking this kit" message.
- **Cross-user real-time.** If 10s feels stale, expose
  `WsEvent::KitNoteAdded` from the Rust work-service and surface
  via the existing `workServiceWs` singleton — no new Supabase
  Realtime channel.

## Related

- [[Black-Hat-Ship-Short-Authorization-Panel]] — also writes
  system notes via `addSystemNote('…', 'black_hat_panel_authorized')`.
- [[Edit-Ship-Short-Post-Creation-Flow]] — same chat thread; its
  save handler now persists via the new service.
- [[Optional-Kit-Inspection-Toggle]] — sibling Kitting surface
  using `kitting_workflow_settings` (table the new policy flags
  also live on).
- [[Kit-Serial-Scoping]] — the per-serial convention this table
  follows (`kit_serial_number` text column, not a hard FK).
- [[Kitting System - Feature Module]] — parent module overview.
- [[KittingServices - Supabase Service]] — service catalogue; the
  new `kit_notes` service should be added there.
- [[ADR-Presence-Architecture-Next-Steps]] — documented forward
  path if the 10s polling becomes a bottleneck.
