---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-05-21
---
# Cancel Kit TO Line

## Purpose / Context

Kits import a flat list of Transfer Orders, but real-world workflows occasionally surface lines that should be excluded after the kit is in motion: a material was substituted upstream, the line was sent in error, the part is being supplied from a different source, etc. Before this change there was no operator-facing way to mark a TO line as cancelled — the only options were to (a) pick something physically and force-mark it, or (b) leave the kit blocked because the unpickable line kept the picking stage gate at `N−1 / N`.

This implementation adds **per-line cancellation** with a captured reason, integrated into the Kit Build Audit Trail. A cancelled line is:

1. Visibly marked in the TO Lines table (line-through, muted row colour, dedicated `Cancelled` pill on the Material cell with the reason exposed via tooltip).
2. Excluded from `pickedCount` / `kittedCount` / `totalLines` so the picking and kitting stages can complete on the remaining live lines and the kit can advance to On Dock.
3. Excluded from BOM coverage — a cancelled line no longer delivers its material, so cancelling the only TO for a required component correctly raises (or leaves up) a Black Hat. The operator can re-cover the material by either re-adding a TO via [[Add-TO-To-Clear-Black-Hat]] or by authorising it via [[Edit-Ship-Short-Post-Creation-Flow]].
4. Stamped into the kit_notes audit-trail thread (sender_type = 'system', event_kind = 'to_line_cancelled') with the actor + reason, matching the system-note pattern from [[Persist-Kit-Notes-Chat-Thread]].

## Architecture

```
Kit Build Audit Trail dialog (kit-production-tracker.tsx)
  │
  │  per-row Trash2 button → setCancelTarget({...line})
  │
  v
CancelTOLineDialog (cancel-to-line-dialog.tsx)
  │  captures reason, calls onConfirm(target, reason)
  v
handleCancelTOLine in the parent (kit-production-tracker.tsx)
  │
  ├─> RRKittingDataService.cancelTOLine(toLineId, reason)
  │     └─> UPDATE RR_Kitting_DATA SET cancelled = TRUE,
  │           cancelled_at = NOW(), cancelled_by_user = auth.uid(),
  │           cancelled_reason = trimmed_reason
  │           (DB CHECK rr_kitting_data_cancellation_invariants enforces
  │            all-or-nothing + non-empty reason)
  │
  ├─> addSystemNote(`TO X / Material Y cancelled. Reason: …`,
  │                   'to_line_cancelled')
  │
  └─> loadDetails(true)  — refreshes the dialog so the cancelled-row
        styling + new stage counts render immediately.
```

Downstream gating updates that flow automatically once the row is marked cancelled:

- `RRKittingDataService.getKitBuildPlanDetails*` — `activeToLines = toLines.filter(t => !t.cancelled)` drives `totalLines / pickedCount / kittedCount`.
- `RRKittingDataService.recheckBomCoverageBySerial` — `allRows.filter(r => !r.cancelled)` drives the `toMaterials` set.
- `KitKanbanService.computeKitProgress` — `activeLines = lines.filter(l => !l.cancelled)` drives the kanban card progress + auto-step transitions.

## Files

### Database

- **`supabase/migrations/325_kit_to_line_cancellation.sql` (NEW)** — adds four columns to `RR_Kitting_DATA`: `cancelled BOOLEAN NOT NULL DEFAULT FALSE`, `cancelled_at TIMESTAMPTZ`, `cancelled_by_user UUID REFERENCES user_profiles(id) ON DELETE SET NULL`, `cancelled_reason TEXT`. CHECK constraint `rr_kitting_data_cancellation_invariants` enforces that either all four cancellation fields are populated (with a non-empty reason) or all are NULL. Partial index `rr_kitting_data_active_lines_idx ON (kit_serial_number) WHERE cancelled = FALSE` accelerates the predominant `WHERE cancelled = false` reads. Applied to `wncpqxwmbxjgxvrpcake` via Supabase MCP; columns + constraint + index verified.

### Service

- **`src/lib/supabase/rr-kitting-data.service.ts`** —
  - `RRKittingDataRecord` interface gains the four cancellation columns.
  - Both `getKitBuildPlanDetailsBy*` methods (PoNumber + SerialNumber variants) extended:
    - `TOLine` shape gains `cancelled`, `cancelledAt`, `cancelledBy`, `cancelledReason`.
    - `userIds.add(r.cancelled_by_user)` so the user-name resolution covers the cancellation actor.
    - `toLines.map` populates the new fields, resolving `cancelledBy` through the existing `userNameMap`.
    - Stage computation now uses `activeToLines = toLines.filter(t => !t.cancelled)` for `totalLines / pickedCount / kittedCount`.
  - `recheckBomCoverageBySerial` selects the new `cancelled` column and filters cancelled rows out of the `toMaterials` set.
  - New `cancelTOLine(toLineId, reason)` static method — trims the reason, validates non-empty + authenticated, UPDATEs the row, returns `{ success, error? }`. Update payload cast through `unknown` so the new columns type-check until `database.types.ts` is regenerated.

- **`src/lib/supabase/kit-kanban.service.ts`** — `syncKitProgressFromSerial` selects the new `cancelled` column; `KitLine` interface gains `cancelled?: boolean | null`; `computeKitProgress` filters cancelled lines before computing totals + currentStep, so a cancelled line doesn't keep the kanban card stuck at `N−1 / N`.

### UI

- **`src/components/kitting/cancel-to-line-dialog.tsx` (NEW)** — modal that captures the operator's reason in a `<Textarea>` (max 500 chars), enforces non-empty trim before enabling the destructive Confirm button, reseeds the input every time the dialog opens (matches the [[Non-Warehouse-Bin-Acknowledgment]] "ack is per-submission" pattern), and exposes an async `onConfirm(target, reason)` callback so the parent can sequence the service call + audit-trail stamp + local refresh through one handler. Header surfaces TO #, material, and description for unambiguous targeting.

- **`src/components/kitting/kit-production-tracker.tsx`** —
  - `TOLine` interface (frontend) gains the four cancellation fields.
  - New buckets at the top of the component: `activeLines = toLines.filter(!l.cancelled)`, `incompleteLines / completedLines = activeLines bucket`, `cancelledLines = toLines.filter(l.cancelled)`. The pending / complete header pills now reflect *active* workload; a new neutral `Cancelled` pill appears alongside them when `cancelledLines.length > 0`.
  - New `cancelTarget` state + `cancellingLine` flag + `handleCancelTOLine` callback (memoised on `loadDetails` + `addSystemNote`). The handler calls the service, surfaces toast feedback on both branches, stamps a system note with `event_kind = 'to_line_cancelled'`, clears the target, and refreshes details.
  - `<CancelTOLineDialog>` mounted alongside the existing `<ConfirmDialog>` / `<EditShipShortDialog>` mounts.
  - TO Lines table:
    - New rightmost actions column with a per-row icon-only `Trash2` ghost button (hover: destructive). Disabled while another cancellation is in flight.
    - Cancelled rows render with a muted `bg-muted/40 text-muted-foreground` background, line-through on Material / Description / Bin / Qty cells, the `Picked` / `Kitted` columns collapse to em-dashes, and an inline `Cancelled` pill on the Material cell with `title` carrying `reason · actor · timestamp` for hover detail.
    - Existing `missingPartFlag` purple-rail styling still applies but only on **non-cancelled** rows (cancellation supersedes "missing").

## Behaviour

- **Reason is required**. Both client-side (Confirm disabled until non-blank trim) and server-side (CHECK constraint requires `length(btrim(cancelled_reason)) > 0`).
- **Cancellation is row-level**. Only the targeted row flips; all sibling rows keep their state. Cancelled rows stay in the table forever (no soft-delete) so the audit trail is immutable.
- **Stage gating respects cancellation**. A kit with 17 TOs where 1 is cancelled and 16 are kitted will show Picking 16/16 → Kitting 16/16 → advance to On Dock. The cancelled line is rendered with a `Cancelled` pill that links to the operator's reason via the `title` tooltip.
- **BOM coverage respects cancellation**. Cancelling the only TO for required material `XYZ` correctly leaves `XYZ` uncovered. The operator's next move is either Add TO to Clear Black Hat (re-cover the material) or Edit Ship Short (authorise the missing line). This matches the principle that cancellation is a *workflow* exclusion, not a magical material-fulfillment shortcut.
- **Kanban progress respects cancellation**. `KitKanbanService.computeKitProgress` excludes cancelled lines from the totals, so the kanban card displays the correct "X / Y" against the live workload.
- **System note on the audit trail**. Every cancellation stamps a `kit_notes` row with `event_kind = 'to_line_cancelled'` and the message `TO {N} / Material {M} cancelled. Reason: {reason}`. The Kit Notes thread renders system notes in italic, sent by `System`, identical to flag add/remove or ship-short authorize events.
- **Idempotence**. Cancelling an already-cancelled row is a no-op for the user-facing semantics (the UI hides the cancel button on cancelled rows; the service call would write the same payload but the CHECK constraint requires the reason — hidden from the UI flow).

## Edge cases handled

- **Already picked or kitted before cancellation**. Operator override is allowed — the cancelled flag dominates the picked/kitted state for stage gating purposes. The cancelled row's Picked/Kitted cells render as em-dashes; the underlying timestamps are kept on the row so the audit trail can still answer "who picked this before it was cancelled?".
- **Empty reason**. Both UI (Confirm button disabled) and DB CHECK constraint reject. The service double-checks via `reason.trim()` before issuing the UPDATE.
- **Unauthenticated caller**. `cancelTOLine` returns `{ success: false, error: 'Not authenticated' }` instead of issuing an update with a NULL actor (which would fail the CHECK constraint anyway).
- **Concurrent cancellation by two operators**. The UPDATE is keyed on row `id`; whoever lands second simply re-writes the timestamp + actor + reason. The audit-trail captures both events through the parent's separate `addSystemNote` calls.
- **Cancelled line was missing-part-flagged**. The cancellation pill takes visual precedence; the missing-part purple rail is suppressed on cancelled rows so the row reads as one coherent state instead of two competing ones.
- **All TO lines cancelled**. `activeToLines.length || 1` guard preserves the existing `0/0` → `0/1` stage-display fallback so the timeline doesn't divide by zero.

## Validation

- `pnpm exec tsc -b --force` — clean.
- `pnpm exec eslint <touched files>` — clean.
- `pnpm exec prettier --write` applied to all touched files.
- **Migration applied** to `wncpqxwmbxjgxvrpcake` via Supabase MCP. `cancelled / cancelled_at / cancelled_by_user / cancelled_reason` columns verified via `information_schema.columns`. The CHECK constraint and partial index were created in the same migration.
- Vite HMR updates succeed on `kit-production-tracker.tsx` + `cancel-to-line-dialog.tsx`.

## Realtime policy compliance

No new `supabase.channel(...)` callsites. The cancellation flow rides on the same `loadDetails(true)` refetch the dialog already uses for flag / ship-short events; the kanban card is updated through the existing `KitKanbanService.syncKitProgressFromSerial` path which the kit lifecycle already invokes on stage transitions. Honours [[Master Rule]] § Realtime Policy.

## Future work

- **Uncancel**. Today cancellation is one-way. Adding an `uncancelTOLine` would just clear the four columns and re-run BOM coverage, but the UX needs care — we'd want a guard like "you can only uncancel a line within N hours" or "only the cancelling operator can uncancel".
- **Bulk cancel**. The current per-row action is fine for the typical 1–2 row case; if floor leads find themselves cancelling a dozen TOs at once we'd want a multi-select + bulk action.
- **Server-side enforcement on RF picking**. The RF Kit Picking service should refuse to surface cancelled lines as next-pick targets. Today the front-end exclusion is sufficient because RF reads through `getKitBuildPlanDetails*` which already filters them, but a defensive check in `RFKittingPickingService.getNextPickItem` would avoid future drift.
- **Cancelled line analytics**. Floor leads might want to see "top N cancellation reasons by week" to spot upstream supply patterns. A small dashboard tile reading the `cancelled_reason` text could surface this.
- **Regenerate `database.types.ts`**. The `cancelTOLine` UPDATE casts through `unknown` because the strongly-typed Supabase client doesn't know about the new columns yet. Regenerating the types via `supabase gen types typescript` would let us drop the cast.

## Related

- [[Persist-Kit-Notes-Chat-Thread]] — audit-trail surface receiving the `to_line_cancelled` system note.
- [[Black-Hat-Ship-Short-Authorization-Panel]] / [[Edit-Ship-Short-Post-Creation-Flow]] / [[Add-TO-To-Clear-Black-Hat]] — the three ways to recover after cancelling the only TO for a required material.
- [[Non-Warehouse-Bin-Acknowledgment]] — sibling "capture an operator decision with a reason" dialog pattern; the CancelTOLineDialog reseed-on-open behaviour and required-text-area UX is modelled on it.
- [[Kit-Serial-Scoping]] — the per-serial convention every kit mutation now follows.
- [[Kitting System - Feature Module]] / [[KittingServices - Supabase Service]] — parent module + service catalogue.
