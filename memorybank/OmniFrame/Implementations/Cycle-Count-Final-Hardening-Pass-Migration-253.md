---
tags: [type/implementation, status/active, domain/database, domain/backend, domain/frontend, cycle-count, zone-exclusivity, supervisor-intent, hardening, websocket, rust]
created: 2026-05-01
---

# Cycle-count final hardening pass — migration 253

Final pass after the 252 multi-pass review surfaced ten more gaps. Same playbook as [[Cycle-Count-Bug-Fix-Pass-Migration-252]]: validate each gap on the actual code + live DB, fix, verify, document. Default behaviors do NOT regress for existing orgs.

## Gaps closed (10 audited; 9 fixed, 1 was already mitigated)

### CRITICAL

#### Gap 1 — Rust `push_cycle_count` did not stamp supervisor columns

`push_cycle_count` (`rust-work-service/src/db/queries.rs`) directly UPDATEd `rr_cyclecount_data` and never set `supervisor_assigned_at` / `supervisor_assigned_by`. A pushed-but-not-acknowledged row was therefore unprotected from `escalate_stale_zone_reservations` — exactly the silent-unassign bug 252 fixed for the SQL `assign_cycle_count_to_user` path.

**Fix.** UPDATE now sets `supervisor_assigned_at = NOW(), supervisor_assigned_by = $pushed_by` alongside the rest of the push state. Re-stamps with the current pusher even if a prior stamp existed — the latest push expresses the latest supervisor intent.

#### Gap 2 — Phase 1 priority must be first sort key (NOT REAL — already fixed)

The audit reported Phase 1 still ordered `sticky → status → priority`. **Verified false** — the file shows `ORDER BY CASE rcc.priority::text WHEN 'critical' THEN 1 …` as the FIRST key (line 238 of `claim_next_cycle_count`), with sticky / heartbeat as tiebreakers within the priority tier. The 252 pass already covered this. Skipped — no change needed.

### HIGH

#### Gap 3 — WebSocket org isolation leaks before Subscribe

`websocket/mod.rs::handle_socket` send loop only filtered when both `subscribed_org` AND `event.organization_id()` were `Some`. Before the Subscribe message arrived, `subscribed_org = None` → the `(Some, Some)` arm didn't match → org-scoped events broadcast freely to every pre-Subscribe socket. Cross-tenant leak in the connect → first-Subscribe window.

**Fix.** Replaced the `if let (Some, Some)` filter with an explicit `match (sub, event_org)` that:
- Drops on org mismatch (existing behavior).
- Drops on `(None, Some)` — deny-by-default for org-scoped events.
- Forwards `(_, None)` system-wide events always.
- Forwards subscribed-client matches.

#### Gap 4 — Queue stats semantics diverge between REST and scheduler broadcast

REST `get_queue_stats` and scheduler `broadcast_queue_stats` were producing different numbers for the same data:
- REST `pending` = `assigned_to IS NULL`. Scheduler counted ALL pending (including reserved-with-assignee).
- REST `completed_today` = `status IN ('completed','approved') AND updated_at::date = CURRENT_DATE`. Scheduler used `status='completed' AND completed_at >= CURRENT_DATE`.
- REST exposed `pushed_pending` and `total_workers_online`. The WS event payload omitted both.

**Fix.** Rewrote `broadcast_queue_stats` to mirror `get_queue_stats` predicates 1:1, grouped per-org via a `WITH orgs AS (… UNION …)` CTE that covers both rr_cyclecount_data orgs and active-heartbeat orgs (so an org with online workers but no CC rows still appears). Added `pushed_pending` + `total_workers_online` to `WsEvent::QueueStatsUpdated` with `#[serde(default)]` so older clients are unaffected.

#### Gap 5 — Zone Rules UI missing 252 controls

Migration 252 added two columns to `cycle_count_zone_rules`: `treat_null_zone_as_locked boolean` and `supervisor_assignment_protection_hours int default 24`. Frontend `ZoneRules` / `ZoneRulesUpdate` types omitted them, so admins couldn't toggle either from the UI.

**Fix.**
- Added both fields to `ZoneRules` and `ZoneRulesUpdate` in `src/lib/supabase/zone-rules.service.ts`.
- `zone-rules-panel.tsx`: new switch for `treat_null_zone_as_locked` (with explanatory copy about NULL-zone fallback) under the Sticky Zone toggle. Number input for `supervisor_assignment_protection_hours`, range 1–168h, default 24h, hydrated from the fetched rule, dirty/reset/save flow wired through.

#### Gap 6 — Push panel didn't aggregate push results

`work-distribution-panel.tsx::handlePush` looped `pushToUser({...})` (React Query `mutate`, fire-and-forget), then immediately ran `onPushComplete()` in `finally`. Failures (e.g. ZONE_LOCKED on a per-row basis) were silent at the panel level — operators saw nothing but a generic per-row toast from the underlying mutation.

**Fix.** `Promise.allSettled` over `workServiceClient.pushToUser` directly (bypasses the React Query mutation so per-row toasts don't fire). Failures bucketed into `reservedZones` / `assignedZones` / `otherFailures` via `parseZoneLockError`. One aggregate toast: success / partial (warning, with description "zone reserved: K1 (3), R0 (1) · zone assigned to others: SF (2) · other: 1") / all-fail (error). `onPushComplete()` called only after all settle. New helper `formatPushFailureBuckets` keeps the description bounded to 3 zones per bucket + "+N more".

### MEDIUM

#### Gap 7 — Mutations don't invalidate active zones; per-row toast spam

`use-cycle-count-operations.ts` `assignCountToUser` / `unassignCount` / `updateCycleCountPriority` only invalidated `CYCLE_COUNT_OPERATIONS_QUERY_KEY` and `CYCLE_COUNT_STATISTICS_QUERY_KEY`. Active zones (`ACTIVE_ZONES_QUERY_KEY`) and zone assignments (`ZONE_ASSIGNMENTS_QUERY_KEY`) silently went stale. Per-row toasts also spammed bulk callers.

**Fix.**
- Exported `ACTIVE_ZONES_QUERY_KEY` / `ZONE_ASSIGNMENTS_QUERY_KEY` / `ZONE_RULES_QUERY_KEY` from `use-zone-rules.ts`.
- Added a single `invalidateAssignmentQueries` helper in `use-cycle-count-operations.ts` that touches all four keys; reused across the three mutations.
- Added `{ silent?: boolean }` option to all three public functions. When `silent: true`, the per-row success/error toast is suppressed. Default `false` preserves single-row dashboard interactions.
- Updated `manual-counts-search.tsx::handleMassAssignConfirm` to pass `{ silent: true }` so the existing aggregate summary toast is the single source of truth for bulk feedback.

#### Gap 8 — Migration 252 smoke `WHEN raise_exception` invalid

`raise_exception` is not a PL/pgSQL exception condition name. The 252 smoke `DO $smoke$` block would throw `ERROR: 42601: unrecognized exception condition 'raise_exception'` if anyone re-ran the migration on a fresh environment. The migration body itself ran clean on production (the smoke is separate).

**Fix.** In-place edit to `supabase/migrations/252_*.sql`: `EXCEPTION WHEN raise_exception THEN` → `EXCEPTION WHEN SQLSTATE 'P0001' THEN`. Matches by SQLSTATE (the actual code raised by `RAISE EXCEPTION ... USING ERRCODE = 'P0001'`). No-op on production (already applied). Important for migration repeatability + any future fresh-environment provisioning.

#### Gap 9 — Phase 1 zone collision check used raw `held.zone`, not pattern-aware

Phase 2 of `claim_next_cycle_count` uses `cycle_count_zone_of(location, zone_pattern)` for both the holder check and the sticky preference. Phase 1 used `held.zone = rcc.zone` against the materialized first-segment column. For orgs with a custom `zone_pattern` configured, Phase 1 could hand back a stale reservation in the same logical zone as another active counter.

**Fix.** Phase 1 now mirrors Phase 2's logic — wraps the `NOT EXISTS` in a `cycle_count_zone_rules` join filtered to `enabled = true AND policy = 'one_counter_per_zone'`, and compares `COALESCE(public.cycle_count_zone_of(other.location, zr_p1.zone_pattern), other.zone) = COALESCE(…rcc.location…)`. Same pattern, same answer in both phases.

### LOW

#### Gap 10 — `assign_next_cycle_count` legacy RPC accepted arbitrary `p_user_id`

`SECURITY DEFINER` + GRANTed to PUBLIC + anon + authenticated + service_role + postgres. Accepted `p_user_id` parameter without binding to `auth.uid()`. Any authenticated session could assign work to any other user in the org. Not currently exploited (Rust owns the live claim path), but a real security gap.

**Fix (migration 253).**
1. Function rebuild: non-service-role callers get rejected with `Permission denied` if `p_user_id <> auth.uid()`. Service-role keeps full impersonation (`auth.uid() IS NULL`).
2. `REVOKE ALL … FROM PUBLIC` and `REVOKE ALL … FROM anon`. `authenticated` + `service_role` retain `EXECUTE` (the two deprecated frontend services that still call this RPC always pass `user.id`, so they continue to work).
3. Live grant audit post-253: `[postgres, authenticated, service_role]` — clean.

## Files touched

- `supabase/migrations/253_cycle_count_final_hardening_pass.sql` (new)
- `supabase/migrations/252_cycle_count_bug_fix_pass.sql` (in-place: gap 8 smoke fix)
- `rust-work-service/src/db/queries.rs` (gaps 1, 9)
- `rust-work-service/src/websocket/mod.rs` (gaps 3, 4 event payload)
- `rust-work-service/src/scheduler/mod.rs` (gap 4)
- `src/lib/supabase/zone-rules.service.ts` (gap 5 types)
- `src/components/zone-rules-panel.tsx` (gap 5 UI)
- `src/components/work-distribution-panel.tsx` (gap 6)
- `src/hooks/use-zone-rules.ts` (gap 7 export keys)
- `src/hooks/use-cycle-count-operations.ts` (gap 7 invalidation + silent option)
- `src/components/manual-counts-search.tsx` (gap 7 caller passes silent: true)

## Verification

- **Migration 253 applied** to Supabase via MCP (`apply_migration` for the function rewrite + grant flip). Live smoke `DO $smoke$` block passes — guard string present in `pg_get_functiondef`, grants = `[postgres, authenticated, service_role]`, service-role pass-through returns a real result.
- **Live invariants (5 of 5 clean post-253):**
  - `inv1_dup_zone_holders`: 0
  - `inv2_unstamped_admin_reassign`: 0 (within last 24h on org `c9d89a74-…`)
  - `inv3_orphan_zone_assignments`: 0
  - `inv4_raw_zone_in_heartbeat`: 0 (last 12h)
  - `inv5_assign_next_grants_clean`: 0 PUBLIC/anon grants
- **Rust** `cargo check` clean. `cargo test --lib` 8/8 pass.
- **Frontend** `npx tsc -b --noEmit` clean. ESLint on touched files: 0 errors, 13 warnings (all pre-existing). Vitest on `src/lib/supabase/__tests__`, `src/hooks/__tests__`, `src/features/rf-interface/__tests__`: 74/75 pass — the same pre-existing `rf-cycle-count-unified.test.tsx:554` Release Confirmation double-DOM ConfirmDialog failure documented in the 252 session log persists; not introduced by this pass.

## Deployment

1. **Migration 253 already applied** on Supabase prod (`wncpqxwmbxjgxvrpcake`). No follow-up DDL.
2. **Rust work-service must be redeployed** on Railway (`fac8472c-…`) to ship gaps 1, 3, 4, 9. Until redeployed:
   - Pushed counts continue to lose supervisor protection after the threshold (gap 1 — DB stamp not set by Rust path).
   - WS bursts may leak across orgs in the connect → first-Subscribe window (gap 3).
   - QueueStats numbers diverge between REST and WS event (gap 4).
   - Phase 1 of pull-next can deliver into a pattern-collision zone (gap 9, low impact — only orgs with custom `zone_pattern`).
3. **Frontend bundle deploys normally** on next release. Touched files compile clean and surface the new admin controls + better push aggregation immediately.

## Related

- [[Cycle-Count-Bug-Fix-Pass-Migration-252]] — direct precursor; this pass closes the gaps that 252's review surfaced.
- [[Zone-Engine-Hardening-Pass-Migration-233]] — the broader zone-exclusivity hardening foundation.
- [[Preserve-Supervisor-Assignment-On-Auto-Release]] — companion soft-release fix.
- [[Cycle-Count-Bug-Fix-Pass-2026-05-01]] — Debug companion for 252.
- [[Cycle-Count-Final-Hardening-Pass-2026-05-01]] — Debug companion for THIS pass.
