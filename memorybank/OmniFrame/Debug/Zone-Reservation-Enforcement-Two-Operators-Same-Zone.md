---
title: Two operators in the same zone — reservation-not-enforced bug
date: 2026-04-24
tags: [cycle-count, zone-exclusivity, trigger, policy-fix, scheduler, rf-interface]
status: fixed
---

# Bug: two operators in K1 simultaneously

## Symptom

Active Operators panel showed **James Dearman** at `K1-60-02-2` and **David Simmons** at `K1-58-01-2`, both marked Busy, both zone K1, at the same time. Zone policy `one_counter_per_zone` was `enabled = true` — should never have happened.

Forensic data from DB:

| When | Who | What |
|------|-----|------|
| 18:51:35 | David Simmons | Claimed `CC-20260421-0827` (K1-58-01-2) — `in_progress` |
| ~19:05 | scheduler | Auto-soft-released David's row: `pending`, `assigned_to = David` (migration 231 preserved the assignment) |
| 19:34:08 | James Dearman | Claimed `CC-20260421-0861` (K1-61-03-2) — trigger ALLOWED it, zone wasn't flagged as busy |

## Root cause

Migration 231 (Apr 22) changed auto-release to keep `assigned_to` while flipping status to `pending`, so supervisor intent wouldn't get wiped. Correct for the previous bug.

BUT the zone-exclusivity trigger (`enforce_cycle_count_zone_exclusivity`) only counted `status IN ('in_progress','recount')` as "zone occupied." A pending-with-assignee row — the reservation state we just created — was invisible to the trigger. So after David's row got soft-released, the zone looked free, and James could claim another K1 count.

By the time the user noticed, K1 had **5 distinct operators with reserved or active rows** (David, James, Jai, William, Nikki). Other zones (SE, SF, SO, SQ, SU, RH) had the same problem with Alessandro, Kenji, Uwe.

## Fix (migration 232)

### 1. Trigger treats reservations as zone-occupying

Widened the "who owns this zone" query:

```sql
AND status IN ('pending','in_progress','recount')  -- was just ('in_progress','recount')
```

Added `ORDER BY CASE status...` so if both active and reserved rows exist, the trigger reports the active one for clearer UX.

Distinct error variants:
- **Active** — `ZONE_LOCKED: Zone "K1" is currently being counted by Jai Singh.`
- **Reserved** — `ZONE_LOCKED: Zone "K1" is reserved for Jai Singh (pending auto-release). Admin must "+ Unassign" to free the zone.` (hint `cycle_count_zone_reserved`)

### 2. Rust Phase 2 claim pre-filter updated

`rust-work-service/src/db/queries.rs::claim_next_cycle_count` Phase 2 SELECT now excludes candidates where any other user has a reserved OR active row in the zone (`status IN ('pending','in_progress','recount') AND assigned_to IS NOT NULL`).

### 3. Reservation escalation RPC + scheduler tick

Hard-unassigning too aggressively would undo migration 231. But leaving soft-reservations forever would lock zones indefinitely. Middle ground:

New RPC `escalate_stale_zone_reservations(p_threshold_minutes int DEFAULT 60)` hard-unassigns reservations where BOTH the row has been idle >60 min AND the operator hasn't pinged the heartbeats in 60 min.

Rust scheduler now has a 4th job (every 5 min, offset 30s): `escalate_stale_reservations`.

### 4. View rewritten with reservation metrics

`v_cycle_count_active_zones` now exposes per (org, zone, user):
- `actively_counting` — rows in_progress/recount
- `reserved_count` — pending + assigned_to (soft-released)
- `active_count_count` — sum of both (for back-compat)
- `has_active` / `has_reservation` — booleans for UI filtering
- `active_ids[]` / `reserved_ids[]` — split arrays

### 5. Hook split

`useActiveZones()` now filters `onlineZones` to rows where `owner_online AND has_active` (actually-counting operators). Reservations surface via `stuckZones` (owner offline >10 min) and get the "+ Unassign" path.

### 6. RF toast distinguishes reserved vs busy

`useUnifiedCycleCount.handleError` parses the `ZONE_LOCKED` message for "reserved for" vs "counted by" and shows tailored copy:
- *"Zone K1 is reserved. Held for Jai Singh until they return or an admin clears it."*
- *"Zone K1 is busy. Jai Singh is counting there."*

### 7. Bonus fix: `worker_heartbeats.current_zone` was storing full location

RF interface sent `zone = task.location` — so `current_zone` held `K1-58-01-2` instead of `K1`. Fixed in two places:
- `src/features/rf-interface/rf-interface.tsx` — `handleCycleCountTaskChange` now calls `deriveZone(task.location)`.
- `rust-work-service/src/api/routes/workers.rs::send_heartbeat` — defense-in-depth normalization: if `zone` contains a dash, collapse to the first segment; if omitted, derive from location.
- Backfilled 2 existing rows in `worker_heartbeats` (K1-58-01-2 → K1 for cbe23c27; K1-61-03-2 → K1 for 19afea2d).

## Cleanup of existing mess

Ran `escalate_stale_zone_reservations(60)` twice (regex-based first run, age-only second run) — **8 + 3 = 11 stuck reservations** cleared. Final view state: zero zones with >1 operator.

## Verification

Smoke test function on live DB:

| Phase | Expected | Actual |
|-------|----------|--------|
| Claim r1 as Jai → in_progress | OK | OK |
| James tries r2 | `ZONE_LOCKED ... counted by Jai Singh` | **PASS** |
| Soft-release r1 (pending + Jai) | OK | OK |
| James tries r2 again | `ZONE_LOCKED ... reserved for Jai Singh` | **PASS** |

`tsc -b --noEmit` clean; ESLint clean; 54/54 cycle-count tests pass; `cargo check` clean.

## Deployment

- Migration 232 applied via Supabase MCP.
- **Rust redeploy required** for the Phase 2 SELECT update, the new scheduler tick, and the heartbeat-zone normalization to take effect.
- Frontend deploys normally — RF client zone-derivation + new toast variants + new view columns all on next bundle.

## Policy summary (post-232)

| Zone state | Trigger outcome | Pull Next visibility |
|---|---|---|
| No assignment | free | any operator can claim |
| `in_progress` or `recount` + assigned_to | busy (active) | only that user |
| `pending` + assigned_to (reservation) | busy (reserved) | only that user via Phase 1; Phase 2 hides from others |
| Reservation idle > 60 min + heartbeat stale > 60 min | auto-escalated to hard unassign | free for all |
| Admin "+ Unassign" | hard unassign | free for all |
