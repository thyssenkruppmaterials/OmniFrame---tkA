---
title: Pull Next claim slowness — fixed
date: 2026-04-21
tags: [cycle-count, performance, rust-work-service, supabase, zone-exclusivity, hotfix]
status: fixed
---

# "Claiming Next Count" was hanging — fixed

## Symptoms

Operator tapped Pull Next in the RF app. "Claiming Next Count" spinner stayed up for several seconds before a count arrived — sometimes never, forcing a retry.

## Root causes (three, compounding)

### 1. `cycle_count_zone_of(location, zone_pattern)` didn't match the partial index

Migration 225 added `idx_rr_cyclecount_active_zone` on `split_part(location, '-', 1)`, but the WHERE / NOT EXISTS in the Rust claim query compared via the function `cycle_count_zone_of(location, zone_pattern)`. Because `zone_pattern` is a column (not a constant), the planner treated the expression as non-stable and couldn't match the indexed expression.

Result: `SubPlan 2 ... loops=5340` — the inner EXISTS scanned `idx_rr_cyclecount_active_zone` once per candidate row (5,340 times). `EXPLAIN ANALYZE` on prod data: **125 ms** just for candidate selection. Sticky-zone + zone-assignment ORDER BY (migration 227) would have made it worse.

### 2. `get_path_rule()` called once per candidate in Rust

`claim_next_cycle_count` returns up to 50 candidates. For each one, Rust called `get_path_rule(pool, ...)` which issues `fetch_all(...)` to pull **every** active path rule for the org, then filters in Rust. Up to **50 round-trips** pulling the same 1–10 rules.

At 10–30 ms per round-trip, this adds 500–1500 ms to every claim.

### 3. Sticky-zone / zone-assignment ORDER BY used correlated EXISTS per candidate

My own 227 work added nested EXISTS in ORDER BY that called `cycle_count_zone_of()` per row — same index-miss issue, amplified.

## Fix (migration 228 + Rust patch)

### DB (migration 228)

- **Generated STORED column** `rr_cyclecount_data.zone` computed as `split_part(location, '-', 1)` (with null-handling for empty / sentinel locations). Materializes once at insert/update; reads are O(1).
- Dropped the old partial index; created two column-based partial indexes:
  - `idx_rr_cyclecount_zone_active` — `(organization_id, zone, assigned_to)` WHERE `status IN ('in_progress','recount') AND assigned_to IS NOT NULL`.
  - `idx_rr_cyclecount_zone_claimable` — `(organization_id, zone)` WHERE `status IN ('pending','recount') AND assigned_to IS NULL`.
- Rewrote `enforce_cycle_count_zone_exclusivity()` trigger to use the `zone` column directly on the fast path (when `zone_pattern IS NULL`). Custom patterns still fall back to `cycle_count_zone_of()`.
  - **Bug caught during smoke test**: STORED generated columns are NOT populated in `NEW` during BEFORE triggers. Fixed by inlining the split_part formula in the trigger when deriving `v_zone` from the row being written (OTHER rows are fine because their `zone` is already materialized). Documented inline.

### Rust (`rust-work-service/src/db/queries.rs`)

- Rewrote Phase 2 WHERE / ORDER BY to compare `rcc.zone = active.zone` directly — no function calls. Left-join on `cycle_count_zone_rules` so the filter is skipped when rules are disabled.
- Two new helpers:
  - `get_all_active_path_rules(pool, org_id)` — fetches the full rule set once.
  - `find_matching_path_rule(rules, warehouse, zone, aisle)` — pure function, no DB IO.
- `claim_next_cycle_count` now calls `get_all_active_path_rules` ONCE before the candidate loop and uses `find_matching_path_rule` in the loop. Eliminates 50 round-trips.
- Old `get_path_rule` kept with `#[allow(dead_code)]` for potential external callers; pull-next ranker no longer uses it.

### `FOR UPDATE` clause

Because Phase 2 now has a LEFT JOIN against `cycle_count_zone_rules`, the lock was ambiguous. Changed to `FOR UPDATE OF rcc SKIP LOCKED` so only the candidate row gets locked, not the rules row.

## Before / after

| Metric                                       | Before     | After   |
|----------------------------------------------|-----------:|--------:|
| Phase 2 candidate SELECT (EXPLAIN ANALYZE)   | **125 ms** | **12–16 ms** |
| Inner SubPlan loops                          | 5,340      | 1 (hashed) |
| Path-rule fetches per claim                  | Up to 50   | 1       |
| Estimated total pull-next latency (p50)      | 1–3 s      | < 100 ms |

## Files touched

- `supabase/migrations/228_zone_column_perf.sql` (new)
- `rust-work-service/src/db/queries.rs` (Phase 2 rewrite + `get_all_active_path_rules` + `find_matching_path_rule`)

## Verification

- `EXPLAIN ANALYZE` on the rewritten query: 16 ms (parallel seq scan used, subplans hashed, `idx_rr_cyclecount_zone_active` picked up).
- Trigger still rejects Nikki trying to claim Jai's K2 (`ZONE_LOCKED` / `ZONE_ASSIGNED` fire correctly on the fast path).
- `cargo check` clean; `npx tsc -b --noEmit` clean; 54/54 cycle-count unit tests pass.
- State rolled back after testing.

## Deployment

- Migration 228 applied via Supabase MCP (generated column backfilled all 7,229 rows automatically, trigger replaced).
- **Rust work-service MUST be redeployed** for the candidate-query rewrite + batched path-rule fetch to take effect. Until then, the DB still enforces correctness via the trigger, but pull-next latency stays in the multi-second range.

## Lessons

- BEFORE triggers can't read STORED generated columns on the `NEW` row — always inline the formula.
- Function calls in WHERE clauses that take column arguments don't match functional indexes — materialize to a column if the expression is hot.
- Never put a DB call inside a ranker loop. Batch + filter in memory.
