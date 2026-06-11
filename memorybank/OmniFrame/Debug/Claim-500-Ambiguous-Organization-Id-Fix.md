---
title: Rust /work/claim returning 500 — "column organization_id is ambiguous"
date: 2026-04-22
tags: [rust-work-service, cycle-count, hotfix, pull-next]
status: fixed
---

# Hotfix: `/work/claim` 500 — ambiguous `organization_id`

## Symptom

RF interface "Pull Next Count" returned HTTP 500 from `POST /api/v1/work/claim` on Railway. Frontend bubbled up as `Error: Database error`.

## Cause

Postgres log: `ERROR: column reference "organization_id" is ambiguous`.

In the performance rewrite (migrations 228 + rust queries.rs) I left-joined `cycle_count_zone_rules rules ON rules.organization_id = rcc.organization_id` so the WHERE clause could short-circuit when rules were disabled. But the SELECT list had unqualified column references (`organization_id`, `created_at`, etc.) — with two tables now in the FROM clause each owning an `organization_id`, Postgres couldn't disambiguate.

## Fix

Removed the LEFT JOIN and inlined the rules check into each WHERE / ORDER BY clause as a correlated EXISTS. `cycle_count_zone_rules` has one row per org so correlated subqueries are cheap (planner collapses them into hashed subplans / init plans).

All column references in the SELECT list and ORDER BY are now either implicit (single-table FROM) or explicitly `rcc.*`-prefixed.

## Verification

- `cargo check` clean.
- `cargo test --lib` — 8 passed.
- `EXPLAIN ANALYZE` on production data: **29.7 ms execution time**, uses `idx_rr_cyclecount_zone_claimable` for the outer scan and `idx_rr_cyclecount_zone_active` for the correlated subplans. Sticky-zone + zone-assignments `EXISTS` collapse into One-Time InitPlans.

No ambiguity errors in the plan.

## Deployment

Requires a new Rust build on Railway (`rust-work-service`). Until that deploys, the 500s will continue because the live service still has the broken SQL baked into the binary.

## Files touched

- `rust-work-service/src/db/queries.rs` — Phase 2 SELECT rewritten to drop the LEFT JOIN and use correlated EXISTS throughout.

## Lesson

When adding a JOIN to a wide SELECT, run an `EXPLAIN` locally before deploying. The error only surfaces at runtime because the planner can't resolve the unqualified reference; SQLX's compile-time macros would have caught it but we're using `query_as::<_, CycleCountTask>()` which is runtime-checked.
