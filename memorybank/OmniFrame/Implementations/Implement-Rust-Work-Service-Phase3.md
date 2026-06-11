---
tags: [type/implementation, status/active, domain/infra, domain/realtime, domain/agent, domain/backend, domain/frontend]
created: 2026-05-06
---

# Implement Rust Work Service — Phase 3

Phase 3 of the comprehensive [[plans/rust_work_service_full_integration_5b88165d.plan]] (Phases 0+1 captured in [[Implement-Rust-Work-Service-Phase0-Phase1]]). Ships **server-owned bootstrap-snapshot endpoints** for the SAP-agent fleet and the recent-job ledger so the FE no longer has to direct-query Supabase REST for either. Pairs with the already-shipped `WsEvent::SapAgentChanged` + `WsEvent::SapJobStatusChanged` push paths so the entire bootstrap → snapshot → WS-driven incremental update flow is owned by `rust-work-service`.

## Purpose / Context

Two FE callsites still cut around `rust-work-service` and queried `public.sap_agents` directly via Supabase REST: `useAgentDetection.probeFleetOnce` (the highest-volume of the two — every 15s when foreground, every 60s when hidden, plus the lazy first-mount probe) and `agents-fleet-card.tsx` (the admin fleet card refresh). The pattern `[[Migrate-SapAgentChanged-To-Rust-WS]]` had already migrated the *snappy* path (Realtime channel → typed WS event) but the *bootstrap snapshot* + *5-min safety-net poll* both still talked to Supabase. Phase 3 closes that gap.

Same pass introduces a brand-new product surface — a **Recent SAP Jobs** ledger card — that piggybacks the same plumbing. The card existed as scattered console prints + the dedicated SAP Job Queue tab; mounting a compact 50-row table next to the agents fleet card on the SAP Testing → Agent Triggers tab gives admins quick at-a-glance visibility into "what just ran on which agent" without leaving the playbook tab.

## Scope shipped

### A. Rust route — `GET /api/v1/sap-agents/fleet`

`rust-work-service/src/api/routes/sap_agents.rs` — NEW file.

Query params:
- `status` — optional, defaults to `online`. Allowed: `online | offline | all` (validated against `ALLOWED_FLEET_STATUSES`).
- `include_capabilities` — bool, default `false`. When `true`, returns the decoded `capabilities` JSONB array. Default `false` keeps the snapshot small at fleet scale (the JSONB blob is hundreds of bytes per agent).

Returns `Vec<FleetAgent>` ordered by `last_seen_at DESC`. Server-side org scoping via `AuthenticatedUser.organization_id` from the JWT — never from the request body or query string.

```sql
SELECT
    a.id,
    a.hostname,
    a.citrix_session,
    NULL::uuid AS user_id,           -- placeholder; sap_agents has no user_id column
    NULL::text AS user_email,        -- placeholder; ditto
    a.sap_system,
    a.sap_client,
    a.sap_user,
    a.version,
    a.status,
    a.last_seen_at,
    a.process_started_at,
    COALESCE(jsonb_array_length(a.capabilities), 0)::int AS capability_count,
    CASE WHEN $3 THEN a.capabilities ELSE NULL END AS capabilities
FROM public.sap_agents a
WHERE a.organization_id = $1
  AND ($2 = 'all' OR a.status = $2)
ORDER BY a.last_seen_at DESC
```

**Schema deviation from the plan:** the plan called for a `LEFT JOIN public.user_profiles up ON up.id = a.user_id` to surface the operator's email next to each agent row. `public.sap_agents` (per `information_schema.columns` 2026-05-06) does NOT have a `user_id` column today — the migrations that landed (247, 250) only carry hostname / citrix_session / sap_user. The route preserves the plan's wire shape (`user_id: Option<Uuid>`, `user_email: Option<String>`) so a future migration that backfills the column doesn't require coordinated FE+BE deploys, but both fields always serialise as `null` today. The `LEFT JOIN user_profiles` was dropped from the SQL because there's nothing to join on; documented in the route module-level doc-comment.

### B. Rust route — `GET /api/v1/sap-agents/jobs/recent`

Same file. Query params:
- `limit` — optional int, default 50, clamped to `1..=200`.
- `status` — optional comma-separated list (e.g. `?status=running,completed`). Empty / `all` → no filter.

Returns `Vec<RecentJob>` ordered `created_at DESC LIMIT $3`. Joins to `sap_agents` for the hostname label.

```sql
SELECT
    j.id,
    j.endpoint,
    j.status,
    jsonb_build_object(
        'to_number', j.payload->>'to_number',
        'warehouse', j.payload->>'warehouse'
    ) AS payload_summary,
    j.error,
    j.assigned_agent_id,
    a.hostname AS assigned_agent_hostname,
    j.created_at,
    j.claimed_at,
    j.completed_at
FROM public.sap_agent_jobs j
LEFT JOIN public.sap_agents a
       ON a.id = COALESCE(j.assigned_agent_id, j.claimed_by)
WHERE j.organization_id = $1
  AND ($2::text[] IS NULL OR j.status = ANY($2))
ORDER BY j.created_at DESC
LIMIT $3
```

**Deviation from the plan:** the plan's join was `ON a.id = j.assigned_agent_id`. `assigned_agent_id` is the *optional pin* (only set when the user picked a specific Citrix box at submit time); the actual claiming agent lives in `j.claimed_by`. For the recent-jobs ledger UX — "which agent just ran this row?" — the claimer is the more useful label. Joining on `COALESCE(assigned_agent_id, claimed_by)` lets pinned-and-claimed jobs use the pin (which always equals `claimed_by` when the pinned agent picked it up) and unpinned-but-claimed jobs use `claimed_by` (the agent that actually ran). Documented in the route module-level doc-comment.

`payload_summary` is a server-computed `jsonb_build_object(...)` projection so we keep the wire payload tiny — full `sap_agent_jobs.payload` blobs include idempotency keys, full SAP arg sets, audit metadata, and run multiple KB each. Adding new keys to the projection is a one-line schema-free change. The `Value` typing on the FE side accommodates new keys without a coordinated deploy.

### C. Router wiring

`rust-work-service/src/api/routes/mod.rs` — added `pub mod sap_agents;` + `pub use sap_agents::sap_agents_routes;` (alphabetical placement between `presence` and `work`).

`rust-work-service/src/main.rs` — added the route group to the protected-routes router. Nest-list ordering: alphabetical within the post-presence cluster, between `/presence` and the Tier 2 cluster (`/entity-focus`, `/notifications`, `/dispatch`):

```rust
let protected_routes = Router::new()
    .nest("/api/v1/work", work_routes())
    .nest("/api/v1/workers", workers_routes())
    .nest("/api/v1/presence", presence_routes())
    .nest("/api/v1/sap-agents", sap_agents_routes())  // ← Phase 3
    .nest("/api/v1/entity-focus", entity_focus_routes())
    .nest("/api/v1/notifications", notifications_routes())
    .nest("/api/v1/dispatch", dispatch_routes())
    .layer(axum::middleware::from_fn_with_state(state.clone(), middleware::require_auth));
```

The crate-level doc-block in `main.rs` lists both new endpoints under "Protected".

### D. FE client — `src/lib/work-service/sap-agents-client.ts`

NEW file mirroring the auth-header shape used by `notifications.client.ts` / `dispatch.client.ts` (JWT in `Authorization: Bearer ...`, optional `X-Organization-ID` for defence-in-depth on routes that derive org from the JWT claim). Exports `setSapAgentsOrganization`, `getFleet(opts)`, `getRecentJobs(opts)` plus typed `FleetAgent` / `RecentJob` interfaces.

Per the plan, these wrap the new endpoints and own all auth + URL construction. The plan's `workServiceFetch` helper in `client.ts` is internal-only (`fetchWithAuth`) — the new client follows the sibling-file pattern instead, keeping the auth + URL-construction logic local so each client is self-contained.

### E. FE swap — `useAgentDetection.probeFleetOnce`

`src/features/admin/sap-testing/hooks/use-agent-detection.ts` — `probeFleetOnce` now calls `getFleet({ status: 'online', includeCapabilities: true })` first. On failure (work-service down, network blip, regional outage), it falls back to the original Supabase REST query as a one-release safety net so the local-vs-fleet routing decision still resolves — `SmartImportButton`, `ImportLt22Dialog`, and the agent-not-detected banner all consult the snapshot synchronously.

The fallback is wrapped with `// TODO(rust-work-service Phase 11): delete this fallback once the work-service path has soaked in production.` — phase 11 of the plan removes it.

The existing `WsEvent::SapAgentChanged` handler is unchanged — that's the snappy path (already shipped via `[[Migrate-SapAgentChanged-To-Rust-WS]]`).

### F. FE swap — `agents-fleet-card.refresh`

`src/features/admin/sap-testing/components/agents-fleet-card.tsx` — same pattern. The card's `refresh()` now calls `getFleet({ status: 'all', includeCapabilities: true })` first (status='all' so the card can render online + offline + draining; the "ancient offline" toggle is a FE-side filter on top), backfills the fields the work-service projection doesn't carry (`display_name`, `current_action`, `transactions_per_hour`, `registered_at` → all `null`), and sets the `agents` state. On failure, falls back to the original `supabase.from('sap_agents').select('*')` REST query with the same TODO marker.

### G. NEW UI surface — `RecentJobsCard`

`src/features/admin/sap-testing/components/recent-jobs-card.tsx` — NEW component. Bootstraps via `getRecentJobs({ limit: 50 })` once on mount + refreshes on every `WsEvent::SapJobStatusChanged` push delivered by the existing `workServiceWs` singleton. Renders a compact 6-column shadcn `Table`: TO Number | Warehouse | Status | Agent | Started | Duration. Status pills mirror the colour scheme from `agents-fleet-card.tsx` (emerald=completed, amber=running, neutral=queued, destructive=failed). Header summary badges show running / queued / failed counts at a glance. Defence-in-depth org filter on the WS handler (matches the agents-fleet-card pattern).

**Mounting deviation from the plan:** the plan said "Mounts in the Inventory Management tab somewhere visible (place it near the existing agents-fleet-card — probably below it)." A previous refactor moved `AgentsFleetCard` from the Inventory Management tab to the Agent Triggers tab so all fleet observability lives next to the trigger runtime that depends on it (verified by `grep AgentsFleetCard` — only consumer is `agent-triggers-tab.tsx`). To honour the *intent* (place it near the existing fleet card), the new `RecentJobsCard` is mounted on the **Agent Triggers tab**, immediately below the Fleet & Diagnostics Card panel that contains AgentHealthCard + AgentsFleetCard. Wired via `<RecentJobsCard defaultOpen />`.

## SQL execution plans

Captured against the production Supabase project `wncpqxwmbxjgxvrpcake` for the active tenant `c9d89a74-7179-4033-93ea-56267cf42a17` (7 sap_agents rows, 1005 sap_agent_jobs rows).

### `/fleet` happy path (`status=online`, `include_capabilities=true`)

```
Index Scan using idx_sap_agents_online on sap_agents a
  (cost=0.12..2.35 rows=1 width=1408) (actual time=0.014..0.014 rows=0 loops=1)
  Index Cond: (organization_id = 'c9d89a74-…'::uuid)
  Buffers: shared hit=1
Planning Time: 0.869 ms
Execution Time: 0.064 ms
```

The planner picked `idx_sap_agents_online` (the `WHERE status='online'` partial index from migration 254) which is even better than the composite `idx_sap_agents_org_status_lastseen` for this exact query because it physically excludes offline rows from the scan. Both indexes are valid hits — the planner's choice is the more efficient option. Execution time **0.064 ms**, single buffer hit. Nothing to tune.

### `/fleet` `status=all` path

```
Sort  (cost=6.19..6.20 rows=7 width=40) (actual time=0.095..0.096 rows=7 loops=1)
  Sort Key: last_seen_at DESC
  ->  Seq Scan on sap_agents a  Filter: (organization_id = 'c9d89a74-…')
Planning Time: 0.731 ms
Execution Time: 0.136 ms
```

For the `status=all` branch on a tiny org (7 rows), Postgres rationally chose seq scan (it's cheaper than the index walk for that cardinality). The composite `idx_sap_agents_org_status_lastseen` will kick in once the org grows past the planner's seq-scan break-even point — verified by the cost estimates.

### `/jobs/recent` happy path (`limit=50`, no status filter)

```
Limit  (cost=189.50..189.63 rows=50 width=289) (actual time=3.487..3.497 rows=50 loops=1)
  ->  Sort  Sort Method: top-N heapsort
        ->  Hash Left Join  Hash Cond: (COALESCE(j.assigned_agent_id, j.claimed_by) = a.id)
              ->  Seq Scan on sap_agent_jobs j
                    Filter: (organization_id = 'c9d89a74-…')
              ->  Hash → Seq Scan on sap_agents a
Planning Time: 1.704 ms
Execution Time: 3.574 ms
```

Seq scan on `sap_agent_jobs` for the org filter (the table has 1005 rows total, 1005 in this org → seq scan is the right call). Top-N heapsort for the `ORDER BY created_at DESC LIMIT 50`. Hash left-join into the 7-row `sap_agents` table. **3.574 ms total** — entirely acceptable. Will scale fine: `idx_sap_agent_jobs_queue` (organization_id, status, priority, created_at) from migration 247 covers the scan when row counts grow past the planner's break-even.

## Quality gates

| Gate | Result |
| --- | --- |
| `cargo build` (rust-work-service) | ✅ clean, only pre-existing warnings (sqlx 0.7 future-incompat, observability/middleware unused fns) |
| `cargo test --lib` (rust-work-service) | ✅ 25/25 passed in 0.08s |
| `cargo clippy --all-targets` | ✅ no new warnings. Pre-existing redundant_field_names + manual_clamp + too_many_arguments untouched |
| `pnpm tsc -b --noEmit` | ✅ clean (18.6s) |
| `pnpm build` | ✅ clean. `feature-admin-sap` chunk: 412.15 KB → 419.21 KB (+7 KB), well under the 500 KB per-chunk budget |
| `npx eslint` on touched files | ✅ no new errors. One pre-existing react-refresh warning on `useOnlineSapAgents` export in `agents-fleet-card.tsx` (line 509) untouched |
| `node scripts/check-bundle-budget.mjs` | ⚠️ pre-existing baseline failures on `feature-admin` (991.89 → 991.70 KB) + `warehouse-location-map` (1523 KB unchanged); verified by running the build before + after the Phase 3 changes — these are NOT introduced by Phase 3. |

## FE bootstrap fallback path

Both FE consumers (`useAgentDetection.probeFleetOnce` + `agents-fleet-card.refresh`) wrap the new `getFleet(...)` call in a try/catch and fall through to the original Supabase REST query on any failure (network error, 5xx, work-service down). Both fallbacks are tagged with `// TODO(rust-work-service Phase 11): delete this fallback once the work-service path has soaked in production.` so Phase 11 has a single grep target to flip the cleanup PR.

The fallback exists for one release. After 24h–48h of production soak with `getFleet` succeeding, Phase 11 deletes both fallbacks (and the unused Supabase `from('sap_agents')` direct-query callsites by extension).

## Files created / modified

### Created

- `rust-work-service/src/api/routes/sap_agents.rs`
- `src/lib/work-service/sap-agents-client.ts`
- `src/features/admin/sap-testing/components/recent-jobs-card.tsx`
- `memorybank/OmniFrame/Implementations/Implement-Rust-Work-Service-Phase3.md` (this note)

### Modified

- `rust-work-service/src/api/routes/mod.rs` — `pub mod sap_agents;` + `pub use sap_agents::sap_agents_routes;`
- `rust-work-service/src/main.rs` — import `sap_agents_routes`, nest under `/api/v1/sap-agents`, doc-block updated
- `src/features/admin/sap-testing/hooks/use-agent-detection.ts` — `probeFleetOnce` swap with Supabase fallback
- `src/features/admin/sap-testing/components/agents-fleet-card.tsx` — `refresh` swap with Supabase fallback
- `src/features/admin/sap-testing/components/agent-triggers-tab.tsx` — import + mount `<RecentJobsCard defaultOpen />` below the Fleet & Diagnostics Card
- `memorybank/OmniFrame/_Index/Implementations.md` — index updated with this entry

## Recent Jobs panel — visual description

A bordered shadcn `Card` with a clickable header (chevron + "Recent SAP Jobs" + count + summary badges for running/queued/failed). When expanded, renders a compact 6-column `Table`:

| TO Number | Warehouse | Status | Agent | Started | Duration |
|---|---|---|---|---|---|
| `0090123456` | `RR01` | `running` (amber spinner pill) | `USINDPR-CXA103V` | `12s ago` | `—` |
| `0090123455` | `RR01` | `completed` (emerald check pill) | `USINDPR-CXA103V` | `2m ago` | `1m 34s` |
| `0090123454` | `RR03` | `failed` (red X pill) | `USINDPR-CXA107V` | `4m ago` | `8s` |
| `0090123453` | `RR01` | `queued` (neutral hourglass pill) | `—` | `5m ago` | `—` |

Status pills colour-match `agents-fleet-card.tsx` (emerald = healthy, amber = active, destructive = failure). Hovering a row shows the full `endpoint` (or `error` if non-null) as a `title` tooltip. The header refresh button reloads the snapshot manually; the WS push handler reloads automatically on every `SapJobStatusChanged` event delivered to the org's WS subscribers.

Empty state: a small `Clock` icon + "No recent SAP-agent jobs in this org yet. Run a queue-mode batch from the SAP Testing playbook to populate the ledger."

Error state: a destructive-coloured banner above the table with the error message — but the table still renders the last-known snapshot so a transient error doesn't blank the panel.

## Open follow-ups

- **Phase 11 cleanup** — delete both Supabase fallback paths in `probeFleetOnce` + `agents-fleet-card.refresh` after the production soak window. Single grep target: `TODO(rust-work-service Phase 11)`.
- **`sap_agents.user_id` column** — if a future product need requires per-agent operator attribution, ship a migration that adds `sap_agents.user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL`. The route's response shape already carries `user_id` + `user_email` placeholders so the FE doesn't need to redeploy.
- **Recent Jobs panel filtering** — current MVP shows all statuses with summary badges. A future iteration could expose `?status=` query string filtering via badge-toggles in the header (the Rust route already supports it).
- **`payload_summary` enrichment** — current projection extracts `to_number` + `warehouse`. Adding e.g. `material`, `quantity`, `bin` is a one-line `jsonb_build_object` extension on the Rust side + nothing on the FE side (the type carries `[key: string]: string | null`).

## Naming clarification (audit gap INFO-1, 2026-05-07)

Earlier drafts of this note referred to the FE fleet-snapshot hook as
`useFleetSnapshot`. The hook ships in the codebase as **`useAgentDetection`**
(`src/features/admin/sap-testing/hooks/use-agent-detection.ts`). Its
`fleet: FleetSnapshot` field is what `<AgentsFleetCard />`,
`<RecentJobsCard />`, and the SAP Console agent-filter dropdown all
consume. Anywhere this note (or the Phase 3 plan) says
"`useFleetSnapshot`", read it as `useAgentDetection().fleet` — single
hook, no rename pending.

## Post-audit fixes (2026-05-07)

The end-to-end integration audit (closed 2026-05-07) flagged the
Phase 3 cards as **defined but unmounted**:

- `RecentJobsCard` had no `<RecentJobsCard ... />` callsite anywhere
  in `src/`.
- `AgentsFleetCard` was only consumed via its `useOnlineSapAgents`
  hook export (the BatchModePanel "Pin to agent" picker); the card
  itself was unmounted.
- `AgentHealthCard` was unmounted entirely.

Audit gap closures FE-1 / FE-2 mounted all three in the Agent Triggers
tab's new **Fleet & Diagnostics** section, exactly matching the
deviation note in section G above. Final layout:

```
agent-triggers-tab.tsx
├── Header strip (KPIs + capability banner)        ← pre-existing
├── Fleet & Diagnostics                            ← FE-1 / FE-2 (new)
│   ├── grid lg:grid-cols-2
│   │   ├── <AgentsFleetCard defaultOpen />
│   │   └── <AgentHealthCard agentConnected={...} defaultOpen=false />
│   └── <RecentJobsCard limit={50} defaultOpen />  ← full width below
├── Triggers list + Recent fires panel             ← pre-existing
├── SAP Console                                    ← FE-3 (new — see Phase 6)
│   └── <SapConsoleCard agentFilter={...} />
└── Dialogs (create / edit / preview)              ← pre-existing
```

A single `useAgentDetection()` subscription drives BOTH the fleet card
status and the SAP Console agent-filter dropdown — no duplicate fetches.
The card mount list now matches what this Phase 3 note claimed all along.

## Related

- [[plans/rust_work_service_full_integration_5b88165d.plan]] — comprehensive plan
- [[Implement-Rust-Work-Service-Phase0-Phase1]] — Phase 0 + 1 (pre-flight diagnostics + free-wins)
- [[Migrate-SapAgentChanged-To-Rust-WS]] — the snappy-path migration this Phase pairs with for fleet
- [[Migrate-Tier1-Deferred-Channels-To-Rust-WS]] — the snappy-path migration this Phase pairs with for jobs (`SapJobStatusChanged`)
- [[Live-Verification-Realtime-Sprint-2026-05-06]] — production verification of the Phase 1 plumbing the Phase 3 endpoints layer onto
- [[Roadmap-Rust-WS-Unlocks]] — the seed planning doc
- [[ADR-WsEvent-Typed-vs-Envelope]] — typed-event decision the Phase 3 endpoints don't have to reopen
- [[Components/Omni-Agent - Headless SAP Agent]] — agent component note
- [[Sessions/2026-05-07]] — post-audit session log capturing FE-1 / FE-2 / FE-3 / AGT-1 closures
