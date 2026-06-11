---
title: Assigned count leaked to another operator after auto-release — fixed
date: 2026-04-22
tags: [cycle-count, zone-exclusivity, auto-release, scheduler, supervisor-intent, policy-fix]
status: fixed
---

# Bug: supervisor-assigned count leaked to a different operator

## Symptom

Jai (me) tapped Pull Next in the RF interface and got **CC-20260326-0008** (hot priority, zone SE). The count had been explicitly **reassigned by Angela to Alessandro** hours earlier. Jai should never have seen it.

## Root cause — reconstructed from cycle_count_assignment_history + notes

| When | Actor | What |
|-----|-------|------|
| 23:37 | Angela Torres | Dashboard reassigned David Simmons → Alessandro Lopez. Status flipped to `in_progress`, `assigned_to = Alessandro`. |
| ~00:05 | scheduler / `release_all_stuck_cycle_count_assignments` | Alessandro's heartbeat was >10 min stale, so the bulk release **cleared `assigned_to = NULL`** and flipped status back to `pending`. Audit note on the row: *"[Released stuck assignment at 2026-04-22 00:05 — operator offline >3h]"*. |
| 01:02 | Jai — Pull Next | Phase 2 of `claim_next_cycle_count` filters `assigned_to IS NULL`. Row was now eligible. Jai claimed it. |

The hole: **auto-release wiped the supervisor's intent**. Angela said "this goes to Alessandro"; 28 minutes later the system silently said "anyone can have it."

## Policy fix (migration 231)

Auto-release (scheduler, heartbeat-based, bulk stuck cleanup) is now **SOFT by default**:

- Flip `status` to `pending`.
- **Keep `assigned_to`**.
- Audit-note the reservation.

Because Phase 2 of the Rust claim query filters `WHERE assigned_to IS NULL`, no other operator can see a row that's still reserved for someone. Because Phase 1 returns already-assigned rows to the caller, the original assignee gets it back on their next Pull Next.

Admins who genuinely need to return a row to the general pool pass `p_also_unassign := true`. Two new UI buttons expose this:

- **Release** — soft. Default click. Keeps assignment.
- **+ Unassign** — hard. Requires a `confirm()` dialog. Clears `assigned_to`.

Both buttons exist on each stuck row AND as "Release All" / "+ Unassign all" in the card header.

## Files touched

- `supabase/migrations/231_preserve_assignment_on_auto_release.sql` (new)
  - Drops + re-creates `release_stuck_cycle_count_assignment(count_id uuid, p_also_unassign boolean DEFAULT false)`.
  - Drops + re-creates `release_all_stuck_cycle_count_assignments(threshold_minutes int DEFAULT 10, p_also_unassign boolean DEFAULT false)`.
  - Drops + re-creates `release_stale_heartbeat_assignments(threshold_minutes int)` — always soft (scheduler never unassigns).
- `rust-work-service/src/scheduler/mod.rs` — legacy 30-min path also changed to soft.
- `src/lib/supabase/zone-rules.service.ts` — `releaseStuckAssignment(countId, alsoUnassign?)` + `releaseAllStuckAssignments(thresholdMinutes?, alsoUnassign?)`.
- `src/hooks/use-zone-rules.ts` — hook signatures `releaseStuck(id, { hard? })` / `releaseAllStuck(mins?, { hard? })`. Tailored toast messages ("Released. Still reserved for the original assignee." vs "Cleared back into the general queue.").
- `src/components/zone-rules-panel.tsx` — `StuckZonesCard` now has soft **Release** + hard **+ Unassign** per row and at the header. Hard path requires confirm().

## Backfill

Restored CC-20260326-0008 on prod: set `assigned_to` back to Alessandro, status `pending`, audit note recording the reversion. Jai's in-progress state cleared; Alessandro will get the count on his next Pull Next.

## Verification

- Phase 2 query filtering `assigned_to IS NULL` returns `[]` for this count now.
- Phase 1 query filtering `assigned_to = Alessandro` returns it correctly.
- `npx tsc -b --noEmit` clean; ESLint clean; 54/54 cycle-count service/hook tests pass.
- `cargo check` clean.

## Deployment

- Migration 231 applied via Supabase MCP.
- **Rust redeploy required** for the scheduler's legacy 30-min path to stop hard-unassigning. Without the redeploy, heartbeat-triggered releases are already soft (delegated to the SQL function), but the 30-min fallback still clears assignment. Short gap, but worth pushing.
- Frontend: deploys normally.

## Policy summary

| Trigger | Before | After |
|---|---|---|
| Scheduler tick, heartbeat > 10 min stale | hard (cleared assignee) | **soft** (keeps assignee) |
| Scheduler tick, updated_at > 30 min | hard | **soft** |
| Admin clicks "Release" in UI | hard | **soft** |
| Admin clicks "+ Unassign" in UI | (new) | **hard**, with confirm |
| Admin clicks "Release All" in card header | hard | **soft** |
| Admin clicks "+ Unassign" in card header | (new) | **hard**, with confirm |

Phase 2 of Rust `claim_next_cycle_count` unchanged (`assigned_to IS NULL`) — no other operator ever sees a reserved row. Phase 1 unchanged (already-assigned rows return to caller) — the original operator gets their work back when they come online.
