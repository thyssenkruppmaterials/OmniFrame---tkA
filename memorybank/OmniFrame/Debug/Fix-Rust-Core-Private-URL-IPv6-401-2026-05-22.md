---
tags: [type/debug, status/active, domain/backend, domain/infra, domain/api, domain/auth]
created: 2026-05-22
---
# Fix: Admin password reset returns 401 "Authentication failed" — `RUST_CORE_PRIVATE_URL` unreachable over IPv6

## Purpose / Context

On 2026-05-22 at 13:52 UTC, the user-management UI started returning
`401 Unauthorized` for every `POST /api/admin/users/{user_id}/reset-password`
request. The error surfaced in the SPA as `Failed to reset password:
Authentication failed` and every other admin endpoint guarded by `RequireAdmin`
was affected the same way (`/api/smartsheet/...` also 401'd within the same
three-minute window). The user's Supabase session was valid the whole time —
proxied Supabase REST calls returned 200/403 normally, only the FastAPI admin
endpoints failed.

This was a regression introduced by the 2026-05-21 rate-limiter-storm fix
([[Fix-FastAPI-Rate-Limiter-500-Storm-2026-05-21]]) which added a new
`RUST_CORE_PRIVATE_URL` env var on the `onebox-ai-logistics` Railway service
pointing at `http://rust-core-service.railway.internal:8010`. The intent was
to move cold-start probes off the public TLS hop, but the Rust Core service
was binding to `0.0.0.0:8010` (IPv4 only) — Railway's `*.railway.internal`
DNS resolves to AAAA records (IPv6) on legacy environments, so the private
DNS connection silently failed with `httpcore.ConnectError: All connection
attempts failed` on every request.

The authentication code then mistranslated that connection failure into a
401 instead of a 503, hiding the real cause.

## Root causes

### 1 — HIGH: `rust-core-service` binds IPv4-only, can't be reached over Railway private DNS

`rust-core-service/src/main.rs:261` used:

```rust
let http_addr = format!("0.0.0.0:{}", http_port);
let listener = tokio::net::TcpListener::bind(&http_addr).await?;
```

Railway's private networking is **IPv6-first**
([docs](https://docs.railway.com/networking/private-networking/how-it-works)):

> New environments (created after October 16, 2025): DNS names resolve to
> both internal IPv4 and IPv6 addresses. Legacy environments: DNS names
> resolve to IPv6 addresses only.

The `onebox-ai-logistics` project (env id `18f36d45-26ae-4b87-ac5c-70673aa9a3dd`)
is a legacy environment, so `rust-core-service.railway.internal` only resolves
to an AAAA record. A service bound to `0.0.0.0` is not listening on the IPv6
stack and is unreachable via private DNS. Calls to it succeed only via the
public URL (`https://rust-core-service-production.up.railway.app`) because
Railway's edge proxy bridges IPv4↔IPv6 on the public hop.

**Fix:** Bind to `[::]:PORT` (IPv6 wildcard). On Linux, the kernel default
`net.ipv6.bindv6only=0` means `[::]` also accepts IPv4 traffic via
IPv4-mapped IPv6 addresses, so this is a strict superset of the previous
binding — the public Railway edge proxy keeps working unchanged.

All other Rust services in the repo (`rust-work-service`,
`rust-streaming-service`, `rust-mdm-service`, `rust-dashboard-service`,
`rust-ai-service`) have the same IPv4-only bind. They are currently only
reachable via public URLs (no `*_PRIVATE_URL` env vars set on the FastAPI
side), so they're not actively broken — but the same fix should be applied
before introducing any private-network DNS for them. See "Follow-up" below.

### 2 — HIGH: `validate_token_with_profile` lets raw httpx exceptions escape

`api/lib/rust_core/__init__.py` was creating a fresh `httpx.AsyncClient` for
the auth path and only catching `httpx.HTTPStatusError`:

```python
async with httpx.AsyncClient(timeout=self.timeout) as auth_client:
    response = await auth_client.post(...)
    response.raise_for_status()
# only httpx.HTTPStatusError caught below
```

When the upstream connection failed (`httpx.ConnectError`,
`httpx.TimeoutException`, or any other `httpx.TransportError`), the raw
exception escaped this method.

The caller in `api/auth/supabase_auth.py::get_current_user` only has
special handling for `RustCoreConnectionError`, `RustCoreError`, and
`HTTPException`. So the raw httpx exception fell through to the generic
`except Exception` arm, which returns the very misleading:

```python
raise HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Authentication failed"
)
```

This is wrong for two reasons:

1. The user IS authenticated — their JWT is valid and unexpired. The
   *infrastructure* is broken, not the token.
2. 401 tells the client "your credentials are wrong". Frontend SPAs
   (correctly) react to 401 by attempting a session refresh and signing the
   user out. So a transient infra outage masquerades as a credential
   problem and kicks users out of the app.

**Fix:** Wrap `httpx.ConnectError`, `httpx.TimeoutException`, and
`httpx.TransportError` in `RustCoreConnectionError` inside both
`validate_token_with_profile` and `validate_token`. The existing
`get_current_user` handler then turns those into a clean
`503 Service Unavailable` with detail
`"Authentication service temporarily unavailable"`, which matches reality.

## Files changed

- `rust-core-service/src/main.rs` — `0.0.0.0` → `[::]` for HTTP listener.
  Added a long comment explaining Railway IPv6 private DNS and the
  history of why we changed it.
- `api/lib/rust_core/__init__.py` — added `httpx.ConnectError`,
  `httpx.TimeoutException`, `httpx.TransportError` handlers to both
  `validate_token` and `validate_token_with_profile` that wrap into
  `RustCoreConnectionError`. Updated docstrings to point at this note.
- **Railway env vars** (`onebox-ai-logistics` service):
  - `RUST_CORE_PRIVATE_URL` changed from
    `http://rust-core-service.railway.internal:8010` →
    `https://rust-core-service-production.up.railway.app` as an immediate
    unblock (forces public URL until the rust-core IPv6 fix deploys). Once
    the rust-core deploy lands, this can be reverted to the IPv6 private
    URL for the latency/egress benefits.

## Verification

Post-env-change (deploy `0b5df4c3-d310-4df3-b3d7-abc09063f027`, 2026-05-22
14:03:51 UTC):

| Check | Pre-fix | Post-fix |
|---|---|---|
| Boot log `Rust Core Service unhealthy at boot` | every worker (4×) | **0 matches** |
| Boot log `Rust core connection failed` | every worker | **0 matches** |
| Boot log `✅ Rust Core Service connected` | not present | **all 7 workers** |
| `POST /api/admin/users/.../reset-password` from user IP | 401 ×4 | **(user has not retried yet)** |
| `/api/smartsheet/.../attachments/file` from user IP | 401 ×2 | **(no further 401s after deploy)** |

User browsing continues normally on the new deploy with zero auth failures.

## Why this was hard to spot

The symptom (`401 Unauthorized`, `"Authentication failed"`) sent everyone
looking at JWT secrets, Supabase token state, and admin role assignments
first — none of which were broken. The actual error
(`httpx.ConnectError: All connection attempts failed`) only appeared in the
backend logs as `ERROR - Unexpected error in authentication: All connection
attempts failed`, with no mention of "Rust" or "connection" in the
frontend-visible payload.

The Python error-wrapping fix above ensures the next time this class of
failure happens, the user sees `503 Service Unavailable` and the log line
is the cleaner `Rust core service unavailable: ...`.

## Follow-up

- [ ] Apply the same `[::]` bind fix to the other five Rust services so
  they remain ready for private-DNS adoption in the future:
  - `rust-work-service/src/main.rs:995`
  - `rust-streaming-service/src/main.rs:137`
  - `rust-mdm-service/src/main.rs:152`
  - `rust-dashboard-service/src/main.rs:157`
  - `rust-ai-service/src/main.rs:159`
  - (`rust-core-service/src/grpc/service.rs:12` — the gRPC server is a
    placeholder today, no actual `bind` happens; can be updated when the
    real impl lands.)
- [ ] After `rust-core-service` redeploys with `[::]`, revert
  `RUST_CORE_PRIVATE_URL` on `onebox-ai-logistics` back to
  `http://rust-core-service.railway.internal:8010` to reclaim the
  cold-start / latency win from
  [[Fix-FastAPI-Rate-Limiter-500-Storm-2026-05-21]].
- [ ] Consider adding a doc/lint check that flags any new
  `*.railway.internal` env var without a corresponding `[::]` bind in the
  target service.

## Related

- [[Fix-FastAPI-Rate-Limiter-500-Storm-2026-05-21]] — the change that
  introduced `RUST_CORE_PRIVATE_URL` and surfaced this latent bug.
- [[Components/Rust-Core-Service]] (if present) — the service being bound.
- Railway private networking docs:
  [`How It Works`](https://docs.railway.com/networking/private-networking/how-it-works)
  and [`Library Configuration`](https://docs.railway.com/networking/private-networking/library-configuration).
