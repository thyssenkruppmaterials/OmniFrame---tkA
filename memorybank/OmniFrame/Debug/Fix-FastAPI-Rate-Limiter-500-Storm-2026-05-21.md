---
tags: [type/debug, status/active, domain/backend, domain/infra, domain/api]
created: 2026-05-21
---
# Fix: FastAPI rate-limiter returns 500 instead of 429, plus 4 collateral fixes

## Purpose / Context

The morning after the 2026-05-20 push, the `onebox-ai-logistics` Railway
container logs showed a continuous storm of 5xx errors during regular
traffic and a 4-minute cold-start cycle. Five distinct issues were tangled
together in the same log stream. This note documents the root cause of
each and the fixes that landed in deploy `*-mpfpi53o` (2026-05-21 16:30 UTC).

## Root causes (per issue, ordered by severity)

### 1 — HIGH: rate limiter `raise HTTPException` from `BaseHTTPMiddleware.dispatch` returns HTTP 500, not HTTP 429

`api/middleware/rate_limiter.py:91` used:

```python
raise HTTPException(status_code=429, detail={...})
```

inside its `dispatch()` method. **This is a well-known Starlette footgun**:
`BaseHTTPMiddleware.call_next` wraps the inner call in
`anyio.create_task_group()`. Any `HTTPException` raised inside a
sub-task surfaces as `ExceptionGroup: unhandled errors in a TaskGroup`,
bypassing FastAPI's `exception_handler` chain. The user receives a
`500 Internal Server Error` (not `429 Too Many Requests`) along with a
≈60-line ASGI traceback in the server log per failed request.

Downstream effects:

- Frontend `version-checker.ts` polls `/build-info.json` every 60s per
  tab. With multiple tabs / NAT'd users, the default `100 req/min/IP`
  cap trips constantly. On a 500 (vs 429), the client retries immediately
  instead of backing off — amplifying the problem.
- Every failed request burned CPU on a ~60-line traceback.
- Log noise made real errors hard to spot.

**Fix:** `return JSONResponse(status_code=429, ..., headers={"Retry-After": str(window)})`
instead of raising. The 503 paths in the same file were already doing
this correctly — only the 429 path got it wrong.

### 2 — MEDIUM: `/build-info.json` shouldn't be rate-limited at all

A ≈150-byte static JSON polled by every browser tab for cache-busting.
Rate-limiting it accomplishes nothing security-wise and breaks the
auto-update mechanism.

**Fix:** Extended the existing health-check exempt-path mechanism to
also cover static SPA / PWA assets:

```python
_HEALTH_EXEMPT_PREFIXES = ('/health',)
_STATIC_EXEMPT_EXACT = frozenset({
    '/build-info.json',
    '/manifest.webmanifest',
    '/sw.js',
    '/favicon.ico',
    '/robots.txt',
})
_STATIC_EXEMPT_PREFIXES = ('/assets/', '/avatars/', '/workbox-')
```

Exempt paths bail BEFORE touching Redis, so a Redis outage no longer
blocks PWA scaffolding fetches either.

### 3 — MEDIUM: 4-minute cold-start because boot health-checks block port bind

The FastAPI `lifespan()` made unbounded calls to:

- `rust_client.health_check()` against the **public** Railway URL (TLS
  handshake + edge proxy hop), and
- `test_connection()` against the Supabase REST endpoint.

With 4 uvicorn workers cold-booting in parallel, 3 of 4 workers timed
out their rust-core probe simultaneously (public-URL connection pool
saturation). Each worker then blocked in `await test_connection()` for
~4 minutes before timing out. Uvicorn doesn't bind port 8080 until
lifespan completes — so Railway's healthcheck saw nothing and
retried every ≈10s for the full 5-minute window. The 2026-05-21
15:46Z deploy used 4:49 of the 5:00 envelope. **A slightly slower
upstream would have failed the deploy entirely.**

**Fix:** Wrapped both probes in `asyncio.wait_for(...)`:

```python
_BOOT_HEALTH_TIMEOUT_S = 5.0  # rust-core
_BOOT_DB_TIMEOUT_S = 10.0     # supabase

health = await asyncio.wait_for(
    rust_client.health_check(), timeout=_BOOT_HEALTH_TIMEOUT_S
)
```

On timeout we log a WARN and proceed. The app starts in a degraded
mode; `/health/rust-core` and `/health/database` surface the live
status to the operator.

**Also:** Added `RUST_CORE_PRIVATE_URL` settings field that takes
precedence over the public `RUST_CORE_URL`. Set on Railway to
`http://rust-core-service.railway.internal:8010` so cold-start probes
flow over the IPv6 private network instead of the public TLS hop.
Resolution order in both `RustCoreClient.__init__` and
`get_rust_core_url()`:

1. Explicit `base_url` parameter
2. `RUST_CORE_PRIVATE_URL` env var (Railway internal DNS — preferred)
3. `RUST_CORE_URL` env var (public, fallback)

Result: cold start dropped from ~4:49 to **≈2:30**.

### 4 — LOW: `SESSION_SECRET_KEY not set`, every worker logged a WARN

`api/main.py:172` was generating a random key per worker per restart:

```python
_session_key = settings.session_secret_key or secrets.token_urlsafe(32)
```

This is not just a warning — **it's a real bug**. Each of the 4 uvicorn
workers gets a DIFFERENT random key. A session cookie issued by worker
#1 is rejected by workers #2-4 when load-balanced internally. Container
restart invalidates all sessions.

**Fix:** Generated a 64-byte URL-safe token via
`python3 -c "import secrets; print(secrets.token_urlsafe(64))"` and
set as `SESSION_SECRET_KEY` env var on the `onebox-ai-logistics`
Railway service. No code change required.

### 5 — LOW: `security_monitoring_middleware` false-positive on every `/admin/*` SPA navigation

`api/main.py:309` used substring matching across a list of suspicious
patterns including `/admin` and `/config`. Both are legitimate
TanStack-router SPA paths that the frontend serves via
`frontend_static.py`'s catch-all (returning `index.html`). Every page
load of an admin tab generated a WARN line, drowning real signal.

**Fix:**

1. Removed `/admin` and `/config` from the scanner-pattern list.
   Kept real scanner fingerprints: `/.env`, `/.git`, `/.aws`, `/.ssh`,
   `/wp-admin`, `/wp-login`, `/phpmyadmin`, `/mysql`, `/backup`,
   `/../`, `/..`.
2. Switched matching from `pattern in path` (substring) to
   `path.startswith(pattern)` so legitimate `/api/admin/users` no
   longer trips the `/admin` rule.
3. Only log the warning when the response is `4xx` — a 200 means the
   path resolved to a legitimate handler and isn't a probe.

## Files changed

- `api/middleware/rate_limiter.py` — fixes 1 and 2.
- `api/main.py` — fixes 3a and 5; added `asyncio` import and
  `_BOOT_HEALTH_TIMEOUT_S` / `_BOOT_DB_TIMEOUT_S` constants.
- `api/config/settings.py` — added `rust_core_private_url` field.
- `api/lib/rust_core/__init__.py` — updated `RustCoreClient.__init__`
  and `get_rust_core_url()` to prefer `RUST_CORE_PRIVATE_URL`.
- **Railway env vars** (`onebox-ai-logistics` service):
  - `SESSION_SECRET_KEY` (64-byte URL-safe, 86 chars) — NEW
  - `RUST_CORE_PRIVATE_URL=http://rust-core-service.railway.internal:8010` — NEW

## Verification (post-deploy `*-mpfpi53o`, 2026-05-21 16:30Z)

| Check | Pre-fix | Post-fix |
|---|---|---|
| `/health` probe success | 10/10 | **10/10** |
| `/build-info.json` hammered 150× from a single IP | 500s start around request ~100 | **150 × 200 OK, 0 × 429, 0 × 500** |
| Deploy log scan for `500 Internal` | dozens per minute | **0 matches** |
| Deploy log scan for `Suspicious request` | continuous false positives | **0 matches** |
| Deploy log scan for `SESSION_SECRET not set` | 4 WARNs per worker boot | **0 matches** |
| Deploy log scan for `TaskGroup` / `ExceptionGroup` | every rate-limit hit | **0 matches** |
| Cold-start duration (Indexing → Healthcheck succeeded) | 4:49 | **2:30** |

## Why `BaseHTTPMiddleware` + `raise HTTPException` is a footgun

Starlette's `BaseHTTPMiddleware.call_next` is implemented as:

```python
async def call_next(request):
    async with anyio.create_task_group() as task_group:
        # ... run the inner app in a sub-task ...
```

When the sub-task raises `HTTPException`, the task group collects it
into an `ExceptionGroup` and re-raises it from the `__aexit__`. FastAPI
registers `HTTPException` handlers on the FastAPI `app`, NOT on
intermediate `BaseHTTPMiddleware` layers — so the `ExceptionGroup` (or
its unwrapped `HTTPException`, depending on Starlette version) propagates
all the way up to `ServerErrorMiddleware` which returns a generic 500.

The Starlette docs explicitly recommend **returning a `Response`** from
middleware `dispatch()` instead of raising. The 503 paths in this same
file already did so; the 429 path was the outlier.

## Related

- [[Apply-Performance-Review-Fixes-2026-05-19]]
- [[Fix-Sqlx07-Supavisor-Transaction-Mode-Incompatibility]]
- [[Components/Rust-Work-Service]]
- Starlette issue tracker on this exact pattern: search for
  `BaseHTTPMiddleware HTTPException ExceptionGroup`.
