---
tags: [type/debug, status/active, domain/backend]
created: 2026-04-11
---
# Fix: Cycle Count Location Ordering in RF Queue

## Issue
RF interface operators receiving cycle counts out of location order. Counts were served based on `created_at` or `assigned_at` timestamps instead of warehouse location path.

## Diagnosis
Multiple ordering bugs across the work service:

1. **Phase 2 `LIMIT 1`:** `claim_next_cycle_count` in `rust-work-service/src/db/queries.rs` fetched only 1 candidate row via `FOR UPDATE SKIP LOCKED LIMIT 1`. The Rust in-memory path-rules sort (alternating aisles, directional ordering) was dead code — it only ever had 0 or 1 rows to sort. If that row was blocked by path rules, user got nothing.

2. **Queue view `get_pending_cycle_counts`:** Ordered by `priority + created_at` — no location ordering.

3. **Phase 1 (existing assignment):** Ordered by `priority + assigned_at` — user's already-assigned tasks returned in assignment order, not location order.

4. **`get_worker_tasks`:** Ordered by `priority + pushed_at/assigned_at` — no location ordering.

5. **Phase 3 (deferred reclaim):** Ordered by `deferred_at ASC` — not location order.

6. **Legacy RPC `assign_next_cycle_count`:** Ordered by `priority + created_at` — no location fields.

## Solution

### Rust work service (`queries.rs`):
- All 5 queries now use unified ordering: **priority → unresolved-last → resolved_zone → resolved_aisle → resolved_sequence → location (text fallback) → tiebreaker**
- Phase 2 `LIMIT` increased from 1 to 50 so the Rust sort can operate on a real candidate pool
- In-memory sort also includes `location` string comparison as tiebreaker before original index

### Supabase migration (`214_fix_assign_next_cycle_count_location_ordering.sql`):
- Legacy `assign_next_cycle_count` RPC rewritten with same location ordering

## Related
- [[Components/Rust-Work-Service]]
- [[Implementations/Manual-Counts-Column-Filters]]
