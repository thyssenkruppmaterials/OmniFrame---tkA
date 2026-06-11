---
tags: [type/debug, status/active, domain/infra, domain/backend, domain/api]
created: 2026-06-08
---
# Fix: `onebox-ai-logistics` deploy fails healthcheck — smartsheet-python-sdk 4.0.0 breaks `from smartsheet import Smartsheet`

## Purpose / Context

On 2026-06-08 (~10:15 UTC) the `onebox-ai-logistics` Railway service began
failing deploys. The symptom looked like a build problem ("deployment is
failing"), but `pnpm build` was green locally and the **image built and pushed
successfully** on Railway. The failure was at the **healthcheck** stage:

```
Starting Healthcheck — Path: /health — Retry window: 5m0s
Attempt #1..#11 failed with service unavailable
2/2 replicas never became healthy!
Healthcheck failed!
```

Production stayed up the whole time — the previous (2026-06-07) deployment kept
serving (`2/2 running`); only the new deploy failed to go live.

## Root cause

### TRUE root cause — HIGH: `smartsheet-python-sdk` 4.0.0 removed the top-level `Smartsheet` export

The deploy (runtime) logs showed the API aborting startup:

```
File "/app/api/services/smartsheet/client.py", line 12, in <module>
    from smartsheet import Smartsheet
ImportError: cannot import name 'Smartsheet' from 'smartsheet' (unknown location)
...
RuntimeError: Critical router import failure: cannot import name 'Smartsheet' from 'smartsheet' (unknown location)
❌ CRITICAL: Router import failed — aborting startup
Stopping Container
```

`api/main.py` treats router import failure as **fatal** (`raise RuntimeError`),
so the whole app refuses to boot → `/health` never responds → healthcheck fails
→ deploy fails.

`api/requirements.txt` pinned `smartsheet-python-sdk>=3.0.0`. A clean install
(no Docker layer cache) resolves that to **4.0.0**, which restructured the
package so `from smartsheet import Smartsheet` no longer resolves — the import
yields a **namespace package with no `__file__`**, which is exactly what the
`(unknown location)` suffix in the error means. The known-good line is **3.7.2**
(what the local dev env has; `has Smartsheet: True`).

Why it worked before and broke now: prior deploys reused a **cached pip layer**
that had an older 3.x install. When Railway's build cache rotated/evicted, the
fresh `pip install` pulled 4.0.0 and the latent version-cap gap became a hard
startup crash.

### Misleading signal that was NOT the cause

There is a **local package also named `smartsheet`** at
`api/services/smartsheet/` (`start.py` inserts `/app/api` onto `sys.path`, and
the code uses top-level absolute imports like `from services...`). This *looked*
like a classic name-shadowing collision. It was ruled out: reproducing the exact
prod import context locally (`sys.path.insert(0, "api")` +
`from services.smartsheet_service import SmartsheetService`) returns `IMPORT OK`
when a 3.x SDK is installed, and the Dockerfile verification step (below) fails
**before `api/` is copied into the image** — i.e. with no local package present
at all. The collision is a latent footgun, not this bug's cause.

## How the fix was found

Hardening the Dockerfile to **fail loudly** is what surfaced the real cause. The
first hardened build printed:

```
Successfully installed ... smartsheet-python-sdk-4.0.0 ...
RUN python -c "from smartsheet import Smartsheet; ..."
ImportError: cannot import name 'Smartsheet' from 'smartsheet' (unknown location)
Build Failed
```

This proved the SDK *installs* but its *import* is broken in 4.0.0, independent
of any local code.

## Files changed

- `api/requirements.txt` — `smartsheet-python-sdk>=3.0.0` → `>=3.0.0,<4.0.0`
  (caps below the breaking 4.x major; resolves to 3.7.2). Added a comment
  explaining the 4.0.0 import breakage.
- `Dockerfile` — runtime stage:
  - Removed the silent `pip install ... || (grep -v pyrfc ... && pip install ...)`
    fallback. `pyrfc` is **not** in `requirements.txt` (it's installed separately
    from GitHub later), so that fallback reinstalled the identical set while
    swallowing real failures and shipping broken images.
  - Added a post-install verification step:
    `RUN python -c "from smartsheet import Smartsheet; import smartsheet; print(...)"`
    so a missing/broken critical SDK becomes a **hard build failure** instead of a
    runtime healthcheck failure discovered only after deploy.

## Verification

- Hardened build #1 (before the pin): **build failed** at the verification step
  with the smartsheet ImportError — confirming the root cause and proving the
  guard works.
- Build #2 (with `<4.0.0` pin, id `439aa2db-...`): installed a 3.x SDK, passed
  the verification step, built + pushed the image, and:
  - Railway build log: `[2/2] Healthcheck succeeded!`
  - `railway status`: `onebox-ai-logistics: ● Online · ... · 2/2 running`
    (the "Deploy failed" badge is gone).
  - `GET https://onebox-ai-logistics-production.up.railway.app/health` →
    `HTTP 200` `{"status":"healthy", ...}`.

Deploys for this service are done via `railway up` (CLI upload of the working
tree); `source.repo` is null (not GitHub-auto-deployed). The failed 2026-06-08
deploy was also a `railway up` from a Cursor session (`cliCaller: cursor`).

## Why this was hard to spot

- "Deployment is failing" sounds like a build error, but the build was green —
  the failure was a **runtime startup crash** caught only by the healthcheck.
- The error pointed at `client.py:12` and there's a same-named local package,
  which strongly suggested an import-shadowing collision rather than a dependency
  version problem.
- `>=3.0.0` had been "working" for a long time purely because the pip layer was
  cached; the breakage was dormant until a cache miss pulled 4.0.0.

## Follow-up

- [ ] Consider renaming the local `api/services/smartsheet/` package (e.g.
  `smartsheet_integration/`) to permanently remove the shadowing footgun.
- [ ] Consider making the smartsheet router import **non-fatal** in
  `api/main.py` so an optional integration can't take down the entire app
  (today it `raise`s and aborts startup).
- [ ] Audit other unbounded `>=` pins in `api/requirements.txt` that could
  jump a major version on a cache miss.
- [ ] When 4.x is needed, update the smartsheet import sites
  (`client.py`, `attachments.py`, `discussions.py`) to the 4.x API and lift the
  cap.

## Related

- [[Deployment-Railway]] — Docker multi-stage build + Railway config.
- [[Fix-Rust-Core-Private-URL-IPv6-401-2026-05-22]] — another
  `onebox-ai-logistics` infra deploy issue with a misleading surface symptom.
