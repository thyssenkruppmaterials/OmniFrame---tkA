---
tags: [type/decision, status/active, domain/auth, domain/agent, domain/backend, domain/database]
created: 2026-05-07
---

# ADR — Agent Identity v2 (Phase 10 of rust-work-service integration)

## Status

ACCEPTED — shipped 2026-05-07 alongside Phase 10 of the comprehensive [[plans/rust_work_service_full_integration_5b88165d.plan]].

## Context

Until Phase 10 the OmniFrame on-prem agent inherited a human user's Supabase session — every authenticated path (`/api/v1/sap-agents/jobs/*` from Phase 7, the `/api/v1/work/ws-token` mint from Phase 4, the heartbeat upsert, the trigger backfill query, …) signed its calls with `state.supabase_token` plucked from `state.supabase_session.access_token`. Three structural problems made this untenable as the agent fleet grew:

1. **Revocation requires user-level action.** Disabling an agent (terminated employee, stolen Citrix endpoint, leaked dev box) meant rotating the original human user's password / signing them out of every session. Operationally hostile.
2. **Audit trail is muddled.** Every agent action was attributed to the user whose JWT the agent borrowed. The honest-attribution work in agent v1.6.6 (migration 251 → `confirmed_by_label = 'Omni Agent'`) papered over the symptom but the underlying credential was still the user's.
3. **JWT expiry is the user's problem.** The v1.7.2 `_refresh_supabase_token_if_needed` machinery exists specifically to keep the agent's borrowed user-JWT alive across an 8-hour Citrix session. If GoTrue rejects a refresh (password rotated upstream, refresh token reuse detected, …) the agent goes dark. A first-class agent identity has no `auth.users` row and is NOT subject to user-lifecycle invalidation.

Phase 10 ships a service-key authentication model: the agent owns its own credentials and exchanges them at boot for short-lived JWTs that the work service verifies locally.

## Decision

### Architecture

```
admin → POST /api/v1/agent-identity/register     → INSERT agent_service_keys (Argon2id hash only)
                                                 → returns plaintext omni_sk_* ONCE

agent boot → POST /api/v1/agent-identity/exchange → Argon2id verify + issue 15-min JWT
          ← { access_token, expires_in: 900, organization_id }

agent      → POST /api/v1/sap-agents/jobs/claim   → middleware: kind=agent verify
           Authorization: Bearer <agent JWT>     → revocation check (Redis 60s, DB fallback)
                                                 → AuthIdentity::Agent { agent_id, key_id, org_id }
                                                   injected into request extensions

admin → POST /api/v1/agent-identity/revoke       → UPDATE agent_service_keys SET revoked_at=now()
                                                 → middleware revocation check trips ≤60s later
```

### Data model

`public.agent_service_keys` (migration 283):
- `id` UUID PK
- `organization_id` UUID NOT NULL → `organizations(id)` ON DELETE CASCADE
- `agent_id` TEXT NOT NULL — mirrors `_agent_self_id()` (e.g. `INDPDC1-Console-aclark`, `Citrix-OmniBox-01`)
- `key_hash` TEXT NOT NULL — Argon2id PHC-string, NEVER plaintext
- `key_prefix` TEXT NOT NULL — first 8 chars of plaintext (`omni_sk_`); fingerprinting only
- `label` TEXT — human label
- `created_at` / `created_by` — audit
- `last_used_at` — bumped on every successful `/exchange`
- `revoked_at` / `revoked_by` / `revoke_reason` — admin revocation trio
- Unique constraint `(org, agent_id, revoked_at)` with `NULLS NOT DISTINCT` so at most ONE active row per `(org, agent_id)` exists; revoked rows can co-exist.
- RLS: admins (`role IN ('admin','superadmin')`) read + write; everyone else denied.

### Plaintext key shape

```
omni_sk_<43 chars URL-safe base64 of 32 random bytes>
```

- 256 bits of entropy, 51 chars total. URL-safe so it survives JSON bodies + HTTP headers without quoting.
- Returned ONCE at registration. Admin saves it on the agent box at `~/.omniframe/agent_service_key.txt` (POSIX) / `%USERPROFILE%\.omniframe\agent_service_key.txt` (Windows).
- NO recovery path. Lost key = revoke + re-register. The plan called this out explicitly; the admin UI's reveal dialog includes a "Save → confirm → close" gate so the admin can't dismiss it accidentally.

### Argon2id parameters

- `memory_cost = 65 536 KiB` (64 MiB)
- `time_cost = 3` iterations
- `parallelism = 4` lanes
- Output length: 32 bytes (default)

Measured ~50 ms per verify on a modern Linux box. Cheap enough to be in the boot path (one verify per `/exchange` call, max 5/hour per agent_id thanks to the rate limiter); expensive enough to deter offline brute-force on the hash if `agent_service_keys` were ever leaked. Default `argon2::Params` would have used 19 MiB memory + 2 iterations — too low for a long-lived service credential. We took the [OWASP-baseline](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) tier in the plan's range without going to the Phase-11-stretch 256 MiB target (which would slow agent boot noticeably on a Citrix VDA).

### JWT format

Standard HS256 JWT signed by `WORK_SERVICE_AGENT_JWT_SECRET`:

```json
{
  "sub":     "<agent_id>",
  "org_id":  "<organization uuid>",
  "kind":    "agent",
  "key_id":  "<agent_service_keys.id>",
  "exp":     1700000900,
  "iat":     1700000000
}
```

- TTL: **900 s (15 min)**. Short enough that a leaked JWT is bounded, long enough that the agent's refresh thread (60s pre-expiry leeway) doesn't burn the work service. Plan default; not env-tunable to keep the runtime invariant simple.
- Verified locally in `crate::middleware::require_auth` — DOES NOT round-trip to `rust-core-service` (which only knows about Supabase user JWTs).
- Discriminated by `kind` claim: the middleware peeks at the unverified `kind` to decide between local verify (this module) and the legacy `rust-core-service` path. A Supabase user JWT has no `kind` claim → falls through to the legacy path unchanged.

### Middleware extension

New `AuthIdentity` enum exposed alongside the existing `AuthenticatedUser`:

```rust
pub enum AuthIdentity {
    User  { user_id, org_id, role },
    Agent { agent_id, org_id, key_id },
}
```

Both variants are inserted into request extensions on every authenticated request. Existing handlers (`Extension<AuthenticatedUser>`) keep working — for `AuthIdentity::Agent { .. }` we synthesise an `AuthenticatedUser { user_id: agent_id, role: "agent", organization_id: org_id, .. }` so legacy extractors don't break. New code prefers `Extension<AuthIdentity>` and gates on `is_agent()` / the `require_admin(&identity)` helper for admin-only paths. This is the minimal-touch pattern; Phase 11 owns the per-handler audit pass that decides which routes should reject agents (e.g. `/api/v1/agent-identity/register` already does via `require_admin`) vs which should accept either (`/api/v1/sap-agents/jobs/heartbeat`).

### Revocation effectiveness

The middleware checks `agent_service_keys.revoked_at IS NULL` for every `kind: "agent"` JWT, NOT just the JWT signature + `exp`. The DB hit is cached in Redis under `agent-identity:revoked:<key_id>` with a **60 s TTL**.

Tradeoff: a revoke fires within 60 s of admin click (the cache slot ages out, the next agent call hits the DB, sees `revoked_at NOT NULL`, returns 401). The plan identified this 60s window as acceptable security/perf — going lower (5s) would 10× the DB hit rate; going higher (5 min) would let a known-leaked key keep firing for too long. The `/revoke` route ALSO primes the cache with `"1"` immediately, so the next agent call is rejected on the very first round-trip in the happy path; the 60 s window is a worst case (Redis was unavailable when admin revoked, then came back online for the agent's next call).

### Rate limiting

`/exchange` is rate-limited at **5 failures per agent_id per hour** in Redis (`ratelimit:agent-identity-exchange:<agent_id>`). Successful exchanges clear the counter so a "4 wrong tries → 5th try is the right key" sequence doesn't leak the lock-out budget to the next attacker. Locks for one window (1 h) after the 5th failure. 429 with `Retry-After` header.

This only bounds the per-agent-id failure rate; an attacker with N candidate agent_ids gets N × 5 attempts/hour. The admin's audit-log volume is the human signal that catches that scenario.

### Backward compatibility

Phase 10 adds the new path. Phase 11 owns the cleanup. Until then:
- Agents WITHOUT a service key continue running on the user-JWT path. Boot banner discloses which path is active.
- Agents WITH a service key prefer the agent JWT for both WS subscribe-token mints and `/api/v1/sap-agents/jobs/*` calls; if no service key is configured, the legacy user JWT is used unchanged.
- The middleware accepts BOTH `kind: "agent"` JWTs and Supabase user JWTs forever (the `kind` claim is the only discriminator) — that's Phase 11's call.

## Consequences

### Positive

- **First-class agent revocation.** Admin → Setup tab → Revoke button → effective ≤60s. No user-account collateral damage.
- **Honest audit trail.** Audit-log entries (`agent_service_key.registered` / `.exchanged` / `.revoked`) name the responsible admin, the affected agent_id, and the key_id. Phase 11 will add a dedicated `agent_identity_audit_log` table; for now the structured-log stream catches it.
- **No user-lifecycle blast radius.** Rotating a user's password no longer takes their agents offline.
- **Identity-v2 capability surfaced** via `/api/v1/sap-testing/dashboard.service_capabilities = ["agent-identity-v2"]` so the FE can show admin-UI affordances (the new "Agent Setup" tab) and per-agent badges in future polish.

### Negative / risks

- **NEW env var: `WORK_SERVICE_AGENT_JWT_SECRET`.** Operators MUST set this in production to a 32+ byte random value. Dev fallback is a deterministic string (logged with a startup warning). Documented in `.env.example`.
- **Plaintext keys are NOT recoverable.** A lost key forces revoke + re-register. The reveal dialog has the "I have saved this key" confirmation gate to make this hard to do accidentally, but it's still a foot-gun. Phase 11 may add a "download as TXT" button that pre-formats the file at the canonical path.
- **60 s revocation latency.** Documented above; security-team-reviewed acceptable. A second-tier control (Redis pub/sub broadcast on revoke) would push this to ~1s but adds plumbing — deferred.
- **N+1 candidate-row scan on `/exchange`.** Today the route fetches every active row for `(org, agent_id)` and Argon2id-verifies each one. The unique-active constraint makes this 0 or 1 rows in the steady state, but a future migration that loosens the constraint must keep this in mind. Mitigated by the `key_prefix` narrow (only verify rows whose prefix matches the candidate).

## Quality gates (shipped)

- ✓ Migration 283 applied via Supabase MCP `apply_migration`; verified via `information_schema.columns` (12 columns) + `pg_policy` (2 admin policies).
- ✓ `cargo build` clean (no new warnings).
- ✓ `cargo test --lib`: **146 passed** (up from 121 in Phase 9 → +25 new tests covering Argon2id roundtrip, plaintext key shape, rate-limit key namespace, revocation-cache key shape, request shape parsing, admin-vs-agent gating, agent JWT issue/verify, signature tampering rejection, wrong-secret rejection, wrong-`kind`-claim rejection, end-to-end mint→hash→verify→issue→verify roundtrip).
- ✓ `cargo clippy --lib --all-targets`: zero new warnings on Phase 10 files (`agent_jwt.rs`, `api/routes/agent_identity.rs`, `middleware.rs`, `api/routes/sap_testing.rs` `service_capabilities` extension).
- ✓ `python3 -c "import ast; ast.parse(open('omni_agent/agent.py').read())"` clean.
- ✓ `pnpm tsc -b --noEmit` clean.
- ✓ `pnpm build` clean (9.5s, 182 PWA precache entries; no new bundle-budget violations — `feature-admin-sap` chunk grew negligibly).

## Files touched

### Created

- `supabase/migrations/283_agent_service_keys.sql`
- `rust-work-service/src/agent_jwt.rs`
- `rust-work-service/src/api/routes/agent_identity.rs`
- `src/lib/work-service/agent-identity-client.ts`
- `src/features/admin/sap-testing/components/agent-identity-tab.tsx`

### Modified

- `rust-work-service/Cargo.toml` — added `argon2`, `jsonwebtoken`, `rand`.
- `rust-work-service/src/lib.rs` — `pub mod agent_jwt;`
- `rust-work-service/src/main.rs` — `mod agent_jwt;`, public `/agent-identity` mount for `/exchange`, protected mount for `/register` + `/revoke` + `/list`.
- `rust-work-service/src/middleware.rs` — `AuthIdentity` enum, agent-JWT branch, revocation cache + DB fallback.
- `rust-work-service/src/api/routes/mod.rs` — `pub mod agent_identity;` + `pub use ...`.
- `rust-work-service/src/api/routes/sap_testing.rs` — `service_capabilities: Vec<String>` field on dashboard response (Phase 10.6 polish).
- `omni_agent/agent.py` — service-key load + JWT exchange + 60s refresh thread + boot-banner disclosure + capability advertisement (`agent-identity-v2`); `_work_service_request` now prefers agent JWT over user JWT; WS subscribe-token mint same.
- `src/lib/work-service/sap-testing-client.ts` — `service_capabilities?: string[]` on dashboard type.
- `src/features/admin/sap-testing/index.tsx` — "Agent Setup" tab wired in.
- `.env.example` — `OMNIFRAME_AGENT_SERVICE_KEY_PATH` + `WORK_SERVICE_AGENT_JWT_SECRET` documented.

## Related

- [[Implementations/Implement-Rust-Work-Service-Phase10]]
- [[Implementations/Implement-Rust-Work-Service-Phase7]] — claim-path centralisation that Phase 10 builds on.
- [[Implementations/Implement-Rust-Work-Service-Phase4]] — WS subscribe-token mint that Phase 10's agent JWT now flows through.
- [[Components/Omni-Agent - Headless SAP Agent]] — agent component (Recent additions section updated).
- [[Sessions/2026-05-07]] — session log this phase appends to.
