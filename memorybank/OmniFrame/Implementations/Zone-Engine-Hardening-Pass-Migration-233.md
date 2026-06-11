---
title: Zone Engine Hardening (migration 233 + Rust + Frontend)
date: 2026-04-24
tags: [cycle-count, zone-exclusivity, hardening, race-conditions, rls, observability, websocket]
status: shipped
---

# Comprehensive zone-engine hardening pass

Closed every issue surfaced by the multi-pass code review (DB invariants, Rust queue, RF UI, dashboard, architecture). One migration plus targeted Rust + frontend changes.

## DB — migration 233

- **Trigger advisory lock.** `enforce_cycle_count_zone_exclusivity` now takes `pg_advisory_xact_lock(hashtextextended('cyclecount_zone:<org>:<zone>', 0))` before the holder check, so concurrent claims serialize through the trigger. Closes the last race window.
- **Bypass order corrected.** Explicit `cycle_count_zone_assignments` (admin “this zone is X’s”) is checked FIRST and is *never* bypassable by `bypass_priorities` / `bypass_count_types`. Bypass overrides only apply to the active/reserved exclusivity check that follows.
- **Reservation metadata.** `rr_cyclecount_data.reservation_started_at timestamptz` plus a maintenance trigger that stamps it on entry into `pending+assigned_to` state and clears it on exit. Backfilled from `updated_at` for existing reservations.
- **Escalation rewritten on durable state.** `escalate_stale_zone_reservations` keys off `reservation_started_at` (with `updated_at` fallback) and heartbeat staleness; no more notes-regex.
- **`v_cycle_count_active_zones` rewritten** to use `cycle_count_zone_of(location, zone_pattern)` so per-org custom patterns roll up correctly. New columns: `actively_counting`, `reserved_count`, `earliest_reservation_at`, `has_active`, `has_reservation`, plus split arrays `active_ids` / `reserved_ids`.
- **Index** `idx_rr_cyclecount_zone_holders` covers `pending|in_progress|recount` with `assigned_to NOT NULL` (matches the new trigger and Rust prefilter predicate).
- **`apply_cycle_count_priority_rules` auth fix.** Explicit `p_org_id` now requires either service_role (auth.uid() null) OR a caller whose role is admin/manager/superadmin/logistics_coordinator AND whose `organization_id` equals `p_org_id`.
- **Scheduler RPCs hardened.** `release_stale_heartbeat_assignments` and `escalate_stale_zone_reservations` are now `SECURITY DEFINER` and `GRANT EXECUTE` only to `service_role`. No more silent partial failures from authenticated callers.
- **RLS lists extended.** All three rr_cyclecount_data policies (view/update/delete) now include `logistics_coordinator` in the admin role list.

Live smoke tests via a temporary `_zone_smoke233()` SQL function passed all 7 phases:

- Active claim succeeds, second claim by another user is `ZONE_LOCKED` (active variant)
- Soft release populates `reservation_started_at`
- Second claim against pending+assigned gets `ZONE_LOCKED` (reserved variant)
- `bypass_priorities=['normal']` lets a normal-priority claim through when no zone assignment exists
- Zone-to-user assignment causes `ZONE_ASSIGNED` to fire even with bypass priorities active (admin intent never bypassed)
- Cleanup successful

## Rust

### queries.rs

- **Phase 2 prefilter is now zone_pattern-aware** (`COALESCE(cycle_count_zone_of(location, zone_pattern), zone)`), matching the trigger for orgs that configure a custom pattern.
- **Phase 1 sticky zone preference**: when an operator already holds active or recently-heartbeated rows in a zone, those rows come first.
- **Path rules + occupancy** are read through new `_tx` variants (`get_all_active_path_rules_tx`, `get_occupied_aisles_tx`) so the ranker shares the same snapshot as `FOR UPDATE SKIP LOCKED`.

### scheduler/mod.rs

- **Queue stats broadcast is org-scoped.** Single grouped query produces one `QueueStatsUpdated` per org, each carrying `organization_id`. Cross-tenant leak closed.
- **`ReservationEscalated` event** distinct from no-op `pending→pending TaskStatusChanged`. UIs can refresh “reserved-for” state cleanly.
- **Auto-release events** now carry `reason` (`auto_release` / `claim` / `start` / `complete` / `release` / `skip`) plus `organization_id`.

### websocket/mod.rs

- **Per-org filtering.** Clients send `Subscribe { organization_id }`; the send loop only forwards events whose `organization_id` is None or matches.
- **`organization_id` field on every WsEvent variant** (extra fields, wire-compatible with the existing TS deserializer).
- New helper `WsEvent::organization_id()` for filtering.
- WS heartbeat persistence remains TODO until auth-on-upgrade lands; in the meantime the frontend forces HTTP heartbeats for stateful payloads.

## Frontend

- **`use-cycle-count-operations` search** now also matches `resolved_zone` and `resolved_aisle`.
- **`use-priority-rules.apply`** invalidates `CYCLE_COUNT_OPERATIONS_QUERY_KEY` and `CYCLE_COUNT_STATISTICS_QUERY_KEY` on success so the dashboard reflects re-scored priorities immediately.
- **`zone-rules-panel`**: Live Zone Activity refresh button now wires to `useActiveZones().refetch`. “Active count” copy split into `N in progress · N reserved`. Stuck Assignments description corrected to mention reserved as well as in-progress.
- **`live-operator-status`**: counter now reads “N active” (online + busy + idle) with separate `busy` and `idle` chips. Operator line shows `current_location → current_zone → “Working…”` so an idle/recovering operator doesn’t look blank.
- **`use-unified-cycle-count`**: 
  - Skip auto-claim wrapped in try/catch — a failed auto-claim no longer leaves the RF in a bad state.
  - Pushed-task fetch failure now toasts the operator instead of swallowing.
  - `complete` and `release` invalidate `PUSHED_WORK_QUERY_KEY` so the badge stays correct.
  - WS heartbeat in `rf-interface` now presence-only; `useWorkerHeartbeat` is the single authoritative HTTP path for stateful heartbeats.
  - `useWorkerHeartbeat` always uses HTTP (since WS doesn’t persist server-side yet).
- **`rf-cycle-count-unified` release**: removed duplicate “Task released” toast (hook handles it).

## Verification

- **Migration 233 applied** to Supabase via MCP. All 7 smoke-test phases pass.
- **Live invariants**: 0 duplicate zone holders, 0 reservations >60 min stale, 0 stale heartbeat zones, view consistent.
- **Rust** `cargo check` clean, `cargo test --lib` 8/8 pass.
- **Frontend** `npx tsc -b --noEmit` clean. Cycle-count + hooks tests 54/54 pass. Pre-existing failures (rbac-hardening storage mock, env-var-dependent security tests, ConfirmDialog double-DOM) unchanged — zero test regressions from this pass.

## Deployment

1. Migration 233 already applied (no follow-up required).
2. **Rust work-service must be redeployed** to Railway for: zone_pattern-aware prefilter, sticky-zone Phase 1, transaction-scoped reads, org-scoped queue stats, `ReservationEscalated` event, per-org WS filtering. Until redeployed:
   - DB enforcement is correct.
   - Stats broadcasts continue to be globally aggregated.
   - WS events continue to lack `organization_id`.
3. Frontend bundle deploys normally on next release.

## Files touched

- `supabase/migrations/233_zone_engine_hardening.sql` (new)
- `rust-work-service/src/db/queries.rs`
- `rust-work-service/src/scheduler/mod.rs`
- `rust-work-service/src/websocket/mod.rs`
- `rust-work-service/src/api/routes/work.rs`
- `src/hooks/use-cycle-count-operations.ts`
- `src/hooks/use-priority-rules.ts`
- `src/hooks/use-zone-rules.ts`
- `src/hooks/use-unified-cycle-count.ts`
- `src/hooks/use-pushed-work.ts`
- `src/components/zone-rules-panel.tsx`
- `src/components/live-operator-status.tsx`
- `src/features/rf-interface/rf-interface.tsx`
- `src/components/ui/rf-cycle-count-unified.tsx`

## Architecture roadmap items (deferred, not in this PR)

These are tracked in `Decisions/Work-Engine-Roadmap-Cycle-Counts-To-Picks-Putaways.md` and are intentionally out of scope here:

- `work_tasks` polymorphic orchestration table (Tier 1).
- Worker capabilities / skills (Tier 1).
- Generalized priority rules (rename + `task_type`) once `work_tasks` lands.
- Durable lifecycle event table (`work_audit_events`) replacing notes-tail audit.
- Externalize scheduler thresholds to per-org / per-warehouse config.
- Retire legacy `assign_next_cycle_count` SQL RPC in favor of work-service-only path.
- WS auth-on-upgrade so server-side heartbeat persistence can replace HTTP fallback.
