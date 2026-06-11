---
tags: [type/debug, status/active, domain/frontend, domain/database, domain/backend]
created: 2026-05-20
---
# Fix — Slow PostgREST LATERAL Embeds (2026-05-20)

## Purpose / Context

Follow-on to [[Performance-Review-2026-05-19-Production-Slowness]] /
[[Apply-Performance-Review-Fixes-2026-05-19]]. After yesterday's RLS
init-plan rewrite + Redis restore + FK indexing, the next two queries
still dominating `pg_stat_statements` were the same two heavy PostgREST
list-fetches that depend on `user_profiles` joins — `rf_putaway_operations`
(625k calls × 2.1s mean) and `rr_cyclecount_data` (95k calls × 2.98s
mean). Together: ~367 hours of cumulative CPU time. This note documents
the two-query refactor that removes the LATERAL embeds on the frontend
side without touching Rust services, FastAPI, or Supabase.

## Symptom — what `pg_stat_statements` saw

Two near-identical queries with `LEFT JOIN LATERAL (SELECT user_profiles.id,
full_name, email FROM user_profiles WHERE id = parent.confirmed_by LIMIT
$1 OFFSET $2)` patterns, one per FK column:

| table | LATERAL targets | mean ms | calls |
|---|---|---:|---:|
| `rf_putaway_operations` | `confirmed_by`, `mca_processed_by` | 2,115 | 625,259 |
| `rr_cyclecount_data` | `created_by`, `approved_by`, `assigned_to` | 2,983 | 95,127 |

Both issued by the browser via `supabase-js`'s embed sugar:

```ts
supabase.from('rf_putaway_operations').select(`
  *,
  confirmed_by_user:user_profiles!confirmed_by(id, full_name, email),
  mca_processed_by_user:user_profiles!mca_processed_by(id, full_name, email)
`)
```

PostgREST translates this to a `LEFT JOIN LATERAL` subquery per row, and
on a 47k-row table paginated as 1000-row chunks the planner picks a
nested-loop LATERAL — N × per-row RLS evaluations of `user_profiles`.
Result: 2-3 s per chunk, repeated 47 / 18 times per full table load.

## Fix — drop the embed, two-query enrichment

### 1. Shared helper — `src/lib/supabase/enrich-with-user-profiles.ts` (NEW)

Exports:

- `fetchUserProfilesByIds(ids, client?)` — returns `Map<id, {id, full_name,
  email}>`. Empty input → empty map (no network). Chunks ids into 500-id
  IN-list batches to avoid URL length limits. Errors are logged but
  swallowed (presentation-only enrichment).
- `attachUserProfiles(rows, [[fkCol, alias], …], client?)` — mutates rows
  in place, attaching the resolved profile under `alias` for each
  `fkCol → alias` mapping.

Defaults to the `supabaseRead` client per
[[Supabase-Read-Replica-Routing]] — `user_profiles` lookups are pure
reads.

### 2. Call sites refactored

| File | What changed |
|---|---|
| `src/lib/supabase/putaway-log.service.ts` | `fetchPutawayOperations` + `searchPutawayOperations` now select `*` (no LATERAL embed) and call `attachUserProfiles(rows, [['confirmed_by', 'confirmed_by_user'], ['mca_processed_by', 'mca_processed_by_user']])` after all chunks land. `PutawayOperationsWithUser` type rewritten from `QueryData<typeof query>` to a hand-written `PutawayOperationRow[]` with the same runtime shape. All read paths routed to `supabaseRead`. |
| `src/lib/rust-core/putaway-log.service.ts` | Both `fetchPutawayOperations` (parallel) and `fetchPutawayOperationsSupabase` (sequential fallback) refactored to mirror the supabase service. Same type rewrite. Same read-replica routing. |
| `src/lib/supabase/cycle-count.service.ts` | `fetchCycleCountData` drops the three `user_profiles!*` embeds (created/approved/assigned) and stitches them in via one `attachUserProfiles` call. The small `active_defer:cycle_count_operator_deferred_counts(…)` child embed is preserved because it isn't against `user_profiles` and isn't the slow path. Reads routed to `supabaseRead`. |

Intentionally NOT touched: `getCycleCountById` (single-row detail view —
the embed cost on one row is negligible), `rr_grip_processing` /
`rr_grsgrip_processing` / `rr_inbound_carts` (still using `user_profiles!`
embeds but not in the slow-query top-cost list — different tables, much
lower call volume).

### 3. Pattern (the two-query shape)

```ts
// Phase 1 — fetch rows planar, no embed.
const { data: rows } = await supabaseRead
  .from('rf_putaway_operations')
  .select('*')
  .order('created_at', { ascending: false })
  .range(from, to)

// Phase 2 — one IN-list lookup attaches all FK profiles in one shot.
await attachUserProfiles(rows, [
  ['confirmed_by',     'confirmed_by_user'],
  ['mca_processed_by', 'mca_processed_by_user'],
])
```

Resulting row shape is byte-identical to what the LATERAL embed produced,
so downstream renderers (`putaway-log-search.tsx`, `manual-counts-search.tsx`,
`exportToCSV`, etc.) need ZERO changes.

## Expected impact

Quoting `pg_stat_statements` from [[Performance-Review-2026-05-19-Production-Slowness]]:

- **`rf_putaway_operations`**: 2,115 ms × 625,259 calls → 367 hours total.
  After fix: ≈50 ms × N (one planar SELECT) + ≈50 ms × 1 (one IN-list
  lookup, ~50–200 distinct user ids per page-set). Mean per call should
  drop to <100 ms.
- **`rr_cyclecount_data`**: 2,983 ms × 95,127 calls → 78 hours total.
  Same shape. After fix: similar drop.

Combined estimated savings: ~400+ hours of cumulative CPU time per
billion calls. Per-load wall-clock for the Putaway Log + Manual Counts
dashboards should drop from ~30-60s for the full 47k+18k page-set down
to a few seconds.

Additional knock-on:

- Read traffic is now routed through `supabaseRead` (load-balanced Supabase
  endpoint), so even the planar SELECTs run on the read replica. Primary's
  PostgREST worker count + buffer cache will recover further.
- Removing the LATERAL drops the per-row RLS evaluation on `user_profiles`,
  which after migration 318 v2 was already `(SELECT auth.uid())`-wrapped
  but is still cheaper not run at all.

## What this does NOT fix

- Realtime fan-out (still on `rf_putaway_operations` + `rr_cyclecount_data`).
  Migration path: [[Roadmap-Rust-WS-Unlocks]] Tier 1 channel migrations.
- The 47k-row Putaway Log + 18k-row Manual Counts being loaded in full
  every dashboard open. A future fix would server-side paginate (date
  windows, status filters, etc.) — out of scope here.
- The remaining LATERAL embeds on `inbound-cart.service.ts` (`rr_inbound_carts`),
  `grip-processing.service.ts` (`rr_grip_processing`), `grs-grip-processing.service.ts`
  (`rr_grsgrip_processing`). They share the same shape and would benefit
  from the same `attachUserProfiles` helper, but were not in the top-cost
  list as of 2026-05-19 so they're deferred.

## Validation

- `pnpm tsc -b` — passes (0 errors)
- `pnpm lint:check` — 0 errors, 95 warnings (unchanged from baseline;
  refactor actually removed 2 `eslint-disable` suppressions because the
  `QueryData`-shaped const helpers were deleted)
- `pnpm vitest run src/hooks/__tests__/useCycleCountOperations.test.ts`
  — 10/10 passed; the consumer hooks see no shape change.

Lint ratchet was already failing pre-refactor (baseline 16 vs actual 95)
for unrelated reasons — that's a pre-existing repo state, not regression.

## Files changed

- `src/lib/supabase/enrich-with-user-profiles.ts` — NEW helper.
- `src/lib/supabase/putaway-log.service.ts` — refactor (4 LATERAL embed
  call sites removed; `PutawayOperationsWithUser` type rewritten;
  stats-fallback reads routed to `supabaseRead`).
- `src/lib/rust-core/putaway-log.service.ts` — refactor (3 LATERAL embed
  call sites removed across parallel + sequential paths; type rewritten;
  stats reads routed to `supabaseRead`).
- `src/lib/supabase/cycle-count.service.ts` — refactor (3 user_profiles
  embeds removed from `fetchCycleCountData`; `active_defer` child embed
  preserved; reads routed to `supabaseRead`).

No Rust, FastAPI, or Supabase migration changes (parallel-workstream scope
strictly the frontend).

## Related

- [[Performance-Review-2026-05-19-Production-Slowness]] — root analysis
- [[Apply-Performance-Review-Fixes-2026-05-19]] — the previous perf pass
  (RLS init-plan, FK indexes, Redis restore)
- [[Supabase-Read-Replica-Routing]] — the read-client pattern used
- [[ADR-Scaling-Roadmap-To-100k-Concurrent]] — Tier C step this advances
- [[Roadmap-Rust-WS-Unlocks]] — Realtime → WS plan (parallel track)
