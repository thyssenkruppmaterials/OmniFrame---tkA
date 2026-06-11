---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database, kitting]
created: 2026-06-04
---

# Kit Build Plans Grid — Reorder + Ship Short + Unread Messages

Three changes to the **Kit Build Plans** grid (`KittingDataGrid`, surfaced by
`KittingDataManager`), from one user request.

## 1. Column reorder

New order (left→right): **Priority · Date Added · Due Date · Kit Serial # ·
Kit PO Number · Kit Number · Status · Ship Short · Messages · Flags**.

- "Added Date/Time" header renamed to **Date Added**.
- **Dropped** the "Added By" column (not in the requested order). **Kept**
  "Flags" at the end — it surfaces operationally critical hats (Black Hat
  blocks picking), so removing it would hide a hard gate.
- CSV export (`KittingDataManager.handleExportData`) was left unchanged — it
  builds its own header list independent of the grid columns.

## 2. Ship Short Authorization column

Shows the kit's `authorized_ship_short_items` part numbers as amber badges
(description on hover), or `—` when none. Threaded the field through:
`getKitGridData` (`RawKitRecord` + `KitGridRecord` mapping,
`authorized_ship_short_items ?? []`) → `KittingGridRow` → new `ShipShortCell`.

## 3. Unread-message indicator (per-user)

A **Messages** column shows a blue `New` badge (`MessageSquareDot`) on kits
that have a Kit Note the current user hasn't read. Builds on the existing
`kit_notes` thread (313).

**Migration 330 (`330_kit_note_reads.sql`, applied to `wncpqxwmbxjgxvrpcake`):**
- `kit_note_reads` (`user_id`, `kit_serial_number`, `organization_id`,
  `last_read_at`, unique `(user_id, kit_serial_number)`) — per-user, per-kit
  read watermark. RLS: SELECT/INSERT/UPDATE own rows only (`user_id =
  auth.uid()`).
- RPC `kit_notes_unread_serials()` — `SECURITY INVOKER`, `SET search_path =
  ''`, returns kit serials with a `sender_type='user'` note authored by
  **another** user (`sender_user_id IS DISTINCT FROM auth.uid()`) newer than
  the caller's watermark (or no watermark). Relies on `kit_notes` org-scoped
  SELECT RLS + `kit_note_reads` own-row RLS. Security advisors: clean (no
  finding references the new objects).

**Read semantics (confirmed with user):** per-user; only operator-typed notes
from others count (system event stamps + the reader's own notes are
excluded); **opening the Kit Build Audit Trail marks the kit read**.

**Frontend:**
- `KitNotesService.getUnreadKitSerials()` (RPC) + `markKitNotesRead(serial)`
  (upsert watermark, `onConflict: user_id,kit_serial_number`).
- `useKitUnreadNotes()` (polled 30s, no realtime per Policy) → `Set<serial>`;
  `useMarkKitNotesRead()` mutation invalidates `['kit-notes','unread']`.
- `KittingDataGrid` takes `unreadKitSerials?: Set<string>`, passed to
  TanStack `meta` so the module-level `Messages` column cell can read it
  without recreating the columns array.
- `KitProductionTrackerDialog` marks read on open (once per open, ref-guarded)
  — placed in the **dialog** so it fires for BOTH the grid row-click and the
  kanban Quick View entry points; the mutation's invalidation clears the
  grid dot.

## Verification

`tsc -b` clean; ESLint clean on all touched files. Migration verified live
(table + 3 policies + RLS on + RPC present); security advisors unaffected.
Dev server HMR-applied. Bundle budget: pre-existing failures only (no new
deps this change).

## Related
- [[Persist-Kit-Notes-Chat-Thread]] — the kit_notes thread this builds on
- [[Kit-Build-Plan-Completed-Tab]] — the tab split the grid lives in
- [[Components/Kitting System - Feature Module]]
