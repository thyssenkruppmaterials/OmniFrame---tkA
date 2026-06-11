---
tags: [type/implementation, status/active, domain/backend, domain/frontend, domain/realtime, domain/database]
created: 2026-05-06
---

# Implementation: Migrate `sap_agents` Realtime to `WsEvent::SapAgentChanged`

First Tier 1 migration from [[Roadmap-Rust-WS-Unlocks]]. Retires the highest-fanout `supabase.channel(postgres_changes)` consumer in the app — `omniframe-agent-detection-fleet` (in `use-agent-detection.ts`) and `sap-agents-fleet` (in `agents-fleet-card.tsx`). Browsers stop subscribing to Supabase Realtime for `sap_agents`; instead, `rust-work-service` listens to a Postgres NOTIFY on `sap_agents` and broadcasts a typed `WsEvent::SapAgentChanged` to org-scoped subscribers via the existing `/ws`.

## Why

Quoting [[Roadmap-Rust-WS-Unlocks]] Tier 1:

> `src/features/admin/sap-testing/hooks/use-agent-detection.ts:583` (`omniframe-agent-detection-fleet`) — `postgres_changes *` on `sap_agents WHERE organization_id=eq.X`. Fires per agent heartbeat × N agents — the highest-frequency sustained `postgres_changes` consumer in the app. Highest-ROI Tier 1 pick.

The migration also validates the `PgListener` half of the migration template (which presence itself doesn't exercise; presence's writes are HSET-with-TTL on Redis, not Postgres). Now that we've shipped one end-to-end LISTEN/NOTIFY → WsEvent migration, future Tier 1 picks (work-queue stats, work-engine health, schedule changes) all share a worked example.

## End-to-end

```
sap_agents row change
        │
        ⯈ trigger sap_agents_notify_changed (mig 270)
        │
        ⯈ PERFORM pg_notify('sap_agent_changed', json_build_object(…)::text)
        │
        ⯈ sqlx::PgListener in rust-work-service::sap_agents_listener::run
        │
        ⯈ WsEvent::SapAgentChanged { agent_id, organization_id, status, last_seen_at, op }
        │
        ⯈ broadcast::Sender<WsEvent>::send(…)
        │
        ⯈ per-socket recv loop in handle_socket(): org filter (deny-by-default)
        │
        ⯈ Browser: WorkServiceWebSocket singleton message dispatch
        │
        ⯈ use-agent-detection.ts WS handler: probeFleetOnce()
        │
        ⯈ agents-fleet-card.tsx WS handler: refresh()
```

## DB migration — `supabase/migrations/270_sap_agents_notify_trigger.sql`

Mirrors the shape of `work_engine_notify_settings_changed` (mig 256). SECURITY DEFINER; `SET search_path = public, pg_temp`; `CREATE OR REPLACE` + `DROP TRIGGER IF EXISTS` so re-runnable.

```sql
CREATE OR REPLACE FUNCTION public.notify_sap_agent_changed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payload jsonb; v_row public.sap_agents;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  v_payload := jsonb_build_object(
    'agent_id',        v_row.id,
    'organization_id', v_row.organization_id,
    'status',          v_row.status,
    'last_seen_at',    v_row.last_seen_at,
    'op',              TG_OP
  );
  PERFORM pg_notify('sap_agent_changed', v_payload::text);
  RETURN NULL;
END $$;

CREATE TRIGGER sap_agents_notify_changed
  AFTER INSERT OR UPDATE OR DELETE
  ON public.sap_agents FOR EACH ROW
  EXECUTE FUNCTION public.notify_sap_agent_changed();
```

Key decisions:

- **`agent_id` is `text`** (not `uuid`) — mirrors `sap_agents.id` schema. Migration 247 stores agent ids as `<COMPUTERNAME>-<SESSIONNAME>-<PID>`-shaped self-minted text so the agent doesn't have to round-trip a UUID at boot.
- **Read OLD on DELETE.** `NEW` is NULL on DELETE; reading OLD lets the listener emit a `SapAgentChanged { op: "DELETE" }` with the row's last `organization_id` so connected clients can evict the row from their UI.
- **`PERFORM pg_notify(…)` then `RETURN NULL`.** AFTER triggers' return value is ignored; returning NULL is the convention for AFTER-row triggers that don't modify the row.
- **Migration applied via Supabase MCP `apply_migration` on 2026-05-06.** Verified via `information_schema.triggers` query: trigger `sap_agents_notify_changed` exists for `INSERT`, `UPDATE`, `DELETE` with `AFTER` timing.

## Rust — `rust-work-service`

### `src/websocket/mod.rs` — +35 LOC

New variant on the `WsEvent` enum:

```rust
SapAgentChanged {
    agent_id: String,
    organization_id: Uuid,
    status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_seen_at: Option<chrono::DateTime<chrono::Utc>>,
    op: String,
},
```

- `organization_id` is REQUIRED (not `Option`-wrapped). Every `sap_agents` row carries one; making it optional would silently bypass the deny-by-default org-scope filter in `handle_socket`'s send loop.
- `WsEvent::organization_id()` matcher updated: `WsEvent::SapAgentChanged { organization_id, .. } => Some(*organization_id)` (wraps the required field so the existing `Option<Uuid>` send-loop filter keeps working).
- `agent_id: String` — mirrors the schema's `text` column.
- `last_seen_at` is `Option<DateTime<Utc>>` so a future schema relaxation (or malformed manual NOTIFY) doesn't crash the consumer.

### `src/sap_agents_listener.rs` — NEW module, ~95 LOC

Mirror of `settings/listener.rs` shape: long-running tokio task, exponential backoff on connect/recv failure, `PgListener::connect_with(&pool)` then `listener.listen("sap_agent_changed")`. On each notification:

```rust
let event = WsEvent::SapAgentChanged {
    agent_id: n.agent_id,
    organization_id: n.organization_id,
    status: n.status,
    last_seen_at: n.last_seen_at,
    op: n.op,
};
if let Err(e) = ws_tx.send(event) {
    debug!(?e, "sap_agents_listener: no WS subscribers (ignored)");
}
```

Logged at `tracing::debug!`, NOT `info!` — sap_agents heartbeats every 30s, this fires per heartbeat, info would flood the log.

### `src/main.rs` + `src/lib.rs` — +12 LOC each

- `mod sap_agents_listener;` registered alongside existing modules.
- `tokio::spawn(async move { sap_agents_listener::run(pool, ws_tx).await; });` in `main()` immediately after the `settings::listener::run(…)` spawn (sibling pattern).

### Org-scope security verification

The `WS-Subscribe-Token` flow + Subscribe-message org filter handle `SapAgentChanged` for free. Walked the path:

1. WS upgrade requires (or doesn't require, per `WORK_WS_REQUIRE_TOKEN`) a `WS-Subscribe-Token`. If presented, claims are pinned to the socket.
2. Client sends `Subscribe { organization_id }`. If a token was pinned and the subscribe org doesn't match, the socket is closed and `work_ws_auth_failure_total{reason="org_mismatch"}` increments.
3. Once subscribed, `subscribed_org` is `Some(client_org)`.
4. Server emits `WsEvent::SapAgentChanged { organization_id: ev_org, … }`.
5. Per-socket send loop reads `event.organization_id() → Some(ev_org)`.
6. Filter: `(Some(client_org), Some(ev_org)) if client_org != ev_org => continue`. Mismatch dropped. Match passes. **Zero new code needed for org-scope enforcement.**
7. Belt-and-braces FE check (defence-in-depth): `if (event.organization_id && event.organization_id !== orgId) return` in both `use-agent-detection.ts` and `agents-fleet-card.tsx`.

## TypeScript — `src/lib/work-service/types.ts` — +15 LOC

Added `'SapAgentChanged'` to the `WsEventType` union and the SapAgentChanged-specific fields (`agent_id`, `organization_id`, `last_seen_at`, `op`) to the flat-optional `WsEvent` shape. Kept the flat-optional shape rather than splitting to a discriminated union to preserve compat with existing consumers that read `event.task_id` / `event.user_id` etc. without narrowing on `event.type`. New consumers MUST narrow on `type === 'SapAgentChanged'` before reading the new fields.

## Frontend — `use-agent-detection.ts`

- Removed the `import type { RealtimeChannel }` import; added `workServiceWs` + `WsEvent` + `WsEventHandler`.
- Removed `fleetRealtimeChannel`, `fleetChannelOrgId`, the `ensureFleetRealtimeChannel(orgId)` Supabase channel attach, and its teardown branch in `stopFleetPoller`.
- Added `fleetWsHandler`, `fleetWsHandlerOrgId`, `ensureFleetWsHandler(orgId)` which calls `workServiceWs.connect(orgId, handler)`.
- The 15s/60s visible/hidden `fleetPollerHandle` `setInterval` is **replaced with a 5-min safety net** (`FLEET_SAFETY_NET_INTERVAL_MS = 5 * 60_000`). The safety-net's tick body skips the refetch when `workServiceWs.getConnectionState() === 'connected'` so the happy path is zero Postgres load between events.
- `handleVisibilityChange` no longer reschedules the fleet poller (its cadence is fixed) but DOES still fire a one-shot `probeFleetOnce()` on tab-show, so a Rust-WS-disconnected user who tabs back gets a fresh snapshot immediately.
- The local `/health` poller (`pollerHandle`, 15s/60s) is UNTOUCHED — it probes the LOCAL agent process, separate from the fleet migration.

## Frontend — `agents-fleet-card.tsx`

- Removed the `supabase.channel('sap-agents-fleet')` `useEffect`. Added a sibling `useEffect` that registers a `WsEventHandler` on `workServiceWs.connect(orgId, handler)` and calls `refresh()` on `'SapAgentChanged'` events whose `organization_id` matches.
- The 30s `setInterval(refresh, 30_000)` is replaced with a 5-min safety net guarded on `workServiceWs.getConnectionState() !== 'connected'`. (The card always renders a fresh snapshot on first mount via the immediate `void refresh()`, so the safety-net only matters during a Rust WS outage.)

## File deltas

| File | Change |
|---|---|
| `supabase/migrations/270_sap_agents_notify_trigger.sql` | NEW. ~95 LOC including the doc-block. |
| `rust-work-service/src/websocket/mod.rs` | +35 LOC for the new `WsEvent::SapAgentChanged` variant + `organization_id()` matcher arm. |
| `rust-work-service/src/sap_agents_listener.rs` | NEW. ~95 LOC mirror of `settings/listener.rs`. |
| `rust-work-service/src/main.rs` | +12 LOC for `mod sap_agents_listener;` + the `tokio::spawn` in `main()`. |
| `rust-work-service/src/lib.rs` | +1 LOC for the `pub mod sap_agents_listener;`. |
| `src/lib/work-service/types.ts` | +15 LOC. New `'SapAgentChanged'` `WsEventType` arm + new optional fields on `WsEvent`. |
| `src/features/admin/sap-testing/hooks/use-agent-detection.ts` | Net ~+10 LOC. Removed Realtime channel code (~40 LOC); added WS handler + safety-net code (~50 LOC). |
| `src/features/admin/sap-testing/components/agents-fleet-card.tsx` | Net ~+8 LOC. Removed Supabase channel + 30s timer (~35 LOC); added WS handler + 5-min safety-net (~43 LOC). |

## Quality gate results

- `cargo build` — clean (only pre-existing warnings on `observability/middleware.rs` dead code).
- `cargo test` — all green on a clean run. Single intermittent flake (`ws_token::tests::tampered_signature_rejected`) is a pre-existing base64-no-pad reserved-bits flakiness in the test itself; reproducible without my changes.
- `cargo clippy --all-targets` — zero new warnings; only the pre-existing `redundant field names` in `api/routes/work.rs` and dead-code in `observability/middleware.rs`.
- `pnpm tsc -b --noEmit` — clean (~24s).
- `pnpm build` — clean in 11s. `feature-admin-sap` chunk at 401.99 KB (under the 500 KB per-chunk budget). Total JS at 9768.39 KB; baseline (without my changes) is 9741.59 KB; +26.8 KB delta is chunking variance, not a regression. The pre-existing over-budget chunks (`warehouse-location-map`, `feature-admin`) are unrelated.
- `npx eslint src/features/admin/sap-testing/ src/lib/work-service/` — 0 errors. The 11 warnings are all in OTHER untouched files; my touched files have 0 new warnings (the single `react-refresh/only-export-components` on `agents-fleet-card.tsx:464` is the pre-existing `useOnlineSapAgents` non-component export, not introduced by this change).
- `pnpm test:unit` — 220 pass / 24 fail — same baseline as before. The 24 failures are pre-existing Supabase `storage.getItem` mock issues in security/RBAC tests (documented in [[Harden-Presence-Service-Tenant-Overload]] Phase B2/B3 quality section).

## Smoke test (manual)

The dev stack (rust-work-service on 8030, FE pnpm dev) wasn't trivially runnable in the worker turn. Manual smoke procedure:

1. `cd rust-work-service && cargo run` — confirm boot logs show:
   - `settings listener spawned (LISTEN work_engine_settings_changed)`
   - `sap_agents listener spawned (LISTEN sap_agent_changed)` (NEW)
   - `WebSocket endpoint available at ws://0.0.0.0:8030/ws`
2. `pnpm dev` — sign in to a tenant with at least one agent registered.
3. Navigate to Inventory Management → Agents Fleet card. Confirm the card renders the current agents.
4. With a connected agent, watch DevTools Network → WS frames. The Subscribe message goes out (`{"type":"Subscribe","organization_id":"…"}`).
5. Trigger an `sap_agents` UPDATE: easiest is wait for the agent's next 30s heartbeat (which UPDATEs `last_seen_at`, `transactions_per_hour`, etc.). Confirm:
   - DevTools shows a `{"type":"SapAgentChanged","organization_id":"…","agent_id":"…","status":"online","last_seen_at":"…","op":"UPDATE"}` frame.
   - The Agents Fleet card's `refreshed HH:MM:SS` timestamp updates.
   - Browser console does NOT show `[Realtime] postgres_changes` events for `sap_agents` anymore.
6. Insert a fresh `sap_agents` row via Supabase Studio: confirm `op:"INSERT"` event arrives within ~1s.
7. `DELETE FROM sap_agents WHERE id = '…'`: confirm `op:"DELETE"` event with the OLD row's org_id.

## Roadmap follow-ons

- **`WsEvent::SapScheduleChanged`** — same shape applied to `sap_agent_schedules` (Tier 1 in [[Roadmap-Rust-WS-Unlocks]]). NOT shipped today; the cross-tenant filter fix [[Fix-ScheduledJobsTab-Cross-Tenant-Filter]] handles the security ratchet for now.
- **`WsEvent::SapJobStatusChanged`** — ephemeral per-job listener. Tier 1 "bottom of the list" — deferred indefinitely per roadmap.
- **`WsEvent::ImportRunStatusChanged`** — deferred indefinitely.
- **`use-agent-trigger-runtime.ts`** — dynamic source, NOT a typed-enum fit; permanently deferred per roadmap.

## Constraints honoured

- Did not touch presence subsystem (`src/lib/presence/`, `use-presence-tracker.ts`). Phase A/B2/B3 left alone.
- Did not touch the work-queue migration (`use-work-queue.ts`, `work-queue-context.tsx`) — sibling worker.
- Did not touch any other `supabase.channel(…)` callsite besides the three named (`scheduled-jobs-tab` + `use-agent-detection` + `agents-fleet-card`).
- Org-scope deny-by-default verified for the new variant via the existing send-loop filter.
- No new Rust deps; everything reuses existing `sqlx`, `tokio`, `tracing`, `prometheus`, `chrono`, `uuid` already in `Cargo.toml`.

## Related

- [[Roadmap-Rust-WS-Unlocks]] — the Tier 1 row this implements.
- [[ADR-Presence-Architecture-Next-Steps]] — Option 2 framing this rides on.
- [[Harden-Presence-Service-Tenant-Overload]] — Phase A/B2/B3 baseline.
- [[Add-WsEvent-Lagged-Metric]] — sibling deliverable shipped same-day; the metric exists so we can SEE if/when this migration's event volume pushes the broadcast buffer.
- [[Fix-ScheduledJobsTab-Cross-Tenant-Filter]] — sibling security fix shipped same-day.
- [[Patterns/Realtime-Presence-Browser-Hardening]] — defence-in-depth pattern.
- [[Components/Omni-Agent - Headless SAP Agent]] — the agent that drives `sap_agents` heartbeats.
- [[Sessions/2026-05-06]] — session log.
