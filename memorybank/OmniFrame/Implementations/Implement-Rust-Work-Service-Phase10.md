---
tags: [type/implementation, status/active, domain/auth, domain/agent, domain/backend, domain/frontend, domain/database]
created: 2026-05-07
---

# Implement Rust Work Service — Phase 10 (Agent Identity v2)

Phase 10 of the comprehensive [[plans/rust_work_service_full_integration_5b88165d.plan]]. Replaces the agent's reliance on inherited user JWTs with first-class service-key authentication — the agent now owns its own credentials. See [[ADR-Agent-Identity-V2-Phase10]] for the architecture decision + parameter rationale; this note covers the shipping diff.

## Purpose / Context

Until Phase 10 the agent inherited a human user's Supabase session via `/supabase/login` (Phase 1.6.4 era) — every authenticated path (Phase 7's `/api/v1/sap-agents/jobs/*`, Phase 4's WS subscribe-token mint, the heartbeat + trigger backfill) signed its calls with `state.supabase_token`. The plan calls out three operational pain points that this kept causing:

1. Disabling an agent (terminated employee, lost laptop) required rotating the user's password — noisy and lossy.
2. Audit trails showed user-attribution for agent actions; the v1.6.6 honest-attribution work papered over the symptom.
3. JWT lifecycle was the user's problem; a refresh failure took the agent dark even though the agent itself was fine.

Phase 10 ships service-key authentication. The agent owns a long-lived `omni_sk_*` plaintext key on disk; at boot it exchanges the key for a 15-minute `kind: "agent"` JWT signed locally by `WORK_SERVICE_AGENT_JWT_SECRET`. Admin can revoke a key without touching `auth.users`.

No user-visible behavior change beyond the new admin Setup page. The legacy user-JWT path stays operational for backward compatibility — Phase 11 owns the cleanup.

## Scope shipped

### 10.1 Schema migration 283

[`supabase/migrations/283_agent_service_keys.sql`](../../../supabase/migrations/283_agent_service_keys.sql) — applied via Supabase MCP `apply_migration`. Verified via `information_schema.columns` (12 columns: id, organization_id, agent_id, key_hash, key_prefix, label, created_by, created_at, last_used_at, revoked_at, revoked_by, revoke_reason) + `pg_policy` (2 admin policies: read + write).

Key design points:
- `(organization_id, agent_id, revoked_at)` UNIQUE NULLS NOT DISTINCT — at most one ACTIVE key per (org, agent) thanks to NULL collision; multiple revoked rows coexist (each carries a distinct non-NULL `revoked_at`).
- Two partial indexes for the hot paths: `idx_agent_service_keys_org_active` (admin list view) and `idx_agent_service_keys_agent_id` (`/exchange` lookup), both `WHERE revoked_at IS NULL`.
- RLS gated on `role IN ('admin', 'superadmin')` — service keys are sensitive even with hash-only storage; non-admins never see the table.

### 10.2 Rust routes — `agent_identity.rs`

NEW file [`rust-work-service/src/api/routes/agent_identity.rs`](../../../rust-work-service/src/api/routes/agent_identity.rs) (~700 LOC including tests). Four routes:

#### `POST /api/v1/agent-identity/register` — admin-only

- Body: `{ agent_id: string, label?: string }`.
- Generates a 32-byte URL-safe random key — `omni_sk_<43 chars base64url>`. 256 bits of entropy.
- Argon2id hashes the plaintext (memory_cost=64 MiB, time_cost=3, parallelism=4 — OWASP-baseline tier; ~50 ms on a modern Linux box, cheap enough for a service path).
- INSERTs `agent_service_keys` row; the unique constraint catches concurrent admins racing on the same `(org, agent_id)` and returns `409 Conflict` with a clear message.
- Returns `{ key_id, plaintext_key, key_prefix, agent_id, label, expires_at: null }`. Plaintext key is the ONLY time the FE sees it.
- Audit: `tracing::info!(kind="agent_service_key.registered", …)`.

#### `POST /api/v1/agent-identity/exchange` — PUBLIC (no JWT)

- Body: `{ agent_id: string, service_key: string }`.
- Mounted on the public router (Phase 10's only auth-exempt route) because agents have no JWT yet at exchange time.
- Cheap-reject: `service_key` must start with `omni_sk_` (saves an Argon2id verify on garbage); still bumps the rate-limit counter so the route can't be used as a generic key-shape probe.
- Rate limit: 5 failures per `agent_id` per hour, tracked in Redis under `ratelimit:agent-identity-exchange:<agent_id>`. Counter cleared on successful exchange. 429 with `Retry-After` header.
- Pulls active rows for `agent_id`, narrows to those whose `key_prefix` matches the candidate (so an attacker can't time-trash the service by forcing N Argon2id verifies), Argon2id-verifies each.
- On match: stamps `last_used_at`, primes the revocation cache (`agent-identity:revoked:<key_id>` = `"0"` for 60s), issues the JWT.
- Returns `{ access_token, token_type: "Bearer", expires_in: 900, organization_id }`.
- Audit: `tracing::info!(kind="agent_service_key.exchanged", …)`.

#### `POST /api/v1/agent-identity/revoke` — admin-only

- Body: `{ key_id: UUID, reason?: string }`.
- UPDATEs `revoked_at = now()`, `revoked_by = auth.uid()`, `revoke_reason`. Org-scoped from the JWT to prevent cross-tenant revocation.
- Returns 404 when the key is already revoked / owned by another org — admin can't accidentally double-revoke.
- Primes the revocation cache with `"1"` so the next agent call is rejected within one round-trip; the 60s cache TTL is the worst-case staleness window if Redis was unavailable at revoke time.
- Audit: `tracing::info!(kind="agent_service_key.revoked", …)`.

#### `GET /api/v1/agent-identity/list` — admin-only

- Query: `?include_revoked=true` (default `false`).
- LEFT JOIN `user_profiles` to surface `created_by_email`. Sort: active first, then by `created_at DESC`.
- Returns `{ keys: ServiceKeyListEntry[] }`.

### 10.3 Middleware — `AuthIdentity` + agent-JWT verify

[`rust-work-service/src/middleware.rs`](../../../rust-work-service/src/middleware.rs) — rewritten:

NEW `pub enum AuthIdentity { User { user_id, org_id, role }, Agent { agent_id, org_id, key_id } }` injected into request extensions alongside the legacy `AuthenticatedUser` shape. Existing handlers pulling `Extension<AuthenticatedUser>` keep working unchanged — for `AuthIdentity::Agent { .. }` we synthesise an `AuthenticatedUser { user_id: agent_id, role: "agent", organization_id, .. }` so the legacy extractors don't break. New code prefers `Extension<AuthIdentity>` and gates on `is_agent()` / `require_admin(&identity)`.

Auth precedence in `require_auth`:
1. `X-Service-Key` header → service user (unchanged).
2. Bearer JWT where the unverified `kind` claim is `"agent"` → verified locally via `crate::agent_jwt::verify`, then revocation-checked. New path.
3. Bearer JWT of any other shape → validated via `rust-core-service` (legacy path, unchanged).

`crate::agent_jwt::looks_like_agent_jwt(token)` cheaply peeks at the unverified payload (base64url-decode the middle section, check `kind == "agent"`). The signature is verified by `verify()` immediately after; we never trust the unverified peek for anything beyond routing.

#### Revocation check

Middleware calls `agent_key_is_revoked(state, key_id)` after JWT verification:
- Redis fast-path: `GET agent-identity:revoked:<key_id>` — returns `"1"` (revoked) or `"0"` (active) when the slot is warm.
- DB fallback on miss: `SELECT revoked_at FROM agent_service_keys WHERE id = $1`. Missing row → treat as revoked (defence-in-depth: a manual cleanup means the row is no longer trustable).
- Fail-closed: if both Redis AND Postgres are unreachable, return `AuthError::ServiceUnavailable` (a partial outage MUST NOT silently let a revoked key slip through).
- Best-effort cache write after every DB hit so the next call skips the round-trip.

### 10.4 Agent first-boot flow

[`omni_agent/agent.py`](../../../omni_agent/agent.py) — additive only, NO existing handler logic touched, NO trigger semantics changed.

NEW state fields on `AgentState`:
- `agent_service_key: str` — plaintext loaded from disk at boot.
- `work_service_jwt: str` — cached agent JWT.
- `work_service_jwt_expires_at: float` — epoch seconds.
- `work_service_jwt_org_id: str` — echoed back in the exchange response.

NEW module-level helpers (around line 845, between AgentState init and the existing `_restore_pinned_session_indexes()` call):
- `_AGENT_SERVICE_KEY_PATH` constant from `OMNIFRAME_AGENT_SERVICE_KEY_PATH` env var (default: `~/.omniframe/agent_service_key.txt`).
- `_load_agent_service_key()` — reads the file, validates the `omni_sk_` prefix, returns `None` when absent.
- `_exchange_service_key_for_jwt(service_key)` — POSTs to `/api/v1/agent-identity/exchange`, populates the four state fields on success, logs once on failure.
- `_refresh_work_service_jwt_if_needed()` — runs at the top of `_work_service_request` AND every 60s in the daemon. Refresh window: 60s before expiry. Failure cooldown: 60s (rate-limiter friendly).
- `_start_work_service_jwt_refresh_thread()` / `_stop_*` — daemon thread lifecycle.
- `_bootstrap_agent_identity_v2()` — reads the key + advertises the active path in the boot banner.

Wired:
- `_ensure_agent_identity_v2_bootstrap()` runs at module load (right after `_AGENT_TOKEN_FRESHLY_MINTED`), so the boot banner is correct from the very first print.
- `_start_work_service_jwt_refresh_thread()` runs from `_on_startup` after the FastAPI app is listening.
- `_stop_work_service_jwt_refresh_thread()` runs from `_on_shutdown`.

Updated paths:
- `_work_service_request` (Phase 7's helper) now prefers `state.work_service_jwt` over `state.supabase_token`. When the agent JWT is present, it goes out as the Bearer token; otherwise the legacy user JWT is used unchanged. Two refreshes happen at the top of the helper: legacy `_refresh_supabase_token_if_needed` AND new `_refresh_work_service_jwt_if_needed`. Both no-op when their respective tokens are healthy.
- `_start_work_service_ws_client` (Phase 4's WS launcher) now passes a token-provider that prefers the agent JWT. The work service's middleware accepts either at `POST /api/v1/work/ws-token` because the route runs through the same `require_auth` middleware that routes `kind` claim differently.

New capability `agent-identity-v2` advertised UNCONDITIONALLY in `AGENT_CAPABILITIES` (build capability, not runtime path) — mirrors the Phase 4 `rust-ws-client` + Phase 7 `agent-claims-via-rust` pattern. Frontend can show "Agent X is on Identity v2" badges off this capability.

`AGENT_VERSION` INTENTIONALLY left at `"1.9.0"` per plan directive — Phase 11 owns the bump to 2.0.0 marking the architecture-change boundary.

### 10.5 Admin Setup page

NEW [`src/features/admin/sap-testing/components/agent-identity-tab.tsx`](../../../src/features/admin/sap-testing/components/agent-identity-tab.tsx) — added as a new "Agent Setup" tab in the SAP Testing page (alphabetically last so the existing tab ordering is preserved).

Surfaces:
- Header strip with active / revoked counts + "Show revoked" toggle + Refresh + "Register new agent" buttons.
- Empty state with a clear CTA when no keys exist yet.
- Table with columns: Agent / Key prefix / Label / Created (with relative time + tooltip with absolute UTC + creator email) / Last used / Status / Actions.
- "Register new agent" dialog: `agent_id` (free-text) + optional label inputs. Submit calls `registerAgentServiceKey()`.
- "Reveal key" dialog (the ONE-TIME plaintext display): renders the plaintext + copy-to-clipboard button + a "I have saved this key" toggle that gates the close button. The dialog can ONLY be dismissed via the toggle-confirmation path — closing accidentally is much harder.
- "Revoke" confirm dialog with optional reason input.

NEW [`src/lib/work-service/agent-identity-client.ts`](../../../src/lib/work-service/agent-identity-client.ts) — typed REST client for the four routes. Mirrors the `triggers-client.ts` / `sap-testing-client.ts` shape (Bearer JWT + optional `X-Organization-ID` defence-in-depth header).

[`src/features/admin/sap-testing/index.tsx`](../../../src/features/admin/sap-testing/index.tsx) wires the new tab into `SAP_TESTING_TABS` and `renderTabContent()`.

### 10.6 Capability advertisement (Phase 10.6 polish)

[`rust-work-service/src/api/routes/sap_testing.rs`](../../../rust-work-service/src/api/routes/sap_testing.rs) — added a top-level `service_capabilities: Vec<String>` field to `DashboardResponse`, populated from a new `SERVICE_CAPABILITIES = &["agent-identity-v2"]` const. NOT a per-agent capability — it's a service-level advertisement that the FE can use to gate admin UIs.

[`src/lib/work-service/sap-testing-client.ts`](../../../src/lib/work-service/sap-testing-client.ts) — the type now carries `service_capabilities?: string[]`. Optional in the type because older deployments may not have shipped the field yet — `service_capabilities ?? []` is the safe consumer pattern.

The field is reserved for future polish: the "Agent Setup" tab today is unconditionally visible to admins, but a future iteration could gate it on `service_capabilities.includes("agent-identity-v2")` so the tab disappears in deploys that haven't been migrated yet.

## Tests added

25 new unit tests across `agent_jwt`, `api::routes::agent_identity`, and `middleware::tests`:

### `agent_jwt::tests`
- `issue_then_verify_roundtrip` — every claim survives a roundtrip.
- `looks_like_agent_jwt_detects_kind_claim` — positive case.
- `looks_like_agent_jwt_rejects_user_jwt_shape` — negative case (no `kind` claim).
- `verify_rejects_tampered_signature`.
- `verify_rejects_token_signed_with_wrong_secret`.
- `verify_rejects_non_agent_kind_claim` — a manually-issued `kind=user` token signed by the agent secret is still rejected.

All six tests share a process-wide `AGENT_JWT_ENV_LOCK` `Mutex` (env-var state is process-global; without the lock parallel tests race on `WORK_SERVICE_AGENT_JWT_SECRET` and surface as flaky `InvalidSignature`). The lock is `pub` so the sibling `agent_identity::tests::jwt_issued_by_register_via_helper_verifies_locally` reaches in for the same serialisation.

### `api::routes::agent_identity::tests`
- `mint_plaintext_key_has_correct_prefix` — `omni_sk_` start, length sanity.
- `mint_plaintext_key_is_random` — two consecutive mints produce different values.
- `argon2_roundtrip_matches` — plaintext → hash → verify True; wrong plaintext → verify False.
- `argon2_uses_phase10_parameters` — PHC string contains `m=65536`, `t=3`, `p=4` (regression guard — we don't accidentally drop to defaults).
- `rate_limit_key_namespace` — `ratelimit:agent-identity-exchange:<id>` shape.
- `revocation_cache_key_includes_uuid` — cache key shape sanity.
- `register_request_parses_minimal_body` / `register_request_parses_with_label`.
- `exchange_request_parses_full_body`.
- `revoke_request_parses_with_optional_reason`.
- `require_admin_accepts_admin_and_superadmin_and_service`.
- `require_admin_rejects_operator_and_agent`.
- `jwt_issued_by_register_via_helper_verifies_locally` — end-to-end mint → hash → verify → jwt issue → jwt verify roundtrip without a DB.

### `middleware::tests`
- `require_admin_accepts_admin_user` (`admin`, `superadmin`, `service`).
- `require_admin_rejects_non_admin_user`.
- `require_admin_rejects_agent`.
- `auth_identity_organization_id_unifies_user_and_agent_paths`.
- `is_agent_discriminator_matches_variant`.
- `synthesise_agent_user_lands_agent_id_in_user_id`.

Full `cargo test --lib`: **146 passed, 0 failed** (up from 121 in Phase 9).

## Quality gates

- ✓ Migration 283 applied via Supabase MCP `apply_migration`.
- ✓ `cargo build` clean (only pre-existing dead-code warnings on `observability/middleware.rs`).
- ✓ `cargo test --lib`: **146 passed**, 0 failed (3 consecutive runs to confirm stability).
- ✓ `cargo clippy --lib --all-targets`: zero new warnings on Phase 10 files.
- ✓ `python3 -c "import ast; ast.parse(open('omni_agent/agent.py').read())"` clean.
- ✓ `pnpm tsc -b --noEmit` clean.
- ✓ `pnpm build` clean (9.5s, 182 PWA precache entries; no new bundle-budget violations).
- ✓ `ReadLints` on the three new TS files (`agent-identity-client.ts`, `agent-identity-tab.tsx`, `index.tsx`) clean.

## End-to-end flow demonstration

1. **Admin registers an agent**:
   ```
   POST /api/v1/agent-identity/register
   Authorization: Bearer <admin user JWT>
   { "agent_id": "INDPDC1-Console-aclark", "label": "Citrix OmniBox 01" }
   → 200 { key_id, plaintext_key: "omni_sk_…", key_prefix: "omni_sk_", agent_id, label, expires_at: null }
   ```
   Plaintext shown ONCE in the admin UI. Admin saves it on the agent box at `~/.omniframe/agent_service_key.txt`.

2. **Agent boot exchanges the key**:
   ```
   POST /api/v1/agent-identity/exchange
   { "agent_id": "INDPDC1-Console-aclark", "service_key": "omni_sk_…" }
   → 200 { access_token, token_type: "Bearer", expires_in: 900, organization_id }
   ```

3. **Agent calls heartbeat with new JWT**:
   ```
   POST /api/v1/sap-agents/jobs/heartbeat
   Authorization: Bearer <agent JWT>
   → 200 (middleware: kind=agent verify → revocation check → AuthIdentity::Agent → handler)
   ```

4. **Admin revokes**:
   ```
   POST /api/v1/agent-identity/revoke
   Authorization: Bearer <admin user JWT>
   { "key_id": "…", "reason": "Aaron offboarded" }
   → 200 { key_id, revoked_at, agent_id }
   ```
   Cache primed with `"1"` immediately.

5. **Agent's next call fails 401**:
   ```
   POST /api/v1/sap-agents/jobs/heartbeat
   Authorization: Bearer <agent JWT>
   → 401 Invalid or expired token  (middleware: revocation cache returns "1" → reject)
   ```

## Backward compatibility

Verified — the legacy user-JWT path is untouched:
- Agents WITHOUT a service key file continue using `state.supabase_token` for both `/api/v1/sap-agents/jobs/*` and the WS subscribe-token mint. Boot banner discloses which path is active.
- The middleware's auth precedence is: X-Service-Key → agent JWT (if `kind == "agent"`) → user JWT via rust-core-service. A user JWT has no `kind` claim and falls through to the legacy path with the same behaviour as before Phase 10.
- `Extension<AuthenticatedUser>` extractors keep working for both paths because we synthesise an `AuthenticatedUser` shape for `AuthIdentity::Agent { .. }`.

Phase 11 owns:
- AGENT_VERSION bump to 2.0.0.
- Deletion of the legacy user-JWT path (`state.supabase_token`-as-credential) once every agent has a service key.
- Per-handler audit pass: which routes should reject `AuthIdentity::Agent { .. }` (admin-only paths) vs accept either (heartbeat / claim / etc).

## Files

### Created

- `supabase/migrations/283_agent_service_keys.sql`
- `rust-work-service/src/agent_jwt.rs`
- `rust-work-service/src/api/routes/agent_identity.rs`
- `src/lib/work-service/agent-identity-client.ts`
- `src/features/admin/sap-testing/components/agent-identity-tab.tsx`
- [[Decisions/ADR-Agent-Identity-V2-Phase10]]
- [[Implementations/Implement-Rust-Work-Service-Phase10]] (this note)

### Modified

- `rust-work-service/Cargo.toml` (+3 deps: argon2, jsonwebtoken, rand)
- `rust-work-service/src/lib.rs` (`pub mod agent_jwt;`)
- `rust-work-service/src/main.rs` (mod + public `/exchange` mount + protected `/register`+`/revoke`+`/list` mount)
- `rust-work-service/src/middleware.rs` (`AuthIdentity` enum + agent-JWT branch + revocation cache + DB fallback)
- `rust-work-service/src/api/routes/mod.rs` (`pub mod agent_identity;` + re-exports)
- `rust-work-service/src/api/routes/sap_testing.rs` (`service_capabilities` field on dashboard response)
- `omni_agent/agent.py` (~330 LOC additive; service-key load + exchange + 60s refresh thread + boot banner + capability + JWT-preferred Authorization in `_work_service_request` + WS token-provider)
- `src/lib/work-service/sap-testing-client.ts` (`service_capabilities?: string[]` on dashboard type)
- `src/features/admin/sap-testing/index.tsx` (Agent Setup tab wired in)
- `.env.example` (`OMNIFRAME_AGENT_SERVICE_KEY_PATH` + `WORK_SERVICE_AGENT_JWT_SECRET` documented)
- [[Components/Omni-Agent - Headless SAP Agent]] (Recent additions)
- [[Sessions/2026-05-07]] (Phase 10 section appended)
- [[_Index/Decisions]]
- [[_Index/Implementations]]

## Deferred to Phase 11

- AGENT_VERSION bump to 2.0.0 (architecture-change boundary).
- Deletion of the legacy user-JWT path (state.supabase_token-as-credential, the entire `/supabase/login` → `state.supabase_session` path, the `_refresh_supabase_token_if_needed` machinery now that the agent has its own credentials).
- Per-handler audit pass: which routes accept `AuthIdentity::Agent { .. }` vs reject. Today every authenticated route accepts both because the synthesised `AuthenticatedUser` is indistinguishable from a real user from the handler's POV. Phase 11 explicitly opt-in / opt-out per route.
- Dedicated `agent_identity_audit_log` table (today the `tracing::info!(kind="agent_service_key.…", …)` lines carry the audit trail; structured-log analysis covers the use case for now).
- "Download key as TXT" button on the reveal dialog so the file is pre-formatted at the canonical path with no risk of trailing newlines / quoting.
- Per-key `expires_at` opt-in (today plaintext keys live until admin revokes).
- Pub/sub broadcast on revoke so the 60s revocation-cache TTL window can be tightened to ~1s (defence-in-depth control; documented as acceptable in the ADR).

## Related

- [[Decisions/ADR-Agent-Identity-V2-Phase10]] — the ADR this ships.
- [[Implementations/Implement-Rust-Work-Service-Phase4]] — WS subscribe-token mint that Phase 10's agent JWT now flows through.
- [[Implementations/Implement-Rust-Work-Service-Phase7]] — `_work_service_request` helper that Phase 10 makes JWT-aware.
- [[Implementations/Implement-Rust-Work-Service-Phase9]] — immediately preceding phase; sibling pattern for new Rust route + FE CRUD UI + admin-only RLS.
- [[Components/Omni-Agent - Headless SAP Agent]] — agent component (Recent additions section updated).
- [[Sessions/2026-05-07]] — session log this phase appends to.
