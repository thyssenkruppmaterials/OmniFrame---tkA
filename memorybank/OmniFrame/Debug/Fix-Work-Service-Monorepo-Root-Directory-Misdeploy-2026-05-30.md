---
tags: [type/debug, status/active, domain/infra, domain/backend]
created: 2026-05-30
---
# Fix — rust-work-service Monorepo Root-Directory Mis-deploy (88% errors)

## Purpose / Context
On 2026-05-30 the production `rust-work-service` on Railway was failing **~88% of requests** and rejecting every `/ws` connection — the realtime-migration target was effectively down. Root cause was a **Railway monorepo mis-configuration**, not a code bug. This note records the diagnosis + fix and two related prod cleanups done in the same pass.

## Symptoms
- `GET /api/v1/workers` → **404**, `POST /api/v1/presence/heartbeat` → **405**, `GET /ws` → **403**.
- Frontend polls `/api/v1/workers` every few seconds → continuous 404 storm.
- `rust-work-service` **deploy logs were Python/uvicorn** (`api.lib.cache.redis_service - Redis connected`), not the Rust binary.
- `rust-core` logged `API key validation failed key_prefix=onbx_wk_` on ~every call.

## Root Cause
The Railway service `rust-work-service` had **no Root Directory set**. In a monorepo, Railway then builds from the **repo root** — where `railway.toml` declares `startCommand = "python start.py"` (comment: *"CRITICAL: Force Python execution"*). So the service built and ran the **FastAPI/Python app**, not `rust-work-service/`.
- `rust-core-service` works because it has `RAILWAY_ROOT_DIRECTORY=rust-core-service` and its own `rust-core-service/railway.toml`.
- **Monorepo rule:** each service's **Root Directory** must point at its subdir. Railway docs: Root Directory is a **Settings-tab / API-only** setting — the `railway` CLI has **no command to set it** (confirmed on CLI 4.65). The config file does *not* follow Root Directory automatically, but a per-dir `railway.toml` inside the subdir is picked up once Root Directory is set.

## Fix
1. **Set Root Directory = `rust-work-service`** on the Railway service (Settings tab — mirrors rust-core's pattern), then redeploy. Railway then builds `rust-work-service/Dockerfile` and runs `./work-service`.
2. **Redeploy is required** — done by the user.

## Verification (live)
- `/health` → `{"version":"0.1.42","service":"rust-work-service"}` (the Rust binary; later 0.1.44 after the crate work).
- `/api/v1/workers` → **401** (route exists, auth required) instead of 404; `/ws` → **400** (WS handshake) instead of 403; `/metrics` → Rust `work_http_requests_total`.
- Boot logs clean: both Postgres pools probed OK, resilient PgListeners subscribed (`config`, `domain`), presence joins, and **org `c9d89a74` (the tenant wedged in the 2026-05-06 Realtime incident) connecting over the Rust `/ws`**.

## Related fix A — service-to-service API key (`onbx_wk_`)
`rust-work-service` sent `RUST_CORE_API_KEY=onbx_wk_service_key_2026`, a **placeholder that was never registered** in `service_api_keys` (only `rust-ai-service`/`onbx_ai_` and `rust-dashboard-service`/`onbx_da_` existed). Every work→core call failed key validation, then fell back to JWT (works, but a wasted DB lookup + log noise per request).

**Provisioning recipe (reusable):**
1. Mint `onbx_wk_<32-hex>` (prefix must be exactly 8 chars; `extract_key_parts` takes `key[..8]`). Hash = lowercase hex `SHA256(full_key)`.
2. Upsert into `service_api_keys` (`service_name='rust-work-service'`, `key_prefix='onbx_wk_'`, `key_hash=<sha256hex>`, `permissions='["auth:validate","auth:permissions"]'::jsonb`, `is_active=true`). `validate_service_api_key(prefix, hash)` (migration 150) is the lookup; `require_auth` calls `validate()` (no specific permission enforced — any active key passes).
3. Set the plaintext on the service var `RUST_CORE_API_KEY` (`--skip-deploys`), then redeploy.
- **Verified:** rust-core flipped from `API key validation failed` → `Authenticated via service API key service=rust-work-service`, and `service_api_keys.last_used_at` populated.

## Related fix B — rust-core log level
`rust-core` ran `RUST_LOG=info,rust_core_service=debug` → per-request DEBUG spam (and contributes to its anomalous flat 3.18 GB RSS). Set `RUST_LOG=info`; logs dropped to 0 DEBUG lines after redeploy.

## Lessons / Gotchas
- **Env-var changes need a redeploy** to take effect — containers read env at startup. "No code change" ≠ "no restart needed". (We initially saw the changes *staged* but not live until the user redeployed.)
- Railway **Root Directory is Settings/API-only** — not settable via the CLI. Use the dashboard or `update_service` (MCP).
- The Railway **MCP project ops returned `Unauthorized`** mid-session while the **CLI stayed authed** — they use separate credential stores; fall back to the `railway` CLI for project reads/writes.

## Related
- [[Rust-Work-Service]]
- [[ADR-Rust-Work-Service-Availability-SLO]]
- [[Implement-Mimalloc-And-Moka-Auth-Cache-Work-Service]]
- [[ADR-Rust-Dependency-Modernization-Roadmap]]
- [[Roadmap-Rust-WS-Unlocks]]
