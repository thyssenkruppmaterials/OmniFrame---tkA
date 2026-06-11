---
title: Cycle-count bug-fix pass (migration 252 + Rust + Frontend)
date: 2026-05-01
tags: [type/implementation, status/active, domain/database, domain/backend, domain/frontend, cycle-count, zone-exclusivity, supervisor-intent, hardening]
created: 2026-05-01
---

# Cycle-count bug-fix pass — migration 252

Closed three concrete cycle-count bugs surfaced by the multi-pass code review on 2026-05-01. Same playbook as [[Zone-Engine-Hardening-Pass-Migration-233]]: one migration, targeted Rust patch, frontend polish, smoke test on prod, vault note. Default behaviors do NOT regress for existing orgs — every new column ships with a safe default.

## The three bugs

### Bug A — Operators colliding in the same physical bin

When a row's location parsed to a NULL zone (`<<empty>>`, blank, or no dash), `enforce_cycle_count_zone_exclusivity` and the Rust Phase-2 prefilter short-circuited. Two operators could legitimately end up at the same physical bin if its location string didn't fit the zone pattern.

**Fix.** New per-org rule `cycle_count_zone_rules.treat_null_zone_as_locked boolean DEFAULT false`. When true, the trigger falls back to LOCATION-EXACT-MATCH exclusivity for unparsable zones (no two users on identical `rr_cyclecount_data.location` even if zone is null). Default OFF — existing orgs unchanged. Admins flip it on per-org via the rules table when they have weird locations they care about.

### Bug B — Hard-assigned cycle counts silently unassigned

Two independent sub-paths.

#### B1. Escalator couldn't tell supervisor-assigned from soft-released

`escalate_stale_zone_reservations` keys off `reservation_started_at` + heartbeat staleness. After 60 minutes of an offline operator, it hard-unassigned. But it had no way to distinguish "Angela explicitly assigned this to Alessandro" from "organic claim that auto-soft-released". Supervisor intent got wiped after one hour — same flavor of bug as the [[Preserve-Supervisor-Assignment-On-Auto-Release]] sweep, but at the harder hard-unassign edge.

**Fix.** New durable columns on `rr_cyclecount_data`:

- `supervisor_assigned_at timestamptz`
- `supervisor_assigned_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL`
- Partial index `idx_rr_cyclecount_supervisor_assigned (organization_id, supervisor_assigned_at) WHERE supervisor_assigned_at IS NOT NULL`.

`assign_cycle_count_to_user` (the SQL RPC at migration 037) and `assign_cycle_count_to_user_force` (which routes through the same body under `app.cycle_count_zone_lock_bypass = on`) now stamp these columns with `NOW()` + `auth.uid()`. The escalator's predicate skips rows with `supervisor_assigned_at >= NOW() - <protect_hours>`, where `protect_hours` comes from a new per-org rule `cycle_count_zone_rules.supervisor_assignment_protection_hours int DEFAULT 24`.

The maintenance trigger `maintain_cycle_count_reservation_started_at` clears `supervisor_assigned_at` / `_by` on:

- Hard unassign (`assigned_to → NULL`).
- Status leaving `pending` / `recount` (claim, complete, cancel, variance_review, approved).

Soft auto-release (status flips to pending while assigned_to remains) preserves the stamp — that's the entire point.

#### B2. Re-assignment within reservation state inherited the old timestamp

When an admin reassigned a row that was already in pending+assigned, `maintain_cycle_count_reservation_started_at` only fired on entry into reservation state. The OLD `reservation_started_at` carried over to the new assignee, so they got "instantly stale" and escalated within minutes.

**Fix.** The trigger now ALSO bumps `reservation_started_at = NOW()` when `assigned_to` changes within the pending+assigned state. Internal logic: `IF v_now_reserved AND v_was_reserved AND v_assignee_changed THEN bump`.

### Bug C — Critical priority not first

Server-side ordering inversion in `rust-work-service/src/db/queries.rs::claim_next_cycle_count`. Phase 1 ordered as `sticky → status → priority → ...`; Phase 2 ordered as `sticky → dedicated → priority → ...`. So a normal-priority sticky row could come BEFORE a critical-priority elsewhere row.

**Fix.** Both phases now lead with `priority`. Sticky / dedicated / heartbeat preferences are tiebreakers WITHIN the same priority tier so:

- Critical-elsewhere always beats normal-here.
- Normal-sticky-K2 still beats normal-elsewhere within the normal tier.

Phase 2's `LIMIT 50` was bumped to **`LIMIT 200`** so a critical row that happens to sort late by location (e.g. unresolved + alphabetical tail) doesn't fall outside the candidate window.

Path-rule occupancy filter no longer drops critical-priority candidates. Saturated aisles should NEVER hide a critical from an operator. Lower priorities still respect the limit.

## DB — migration 252

- **Schema.** `rr_cyclecount_data.supervisor_assigned_at` + `_by` (FK to user_profiles, ON DELETE SET NULL) + partial index. `cycle_count_zone_rules.treat_null_zone_as_locked` + `supervisor_assignment_protection_hours`.
- **`assign_cycle_count_to_user` rewrite.** Same return shape, same permission gate, but stamps the supervisor columns. Service-role callers (`auth.uid() IS NULL`) pass through and stamp `NULL` (which the application can render as "system"). Detects the force-variant via the bypass GUC and surfaces "(force-assigned)" in the success message.
- **`maintain_cycle_count_reservation_started_at` rewrite.** Adds the assignee-change-bump branch; adds the supervisor-clear logic.
- **`escalate_stale_zone_reservations` rewrite.** Joins `cycle_count_zone_rules` for the per-org `supervisor_assignment_protection_hours`. Adds the `supervisor_assigned_at IS NULL OR < window` guard. SECURITY DEFINER, service_role only — unchanged.
- **`enforce_cycle_count_zone_exclusivity` extension.** Reads `treat_null_zone_as_locked`. When set + `v_zone IS NULL`, takes a per-location advisory lock (`cyclecount_loc:<org>:<location>`) and raises `ZONE_LOCKED` with the friendly message *"Location "<X>" is currently held by <Y> (NULL-zone fallback). Only one counter may work this exact bin at a time."*
- **Forensic backfill.** Idempotent CTE that scans `cycle_count_assignment_history` + `rr_cyclecount_data` and stamps `supervisor_assigned_at` retroactively for any row that:
  1. Currently has `supervisor_assigned_at IS NULL` AND assigned_to is set AND status is pending/recount.
  2. Has a most-recent assignment_history entry by `reassigned_by IS NOT NULL` AND `reassigned_by IS DISTINCT FROM new_counter_id` (excludes self-claims).
  3. The reassign happened within the org's protection window.
  Result on org `c9d89a74-7179-4033-93ea-56267cf42a17`: **0 rows touched** — the only currently-pending+assigned rows are organic claims with no admin reassignment history. Bug B applies going forward, not retrospectively for this snapshot.

Live smoke test inside a `DO $smoke$` block exercised all three fix points:

- **Phase A.1** — `treat_null_zone_as_locked = false`: a second operator could claim a `<<empty>>`-location row held by another user. Behavior preserved.
- **Phase A.2** — flag flipped on: same claim now raises `ZONE_LOCKED: Location "<<empty>>" is currently held by … (NULL-zone fallback)`. Caught in the test's exception block.
- **Phase B.1** — recent supervisor stamp + 24h window: predicate excludes the row from escalation.
- **Phase B.2** — backdate the stamp 48h: predicate now matches.
- **Phase C** — replicate the new `priority FIRST` ORDER BY against a critical+normal pair: critical returns first.
- **Cleanup** — DELETE all `CC-SMOKE-*` rows under bypass GUC, reset rule flag.

All five phases passed in the live smoke. No orphan smoke rows. No production rows escalated by the test (the supervisor predicate was tested INLINE rather than by calling the real public function).

## Rust — `rust-work-service/src/db/queries.rs`

- **Phase 1 ORDER BY:** priority first; sticky-zone / status / heartbeat are tiebreakers within the priority tier.
- **Phase 1 zone-collision filter:** new `WHERE NOT EXISTS` guards a stale reservation from delivering an operator into a zone NOW actively held by a different user. Falls through to Phase 2 / next pull when collision detected.
- **Phase 2 ORDER BY:** priority first; sticky / dedicated zones are tiebreakers within tier; `LIMIT 50 → 200`.
- **Path-rule occupancy:** critical-priority counts bypass aisle saturation entirely.

`cargo check` clean. `cargo test --lib` 8/8 pass.

## Frontend

- **`src/lib/supabase/zone-rules.service.ts`.** `listActiveZones` no longer swallows errors — throws so callers can decide. The realtime subscriber wraps it in try/catch (no toast spam from silent reconnects). React Query in `useActiveZones` already handles thrown errors as the "error" state.
- **`src/hooks/use-unified-cycle-count.ts`.** Skip auto-claim no longer just logs on failure. Toasts the operator with a different message for `ZONE_LOCKED` / `ZONE_ASSIGNED` ("Skipped. Next-up count is in a zone reserved for someone else.") vs queue-empty ("Skipped. No more counts available right now.").
- **`src/components/work-distribution-panel.tsx`.** Push preflight against `useActiveZones()` + `useZoneAssignments()`. For each selected count, derives the zone (from `resolved_zone` or `deriveZone(location)`); flags conflicts with another active counter ("Zone reserved for X") OR an admin assignment to a different user ("Zone assigned to X"). Inline rose-colored warning lists each (zone, owner, count_count) tuple. Push button disabled until the admin clicks "Override Confirmed (admin force)". Aisle-collision warning preserved as a separate (amber) panel.
  - **Return to queue confirm dialog.** New ConfirmDialog with explicit assignment-clear copy ("Returning N counts clears their assignments. Any operator may then claim them on their next Pull Next."). Three-bullet detail list spells out exact effect.
- **`src/components/manual-counts-search.tsx`.**
  - **Mass assign.** `Promise.all → Promise.allSettled` + per-row aggregate. Toast variants: all-success → green "Assigned N"; partial → amber "Assigned N, blocked M" with a description that aggregates `zone reserved: K1, R0` / `zone assigned to others: K1` / `other: M` reason buckets. all-fail → red.
  - **"Deferred (was X)" badge.** When `assigned_to IS NULL` BUT `active_defer.find(d => d.is_active)` is set, render an amber outline badge with a `RotateCcw` icon and the prior assignee's name (when known via `counter_name`) instead of the muted "Unassigned".
  - **"Pull Next preview" sort preset.** New toolbar toggle button that mirrors the Rust Phase 2 ordering: priority → resolution_source (resolved first) → resolved_zone → resolved_aisle → resolved_sequence → location → created_at. Admins can see what the next operator would actually receive without spinning up an RF.

## Verification

- **Migration 252 applied** to Supabase via MCP (4 sequential `apply_migration` calls — schema, assign function, maintain trigger, escalator, zone trigger). Smoke test ran via `execute_sql` in a separate `DO $smoke$` block; all 5 phases pass; no orphan smoke rows.
- **Forensic backfill ran** (0 rows currently eligible — production has no admin-reassigned rows in `pending+assigned` state).
- **Live invariants:** 0 duplicate zone holders; 0 reservations >60 min stale that are ALSO supervisor-protected (the protection layer is new — pre-252 admin reassignments won't see retroactive protection).
- **Rust** `cargo check` clean; `cargo test --lib` 8/8 pass.
- **Frontend** `npx tsc -b --noEmit` clean. ESLint touched files clean (zero new warnings). Vitest 74/75 pass — the same `rf-cycle-count-unified > Release Confirmation` ConfirmDialog double-DOM failure that existed before this pass remains; verified by stash + re-run.

## Deployment

1. **Migration 252 already applied** (no follow-up required).
2. **Rust work-service must be redeployed** to Railway for the priority-first ordering fix in Phase 1 / Phase 2, the LIMIT bump, the critical-bypass for occupancy, and the Phase 1 zone-collision filter. Until redeployed, the DB enforcement (escalator + null-zone fallback + supervisor protection) is correct, but the **priority inversion bug C is still live**.
3. **Frontend bundle deploys normally** on next release.

## Files touched

- `supabase/migrations/252_cycle_count_bug_fix_pass.sql` (new)
- `rust-work-service/src/db/queries.rs`
- `src/lib/supabase/zone-rules.service.ts`
- `src/hooks/use-unified-cycle-count.ts`
- `src/components/work-distribution-panel.tsx`
- `src/components/manual-counts-search.tsx`

## Related

- [[Zone-Engine-Hardening-Pass-Migration-233]] — prior comprehensive hardening pass (advisory locks, `reservation_started_at`, view rewrite).
- [[Preserve-Supervisor-Assignment-On-Auto-Release]] — migration 231, soft-release-by-default. Companion fix to this pass: 231 fixed the soft path, 252 fixes the hard path.
- [[Restore-All-Wiped-Admin-Reassignments]] — manual sweep that pre-dated 252's columns.
- [[Cycle-Count-Zone-Exclusivity]] — original migration 225 design.
- [[Cycle-Count-Zone-Sticky-And-Assignments]] — sticky_zone + zone assignments background.
- [[Cycle-Count-Bug-Fix-Pass-2026-05-01]] — companion Debug note for this pass.
