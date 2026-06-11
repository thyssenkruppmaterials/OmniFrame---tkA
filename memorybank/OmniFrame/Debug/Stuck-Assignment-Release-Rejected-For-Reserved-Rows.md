---
tags: [type/debug, status/active, domain/database, domain/frontend]
created: 2026-05-08
---
# "Count is not currently assigned / in progress" — fixed

## Symptoms

In **Inventory Management → Count Settings → Zone Rules**, the **Stuck Assignments** card listed K3 / Jai Singh (`1 reserved · last seen 52m ago`). Clicking **Release** or **+ Unassign** on the row produced the error toast `Count is not currently assigned / in progress`. The header **Release All** silently reported `released = 0`. The admin had no way to clear the stuck row from the UI.

Reproduced on prod against `rr_cyclecount_data.id = 97d474d4-cbcb-442a-973d-a36d28674d65` (`CC-20260424-0611`), which sat in `status='pending' + assigned_to=8fe94172…` for ~50 minutes.

## Root cause — interaction of three migrations

1. **231** introduced *soft auto-release*: when an operator's heartbeat goes stale, the scheduler flips `status` to `pending` but **keeps `assigned_to`**, preserving supervisor intent.
2. **233** rewrote `v_cycle_count_active_zones` to roll up *both* actively-counted rows (`actively_counting`) **and** soft-released rows (`reserved_count` = `pending+assigned_to`). The Stuck Assignments card iterates `active_count_ids`, the union of both subsets.
3. The release RPCs themselves (`release_stuck_cycle_count_assignment`, `release_all_stuck_cycle_count_assignments`) were **never** widened. They still gated on `status IN ('in_progress','recount')`, so the moment a row was soft-released the admin path could no longer touch it.

Net effect: every row visible in the "Stuck Assignments" card under the **reserved** sub-rollup was unreleasable via the UI. The single-row RPC rejected with the error message; the bulk RPC silently filtered the row out and reported zero releases.

## Fix — migration 290

`supabase/migrations/290_release_stuck_includes_reserved.sql` widens both RPCs:

- Precondition `status IN ('in_progress','recount')` → `status IN ('pending','in_progress','recount')` (with `assigned_to IS NOT NULL` unchanged).
- Soft branch is now idempotent on already-pending rows — bumps `updated_at` and appends an audit note. Original semantics ("keep the assignment, return the row to the pull queue for the same operator") still hold.
- Hard branch (`p_also_unassign := true`, exposed as **+ Unassign**) clears `assigned_to` regardless of whether the row was actively counted or already soft-released. This is the action admins actually want against a stale reservation.
- Updated error message for the rejected case from `"Count is not currently assigned / in progress"` to `"Count has no live assignment to release"` (only fires for terminal/unassigned rows now).
- Bulk RPC's predicate also widened so **Release All** / **+ Unassign** in the card header includes reserved rows when their owner heartbeat is older than the threshold.
- `release_stale_heartbeat_assignments` is untouched (already correct per migration 231).

Applied to prod via Supabase MCP (`apply_migration: release_stuck_includes_reserved_290`). `pg_get_functiondef` confirms the new bodies are live.

## UI tightening

`src/components/zone-rules-panel.tsx` `StuckZonesCard` — split `z.active_count_ids` into separate render passes for `z.active_ids` and `z.reserved_ids`:

- Active row → `[Release] [+ Unassign]` (both meaningful).
- Reserved row → `[Reserved badge] [+ Unassign]` (Release would be a no-op, hiding it prevents the user from clicking repeatedly thinking nothing happened).

Keeps the per-zone grouping and overall row count identical, but the action buttons now match what each row actually needs.

## Verification

- `pg_get_functiondef` against both RPCs returns the new bodies.
- Predicate probe against the K3 row (`97d474d4-…`) returns `would_match_bulk = true` under the new RPC.
- `npx tsc -b --noEmit` clean.
- `pnpm vitest run` — 228 passed / 24 failed (24 are pre-existing jsdom `storage.getItem` failures, identical with and without this change; zero regressions).

## Deployment

- Migration 290 already applied to Supabase (`wncpqxwmbxjgxvrpcake`).
- Frontend deploys normally. No Rust changes required — scheduler already uses `release_stale_heartbeat_assignments` which was correct.

## Files touched

- `supabase/migrations/290_release_stuck_includes_reserved.sql` (new)
- `src/components/zone-rules-panel.tsx` — `StuckZonesCard` button split

## Related

- [[Stuck-Zone-Assignments-When-Operator-Offline]]
- [[Preserve-Supervisor-Assignment-On-Auto-Release]]
- [[Zone-Engine-Hardening-Pass-Migration-233]]
