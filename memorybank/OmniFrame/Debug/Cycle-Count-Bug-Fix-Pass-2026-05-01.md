---
title: 3 cycle-count bugs (zone collision / hard unassign / critical not first) — fixed
date: 2026-05-01
tags: [type/debug, status/fixed, domain/database, domain/backend, domain/frontend, cycle-count, zone-exclusivity, supervisor-intent, priority-ordering]
created: 2026-05-01
---

# 3 cycle-count bugs — closed in one pass

Multi-pass review on 2026-05-01 surfaced three production bugs in the cycle-count engine. Migration 252 + Rust patch + frontend polish closed all three with no regression to existing orgs.

## Bug A — Operators colliding in the same zone

### Symptom
Two operators ended up at the same physical bin even though `cycle_count_zone_rules.policy = 'one_counter_per_zone'`. Push panel showed no warning before the conflict.

### Root cause
- `enforce_cycle_count_zone_exclusivity` returned `NEW` whenever `v_zone IS NULL` — i.e. when the location string was empty, `<<empty>>`, or had no dash. Same hole in the Rust Phase-2 prefilter.
- `WorkDistributionPanel` (Push) didn't preflight zone conflicts; only warned on aisle/heartbeat.
- Phase 1 of `claim_next_cycle_count` didn't re-check zone occupancy: a stale reservation could still deliver an operator into a zone now busy.
- RF skip auto-claim error was swallowed (`use-unified-cycle-count.ts skipTask` try/catch logs-only, no toast).

### Fix (migration 252 + Rust + frontend)
1. New per-org rule `cycle_count_zone_rules.treat_null_zone_as_locked boolean DEFAULT false`. When true and the row's zone is NULL, fall back to LOCATION-EXACT-MATCH exclusivity (the trigger raises `ZONE_LOCKED: Location "<X>" is currently held by <Y>`).
2. **Push preflight** in `work-distribution-panel.tsx`: derives each selected count's zone, looks it up in `useActiveZones()` + `useZoneAssignments()`, and surfaces a rose-colored panel listing every (zone, owner, count_count) conflict before the trigger rejects it. Push button disabled until the admin clicks an explicit "Override Confirmed (admin force)".
3. **RF skip auto-claim** — `use-unified-cycle-count.ts` now toasts on failure, with a different message for `ZONE_LOCKED` / `ZONE_ASSIGNED` ("Skipped. Next-up count is in a zone reserved for someone else.") vs queue-empty.
4. **Phase 1 zone-collision filter** in Rust `claim_next_cycle_count`: rows whose zone is held by a different in_progress/recount user are excluded; they fall to Phase 2 where they hit the existing prefilter.

## Bug B — Hard-assigned cycle counts silently unassigned

### Symptom
An admin reassigned a cycle count to operator X. ~60 minutes later the count's `assigned_to` was null and the audit notes showed `[Escalated to hard-unassign at … — reservation for X exceeded 60 min]`. Same shape as the [[Preserve-Supervisor-Assignment-On-Auto-Release]] bug — except this was the HARD-unassign edge of the same problem (231 fixed soft; 252 fixes hard).

Secondary symptom: when an admin reassigned a row that was already in pending+assigned, the new assignee got escalated within minutes — way before the 60-min threshold. Cause: `reservation_started_at` carried over from the prior assignee.

### Root cause
- `escalate_stale_zone_reservations` couldn't tell a supervisor's explicit assignment from an organic soft-released reservation. Both look the same in `pending+assigned` state with old `reservation_started_at`.
- `maintain_cycle_count_reservation_started_at` only stamped `reservation_started_at` on entry into reservation state — it didn't bump on assignee-change WITHIN the reservation state.
- RF skip path didn't distinguish skip from unassign in dashboard rendering.

### Fix (migration 252)
1. New durable columns: `rr_cyclecount_data.supervisor_assigned_at timestamptz` + `supervisor_assigned_by uuid REFERENCES user_profiles(id)`. Stamped by `assign_cycle_count_to_user` (and the force variant via the bypass GUC). Cleared by the maintenance trigger on hard unassign or status leaving pending/recount.
2. New per-org rule `cycle_count_zone_rules.supervisor_assignment_protection_hours int DEFAULT 24` controls how long the protection window stays active.
3. `escalate_stale_zone_reservations` rewritten to skip rows where `supervisor_assigned_at IS NOT NULL AND supervisor_assigned_at >= NOW() - <protect_hours>`.
4. `maintain_cycle_count_reservation_started_at` rewritten with three branches:
   - Entering reservation state → stamp.
   - Re-assigned within reservation state → re-stamp (NEW).
   - Leaving reservation state → clear.
   Plus a new supervisor-clear branch on hard unassign / status-out-of-pending.
5. **Dashboard "Deferred (was X)" badge** in `manual-counts-search.tsx` for rows with `assigned_to IS NULL` BUT `active_defer.is_active = true` — surfaces the prior assignee from `counter_name`.
6. **Push panel "Return to queue" confirm dialog** with explicit assignment-clear copy.

## Bug C — Critical priority not first

### Symptom
An operator with sticky_zone enabled was on Pull Next pulling normal-priority counts in zone K2 while three critical-priority counts in other zones sat at the head of the unassigned queue.

### Root cause
Server-side ordering inversion in `rust-work-service/src/db/queries.rs::claim_next_cycle_count`:
- Phase 1 ordered as `sticky → status → priority → …` — priority was 3rd.
- Phase 2 ordered as `sticky → dedicated → priority → …` — priority was 3rd.
- Path-rule occupancy filter dropped critical-priority candidates the same as any other when an aisle was saturated.
- Phase 2's `LIMIT 50` could exclude a critical row that happened to sort late by location (e.g. unresolved + alphabetical tail).

### Fix (Rust + frontend)
1. Phase 1 ORDER BY: priority FIRST. Sticky-zone / heartbeat / status are tiebreakers within the priority tier.
2. Phase 2 ORDER BY: priority FIRST. Sticky / dedicated zones are tiebreakers within the tier.
3. Phase 2 `LIMIT 50 → 200`. Cost is acceptable; the index supports it.
4. Path-rule occupancy filter: `is_critical → false` for `blocked_by_occupancy`. Critical bypasses aisle saturation entirely.
5. **"Pull Next preview" sort preset** in `manual-counts-search.tsx` — admins toggle a button to see the table sorted exactly the way the Rust Phase 2 ranker would. Mirrors `priority → unresolved → zone → aisle → sequence → location → created_at`.

## Cross-cutting fixes

- **Mass assign** in `manual-counts-search.tsx`: `Promise.all → Promise.allSettled` + per-row reason aggregation. Toast variants: all-success → green; partial → amber "Assigned N, blocked M" with description that aggregates `zone reserved: K1, R0` / `zone assigned to others: K1` / `other: M`.
- **`listActiveZones` error swallowing** in `zone-rules.service.ts`: now throws so callers can surface the error. The realtime subscriber wraps in try/catch (no toast spam from silent reconnects).

## Verification

- Migration 252 applied via Supabase MCP (4 `apply_migration` calls). Live smoke test ran via `execute_sql` in a `DO $smoke$` block exercising all three fix points (priority-first ordering, supervisor protection, NULL-zone fallback). All 5 phases passed; no orphan smoke rows; production rules untouched.
- Forensic backfill ran on org `c9d89a74-7179-4033-93ea-56267cf42a17` — 0 rows currently eligible (the only pending+assigned rows are organic claims, not admin-reassigned).
- Rust `cargo check` clean; `cargo test --lib` 8/8 pass.
- Frontend `npx tsc -b --noEmit` clean; ESLint touched files clean (zero new warnings); Vitest 74/75 pass (1 pre-existing ConfirmDialog double-DOM failure unchanged — verified by stash + re-run).

## Deployment

- **Migration 252 already applied.**
- **Rust work-service must be redeployed to Railway** for Bug C and the Phase-1 zone-collision filter. Until redeployed, the DB enforcement (escalator + null-zone fallback + supervisor protection) is correct, but the priority inversion bug C is still live.
- Frontend bundle deploys normally on next release.

## Related

- [[Cycle-Count-Bug-Fix-Pass-Migration-252]] — full implementation note.
- [[Zone-Engine-Hardening-Pass-Migration-233]] — prior hardening pass.
- [[Preserve-Supervisor-Assignment-On-Auto-Release]] — migration 231, soft-release-by-default. Companion fix.
- [[Restore-All-Wiped-Admin-Reassignments]] — manual sweep that pre-dated 252's columns.
- [[Cycle-Count-Zone-Exclusivity]] — original 225 design.
