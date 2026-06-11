---
tags: [type/implementation, status/active, domain/infra, domain/realtime, domain/backend, domain/frontend]
created: 2026-05-06
---
# Live Verification — Realtime / Presence Sprint (2026-05-06 PM)

## Purpose / Context

End-to-end verification of the entire Customer Portal Presence + Realtime sprint (DB migrations 270–275, `rust-work-service` listeners + REST + WS, frontend Phase A/B/Tier 2 surfaces) executed against the **live production environment** on Railway + Supabase, on 2026-05-06 ~21:07 UTC-4 (post-recovery deploy).

**Verdict: 🟢 GREEN (with three yellow flags listed under "Outstanding items").**

## Targets

| Layer | Target | URL |
| --- | --- | --- |
| Frontend (Vite SPA + FastAPI) | `onebox-ai-logistics` Railway service | <https://onebox-ai-logistics-production.up.railway.app> |
| Realtime backend | `rust-work-service` Railway service (env `production`) | <https://rust-work-service-production.up.railway.app> |
| Auth backend | `rust-core-service` Railway service | <https://rust-core-service-production.up.railway.app> |
| Supabase Postgres + Realtime | project `wncpqxwmbxjgxvrpcake` | <https://wncpqxwmbxjgxvrpcake.supabase.co> |

## Service health (Phase 1)

| Service | Latest deploy | Status | Created (UTC) | Image digest |
| --- | --- | --- | --- | --- |
| `rust-work-service` | `753b4488-c7c4-449c-903b-f601739e9690` | SUCCESS | 2026-05-07 00:55:10Z (= 2026-05-06 8:55 PM UTC-4) | `sha256:10b06fa45691…` |
| `onebox-ai-logistics` (frontend + FastAPI) | `bbf597dd-4c93-4eb3-9956-ccc76c07f509` | SUCCESS | 2026-05-07 00:54:54Z (= 2026-05-06 8:54 PM UTC-4) | `sha256:1baa5b7a6a57…` |
| `rust-core-service` | `f0784733-d4e8-4dad-b08e-78077a4caad3` | SUCCESS | 2026-04-11 22:07:49Z (legacy, healthy) | `sha256:b979b96edf83…` |

Both realtime-sprint deploys are **after** the 8:54 PM UTC-4 recovery cut-off. Frontend `build-info.json`: `version: 2.0.15`, `buildTime: 2026-05-07T00:57:25.628Z`, `commitHash: "unknown"` ⚠️ (yellow flag — see Outstanding items).

### Listener boot logs (rust-work-service deploy `753b4488`)

All 6 listeners + 2 evictors confirmed via `railway logs` (filter: `listener OR evictor OR LISTEN OR spawn`). Boot timestamps `2026-05-07T00:58:31.909*Z`:

```
INFO presence evictor spawned (30s tick, 90s TTL)
INFO entity_focus evictor spawned (30s tick, 30s TTL)
INFO sap_agents listener spawned (LISTEN sap_agent_changed)
INFO sap_jobs listener spawned (LISTEN sap_agent_job_changed)
INFO sap_import_runs listener spawned (LISTEN sap_import_run_changed)
INFO cycle_count listener spawned (LISTEN cycle_count_data_changed)
INFO lx03 listener spawned (LISTEN lx03_data_changed)
INFO notifications listener spawned (LISTEN notification_created)
INFO settings listener spawned (LISTEN work_engine_settings_changed)
INFO Connected to Redis successfully
INFO rust-work-service is ready and listening on 0.0.0.0:8030
INFO entity_focus::evictor spawned cadence_secs=30 ttl_secs=30
INFO presence::evictor spawned cadence_secs=30 ttl_secs=90
```

No panics, no `WARN` at boot, no reconnects in the 30 minutes since.

### Critical env vars (rust-work-service)

| Var | Status |
| --- | --- |
| `DATABASE_URL` | ✅ set (Supabase pooler) |
| `REDIS_URL` | ✅ set (Redis Cloud `redis-11543.c62.us-east-1-4.ec2.cloud.redislabs.com:11543`) |
| `SUPABASE_JWT_SECRET` | ✅ set |
| `RUST_CORE_URL` / `RUST_CORE_API_KEY` | ✅ set |
| `CORS_ALLOWED_ORIGINS` | ✅ set (frontend prod + localhost dev) |
| `WORK_WS_REQUIRE_TOKEN` | ❌ **NOT SET** — strict-mode WS auth is OFF; legacy bypass active. See yellow flag #2. |

### Critical env vars (onebox-ai-logistics frontend)

| Var | Value |
| --- | --- |
| `VITE_WORK_SERVICE_URL` | <https://rust-work-service-production.up.railway.app> ✅ |
| `VITE_WORK_SERVICE_WS_URL` | wss://rust-work-service-production.up.railway.app/ws ✅ |
| `VITE_RUST_CORE_ENABLED` | `true` ✅ |
| `VITE_PRESENCE_MODE` | **NOT SET** → resolves to `'supabase'` default at build time. Phase A/B Supabase presence path is active in production; Option 2 Rust presence is NOT live for any user. |
| `VITE_PRESENCE_DISABLED` | NOT SET → kill switch off (default). |

## Database verification (Phase 2)

### Migrations 270–275 — applied ✅

All six migrations present in `supabase_migrations.schema_migrations`:

| Version | Name |
| --- | --- |
| 20260506225656 | sap_agents_notify_trigger |
| 20260506234808 | sap_agent_jobs_notify_trigger |
| 20260506234817 | sap_outbound_to_import_runs_notify_trigger |
| 20260506234831 | rr_cyclecount_data_notify_trigger |
| 20260506234847 | rr_lx03_data_notify_trigger |
| 20260506235740 | notifications_organization_id_and_trigger |

### Triggers — all 6 present, AFTER INSERT/UPDATE/DELETE ✅

```
notifications_notify_created          AFTER INSERT  → public.notifications
rr_cyclecount_data_notify_changed     AFTER I/U/D   → public.rr_cyclecount_data
rr_lx03_data_notify_changed           AFTER I/U/D   → public.rr_lx03_data
sap_agent_jobs_notify_changed         AFTER I/U/D   → public.sap_agent_jobs
sap_agents_notify_changed             AFTER I/U/D   → public.sap_agents
sap_import_runs_notify_changed        AFTER I/U/D   → public.sap_outbound_to_import_runs
```

### NOTIFY functions — all 6 present, all `SECURITY DEFINER` ✅

```
notify_cycle_count_data_changed   prosecdef=true
notify_lx03_data_changed          prosecdef=true
notify_notification_created       prosecdef=true
notify_sap_agent_changed          prosecdef=true
notify_sap_agent_job_changed      prosecdef=true
notify_sap_import_run_changed     prosecdef=true
```

### `notifications` schema — all required columns present ✅

```
id              uuid                NOT NULL  default uuid_generate_v4()
user_id         uuid                NULL
type            notification_type   NULL      default 'info'
title           varchar             NOT NULL
message         text                NULL
data            jsonb               NULL      default '{}'::jsonb
read            boolean             NULL      default false
read_at         timestamptz         NULL
action_url      text                NULL
created_at      timestamptz         NULL      default now()
organization_id uuid                NOT NULL          ← added by mig 275
kind            text                NULL              ← added by mig 275
```

### `notifications` RLS policies — all 3 present ✅

```
"Service role can insert notifications"   FOR INSERT  WITH CHECK (TRUE)
"Users can update their own notifications" FOR UPDATE USING (user_id = auth.uid())
"Users can view their own notifications"   FOR SELECT  USING (
  user_id = auth.uid() AND organization_id = (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  )
)
```

Defence-in-depth `organization_id` check on SELECT confirmed.

### Advisor warnings introduced by migrations 270–275 ⚠️

`get_advisors(security)` returns **12 new** `anon_security_definer_function_executable` + `authenticated_security_definer_function_executable` WARN entries, one pair for each of the 6 new `notify_*` trigger functions. They're flagged because they're `SECURITY DEFINER` and PostgREST exposes ANY public-schema function as `/rest/v1/rpc/<fn>` to the `anon` and `authenticated` roles by default.

**Risk assessment:** These are *trigger* functions — they reference `NEW`/`OLD`/`TG_OP`. Calling them via `/rest/v1/rpc/notify_sap_agent_changed` from outside a trigger context will fail with `record "new" is not assigned yet` or similar at runtime. So **not exploitable** in the obvious sense, but they're noisy lint output and Supabase's recommendation (REVOKE EXECUTE FROM anon, authenticated) is the right hygiene. **Recommended follow-up note: Debug/Tighten-NOTIFY-Function-Grants.md** — revoke RPC execution to silence the lints.

No other new advisor findings. Postgres logs (last 30 min) — only routine `LOG` level (connection auth, pg_cron jobs); no `ERROR`, `WARN`, `FATAL`.

## REST endpoint smoke tests (Phase 3)

Routed through `https://rust-work-service-production.up.railway.app`. Auth was performed using two patterns:

1. **Service-key path** (`X-Service-Key: $RUST_CORE_API_KEY`) — passes `require_auth` middleware; the request reaches the route handler. Org-scoped routes then 403 (no `organization_id` on service identity); user-scoped routes 400 ("Invalid user ID" — `system` is not a UUID). This is the **expected enforcement** and confirms routing + auth chain.
2. **Negative auth** — bogus `X-Service-Key` returned 401 "Authentication required" as expected.

| Method | Endpoint | Auth | HTTP | Body | Verdict |
| --- | --- | --- | --- | --- | --- |
| GET  | `/health` | none | 200 | `{"status":"healthy","version":"0.1.31","service":"rust-work-service"}` | ✅ |
| GET  | `/metrics` | none | 200 | Prometheus exposition (see Phase 6) | ✅ |
| GET  | `/api/v1/presence/online` | none | 401 | `{"error":"Authentication required"}` | ✅ enforced |
| GET  | `/api/v1/presence/online` | service-key | 403 | `{"error":"Organization context required","code":"FORBIDDEN"}` | ✅ org-required |
| POST | `/api/v1/presence/heartbeat` | service-key | 403 | `{"error":"Organization context required","code":"FORBIDDEN"}` | ✅ org-required |
| GET  | `/api/v1/notifications` | none | 401 | `{"error":"Authentication required"}` | ✅ enforced |
| GET  | `/api/v1/notifications?unread_only=true&limit=10` | service-key | 400 | `{"error":"Invalid user ID","code":"BAD_REQUEST"}` | ✅ user-id required |
| GET  | `/api/v1/entity-focus/users?entity_kind=ticket&entity_id=test-123` | service-key | 400 | `{"error":"Invalid user ID","code":"BAD_REQUEST"}` | ✅ user-id required |
| POST | `/api/v1/dispatch/broadcast` | service-key | 400 | `{"error":"Invalid user ID","code":"BAD_REQUEST"}` | ✅ user-id required |
| GET  | `/api/v1/presence/online` | bogus key | 401 | `{"error":"Authentication required"}` | ✅ rejection |

**All 4 route groups (`presence/*`, `entity-focus/*`, `notifications/*`, `dispatch/*`) are mounted, the `require_auth` middleware fires, and each route correctly blocks on the missing identity field.** I could not exercise the 200-OK path because I do not have a real user JWT (and minting one would be out of scope of "verification"); the user can run the JWT-bearing curls below to complete the matrix end-to-end.

### Manual procedure for the user (real-JWT smoke pass)

Replace `$JWT` with a fresh `supabase.auth.session()?.access_token` from a logged-in browser tab; replace `$SUP_JWT` with a supervisor-role user's JWT for the dispatch test.

```bash
RUST_WORK_URL=https://rust-work-service-production.up.railway.app

# Presence — Option 2
curl -X POST $RUST_WORK_URL/api/v1/presence/heartbeat \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"status":"online","role_name":"verification"}'
# Expected: 200 with {"broadcast":"PresenceJoined"} (first call) or "PresenceUpdated"

curl $RUST_WORK_URL/api/v1/presence/online -H "Authorization: Bearer $JWT"
# Expected: 200 with {"users":[…]}

curl -X DELETE $RUST_WORK_URL/api/v1/presence -H "Authorization: Bearer $JWT"
# Expected: 200 with {"removed":true|false}

# Entity focus — Tier 2 #1
curl -X POST $RUST_WORK_URL/api/v1/entity-focus/heartbeat \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"entity_kind":"ticket","entity_id":"<real-ticket-uuid>"}'

curl "$RUST_WORK_URL/api/v1/entity-focus/users?entity_kind=ticket&entity_id=<real-ticket-uuid>" \
  -H "Authorization: Bearer $JWT"

# Notifications — Tier 2 #2
curl "$RUST_WORK_URL/api/v1/notifications?unread_only=true&limit=10" \
  -H "Authorization: Bearer $JWT"

# Dispatch — Tier 2 #3 (supervisor role required)
curl -X POST $RUST_WORK_URL/api/v1/dispatch/broadcast \
  -H "Authorization: Bearer $SUP_JWT" -H "Content-Type: application/json" \
  -d '{"message":"test broadcast","target_zone":"ZONE1"}'
```

## WebSocket pipe verification (Phase 4)

**Method:** `websocat` connected to `wss://rust-work-service-production.up.railway.app/ws` without a `WS-Subscribe-Token` (legacy bypass — `WORK_WS_REQUIRE_TOKEN` is unset on the deployed service). Sent a `Subscribe` for org `c9d89a74-7179-4033-93ea-56267cf42a17` (active prod tenant). Then triggered each listener's source table via Supabase MCP `execute_sql`.

```
→ {"type":"Subscribe","organization_id":"c9d89a74-7179-4033-93ea-56267cf42a17"}
```

### Observed frames after triggering each table — all 6 listeners verified end-to-end

| Source change | WsEvent received | Latency | Status |
| --- | --- | --- | --- |
| `UPDATE sap_agents SET status = status WHERE id = 'USINDPR-CXA103V-…'` | `SapAgentChanged` (`agent_id`, `organization_id`, `status=offline`, `last_seen_at`, `op=UPDATE`) | < 2s | ✅ |
| `UPDATE sap_agent_jobs SET status = status WHERE id = '2e7f0758-…'` | `SapJobStatusChanged` (`job_id`, `status=completed`, `op=UPDATE`) | < 2s | ✅ |
| `UPDATE sap_outbound_to_import_runs SET status = status WHERE id = 'cdf7ee11-…'` | `ImportRunStatusChanged` (`run_id`, `status=queued`, `rows_imported=0`, `op=UPDATE`) | < 2s | ✅ |
| `UPDATE rr_cyclecount_data SET status = status WHERE id = '8d306e32-…'` | `CycleCountOperationChanged` (`row_id`, `op=UPDATE`) | < 2s | ✅ |
| `UPDATE rr_lx03_data SET warehouse = warehouse WHERE id = '7700c1f1-…'` | `Lx03DataChanged` (`row_id`, `op=UPDATE`) | < 2s | ✅ |
| `INSERT INTO notifications (…) RETURNING id 304bba9a-78de-4412-bd74-c9a99ad45a3d` | `Notification` (`notification_id`, `user_id`, `organization_id`, `kind=verification_test`, `title`, `body`, `severity=info`) | < 2s | ✅ |

**Plus** ambient frames observed in the same session (confirming pre-existing fan-outs still work):

- `Heartbeat` (every ~10s, server-side liveness)
- `QueueStatsUpdated` (org-scoped queue stats — confirms work-queue WS replacement is delivering)

The verification notification row was DELETEd cleanly afterwards. `work_websocket_subscribers{org_hash="c997"} = 3` while my test socket was open (i.e. 2 other production subscribers concurrent with mine) — so org-scoped fan-out is reaching real production tabs.

## Functionality matrix (Phase 5)

Legend: ✅ VERIFIED in production / 🟡 DEFERRED (cannot verify without UI/JWT) / ❌ FAIL.

### Phase A presence hardening — source/bundle VERIFIED ✅, runtime DEFERRED 🟡

| Item | In bundle? | Verdict | Notes |
| --- | --- | --- | --- |
| `TRACK_DEBOUNCE_MS = 1500` constant | ✅ `1500` literal in customer-portal chunk | ✅ | constants.ts is bundled |
| `CHANNEL_ERROR_THRESHOLD = 3`, `_WINDOW_MS = 60000`, `_STABLE_CONNECTION_MS = 60000` | ✅ `6e4` (60000) literal in chunks | ✅ | minified but constant value preserved |
| Visibility-aware heartbeat (5min hidden vs 60s active) | n/a — runtime check | 🟡 | manual: `document.visibilityState='hidden'` then check Network tab DB heartbeat cadence |
| `VITE_PRESENCE_DISABLED` kill switch | ✅ `PRESENCE_DISABLED` IIFE present | ✅ | Currently `false` in production (env unset) |
| `VITE_PRESENCE_MODE` selector (`'supabase'`/`'rust'`/`'disabled'`) | ✅ resolution IIFE present | ✅ | Currently `'supabase'` in production (env unset) |
| Kiosk-route opt-out regex (`/^\/rf-/`, `/^\/timeclock(app)?(\/|$)/`, `/^\/customer-portal(\/|$)/`) | ✅ first regex literal present in bundle | ✅ | other two are minified together but the IIFE invokes all three |

### Phase B2 / B3 — VERIFIED ✅

| Item | Verdict | Evidence |
| --- | --- | --- |
| `presence:hidden` permission key | ✅ | `"presence:hidden"` literal present in 3 customer-portal/feature chunks |
| `useIsPresenceCandidate` hook | ✅ | resolves `presence:hidden` — bundled inside customer-portal chunk (function name minified) |
| `current_page` field DROPPED from `PresencePayload` | ✅ | 0 occurrences of `current_page` across all 108 deployed JS chunks |

### Roadmap-Rust-WS-Unlocks Tier 1 migrations — VERIFIED ✅

| Migration | Verdict | Evidence |
| --- | --- | --- |
| `useAgentDetection` (replaces `omniframe-agent-detection-fleet`) | ✅ | 0 occurrences of `omniframe-agent-detection-fleet` or `sap-agents-fleet` in bundle |
| `useWorkQueue` (replaces `omniframe-work-queue-realtime`) | ✅ | 0 occurrences of `omniframe-work-queue-realtime` or `work-queue-realtime` in bundle |
| `agents-fleet-card.tsx` migration | ✅ | bundled into `feature-admin-sap` chunk; legacy supabase channel name absent |
| `useJobQueue` / `import-lt22-dialog` / `useCycleCountOperations` / `useLx03Data` | ✅ end-to-end pipe verified live | each emits via the now-confirmed listeners (Phase 4) |
| `scheduled-jobs-tab` cross-tenant filter (`organization_id=eq.${orgId}`) | ✅ source-level | line 273 of `scheduled-jobs-tab.tsx`; bundled into `feature-admin-sap` chunk |
| `RecvError::Lagged` → `work_ws_lagged_events_total` metric | ✅ source-level | `rust-work-service/src/observability/metrics.rs:55` + `websocket/mod.rs:583`. Counter 0 in production (no lagged consumers observed) — auto-registers on first lag, so absence in `/metrics` is expected. |

### Tier 2 surfaces — VERIFIED ✅

| Surface | Verdict | Evidence |
| --- | --- | --- |
| Tier 2 #1 — Entity-focus pill / `useEntityFocus` | ✅ | `/api/v1/entity-focus/heartbeat`, `/users`, `entity-focus-pill` all present in `feature-customer-portal` chunk; live REST returns 400 (auth/user-required) → routing OK; `work_entity_focus_total{op=track}=1` and `{op=untrack}=1` show real production usage. |
| Tier 2 #2 — `NotificationsPanel` / `useNotifications` | ✅ | `/api/v1/notifications/`, `/api/v1/notifications/read-all` and `useNotifications` all present in `route-D-D09y-G.js` chunk; live INSERT → WS `Notification` frame VERIFIED in Phase 4; `work_notifications_total{op=enqueue}=1` after my test insert. |
| Tier 2 #3 — `BroadcastDialog` + `target_zone`/`target_role` | ✅ | `/api/v1/dispatch/broadcast`, `target_zone`, `target_role` literals all present in `feature-admin-work-queue-Bo1Zk4q6.js`. Server-side `dispatch::resolve` not load-tested (requires supervisor JWT). |

### Realtime policy rule — VERIFIED ✅

| Item | Verdict | Path |
| --- | --- | --- |
| `realtime-policy workspace rule` | ✅ exists in repo | `/realtime-policy workspace rule` (always-applied workspace rule) |

## Stability + observability spot checks (Phase 6)

### `rust-work-service` runtime (last 30 min)

- **0 ERROR / FATAL / panic** lines.
- **3 WARN** lines, all `Missing authentication` from MY unauthenticated curls in Phase 3 (expected; the middleware logs every unauthenticated hit at WARN). Source: `rust_work_service::middleware`.
- No reconnects on any of the 6 PgListeners (no `*_listener: recv failed; reconnecting` lines).

### Prometheus metrics snapshot at end of verification

```
work_entity_focus_active{org_hash="c997"} 0
work_entity_focus_total{op="track"}     1   ← pre-existing prod traffic
work_entity_focus_total{op="untrack"}   1   ← pre-existing prod traffic
work_notifications_total{op="enqueue"}  1   ← MY test insert
work_websocket_subscribers{org_hash="c997",task_type="all"} 3
work_websocket_subscribers{org_hash="unbound",task_type="all"} 0
```

**Counters absent from `/metrics` body** (auto-register on first observation, not a bug):
- `work_presence_active_users` — 0 production traffic (FE is on `'supabase'` mode)
- `work_presence_track_total` — same
- `work_presence_redis_errors_total` — 0 errors (good)
- `work_dispatch_broadcast_total` — no broadcasts since deploy
- `work_ws_lagged_events_total` — no lag events (good)
- `work_ws_auth_failure_total` — no auth failures so far

**Yellow flag #1: zero presence traffic on the Rust path.** `work_presence_*` counters are unobserved because `VITE_PRESENCE_MODE` is unset on Railway → bundle resolves to `'supabase'` at build time → real users still drive Supabase Realtime presence, not Rust. Option 2 is verified DEPLOYED but NOT ACTIVE. To activate fleet-wide, set `VITE_PRESENCE_MODE=rust` on the `onebox-ai-logistics` Railway service and trigger a redeploy.

### Supabase logs (last 30 min)

Queried `get_logs(service=postgres)`. Only `LOG`-level entries (`connection authenticated`, `connection authorized`, `pg_cron job 2/3 starting`, routine `checkpoint complete`). No `WARNING`, `ERROR`, or `FATAL`. No trigger failure messages. RLS denials would show as `ERROR: new row violates row-level security policy` — none seen.

### Supabase advisors

See Phase 2. Migrations 270–275 introduced **12 new lint WARNs** (anon/authenticated `SECURITY DEFINER` RPC exposure on the 6 trigger functions). Not exploitable in practice (trigger functions error without trigger context) but recommended hygiene fix is to revoke EXECUTE.

## Manual procedures handed off to user

1. **Real-JWT REST smoke pass** — see Phase 3 "Manual procedure for the user" section above. Run with a logged-in browser-session JWT. Expected: every endpoint returns 200 with the documented body shape.
2. **UI bell verification** — sign in, watch a `NotificationsPanel` bell render in the top action bar of `authenticated-layout`. Trigger a server-side notification (e.g. assign a ticket to yourself, or insert a row directly via SQL with `kind='verification_test'`) and confirm:
   - the bell unread badge increments within < 2s,
   - the popover shows the new row when opened,
   - clicking it routes to the `link` field if present,
   - the row marks read after click and the badge decrements.
3. **EntityFocusPill UI verification** — open a ticket in the customer-portal `tickets/$ticketId` route in **two** tabs (or two browsers, two users). Confirm:
   - the pill on tab A shows tab B's user within 5–30s,
   - closing tab B causes the pill to drop tab B's user within 30s (entity_focus TTL),
   - the soft-lock advisory matches the documented Pattern note `[[Entity-Focus-Soft-Locking]]`.
4. **BroadcastDialog UI verification** — sign in as a supervisor, open the work-queue admin tab, open the BroadcastDialog, send a `target_zone` or `target_role` broadcast. Confirm:
   - the dialog reports `resolved_user_count` after submit,
   - operators in the matching zone/role see the toast within < 2s.
5. **Activate Option 2 presence (optional follow-up)** — set `VITE_PRESENCE_MODE=rust` on `onebox-ai-logistics`, redeploy, watch `work_presence_active_users` increment in `/metrics`. Compare WS frame volume to the Supabase Realtime presence baseline before / after.

## Outstanding items

### Yellow flag #1 — Option 2 Rust presence is deployed but not active

FE bundle ships the `'rust'` code path but the env var `VITE_PRESENCE_MODE` is unset in production, so `PRESENCE_MODE` resolves to `'supabase'` at build time (per `src/lib/presence/constants.ts:149`). Net effect: Rust presence REST + WS endpoints are operational but receive zero traffic from real users; the org's load-bearing presence path is still the Supabase Realtime channel that wedged earlier today. Activation is a one-line env var flip + redeploy.

### Yellow flag #2 — `WORK_WS_REQUIRE_TOKEN` not set on rust-work-service

The rust-work-service runs in legacy WS-bypass mode: clients can upgrade to `/ws` without a `WS-Subscribe-Token`. The org-mismatch check on the `Subscribe` message still runs (so cross-tenant data leakage is blocked), but token-less upgrades remain possible. The deployed FE bundle correspondingly does NOT call `POST /api/v1/work/ws-token` — verified by grep across all 108 chunks: zero occurrences of `/work/ws-token` or `WS-Subscribe-Token`. To tighten, set `WORK_WS_REQUIRE_TOKEN=true` on `rust-work-service` AND ship a FE update that fetches the token and includes it in the WS upgrade.

### Yellow flag #3 — frontend `build-info.json` lost the git SHA

`/build-info.json` reports `commitHash: "unknown"` and `buildId: "unknown-mous0ynw"`. The `vite.config.ts` deterministic build hash logic depends on `.git` being present in the Docker build context; the production Dockerfile likely copies only the source tree without `.git`. Effect: the version-checker / auto-updater can detect *that* a new build shipped (the `mous0ynw` base36 timestamp suffix changes) but operators cannot trace the build back to a specific commit from `/build-info.json` alone. Cosmetic, but worth a follow-up.

### Lint hygiene — 12 new advisor WARNs from migrations 270–275

The 6 new `notify_*` SECURITY DEFINER trigger functions are exposed as `/rest/v1/rpc/<fn>` to `anon` and `authenticated`. Not exploitable (trigger context is required) but Supabase's lint flags them. Recommended: `REVOKE EXECUTE ON FUNCTION public.notify_*_changed FROM anon, authenticated;` in a follow-up migration. Add a Debug/Tighten-NOTIFY-Function-Grants.md note when filing.

## Related

- [[Roadmap-Rust-WS-Unlocks]]
- [[ADR-Presence-Architecture-Next-Steps]]
- [[ADR-WsEvent-Typed-vs-Envelope]]
- [[Implement-Presence-On-Rust-Option-2]]
- [[Migrate-SapAgentChanged-To-Rust-WS]]
- [[Migrate-Tier1-Deferred-Channels-To-Rust-WS]]
- [[Migrate-Work-Queue-To-WS]]
- [[Implement-Entity-Soft-Locking-Tier2-1]]
- [[Implement-Notifications-Panel-Tier2-2]]
- [[Implement-Richer-Dispatch-Broadcast-Tier2-3]]
- [[Add-WsEvent-Lagged-Metric]]
- [[Harden-Presence-Service-Tenant-Overload]]
- [[Realtime-Presence-Browser-Hardening]]
- [[Server-Side-Presence-Redis-HSET]]
- [[Entity-Focus-Soft-Locking]]
- [[Fix-CustomerPortal-Presence-Tenant-Overload]]
- [[Fix-Realtime-Tenant-Overload]]
- [[Fix-ScheduledJobsTab-Cross-Tenant-Filter]]
- [[NotificationsPanel]]
- [[2026-05-06]]
