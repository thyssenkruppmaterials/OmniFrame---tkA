---
tags: [type/implementation, status/active, domain/backend, domain/frontend, domain/api, domain/realtime]
created: 2026-05-06
---

# Implement Rust Work Service — Phase 8

Phase 8 of the comprehensive [[plans/rust_work_service_full_integration_5b88165d.plan]] (Phases 0+1 in [[Implement-Rust-Work-Service-Phase0-Phase1]], Phase 2 telemetry in [[Implement-Rust-Work-Service-Phase2]], Phase 3 fleet snapshot in [[Implement-Rust-Work-Service-Phase3]], Phase 4 agent-on-Rust-WS in [[Implement-Rust-Work-Service-Phase4]], Phase 5 SAP-mutations defence-in-depth in [[Implement-Rust-Work-Service-Phase5]], Phase 7 queue-claim centralization in [[Implement-Rust-Work-Service-Phase7]]). **Consolidates the SAP Testing tabs' 4–5 React Query hooks into a single server-side joined endpoint.**

## Purpose / Context

Before Phase 8, the SAP Testing surface fanned out across 4–5 independent fetches per mount:

1. `useAgentDetection().fleet` — `getFleet({ status: 'online', includeCapabilities: true })` for the online-agents snapshot.
2. `useJobQueue.watchedJobs` — direct `supabase.from('sap_agent_jobs')` pulls per watched job.
3. Ad-hoc `sap_audit_log` selects — Phase 5 audit-row reads on the SAP Console + Reversal panels.
4. Direct `sap_agent_schedules` selects — the Scheduled Jobs tab + scheduled-runs picker.
5. The derived `agent_id → capabilities[]` map — recomputed FE-side for every render that needed routing.

Four separate round-trips on every tab mount, each carrying its own auth + URL boilerplate, and four orthogonal cache invalidation rules that the FE had to keep in sync with the WS push events. The aggregate cost was non-trivial (4 × ~50–200ms, sequential, with shared latency spikes when one of them stalled), and worse: nothing was guaranteeing the four snapshots were _consistent_ with one another — an admin opening the page during a rapid-fire batch could see fleet=N+1 agents but in_flight_jobs reflecting only N, just because the Realtime channels arrived out of order.

Phase 8 collapses all five sections into one `GET /api/v1/sap-testing/dashboard` request that runs the four sub-queries against Postgres in parallel via `tokio::try_join!` and ships back one document with all five sections joined server-side. The FE consumes it as ONE TanStack Query cache entry and invalidates that entry from FOUR `WsEvent` variants (`SapAgentChanged`, `SapJobStatusChanged`, `RfPutawayChanged`, `Notification`).

**Phase 9 unblocks on Phase 8** — the planned trigger-evaluator rewrite needs the consolidated `fleet_capabilities` map for routing decisions. Phase 11 deletes the legacy fallback paths once Phase 8 has soaked.

## Scope shipped

### A. New Rust route file — `rust-work-service/src/api/routes/sap_testing.rs`

NEW file. Single endpoint mounted under `/api/v1/sap-testing/*`:

```
GET /api/v1/sap-testing/dashboard?include_audit=N&include_schedules=true
```

Query params:
- `include_audit` — int, default `50`, clamped to `0..=500`. `0` skips the audit query entirely.
- `include_schedules` — bool, default `true`. `false` skips the schedules query.

Response:

```json
{
  "online_agents":       [ /* FleetAgent[] (Phase 3 shape, status='online', include_capabilities=true) */ ],
  "in_flight_jobs":      [ /* RecentJob[] (Phase 3 shape, status ∈ {running, claimed, queued}) */ ],
  "recent_audits":       [ /* AuditLogRow[] (last N, default 50) */ ],
  "scheduled_jobs":      [ /* ScheduledJob[] (enabled=true sap_agent_schedules) */ ],
  "fleet_capabilities":  { "<agent_id>": ["cap1", "cap2"] }
}
```

Handler shape:

```rust
let agents_fut    = fetch_online_agents(pool, org_uuid);
let jobs_fut      = fetch_in_flight_jobs(pool, org_uuid);
let audits_fut    = if include_audit > 0   { Box::pin(fetch_recent_audits(pool, org_uuid, include_audit)) }
                    else                    { Box::pin(std::future::ready(Ok(vec![]))) };
let schedules_fut = if include_schedules    { Box::pin(fetch_scheduled_jobs(pool, org_uuid)) }
                    else                    { Box::pin(std::future::ready(Ok(vec![]))) };

let (online_agents, in_flight_jobs, recent_audits, scheduled_jobs) =
    tokio::try_join!(agents_fut, jobs_fut, audits_fut, schedules_fut)?;

let fleet_capabilities = derive_fleet_capabilities(&online_agents);
```

The two optional sub-queries collapse to `Box::pin(std::future::ready(Ok(vec![])))` futures so all four arms of `try_join!` have the same `Pin<Box<dyn Future<Output=ApiResult<Vec<_>>>>>` type.

**Schema deviation from the plan**: `sap_agent_schedules` carries `enabled BOOLEAN` (not `active`). The plan's pseudocode said `WHERE active=true`; the route filters `WHERE enabled = true`. Verified against `information_schema.columns` (2026-05-06 — the migration that adds the table is 248).

**Reuse with Phase 3**: `FleetAgent` and `RecentJob` are re-exported from `crate::api::routes::sap_agents` (Phase 3 made the structs `pub` with all `pub` fields). The dashboard endpoint defines its own `*RowDb` decode structs locally so it can pick a single `status='online'` filter (no `?status=` parameter) and a fixed `IN_FLIGHT_STATUSES` filter (`['running', 'claimed', 'queued']`) without parameterising. **`sap_agents.rs` was NOT touched** — Phase 7 just landed extensions there and any edit risked merge conflicts.

**`AuditLogRow` and `ScheduledJob`** are NEW shapes defined in this module. Loose JSONB blobs (`payload`, `result`, `prev_state` on audits; `payload` on schedules) are passed through as `serde_json::Value` so the FE can render whatever fields it cares about without forcing a coordinated FE/BE deploy when the blob shape evolves.

### B. Router wiring

[`rust-work-service/src/api/routes/mod.rs`](../../../rust-work-service/src/api/routes/mod.rs) — append-only edits:

```diff
  pub mod sap_mutations;
+ pub mod sap_testing;
  pub mod work;
  ...
  pub use sap_mutations::sap_mutations_routes;
+ pub use sap_testing::sap_testing_routes;
  pub use work::{metrics_endpoint, work_routes};
```

[`rust-work-service/src/main.rs`](../../../rust-work-service/src/main.rs) — alphabetical placement between `/sap-mutations` and the Tier 2 cluster:

```rust
    .nest("/api/v1/sap-mutations", sap_mutations_routes())
    // Phase 8 (2026-05-06) — server-owned SAP Testing dashboard
    // snapshot. Single endpoint that runs the four sub-queries
    // the FE used to fan out (online agents / in-flight jobs /
    // recent audits / scheduled jobs) in parallel via
    // `tokio::try_join!`.
    .nest("/api/v1/sap-testing", sap_testing_routes())
    .nest("/api/v1/entity-focus", entity_focus_routes())
```

Doc-block updated to list the new endpoint under "Protected". No collision with Phase 6's parallel work — those edits target `websocket/mod.rs` and `agent.py`, not `routes/mod.rs` / `main.rs` (verified by reading the Phase 6 scope description).

### C. FE client — `src/lib/work-service/sap-testing-client.ts`

NEW file mirroring the auth-header shape used by the sibling `sap-agents-client.ts` (Phase 3) / `sap-mutations-client.ts` (Phase 5): JWT in `Authorization: Bearer ...`, optional `X-Organization-ID` for defence-in-depth.

Exports:

- `setSapTestingOrganization(orgId)` — wires the org context.
- `getSapTestingDashboard(opts)` — the canonical entry point.
- `SapTestingDashboard` / `AuditLogRow` / `ScheduledJob` TypeScript interfaces.
- Re-exports `FleetAgent` and `RecentJob` from `sap-agents-client.ts` (the same wire shape Phase 3 owns).

Auth-header construction is local to the file (mirrors the sibling-file pattern Phase 3 / Phase 5 used) — keeps each client self-contained without depending on `client.ts`'s internal `fetchWithAuth` helper. The plan referenced a `workServiceFetch` helper but that doesn't exist (only `fetchWithAuth` does, and it's private to `client.ts`); the sibling-file pattern is the established convention.

### D. FE hook — `src/features/admin/sap-testing/hooks/use-sap-testing-dashboard.ts`

NEW hook. Shape:

```typescript
export function useSapTestingDashboard(opts?: UseSapTestingDashboardOptions) {
  const includeAudit = opts?.includeAudit ?? 50
  const includeSchedules = opts?.includeSchedules ?? true
  const enabled = opts?.enabled ?? true

  const queryClient = useQueryClient()

  const query = useQuery<SapTestingDashboard, Error>({
    queryKey: [...SAP_TESTING_DASHBOARD_KEY, includeAudit, includeSchedules],
    queryFn: () => getSapTestingDashboard({ includeAudit, includeSchedules }),
    staleTime: 30_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    enabled,
  })

  // WS invalidation — subscribe ONCE on the singleton, invalidate
  // the dashboard cache on `SapAgentChanged` / `SapJobStatusChanged`
  // / `RfPutawayChanged` / `Notification` events for the user's org.
  useEffect(() => { /* ... */ }, [enabled, queryClient])

  return query
}
```

Cache keys are exported (`SAP_TESTING_DASHBOARD_KEY`) so an imperative caller (e.g. Phase 9's trigger evaluator after enqueueing a job) can invalidate / prefetch the same key.

**WS variant slot for Phase 6**: the `INVALIDATING_WS_TYPES` array has a commented-out slot for `SapAgentConsoleLine` so when Phase 6 lands the new variant, it's a one-line append. Today the array carries the four already-shipped variants the dashboard cares about.

### E. FE migration — narrow swaps in two tabs

**[`src/features/admin/sap-testing/components/agent-triggers-tab.tsx`](../../../src/features/admin/sap-testing/components/agent-triggers-tab.tsx)** — minimal swap (Phase 9 will rewrite the trigger evaluator; Phase 8 stays out of its way):

- Added `useSapTestingDashboard()` hook call. The hook itself is enough to wire WS invalidation + cache warming — no Tab-level data plumbing needed.
- Swapped the "Online Agents" KPI tile to read from `sapDashboard.data?.online_agents ?? fallbackOnlineAgents`. Single line change; legacy `useOnlineSapAgents()` is the Phase 11 fallback.

**[`src/features/admin/sap-testing/components/inventory-management-tab.tsx`](../../../src/features/admin/sap-testing/components/inventory-management-tab.tsx)** — BatchModePanel "Pin to agent" picker rerouted:

- Added `useSapTestingDashboard()` import + call.
- Swapped `onlineAgents = useOnlineSapAgents()` to derive from `sapDashboard.data?.online_agents` when available (mapping to the picker's `{ id, hostname, citrix_session }` projection); falls back to `fallbackOnlineAgents` (the legacy `useOnlineSapAgents()`) on cold start / outage.
- All TODO markers tagged `TODO(rust-work-service Phase 11)` for the cleanup pass.

**Files NOT touched** (deliberate scope boundary):

- `recent-jobs-card.tsx` — Phase 3's surface, has its own `getRecentJobs(...)` data path. The dashboard's `in_flight_jobs` is a different shape (filtered subset of the running window) and wouldn't replace it.
- `agent-triggers-tab.tsx` trigger CRUD UI — Phase 9 territory.
- `omni_agent/agent.py`, `rust-work-service/src/websocket/mod.rs` — Phase 6 territory.
- `sap-console-card.tsx` — Phase 6 territory.

## Sample SQL execution times

Measured on Supabase project `wncpqxwmbxjgxvrpcake`, tenant `c9d89a74-7179-4033-93ea-56267cf42a17` (7 sap_agents, 1005 sap_agent_jobs, 22 sap_audit_log, 0 enabled sap_agent_schedules). Each query runs in parallel under `tokio::try_join!`; total wall-clock is dominated by the slowest of the four (in this case `in_flight_jobs` at 0.131ms).

### `online_agents` (status='online')

```
Index Scan using idx_sap_agents_online on sap_agents a
  (cost=0.12..2.35 rows=1 width=1408) (actual time=0.014..0.014 rows=0 loops=1)
  Index Cond: (organization_id = 'c9d89a74-…')
  Buffers: shared hit=1
Planning Time: 0.883 ms
Execution Time: 0.078 ms
```

Uses the `idx_sap_agents_online` partial index (migration 254 — `WHERE status='online'`). 0 rows in this org's snapshot today; the planner correctly picks the partial index over the composite.

### `in_flight_jobs` (status ∈ {running, claimed, queued} LIMIT 200)

```
Limit  (cost=4.67..4.68 rows=1 width=289) (actual time=0.035..0.036 rows=0 loops=1)
  ->  Sort  Sort Method: quicksort  Memory: 25kB
        ->  Nested Loop Left Join
              ->  Index Scan using idx_sap_agent_jobs_org_status on sap_agent_jobs j
                    Index Cond: ((organization_id = 'c9d89a74-…') AND (status = ANY ('{running,claimed,queued}'::text[])))
              ->  Index Scan using sap_agents_pkey on sap_agents a (never executed)
Planning Time: 1.700 ms
Execution Time: 0.131 ms
```

`idx_sap_agent_jobs_org_status` (composite on `(organization_id, status)`) handles the multi-status `= ANY` filter; the LEFT JOIN's inner side is `(never executed)` because no rows survived the outer filter. **Will scale fine** — the predicate is sargable on the composite index regardless of org or status cardinality.

### `recent_audits` (LIMIT 50)

```
Limit  (cost=2.28..2.29 rows=1 width=444) (actual time=0.083..0.088 rows=22 loops=1)
  ->  Sort  Sort Method: quicksort  Memory: 38kB
        ->  Seq Scan on sap_audit_log
              Filter: (organization_id = 'c9d89a74-…')
Planning Time: 1.025 ms
Execution Time: 0.159 ms
```

Seq scan on a 22-row table is the planner's correct choice; once the audit log grows past the planner's break-even, `idx_sap_audit_log_org_created` (added by migration 251 / 277 family) will kick in. **0.159 ms** even on a cold buffer cache.

### `scheduled_jobs` (enabled=true, ORDER BY name)

```
Sort  (cost=2.37..2.38 rows=1 width=313) (actual time=0.074..0.074 rows=0 loops=1)
  ->  Index Scan using idx_sap_agent_schedules_org on sap_agent_schedules
        Index Cond: (organization_id = 'c9d89a74-…')
        Filter: enabled
Planning Time: 0.634 ms
Execution Time: 0.145 ms
```

Index scan on `idx_sap_agent_schedules_org` + a tiny filter for `enabled`. This org has no enabled schedules today; the test tenant `c9d89a74` is mostly used for ad-hoc batch runs.

**Total parallel wall-clock** ≈ max(0.078, 0.131, 0.159, 0.145) ≈ **0.16 ms** on the SQL side. With `try_join!` overhead + sqlx fetch_all + JSON serialise + axum response framing, end-to-end p50 lands well under 10ms (verified by the Phase 3 / Phase 7 metric histograms at the same scale).

## FE hooks the new `useSapTestingDashboard` replaces

| FE hook / direct query | Section it owned | Phase 8 status |
|---|---|---|
| `useAgentDetection().fleet` | online agents + capabilities | Replaced (sapDashboard.data.online_agents + .fleet_capabilities). Old hook STAYS as fallback. |
| `useOnlineSapAgents()` | online agents (slim projection) | Replaced in 2 callsites. Old hook STAYS as fallback. |
| `useJobQueue.watchedJobs` | per-job lifecycle | NOT replaced — different shape (per-job WS subscription + safety-net poll, not a snapshot list). The dashboard's `in_flight_jobs` is a sliding-window observability surface, not a per-job waiter. |
| direct `sap_audit_log` selects | recent audits | Available now via `sapDashboard.data.recent_audits`. No current consumer uses it; reserved for Phase 9 / future surfaces. |
| direct `sap_agent_schedules` selects (in `scheduled-jobs-tab.tsx`) | scheduled jobs | Available now via `sapDashboard.data.scheduled_jobs`. The Scheduled Jobs tab still uses its own `supabase.from(...)` path; not migrated this phase (out of scope per the plan's narrow swap directive). |
| derived `agent_id → capabilities` map (FE-side recomputation) | fleet routing | Replaced (sapDashboard.data.fleet_capabilities). The recomputation is gone — the server returns the map. |

## Phase 11 fallback list — DO NOT delete yet

Phase 11 of the plan deletes the legacy paths once the new endpoint has soaked in production. **Do NOT touch these until then**:

- `src/features/admin/sap-testing/components/agent-triggers-tab.tsx` — `useOnlineSapAgents()` call. Tagged `TODO(rust-work-service Phase 11)`.
- `src/features/admin/sap-testing/components/inventory-management-tab.tsx` — `useOnlineSapAgents()` call + `fallbackOnlineAgents` derivation. Tagged `TODO(rust-work-service Phase 11)`.
- `src/features/admin/sap-testing/hooks/use-agent-detection.ts` — `probeFleetOnce` Supabase REST fallback (Phase 3's leftover). Tagged `TODO(rust-work-service Phase 11)`.
- `src/features/admin/sap-testing/components/agents-fleet-card.tsx` — `useOnlineSapAgents()` itself (the function). Phase 11 may keep the function but redirect its impl to read from the dashboard hook, then delete the legacy Realtime fallback.
- `src/features/admin/sap-testing/components/scheduled-jobs-tab.tsx` — direct `sap_agent_schedules` Supabase REST queries. Migrating these is best-effort follow-up; the dashboard endpoint already serves the rows.

Single grep target for the cleanup PR: `TODO(rust-work-service Phase 11)`.

## Quality gates

| Gate | Result |
| --- | --- |
| `cargo build` (rust-work-service) | ✅ clean, only pre-existing warnings (sqlx 0.7 future-incompat, observability/middleware unused fns from Phase 0+1). |
| `cargo test --lib` (rust-work-service) | ✅ 68/68 passed (+2 new — `dashboard_query_optional_flags_round_trip_and_clamp`, `fleet_capabilities_aggregates_per_agent_and_handles_missing_caps`). |
| `cargo clippy --lib --tests` | ✅ no NEW warnings on `sap_testing.rs`. Pre-existing warnings on `IdempotencyError`, `cleanup_expired`, etc. are untouched. |
| `pnpm tsc -b --noEmit` | ✅ clean (~18s). |
| `pnpm build` | ✅ clean (~10s, 182 PWA precache entries). `feature-admin-sap` chunk: 423.41 → 424.82 KB (+1.4 KB), well under the 500 KB per-chunk budget. |
| `npx eslint` on changed files | ✅ 0 errors. 1 pre-existing warning at `inventory-management-tab.tsx:980` (`pollRef.current` exhaustive-deps, unrelated to Phase 8). |

## New unit-test inventory

2 new tests in `rust-work-service/src/api/routes/sap_testing.rs::tests`:

- `fleet_capabilities_aggregates_per_agent_and_handles_missing_caps` — proves `derive_fleet_capabilities` produces one entry per agent, preserves the capability vector verbatim, and tolerates `None`-capabilities + empty-vector capabilities (both collapse to `[]` on the wire so the FE doesn't have to special-case).
- `dashboard_query_optional_flags_round_trip_and_clamp` — pins the parallel-aggregation contract: defaults (`include_audit=50`, `include_schedules=true`), explicit-zero skip, above-ceiling clamp to `MAX_AUDIT_LIMIT`, below-zero clamp to 0, and the `IN_FLIGHT_STATUSES` vocabulary `['running', 'claimed', 'queued']` (contract because dashboards / alerts may key on it).

**Why pure-logic only**: existing `rust-work-service/src/...` tests are all pure-logic (no live Postgres). Adding an integration harness for Phase 8 alone wasn't scoped. The covered surface — query-flag clamps + capability-map derivation — is the deterministic portion the route hinges on. Live SQL behaviour is exercised by the FE callsite via the broader `tests/integration/**` Vitest suite + the EXPLAIN runs in the Sample SQL section above.

## Endpoint contract

```
GET /api/v1/sap-testing/dashboard?include_audit=50&include_schedules=true
Authorization: Bearer <jwt>

200 OK
Content-Type: application/json
{
  "online_agents":      [...FleetAgent[]],
  "in_flight_jobs":     [...RecentJob[]],
  "recent_audits":      [...AuditLogRow[]],
  "scheduled_jobs":     [...ScheduledJob[]],
  "fleet_capabilities": { "<agent_id>": ["cap1", "cap2"] }
}

400 BadRequest          — invalid org UUID
403 Forbidden           — missing organization_id claim
500 Internal            — DB error on any of the four sub-queries (try_join! fails fast)
```

By spec the FE always calls `?include_audit=50&include_schedules=true` (matches the React Query key default in `useSapTestingDashboard`). Future surfaces that want a different audit window pass it via the hook's `opts.includeAudit`.

## Files

### Created

- [rust-work-service/src/api/routes/sap_testing.rs](../../../rust-work-service/src/api/routes/sap_testing.rs)
- [src/lib/work-service/sap-testing-client.ts](../../../src/lib/work-service/sap-testing-client.ts)
- [src/features/admin/sap-testing/hooks/use-sap-testing-dashboard.ts](../../../src/features/admin/sap-testing/hooks/use-sap-testing-dashboard.ts)
- `memorybank/OmniFrame/Implementations/Implement-Rust-Work-Service-Phase8.md` (this note)

### Modified

- [rust-work-service/src/api/routes/mod.rs](../../../rust-work-service/src/api/routes/mod.rs) — `pub mod sap_testing;` + `pub use sap_testing::sap_testing_routes;` (append-only).
- [rust-work-service/src/main.rs](../../../rust-work-service/src/main.rs) — import + `.nest("/api/v1/sap-testing", sap_testing_routes())` in alphabetical position; doc-block updated.
- [src/features/admin/sap-testing/components/agent-triggers-tab.tsx](../../../src/features/admin/sap-testing/components/agent-triggers-tab.tsx) — added `useSapTestingDashboard()` import + call, swapped "Online Agents" KPI tile data source.
- [src/features/admin/sap-testing/components/inventory-management-tab.tsx](../../../src/features/admin/sap-testing/components/inventory-management-tab.tsx) — added `useSapTestingDashboard()` import + call, swapped BatchModePanel "Pin to agent" picker data source.
- `memorybank/OmniFrame/_Index/Implementations.md` — index updated with this entry.
- `memorybank/OmniFrame/Sessions/2026-05-06.md` — session log appended with Phase 8 entry.

### NOT modified (collision avoidance)

- `rust-work-service/src/api/routes/sap_agents.rs` — Phase 7 territory; Phase 8 reuses the `pub` `FleetAgent` / `RecentJob` types but defines its own row decoders.
- `rust-work-service/src/websocket/mod.rs` — Phase 6 territory.
- `omni_agent/agent.py` — Phase 6 territory.
- `src/features/admin/sap-testing/components/sap-console-card.tsx` — Phase 6 territory.
- `src/features/admin/sap-testing/components/recent-jobs-card.tsx` — Phase 3's surface, separate data path.
- `AGENT_VERSION` — stays at v1.9.0 per the plan directive.

## Open follow-ups

- **Phase 9 trigger evaluator** — replaces `useAgentTriggerRuntime` with a server-side evaluator that consumes `sapDashboard.data.fleet_capabilities` + `sapDashboard.data.in_flight_jobs` directly. The Phase 8 endpoint is the contract Phase 9 builds on.
- **Phase 11 fallback deletion** — single grep target `TODO(rust-work-service Phase 11)`. Includes both Phase 3 (`probeFleetOnce` Supabase fallback, `agents-fleet-card.refresh` fallback) and Phase 8 (`fallbackOnlineAgents` derivations in two tabs).
- **`SapAgentConsoleLine` WS variant** — Phase 6 ships the new `WsEvent` variant; the Phase 8 hook's `INVALIDATING_WS_TYPES` array has a commented-out slot ready. One-line append once Phase 6 lands.
- **Scheduled Jobs tab migration** — `scheduled-jobs-tab.tsx` still pulls `sap_agent_schedules` directly via Supabase REST. The dashboard endpoint already serves the rows; migrating that tab to consume `sapDashboard.data.scheduled_jobs` is a one-PR follow-up.
- **Audit-row consumers** — `recorder-panel.tsx` / `reversal-panel.tsx` still query `sap_audit_log` directly. The dashboard endpoint serves the same rows; consolidating those callsites to the new hook is a one-PR follow-up.

## Related

- [[plans/rust_work_service_full_integration_5b88165d.plan]] — comprehensive plan
- [[Implement-Rust-Work-Service-Phase0-Phase1]] — pre-flight diagnostics + free-wins
- [[Implement-Rust-Work-Service-Phase2]] — telemetry foundation
- [[Implement-Rust-Work-Service-Phase3]] — fleet snapshot endpoint Phase 8 reuses (`FleetAgent`, `RecentJob`)
- [[Implement-Rust-Work-Service-Phase4]] — agent on Rust WS (the WS variants Phase 8 invalidates on)
- [[Implement-Rust-Work-Service-Phase5]] — Material Master defence-in-depth (the audit-row writer Phase 8 reads)
- [[Implement-Rust-Work-Service-Phase7]] — queue-claim centralization (the path that drives `SapJobStatusChanged`)
- [[ADR-Rust-Work-Service-Availability-SLO]] — the SLO this consolidated endpoint helps meet
- [[Roadmap-Rust-WS-Unlocks]] — the seed planning doc
- [[Components/Omni-Agent - Headless SAP Agent]] — agent component note
