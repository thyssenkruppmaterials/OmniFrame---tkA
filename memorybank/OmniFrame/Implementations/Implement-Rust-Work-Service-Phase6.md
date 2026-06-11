---
tags: [type/implementation, status/active, domain/backend, domain/frontend, domain/database, domain/realtime, domain/agent]
created: 2026-05-07
---

# Implement Rust Work Service — Phase 6

Phase 6 of the comprehensive [[plans/rust_work_service_full_integration_5b88165d.plan]] (Phases 0+1 in [[Implement-Rust-Work-Service-Phase0-Phase1]], Phase 2 telemetry in [[Implement-Rust-Work-Service-Phase2]], Phase 3 fleet snapshot in [[Implement-Rust-Work-Service-Phase3]], Phase 4 agent-on-Rust-WS in [[Implement-Rust-Work-Service-Phase4]], Phase 5 SAP-mutations defence-in-depth in [[Implement-Rust-Work-Service-Phase5]], Phase 7 claim-via-Rust in [[Implement-Rust-Work-Service-Phase7]]). Ships **fleet-wide live console streaming**: agents push their stdout/stderr lines to `rust-work-service`, which fans out via the per-org WS bus and the SAP Console card sees agent output in <100ms.

## Purpose / Context

Before Phase 6, the SAP Console card (`src/features/admin/sap-testing/components/sap-console-card.tsx`) was localStorage-only — every consumer (Inventory Management tab, Agent Triggers tab) wrote its own `pushConsole(...)` calls into a per-tab buffer. Operators watching the agent's actual stdout had to (a) connect to the Citrix box and read the agent console window, OR (b) trust that the FE had pushed every relevant line via its own `logSapAudit(...)` / `pushConsole(...)` callsites. Neither scaled past one operator and one agent.

Phase 6 ships a fan-out path: agent print() → buffered in-process → batched POST to rust-work-service → broadcast `WsEvent::SapAgentConsoleLine` → every subscribed FE socket sees the line → SapConsoleCard pushes it into its local buffer. Hot path is in-memory broadcast (no DB write); a `persist=true` flag opt-in writes each line to `public.sap_agent_console_log` for forensic replay.

Flag-gated end-to-end (`OMNIFRAME_AGENT_CONSOLE_RELAY=1` on the agent side, additive on the Rust + FE side) so the parallel-run window can validate without flipping production behaviour.

## Scope shipped

### A. WS variant `WsEvent::SapAgentConsoleLine`

[`rust-work-service/src/websocket/mod.rs`](../../../rust-work-service/src/websocket/mod.rs) — appended at the end of the enum (alphabetical-ish — last variant in the file) and added to `organization_id()`:

```rust
SapAgentConsoleLine {
    agent_id: String,
    organization_id: Uuid,
    level: String,        // "info" | "warn" | "error" | "debug" | "trace" | "success"
    message: String,
    ts: chrono::DateTime<chrono::Utc>,
}
```

`organization_id` is REQUIRED so the deny-by-default org-scope filter in `handle_socket`'s send loop covers it for free — cross-tenant leaks impossible by construction. Mirrors the pattern from `WsEvent::SapAgentChanged`, `Notification`, etc.

### B. New route file `rust-work-service/src/api/routes/sap_console.rs`

NEW FILE (separate from `sap_agents.rs` because Phase 8 may be editing that file in parallel — collision-free merge).

Single endpoint:

```
POST /api/v1/sap-console/lines

Body:
  {
    "agent_id": "HOST-Console-USER",
    "lines": [
      {"level": "info", "message": "[boot] truststore injected", "ts": "2026-05-07T01:00:00Z"},
      ...
    ],
    "persist": false
  }

Response (200):
  { "ok": true, "broadcast_count": 12, "persisted_count": 0 }
```

Four-step pipeline:

1. **Auth + body validation** — `allow_console_write(user)` accepts service-key callers (`role = "service"`), explicit `agent.console.write` permission holders, and (until Phase 10's service-key path lands) any authenticated org member. Empty `lines` returns 200 (no-op success) so the agent's relay can flush empty batches without forcing a defensive skip-when-empty in the daemon.
2. **Per-agent rate limit** — `ratelimit:sap-console:{agent_id}` Redis token bucket, 100 requests/min/agent, INCR + EXPIRE-on-first-hit semantics. Mirrors Phase 5's `sap-mutations` shape so a single `redis-cli KEYS ratelimit:*` scan surfaces every active counter. The counter is keyed on REQUESTS, not lines — typical batch size 10–50 lines × 100 req/min ≈ 5 000 lines/min headroom on the hottest agent.
3. **Sanitise + broadcast** — each line is clamped to the level vocabulary (`sanitize_level()` normalises `warning`→`warn`, falls back to `info` on unknown), truncated to 4096 chars (`sanitize_message()` with `…[truncated NNN chars]` marker), then `state.ws_broadcast.send(...)`'d as a `WsEvent::SapAgentConsoleLine`.
4. **Optional persist** — when `body.persist == true`, a single bulk INSERT via `UNNEST(...)` lands all lines in `sap_agent_console_log` in one round-trip. The hot path is the broadcast — persistence is opt-in for forensic replay.

Three pure-logic + broadcast tests added (no live Redis/Postgres):

- `broadcast_count_matches_input_size` — exercises the SAME `tx.send(...)` loop with a standalone `create_broadcast_channel()` + receiver to confirm broadcast_count == lines sent and the receiver decodes the events correctly.
- `rate_limit_outcome_at_budget_is_not_exceeded` / `rate_limit_outcome_above_budget_is_exceeded` — confirm `count == budget` is OK, `count > budget` flips `exceeded`.
- `persist_default_is_false` / `persist_explicit_true_is_recognised` — confirm `persist=false` is the default (hot path stays broadcast-only) and `persist=true` round-trips through `serde::Deserialize`.

15 total tests pass, including auth-gate, sanitiser, and rate-limit-key namespacing.

### C. Migration 278 — `sap_agent_console_log` table

[supabase/migrations/278_create_sap_agent_console_log.sql](../../../supabase/migrations/278_create_sap_agent_console_log.sql) — applied via Supabase MCP `apply_migration` (verified with `information_schema.columns` query).

```sql
CREATE TABLE IF NOT EXISTS public.sap_agent_console_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  level           TEXT NOT NULL,
  message         TEXT NOT NULL,
  ts              TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sap_agent_console_log_org_ts
  ON public.sap_agent_console_log (organization_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_sap_agent_console_log_org_agent_ts
  ON public.sap_agent_console_log (organization_id, agent_id, ts DESC);

ALTER TABLE public.sap_agent_console_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sap_agent_console_log org read" ON public.sap_agent_console_log
  FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
  ));
```

Secondary `(org, agent_id, ts DESC)` index added on top of the plan's required `(org, ts DESC)` so a future per-agent viewer narrows efficiently. No INSERT policy — writes land via the rust-work-service service-role JWT.

7-day cleanup policy via pg_cron is **deferred** — noted in the migration's COMMENT block so a future maintainer can wire a schedule once viewer endpoints exist.

### D. Wiring in `routes/mod.rs` + `main.rs`

Append-only edits to dodge parallel Phase 8 conflicts:

- [rust-work-service/src/api/routes/mod.rs](../../../rust-work-service/src/api/routes/mod.rs) — `pub mod sap_console;` at the bottom of the existing module list, `pub use sap_console::sap_console_routes;` at the bottom of the re-export block. Phase 8's `sap_testing` was already there; both add cleanly because order doesn't matter at the file level.
- [rust-work-service/src/main.rs](../../../rust-work-service/src/main.rs) — `.nest("/api/v1/sap-console", sap_console_routes())` mounted alphabetically between `/sap-agents` and `/sap-mutations`, behind `require_auth`.

### E. Frontend TS types

[`src/lib/work-service/types.ts`](../../../src/lib/work-service/types.ts) — extended the discriminated `WsEventType` union with `'SapAgentConsoleLine'` and added `level?: string`, `message?: string`, `ts?: string` optional fields to the flat `WsEvent` shape (`agent_id?: string` and `organization_id?: string` already existed from Phase 3's `SapAgentChanged` work).

Wire-compatible — TS deserialisers already tolerate unknown variants.

### F. Agent-side relay (`omni_agent/agent.py`)

Four additive blocks behind `OMNIFRAME_AGENT_CONSOLE_RELAY=1` (default off):

1. **Module-level constants** (alongside the Phase 4/7 flag block):
   - `_CONSOLE_RELAY_ENABLED` (env-driven)
   - `_CONSOLE_RELAY_BUFFER_CAP = 10_000` (deque ring-buffer cap)
   - `_CONSOLE_RELAY_BATCH_SIZE = 50` (per-flush batch)
   - `_CONSOLE_RELAY_FLUSH_INTERVAL_SEC = 0.5` (flush cadence)
   - `_CONSOLE_RELAY_INITIAL_BACKOFF_SEC = 2.0`, `_CONSOLE_RELAY_MAX_BACKOFF_SEC = 30.0` (exponential backoff on POST failure)

2. **AgentState additions** — `state.console_buffer: collections.deque(maxlen=10_000)` + `state.console_buffer_lock: threading.Lock()`. `deque(maxlen=...)` is Python's canonical ring buffer — the oldest entries silently drop when full so a sustained network outage can't OOM the agent.

3. **Helpers** — `_log(message, level=None)` mirrors `print()` AND appends to the buffer with prefix-inferred level (`_detect_log_level()` recognises `[boot]`, `[jobs]`, `[work-ws]`, etc; markers like `WARN`/`error`/`exception`/`watchdog` flip the level upward). `_ConsoleRelayStream` is an `sys.stdout` / `sys.stderr` proxy installed by `_install_console_relay_streams()` at startup (only when the flag is on) so EVERY agent print line mirrors into the buffer without touching 250+ existing `print()` callsites — pragmatic alternative to wrapping each by hand.

4. **Daemon thread** — `_start_console_relay_thread()` spawns a daemon (`omni-console-relay`) that drains up to `_CONSOLE_RELAY_BATCH_SIZE` lines from the deque every ~500ms, POSTs to `_work_service_request("POST", "/api/v1/sap-console/lines", json=...)`, and on failure re-injects the batch via `appendleft` with exponential backoff. Login-gated like the job poller (skips when `state.supabase_token` / `state.org_id` are unset).

Boot banner exposes the posture ("Console relay: ENABLED — Phase 6 path active" / "DISABLED (default)"). Wired into `_on_startup` (after `_start_trigger_backfill_poller`) and `_on_shutdown`.

Agent version stays at `1.9.0` — Phase 6 is additive behind a flag; the version bump is reserved for v1.10 (legacy Realtime LOC deletion).

### G. SAP Console card + agent filter dropdown

[`src/features/admin/sap-testing/components/sap-console-card.tsx`](../../../src/features/admin/sap-testing/components/sap-console-card.tsx) — added an optional `agentFilter?: { agents: string[]; selected: string | null; onChange: (next: string | null) => void }` prop that renders a native `<select>` between the search input and the level toggles when set. Native select (instead of shadcn's Select primitive) keeps the card self-contained — the rest of the toolbar uses native controls too.

The card stays a pure presentational component — the WS subscription lives in a new sibling hook:

[`src/features/admin/sap-testing/hooks/use-agent-console-stream.ts`](../../../src/features/admin/sap-testing/hooks/use-agent-console-stream.ts) — `useAgentConsoleStream(pushConsole, { agentFilter, enabled })` attaches a `WsEventHandler` to the singleton `workServiceWs`, filters on `event.type === 'SapAgentConsoleLine'` + `event.organization_id === currentOrgId` (defence-in-depth against future protocol bugs) + the optional `agentFilter`, maps the wire-shape level onto the FE's `ConsoleLevel` union, derives the `source` column from the message's `[prefix]` tag, and pushes through the consumer's `pushConsole`. Refs hold the latest filter/push fn so the WS handler doesn't re-attach on every render.

Safety-net `setInterval` is installed as a no-op gate today (returns early when `workServiceWs.getConnectionState() === 'connected'`) — replaces the plan's "5-min safety net" placeholder; once a future `GET /api/v1/sap-console/lines?since=...` viewer endpoint lands, the empty branch turns into a catch-up fetch.

Wired into both consumers:

- [`agent-triggers-tab.tsx`](../../../src/features/admin/sap-testing/components/agent-triggers-tab.tsx) — `useAgentConsoleStream(pushConsole, { agentFilter: consoleAgentFilter })`, dropdown sourced from `detection.fleet.agents.map((a) => a.id)`.
- [`inventory-management-tab.tsx`](../../../src/features/admin/sap-testing/components/inventory-management-tab.tsx) — same shape, dropdown sourced from `agentDetection.fleet.agents`.

The agent filter `null` value renders the WS stream from EVERY org agent; selecting a specific agent narrows in-memory (the WS broadcast is org-scoped, the FE just filters on `agent_id` after receipt).

## Cross-phase coordination

- **Phase 8** (parallel sprint) — DID NOT touch `sap_agents.rs` (Phase 6's route lives in the new `sap_console.rs` file) or any FE files Phase 8 was likely to edit (`agent-triggers-tab.tsx`, `agents-fleet-card.tsx`, `agent-health-card.tsx`, `recent-jobs-card.tsx`). The only shared edits — `routes/mod.rs` + `main.rs` + `types.ts` — are append-only so the merge is order-independent.
- **Phase 10** (later) — will plug a `agent.console.write` permission check into `allow_console_write()` in [sap_console.rs](../../../rust-work-service/src/api/routes/sap_console.rs). Today the gate accepts any authenticated org member as transitional behaviour; the test `permission_gate_accepts_explicit_permission` already exercises the `permissions.contains(...)` path so the future cutover is just deleting the trailing fallback branch.
- **Phase 11** (later) — viewer endpoint `GET /api/v1/sap-console/lines?since=...` (deferred), full migration of remaining `print()` callsites to `_log(level, message)` (deferred — the stdout proxy captures everything in the meantime), and pg_cron 7-day cleanup policy on `sap_agent_console_log` (deferred — table comment notes this).

## Quality gates

- `cargo build` clean (7 pre-existing warnings, none from Phase 6).
- `cargo test --lib` 68 passed (15 new in `sap_console::tests`).
- `cargo clippy --all-targets` zero new warnings in `sap_console.rs`.
- `python3 -c "import ast; ast.parse(open('omni_agent/agent.py').read())"` clean.
- `pnpm tsc -b --noEmit` clean.
- `pnpm build` clean.
- Migration 278 applied via Supabase MCP, verified with `information_schema.columns` (7 columns: id, agent_id, organization_id, level, message, ts, created_at).

## Files

### Created

- [`rust-work-service/src/api/routes/sap_console.rs`](../../../rust-work-service/src/api/routes/sap_console.rs) — new route file, ~600 LOC including 15 tests.
- [`supabase/migrations/278_create_sap_agent_console_log.sql`](../../../supabase/migrations/278_create_sap_agent_console_log.sql) — table + indexes + RLS + COMMENTs.
- [`src/features/admin/sap-testing/hooks/use-agent-console-stream.ts`](../../../src/features/admin/sap-testing/hooks/use-agent-console-stream.ts) — WS bridge hook.

### Modified

- [`rust-work-service/src/websocket/mod.rs`](../../../rust-work-service/src/websocket/mod.rs) — appended `SapAgentConsoleLine` variant + `organization_id()` arm.
- [`rust-work-service/src/api/routes/mod.rs`](../../../rust-work-service/src/api/routes/mod.rs) — append-only `pub mod sap_console; pub use sap_console::sap_console_routes;`.
- [`rust-work-service/src/main.rs`](../../../rust-work-service/src/main.rs) — imported `sap_console_routes`, mounted `.nest("/api/v1/sap-console", ...)` alphabetically.
- [`src/lib/work-service/types.ts`](../../../src/lib/work-service/types.ts) — added `'SapAgentConsoleLine'` to union, `level?` / `message?` / `ts?` to flat shape.
- [`omni_agent/agent.py`](../../../omni_agent/agent.py) — Phase 6 flag block, `state.console_buffer`, `_log()` / `_detect_log_level()` / `_ConsoleRelayStream` / `_install_console_relay_streams()` / `_start_console_relay_thread()` / `_stop_console_relay_thread()`, startup/shutdown wiring, boot banner posture line.
- [`src/features/admin/sap-testing/components/sap-console-card.tsx`](../../../src/features/admin/sap-testing/components/sap-console-card.tsx) — added `agentFilter?` prop + native `<select>` dropdown between search and level toggles.
- [`src/features/admin/sap-testing/components/agent-triggers-tab.tsx`](../../../src/features/admin/sap-testing/components/agent-triggers-tab.tsx) — imports + `consoleAgentFilter` state + `useAgentConsoleStream(...)` hook + `agentFilter={...}` prop on the card.
- [`src/features/admin/sap-testing/components/inventory-management-tab.tsx`](../../../src/features/admin/sap-testing/components/inventory-management-tab.tsx) — same shape as the Triggers tab.

## Verification

### Migration

```sql
SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'sap_agent_console_log'
 ORDER BY ordinal_position;
```

Returns 7 rows: `id (uuid)`, `agent_id (text)`, `organization_id (uuid)`, `level (text)`, `message (text)`, `ts (timestamptz)`, `created_at (timestamptz)` — all NOT NULL.

### Boot output (Phase 6 enabled)

```
[boot] OMNIFRAME_AGENT_CONSOLE_RELAY=1 — Phase 6 path active. Agent will mirror selected print() lines to rust-work-service /api/v1/sap-console/lines so the SAP Console card sees live stdout. Default flush every 500ms in batches up to 50 lines, 10 000-line buffer cap. Override target via OMNIFRAME_WORK_SERVICE_URL (default: production).
...
[boot]   Console relay: ENABLED — Phase 6 path active (OMNIFRAME_AGENT_CONSOLE_RELAY=1). Selected print() lines mirror to rust-work-service /api/v1/sap-console/lines; the SAP Console card in the web app will see live stdout. Targeting https://rust-work-service-production.up.railway.app. Buffer cap 10000 lines, batch size 50, flush every 500ms.
[work-ws] console relay thread started — flush every 500ms in batches up to 50 lines, buffer cap 10000. POSTing to rust-work-service /api/v1/sap-console/lines.
```

### Sample WS event line

When an FE socket subscribed to the org receives a relayed line, the `useAgentConsoleStream` handler logs (in dev tools):

```
[work-ws] event delivered: type=SapAgentConsoleLine agent_id=HOST-Console-USER level=info message="[boot] Stable agent_id: HOST-Console-USER (PID 12345, started 2026-05-07T01:00:00Z)" ts=2026-05-07T01:00:00.123Z
```

## Post-audit fixes (2026-05-07)

The end-to-end integration audit (closed 2026-05-07) flagged Phase 6's
`SapConsoleCard` mount as **inventory-tab only** even though this note
documented "wired into both consumers". The Agent Triggers tab had the
hook and state plumbing imports listed in the "Modified" section above
but no actual `<SapConsoleCard ... />` JSX callsite. Audit gap closure
FE-3 mounted the card in the Agent Triggers tab at the bottom of the
view (below the trigger CRUD list and recent-fires panel), so admins
can correlate a `WsEvent::TriggerFired` event above with the agent's
console output streamed back via `WsEvent::SapAgentConsoleLine` below.

The two tabs use distinct `useSapConsole(...)` storage keys
(`sap-console:inventory-tab` vs `sap-console:agent-triggers-tab`) so
each tab keeps its own scrollback. Both consume the same singleton
`workServiceWs` subscription via `useAgentConsoleStream`, so adding
the second mount does NOT double the WS event handler count.

## Related

- [[Implement-Rust-Work-Service-Phase4]] — Phase 4 agent-on-Rust-WS (which this Phase reuses for the broadcast fan-out).
- [[Implement-Rust-Work-Service-Phase5]] — Phase 5 SAP-mutations defence-in-depth (rate-limit pattern reused).
- [[Implement-Rust-Work-Service-Phase7]] — Phase 7 claim-via-Rust (`_work_service_request` helper reused for the relay POST).
- [[ADR-Presence-Architecture-Next-Steps]] — "Option 2" decision context that gate-keeps new Realtime channel adds.
- [[Sessions/2026-05-07]] — post-audit session log capturing FE-1 / FE-2 / FE-3 / AGT-1 closures.
- [[Roadmap-Rust-WS-Unlocks]] — broader migration roadmap.
