---
title: "Active zones showed 3 locks for an offline operator — fixed"
date: 2026-04-21
tags: [cycle-count, zones, worker-heartbeats, rr_cyclecount_data, dashboard, ux-fix]
status: fixed
---

# Dashboard showed stuck zone locks for an operator who wasn't online

## Symptoms

Manual Counts header showed 3 amber "active zone" chips for **Alessandro Lopez** (zones SE, SF, SO) — but Alessandro had been **offline for 3h 45m** (last `worker_heartbeats.last_heartbeat` at 20:16; the screenshot was at 00:01).

Further investigation: the rows had been assigned by **Angela Torres** via the dashboard reassignment UI at 23:37–23:43 — a cross-user supervisor reassign. Alessandro never logged in to claim them, so they sat in `status = 'in_progress'` with no real counter behind them, producing fake "active zone" chips and blocking anyone else from pulling work in SE/SF/SO.

## Root cause

`v_cycle_count_active_zones` (migrations 225/227) rolled up every row where `assigned_to IS NOT NULL AND status IN ('in_progress', 'recount')`. It had no notion of whether the operator was actually online.

The existing Rust `scheduler::detect_and_release_abandoned` only releases rows whose `updated_at` is older than 30 minutes — Alessandro's rows had been assigned very recently, so the scheduler wouldn't touch them.

## Fix — Migration 229 + UI split

### DB

- Rewrote `v_cycle_count_active_zones`:
  - Joins `worker_heartbeats` (latest per user) so every row now has `owner_last_heartbeat`, `owner_online` (true if last heartbeat is within 5 min), `minutes_since_seen`, and `is_stuck` (true if last heartbeat > 10 min OR never).
  - Still groups by `(org, zone, locked_by)` with the counts/ids.
  - Uses the indexed `rcc.zone` column from migration 228 — stays fast.
- **`release_stuck_cycle_count_assignment(count_id)`** — `SECURITY DEFINER` RPC, admin/manager/logistics_coordinator gated. Sets `app.cycle_count_zone_lock_bypass = on`, clears assignee + status, appends an audit note.
- **`release_all_stuck_cycle_count_assignments(threshold_minutes)`** — bulk version that releases every row in the caller's org held by an operator whose heartbeat is older than the threshold (default 10 min).

### Service / hook

- `ActiveZone` now carries `owner_online`, `owner_last_heartbeat`, `minutes_since_seen`, `is_stuck`.
- `useActiveZones()` splits the list into `onlineZones` (chips on the dashboard) and `stuckZones` (admin cleanup queue). Exposes `releaseStuck(countId)` and `releaseAllStuck(thresholdMins)` mutations + `isReleasing` flag.
- `zone-rules.service.ts` adds `releaseStuckAssignment` + `releaseAllStuckAssignments`.

### UI

- **Manual Counts header strip** now renders only `onlineZones` in green; if any rows are stuck, a dedicated amber pill shows `⚠ N stuck · release` that one-click bulk-releases.
- **Count Settings → Zone Rules**: Live Zone Activity card only lists online operators. A new `StuckZonesCard` appears below it (amber theme, per-count Release button + a Release All header button) whenever `stuckZones.length > 0`.

### One-off cleanup

Executed on the live DB via MCP: released Alessandro's 3 in-progress rows (SE, SF, SO) with audit note `[Released stuck assignment … operator offline >3h]`. View now returns 0 rows.

## Verification

- Before: view returned 3 rows, all `owner_online = false`, all `is_stuck = true`.
- After one-off cleanup: 0 rows. The dashboard strip is clean.
- Trigger still blocks cross-user claims on `ZONE_LOCKED` / `ZONE_ASSIGNED` on fast path.
- `tsc -b --noEmit` clean; ESLint clean; 54/54 cycle-count unit tests pass.

## Deployment

- Migration 229 applied to Supabase via MCP.
- Frontend: deploy normally.
- Rust work-service: no changes required for this fix (the scheduler can keep running on its existing 30-minute `updated_at` rule; this migration layers the "operator-offline" semantics on top).

## Follow-up ideas (not in this PR)

- Extend the Rust scheduler to also release when the operator's heartbeat is older than N minutes (complement to the 30-min `updated_at` rule), so this happens automatically without admin intervention.
- Guard the dashboard "Assign to …" UI with a warning if the target user's heartbeat is stale ("Angela is offline — are you sure?").
- Add an `effective_status` field in `get_active_workers` Rust query so UI badges never show "Online" when heartbeat is about to time out.

## Files touched

- `supabase/migrations/229_zone_owner_online_and_stuck_release.sql` (new)
- `src/lib/supabase/zone-rules.service.ts` (types + release RPCs)
- `src/hooks/use-zone-rules.ts` (`useActiveZones` split + mutations)
- `src/components/zone-rules-panel.tsx` (Live Zone Activity honest + StuckZonesCard)
- `src/components/manual-counts-search.tsx` (green online chips + amber stuck pill + one-click release)
