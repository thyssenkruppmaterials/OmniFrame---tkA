---
tags: [type/decision, status/active, domain/infra, domain/realtime]
created: 2026-05-06
---

# Roadmap: What Option 2 (Rust WS Presence) Unlocks

Companion to [[ADR-Presence-Architecture-Next-Steps]]. The user has committed to Option 2 — extending `rust-work-service /ws` with three new `WsEvent` variants + a Redis-backed per-org presence set. This note answers: **what else does that buy us, and what should we bundle vs. defer?**

## 1. Bottom line

There isn't a single "killer app" follow-on that would justify Option 2 if presence wasn't broken — **Option 2 stands on its own as a presence fix.** What it DOES give us, almost for free, is a sanctioned per-org WS bus and a reusable "browser → Rust → Redis/Postgres" migration template. The biggest *concrete* near-term unlock is collapsing the `sap_agents` postgres_changes consumers (`useAgentDetection` + `agents-fleet-card`) onto the same primitive — that pair is the highest-fanout `postgres_changes` consumer in the app today and migrates almost line-for-line off the presence pattern. The win is incremental and additive, not concentrated in one wow feature.

## 2. Tier 0 — Free (no additional code beyond Option 2)

Building Option 2 automatically delivers, with zero extra code:

- **A per-org auth-bearing pub/sub primitive any future feature can attach to.** Three new `WsEvent` variants don't lock the enum — variant N+4 is the same shape, same `organization_id()` matcher, same FE handler-registration pattern. The `WS-Subscribe-Token` issuance + Subscribe deny-by-default + `broadcast::channel(1000)` fan-out is now a "we know how to do this" infrastructure muscle.
- **Redis as a sanctioned per-org ephemeral state store.** The `presence:org:{org_id}` HSET-with-TTL + tokio evictor pattern is the first place we've put org-state in Redis with a self-healing TTL; reusable for "who has lock on entity X", "in-flight count operations", "live KPI values", etc.
- **A reusable "browser → Rust → Postgres/Redis" migration template.** Every future feature that today reaches for `supabase.channel(...)` has a worked example to copy: bootstrap REST endpoint + WS event variant + heartbeat (if needed) + frontend handler registration on the existing singleton.
- **One frontend WS singleton, now battle-tested at higher event volume.** Option 2 forces `WorkServiceWebSocket` to handle presence-rate traffic. Subsequent multiplexed channels inherit a singleton whose reconnect/backoff/breaker has been pressure-tested on the highest-fanout event class first.
- **`WS-Subscribe-Token` issuance broadens to non-warehouse roles.** Today only operator-class roles need the token; Option 2 makes EVERY authenticated tab need one. That exercise hardens the issuance endpoint + caching + 5-min TTL cycle for the whole role matrix, paying down latent risk before Tier 1 migrations stress it further.
- **`user_profiles.last_seen` retains its read shape unchanged.** Any "who was online today" historical reporting query keeps working — Option 2 is additive over existing SQL state, not a replacement.

## 3. Tier 1 — Cheap follow-on migrations (days each)

### Channel migrations (each existing `supabase.channel(...)` callsite)

| Callsite | Today's load profile | Migration cost | Win |
|---|---|---|---|
| `src/features/admin/sap-testing/hooks/use-agent-detection.ts:583` (`omniframe-agent-detection-fleet`) | `postgres_changes *` on `sap_agents WHERE organization_id=eq.X`. Fires per agent heartbeat × N agents — the highest-frequency sustained `postgres_changes` consumer in the app. | ~1.5–2 days: add `WsEvent::SapAgentChanged { agent_id, organization_id, status, last_seen_at }` driven by `sqlx PgListener` on a `sap_agents` NOTIFY trigger. | Removes biggest sustained postgres_changes load; sister callsite (#2 below) absorbs free. **Highest-ROI Tier 1 pick.** |
| `src/features/admin/sap-testing/components/agents-fleet-card.tsx:188` (`sap-agents-fleet`) | Same `sap_agents` postgres_changes; org-filtered (v1.7.4). Sister of above. | ~0.5 day if #1 ships: subscribe to the same `WsEvent::SapAgentChanged` from the existing WS handler; delete the `setInterval(refresh, 30_000)` at line 174 because the WS push obsoletes it. | Free-with-#1; also removes the paired 30s poll. |
| `src/features/admin/sap-testing/hooks/use-job-queue.ts:116` (`sap-agent-job-{id}`) | Ephemeral per-job `UPDATE` listener on `sap_agent_jobs WHERE id=eq.X`; channel teardown 250ms after terminal status. Low frequency, short-lived, but creates channel churn (one new channel per submitted job). | ~1.5 days: add `WsEvent::SapJobStatusChanged { job_id, organization_id, status }` + LISTEN/NOTIFY trigger on `sap_agent_jobs`. | Eliminates short-lived channel churn. Modest. |
| `src/features/outbound/components/import-lt22-dialog.tsx:247` (`lt22-import-run-{id}`) | Same ephemeral UPDATE-on-row pattern as job-queue, for `sap_outbound_to_import_runs`. | ~1 day: reuse a generic `WsEvent::ImportRunStatusChanged` (or fold into a generic `EntityStatusChanged` envelope shared with #3). | Modest; pairs with #3 thematically. |
| `src/features/admin/sap-testing/components/scheduled-jobs-tab.tsx:252` (`sap-agent-schedules-tab`) | `postgres_changes *` on `sap_agent_schedules` with **NO org filter** — cross-tenant leak today. Low frequency. | Fix the cross-tenant leak in 0.5 day TODAY by adding `filter: organization_id=eq.<orgId>` (independent of migration). Full migration: ~1.5 days for `WsEvent::SapScheduleChanged`. | Cross-tenant fix is the real win, not load reduction. **Do the org-filter fix immediately, regardless of Option 2 timing.** |
| `src/features/admin/sap-testing/hooks/use-agent-trigger-runtime.ts:632` (`agent-trigger-{id}`) | Configuration-driven postgres_changes — user picks the table/event/filter at trigger setup time. Frequency is whatever the user configured. | High — would need a generic "subscribe to table X" Rust primitive, which is overkill. | **Don't migrate.** Defer indefinitely; this is a power-user feature whose dynamic shape doesn't fit the typed `WsEvent` enum. |
| `src/lib/presence/presence.service.ts:406` | THE ONE OPTION 2 REPLACES. | n/a | n/a |

### Polling migrations (selected — only ones worth converting)

| Callsite | Today's profile | Cost | Win |
|---|---|---|---|
| `src/hooks/use-work-queue.ts:93,105` | 30s/60s polls of work-service queue/stats. | **~1 day, frontend-only** — register a WS handler that invalidates the relevant `QueryClient` keys on `QueueStatsUpdated` / `TaskAssigned` / `TaskStatusChanged`. **These events are ALREADY emitted by Rust.** Pure positive — zero new Rust code. | Eliminates two polls on the canonical work-engine queue across every operator tab. Top pick to bundle. |
| `src/features/admin/work-queue/context/work-queue-context.tsx:345` | 30s `setInterval(refreshQueueStats)`. | ~0.5 day with the same handler. | Free-with-`use-work-queue` migration. |
| `src/hooks/use-work-engine-live.ts:310` | 30s poll of `work_engine_health`. | ~1 day: add `WsEvent::WorkEngineHealthChanged` driven by a `PgListener` on the existing `work_engine_settings_changed` NOTIFY infra (rust-work-service already consumes that channel for cache invalidation — extending it is small). | Removes a recurring 30s Postgres SELECT for every connected operator tab. |
| `src/features/admin/sap-testing/components/agents-fleet-card.tsx:174`, `agent-health-card.tsx:110` | 30s polls paired with the channel listeners above. | Folds into the `SapAgentChanged` migration. | Free with the channel migration. |
| `useTickets.ts:518`, `useSmartsheet.ts:391/544` | Smartsheet API polls. | n/a — Smartsheet is the source of truth, the polling has to live somewhere. | **Skip.** Out of scope for a Postgres-WS migration. |
| `use-cycle-count-operations.ts`, `use-lx03-data.ts`, `use-mdm-commands.ts`, `use-device-locations.ts` | 30s–5min Postgres polls (each already paired with its own `.channel(...)` for postgres_changes). | Each is a 1–2 day migration to a domain-specific `WsEvent`. | **Defer.** No current pain — these run quietly. Migrate one-off if a complaint arises. |

### Top 3 picks to bundle with Option 2

1. **`use-work-queue` + `work-queue-context` consume of EXISTING work-service WS events.** ~1.5 days, frontend-only. Demonstrates the WS singleton can multiplex presence + work-queue cleanly. **Best ROI to bundle — no Rust scope creep.**
2. **`useAgentDetection` + `agents-fleet-card` → `WsEvent::SapAgentChanged`.** ~2 days. Single-pair migration that retires the highest-fanout `postgres_changes` consumer left in the app. Validates the LISTEN/NOTIFY half of the migration template.
3. **The 0.5-day org-filter fix on `scheduled-jobs-tab.tsx:252`.** Fix the cross-tenant leak NOW, regardless of when Option 2 ships — this is a security ratchet, not a migration.

### Bottom of the list (defer or keep as-is)

- `use-job-queue` and `import-lt22-dialog` ephemeral channels — load is small, the existing pattern is fine, defer until a real complaint.
- `use-agent-trigger-runtime` — dynamic source, not a typed-enum fit.
- All entity-data hook polls (`use-cycle-count-operations`, `use-lx03-data`, etc.) — quiet today; migrate one-off only.

## 4. Tier 2 — Medium follow-on (weeks)

Three product surfaces become genuinely cheap *only because Option 2 shipped*:

### 4.1 Live "X is editing this row" soft-locking on DataTables

Natural extension of the presence Redis HSET. Same `presence:org:{org_id}` schema, plus a sibling `presence:focus:{org_id}:{entity_kind}:{entity_id}` HSET listing user_ids currently focused on a row. New `WsEvent::EntityFocus { entity_kind, entity_id, user_id, action: 'enter'|'leave' }`. UI: a small avatar stack + "Sarah is editing" pill on `<DataTableRow>`. **Cost on top of Option 2:** ~1 week (1 `WsEvent` variant, 1 hook, 1 UI affordance, 1 server-side TTL eviction loop that mostly mirrors presence's). **Removes:** customer-portal CSRs editing the same `RR Updates` row over each other (a real source of conflicts today, currently mitigated by Slack pings).

### 4.2 Server-pushed notifications panel ("bell icon")

Rust holds a per-user Redis sorted-set (`notifications:user:{user_id}`) for unread items, pushes deltas via a new `WsEvent::Notification { ... }`. Bootstrap REST endpoint returns the current unread queue. **Cost on top of Option 2:** ~1.5 weeks (1 `WsEvent` variant, 1 REST endpoint, 1 panel UI, 1 enqueue API for backend services to call). **Removes:** today users only learn about completed SAP jobs, escalated reservations, and similar terminal events when they happen to be on the relevant tab. A persistent, dismissable feed closes that hole. Worth flagging in planning even if not bundled — it's a high-visibility UX win that appears in product asks every quarter or two.

### 4.3 Richer dispatch broadcasts

The Rust service already emits `WsEvent::PushedWork`; the FE already consumes it via `use-pushed-work.ts`. **What's left:** a "broadcast to all operators in zone X" or "broadcast to role Y" supervisor primitive + UI. Option 2 doesn't directly enable this — but it makes the WS singleton a known-stable surface to keep extending without each addition feeling architecturally fraught. **Cost on top of Option 2:** <1 week. **Removes:** "go tell the second-shift forklift drivers we're switching priority" being a verbal hand-off rather than an in-app push.

### Skipped from the candidate list

- **In-app messaging / chat** between operators and supervisors — doesn't fit the warehouse UX (operators on RF guns aren't typing). Build only on explicit product ask.
- **Per-user "follow this entity" subscriptions** — subsumed by 4.1 + 4.2; not a distinct product surface.
- **Live reassignment / dispatch broadcasts** as a standalone item — already half-shipped via existing `PushedWork`; covered by 4.3.

## 5. Tier 3 — Strategic

**Tentative — only mention if on-prem is on the roadmap.** Supabase Realtime can't run in an air-gapped/on-prem deployment. Option 2 + the Tier 1 `useAgentDetection` migration retire the two highest-fanout Realtime dependencies in the app. If on-prem is a real product direction, every Tier 1 migration is also a "step toward making this app deployable without Supabase as a managed dependency" — the remaining `postgres_changes` consumers are CRUD reactivity hooks that all share the same `PgListener + WsEvent` migration shape. If on-prem is NOT on the roadmap, this consideration adds nothing to the framing and should be dropped.

## 6. Risks / things to budget for

- **`rust-work-service` becomes a presence SPOF.** Its WS being down breaks presence org-wide; Tier 1 magnifies this (each migration adds a new reason to need WS up). Mitigated by Phase A circuit-breaker fallback, but Option 2 needs an explicit availability SLO (`/ws` ≥ 99.9%) before Tier 1 migrations land.
- **Redis becomes source of truth for org ephemeral state.** A Redis flush silently zeros presence. The 90s heartbeat re-emit cadence makes this self-healing within 90s, but worth an explicit ops review of the Redis maxmemory policy + persistence config. Nothing today depends on Redis for ground-truth org state — Option 2 is the first.
- **Migration debt if some Supabase Realtime channels stay.** Half-migrated state means BOTH WS and Realtime are critical-path for different features. Recommendation: ship Option 2 with an explicit "no new Supabase Realtime channels — extend the WS instead" code-review checklist item.
- **`broadcast::channel(1000)` is a cliff with silent loss.** If a slow consumer falls behind, lagged events drop. We need a `RecvError::Lagged` log + Prometheus counter + alert before Tier 1 multiplies event volume. Currently the work-engine event volume is well below the threshold; presence + future Tier 1 will not be.
- **Token issuance becomes hot path.** Every authenticated tab now needs a `WS-Subscribe-Token`; ensure issuance is rate-limited + cached locally on the FE for the 5-min TTL, not re-issued per WS reconnect. Lazy reconnect storms today (e.g. iframe presence wedge) could amplify into token-issuance storms tomorrow.
- **Closed enum vs generic envelope.** Tier 1 keeps adding `Sap…Changed`, `WorkEngineHealthChanged`, etc. — the `WsEvent` enum grows. Decide NOW whether to keep the closed enum (better type safety, current pattern) or move to a `WsEvent::DomainEvent { kind, payload }` envelope (easier to extend, weaker type safety). Not deciding is the worst option — we end up with both.

## 7. Sequencing recommendation

### Bundle with Option 2 (nearly-free incremental work)

- **`use-work-queue` + `work-queue-context` → consume existing work-service WS events.** Frontend-only, ~1.5 days, no Rust scope creep. Proves the WS singleton multiplexes cleanly.
- **The 0.5-day org-filter fix on `scheduled-jobs-tab.tsx:252`.** Independent ratchet — fix the cross-tenant leak as part of the Option 2 PR train.
- **`broadcast::channel` `RecvError::Lagged` metric + alert.** Operational ratchet; one log line + one counter; ~half a day.
- **Code-review checklist item: "no new Supabase Realtime channels — extend the WS instead."** Documentation, not code.

### Sprint after Option 2 (high-value Tier 1 + maybe one Tier 2 starter)

- **`useAgentDetection` + `agents-fleet-card` → `WsEvent::SapAgentChanged`.** ~3 days. Highest-ROI single migration; validates the `PgListener` half of the migration template (which presence itself doesn't exercise).
- **Optionally: Tier 2 #1 (entity soft-locking on DataTables)** as a 1-week add-on if the customer-portal RR Updates pain is acute enough to prioritize. If not, save it.

### Defer indefinitely (and why)

- **SAP job/import ephemeral channels** (`use-job-queue`, `import-lt22-dialog`) — load is small, current pattern is fine, no pain.
- **`use-agent-trigger-runtime`** — dynamic source, not a typed-enum fit; bespoke power-user feature.
- **Entity-data hook polls** (`use-cycle-count-operations`, `use-lx03-data`, `use-mdm-commands`, `use-device-locations`) — no current pain; migrate one-off only on complaint.
- **Tier 2 #2 (notifications)** and **#3 (richer dispatch)** — only ship on explicit product ask. The infrastructure will be ready when they're asked for.

### One concrete next step (right now, before the Option 2 Rust week starts)

**Spend one day spiking `useAgentDetection` migration against a stubbed `WsEvent::SapAgentChanged` over the existing `WorkServiceWebSocket` singleton.** Use a fixture-only Rust handler (or even a hand-crafted JSON payload broadcast from `cargo test`) to validate end-to-end: org-filter, reconnect, breaker pathway, FE handler registration alongside the existing work-engine handlers. **If the spike feels comfortable in a day, the Option 2 plan is validated and you have a worked migration template before committing the 2-week budget. If it doesn't feel comfortable, you've discovered the hidden surface area before sinking the budget into presence.**

## Gaps / what wasn't read

- The broader `\.channel\(` grep returned ~40 files (chained `.channel(` calls beyond the literal `supabase.channel(` pattern). All sampled callsites match the entity-data CRUD-reactivity shape, none match the presence-style high-fanout shape — but if any of those mid-frequency callsites turns out to be a measurable load source, it would land in the same "defer until a complaint arises" bucket as the others.
- Did NOT inspect `rust-work-service`'s existing `PgListener` infra depth (the ADR's claim that `work_engine_settings_changed` LISTEN already exists was trusted). If that infra is thinner than assumed, the `SapAgentChanged` migration grows by ~1 day for boilerplate.
- Did NOT inspect on-prem deployment roadmap state — Tier 3's value depends entirely on whether on-prem is a real direction. If it is, that section deserves more weight in the framing.

## Related

- [[ADR-Presence-Architecture-Next-Steps]] — the foundation; this note is its follow-on roadmap.
- [[Implementations/Harden-Presence-Service-Tenant-Overload]] — Phase A + B2 + B3 implementation context.
- [[Patterns/Realtime-Presence-Browser-Hardening]] — the browser-side defence pattern Option 2 retires (mostly) and that this roadmap leans on for FE breaker behaviour.
- [[Sessions/2026-05-06]] — the session this roadmap was written in.


## Shipped status — Bundle with Option 2

_Updated 2026-05-06 — incremental as items land._

- **[DONE 2026-05-06]** `use-work-queue` + `work-queue-context` migrated to consume the existing work-service WS events. Frontend-only — [[Implementations/Migrate-Work-Queue-To-WS]]. **Wire-compat:** all six consumed variants (`TaskAssigned`, `TaskStatusChanged`, `PushedWork`, `WorkerStatusChanged`, `QueueStatsUpdated`, `ReservationEscalated`) already emitted by Rust today — only TS gap was `'ReservationEscalated'` missing from `WsEventType`, fixed as a downstream type catch-up. **No Rust changes required.**
- **[DONE 2026-05-06]** Code-review checklist item shipped as `realtime-policy workspace rule` — "no new Supabase Realtime channels; extend the WS instead." Auto-attached to all `src/**/*.{ts,tsx}` files; references this Roadmap and the ADR; lists three acceptable alternatives + a reviewer checklist.
- **[PENDING]** `useAgentDetection` + `agents-fleet-card` → `WsEvent::SapAgentChanged`. Owned by parallel sibling worker (SAP-side track).
- **[PENDING]** `scheduled-jobs-tab.tsx:252` cross-tenant org-filter fix. Owned by parallel sibling worker.
- **[PENDING]** `broadcast::channel` `RecvError::Lagged` metric + alert. Owned by parallel sibling worker (Rust-side track).



---

## Status updates (2026-05-06)

### Bundle with Option 2

- **The 0.5-day org-filter fix on `scheduled-jobs-tab.tsx:252`.** **[DONE 2026-05-06]** — see [[Fix-ScheduledJobsTab-Cross-Tenant-Filter]]. Filter `organization_id=eq.<orgId>` + `if (!orgId) return` guard. Same teardown semantics. Independent of Option 2; no Rust delta. Single security ratchet shipped first per the deliverable plan.
- **`broadcast::channel` `RecvError::Lagged` metric + alert.** **[DONE 2026-05-06]** — see [[Add-WsEvent-Lagged-Metric]]. New Prometheus counter `work_ws_lagged_events_total{org_hash}` registered in the existing `rust-work-service` registry; per-socket recv loop now matches on `RecvError::Lagged(n)` explicitly, increments by `n`, emits `tracing::warn!` with the lagged count + org_id. Channel size unchanged at 1000 (sizing is a future load-test-driven decision). Runbook stub pointer left in code; runbook itself TODO.

### Sprint after Option 2

- **`useAgentDetection` + `agents-fleet-card` → `WsEvent::SapAgentChanged`.** **[DONE 2026-05-06]** — see [[Migrate-SapAgentChanged-To-Rust-WS]]. End-to-end: migration 270 (`notify_sap_agent_changed()` SECURITY DEFINER + `sap_agents_notify_changed` AFTER trigger) → new `rust-work-service::sap_agents_listener` (mirror of `settings::listener`) → new `WsEvent::SapAgentChanged { agent_id, organization_id, status, last_seen_at, op }` variant → TS `WsEvent` flat-optional shape extended → both FE callsites (`use-agent-detection.ts` line 583 and `agents-fleet-card.tsx` line 188) drop their Supabase channels + 30s/visibility timers and subscribe to the singleton `WorkServiceWebSocket` instead. Each FE consumer keeps a 5-min safety-net poll guarded on `getConnectionState() !== 'connected'`. Deny-by-default org filter on the existing send loop covers the new variant for free; both FE handlers add a defence-in-depth `event.organization_id !== orgId` check anyway. Migration applied via Supabase MCP `apply_migration`; trigger verified via `information_schema.triggers`.

### Tier 1 deferred-channel migrations (newly shipped)

- **[DONE 2026-05-06]** `use-job-queue.ts` → `WsEvent::SapJobStatusChanged`. Migration 271 + new `sap_jobs_listener` Rust module + ephemeral-channel-churn retired (per-job `supabase.channel('sap-agent-job-{id}')` subscriptions replaced with one shared WS handler filtering by `event.job_id ∈ watchedJobs`). 5-min safety-net poll guarded on disconnected state. Whole-file rewrite of the hook \u2014 net ~ +30 LOC. See [[Migrate-Tier1-Deferred-Channels-To-Rust-WS]].
- **[DONE 2026-05-06]** `import-lt22-dialog.tsx` → `WsEvent::ImportRunStatusChanged`. Migration 272 + new `sap_import_runs_listener` Rust module + per-run channel retired. Surgical edit of the run-row `useEffect`; same status-pill / toast logic preserved. See [[Migrate-Tier1-Deferred-Channels-To-Rust-WS]].
- **[DONE 2026-05-06]** `use-cycle-count-operations.ts` → `WsEvent::CycleCountOperationChanged`. Migration 273 + new `cycle_count_listener` Rust module + org-filtered channel retired. The TanStack-query-invalidation logic preserved verbatim; safety-net poll added. See [[Migrate-Tier1-Deferred-Channels-To-Rust-WS]].
- **[DONE 2026-05-06]** `use-lx03-data.ts` → `WsEvent::Lx03DataChanged`. Migration 274 + new `lx03_listener` Rust module. **Note:** `rr_lx03_data.organization_id` is NULLABLE; the event variant carries `Option<Uuid>` and NULL-org rows broadcast system-wide \u2014 preserves the pre-migration behaviour of the unfiltered Supabase channel. FE defence-in-depth org check covers cross-tenant attack. See [[Migrate-Tier1-Deferred-Channels-To-Rust-WS]].
- **[DECIDED 2026-05-06 \u2014 grandfathered]** `use-agent-trigger-runtime.ts` (`agent-trigger-{id}` channel). Workstream B investigation concluded the typed `WsEvent` enum is structurally unfit for runtime-configured table/event/filter subscriptions. Documented as an explicit exception in `realtime-policy workspace rule`. See [[ADR-WsEvent-Typed-vs-Envelope]] \u00a7 \"Workstream B context\" for the rejected envelope alternative.
- **[N/A]** `use-mdm-commands.ts` and `use-device-locations.ts` (originally listed in the prompt's variant lane). Confirmed neither has a live `supabase.channel(\u2026)` callsite \u2014 use-mdm-commands is pure polling and use-device-locations uses the MDM-service WebSocket on port 8040, NOT Supabase Realtime. Three dead-code subscription methods in `src/lib/supabase/device-manager.service.ts` (`subscribeToDeviceChanges`, `subscribeToCommandChanges`, `subscribeToLocationChanges`) have no live consumer; flagged for cleanup but not migrated.

### Architectural decisions (newly shipped)

- **[DONE 2026-05-06]** Closed-enum-vs-envelope decision. **Option \u03b1 (typed enum) chosen.** All four Tier 1 deferred migrations are typed variants. See [[ADR-WsEvent-Typed-vs-Envelope]].
- **[DONE 2026-05-06]** `broadcast::channel` sizing decision. **Parked at 1000 pending Lagged-metric data.** Trigger to revisit codified in [[ADR-Broadcast-Channel-Sizing]].

### Operational ratchets (newly shipped)

- **[DONE 2026-05-06]** `docs/runbooks/work-engine/ws-lagged-events.md` runbook (Workstream D1). Replaces the `(TODO)` pointer in `metrics.rs` + `websocket/mod.rs` + the [[Add-WsEvent-Lagged-Metric]] note. Sections: symptom \u00b7 triage \u00b7 mitigation (consumer-side / server-side / load-test guidance) \u00b7 escalation \u00b7 related metrics + dashboards.

### Option 2 — Server-side presence on `rust-work-service` (HEADLINE)

- **Server-side presence on `rust-work-service` end-to-end.** **[DONE 2026-05-06]** — see [[Implement-Presence-On-Rust-Option-2]]. Three new `WsEvent` variants (`PresenceJoined`, `PresenceUpdated`, `PresenceLeft`) + a new `presence` module under `rust-work-service` (`redis.rs` HSET helpers, `evictor.rs` 30s sweep task, REST routes at `/api/v1/presence/{heartbeat,online,(DELETE)/}`). Redis schema: `presence:org:{org}` HSET + sibling `:expirations` ZSET + iteration-set `presence:orgs`. New FE class `PresenceServiceRust` with the same surface as `PresenceService`; module facade in `src/lib/presence/index.ts` selects between the two impls at module load via `VITE_PRESENCE_MODE` (`'supabase'` default / `'rust'` / `'disabled'`). Phase A / B2 / B3 surface intact — no DB migration, no breaking changes. New Pattern note [[Server-Side-Presence-Redis-HSET]] distils the shape for Worker 3's Tier 2 entity-focus extension. `WsEvent::PushedWork` extension fields (`target_zone`, `target_role`, `target_user_ids`, `broadcast_message`) added by Worker 3 in parallel — this PR adds `: None` defaults at the three existing call sites in `api/routes/work.rs` to keep the build green during the parallel-worker train.

### Tier 2 — New product surfaces (newly shipped)

- **[DONE 2026-05-06]** Tier 2 #1 — Live "X is editing this row" soft-locking on DataTables. See [[Implement-Entity-Soft-Locking-Tier2-1]] + the distilled [[Patterns/Entity-Focus-Soft-Locking]]. New `entity_focus/` Rust subsystem (sibling to `presence/` on a separate `presence:focus:*` Redis prefix with a 30s TTL — half of presence's 90s) + `WsEvent::EntityFocus { entity_kind, entity_id, user_id, organization_id, action }` variant + REST endpoints under `/api/v1/entity-focus/*` + FE `useEntityFocus` hook + `EntityFocusPill` component. Wired on `TicketListPanel` as the canonical reference; other DataTable owners (`WorkerMonitor`, `Lx03DataTable`, `WorkTaskTable`) can adopt incrementally per the pattern note. Independent evictor task to keep failure domains isolated from Worker 1's presence evictor — same 30s cadence so SREs see one rhythm.

- **[DONE 2026-05-06]** Tier 2 #2 — Server-pushed notifications panel ("bell icon"). See [[Implement-Notifications-Panel-Tier2-2]] + [[Components/NotificationsPanel]]. Migration 275 extends `public.notifications` with `organization_id`, `kind`, indexes, an AFTER INSERT NOTIFY trigger, and tightened RLS. New Rust `notifications_listener` (PgListener) + REST routes (`GET /`, `POST /:id/read`, `POST /read-all`) + `WsEvent::Notification` variant. New FE `useNotifications` + `NotificationsPanel` (bell icon + 99+ badge + popover) wired into the authenticated layout. Backend Python helper `enqueue_notification(...)` in `api/services/notifications.py` with 60s in-process dedup. **Helper provided; producer call sites NOT yet wired** — natural integration points (SAP terminal status, reservation escalation, ticket assignment, drone scan) catalogued in the implementation note for follow-up. **TODO**: 30-day cleanup migration (recommend daily `pg_cron`).

- **[DONE 2026-05-06]** Tier 2 #3 — Richer dispatch broadcasts. See [[Implement-Richer-Dispatch-Broadcast-Tier2-3]]. `WsEvent::PushedWork` extended in place with four optional fields (`target_zone`, `target_role`, `target_user_ids`, `broadcast_message`) — wire-compatible with existing single-user pushes. New Rust route `POST /api/v1/dispatch/broadcast` (server-side supervisor authz, org-scoped target resolution against `worker_heartbeats.current_zone` and `user_profiles.role`). New FE `BroadcastDialog` in the work-queue admin + extended `use-pushed-work.ts` consumer that branches on `isBroadcast` and shows a 12s toast for matching recipients. **MVP UX** — UUID textarea for "Specific users", free-text Zone / Role inputs; flagged for product iteration in the implementation note.
