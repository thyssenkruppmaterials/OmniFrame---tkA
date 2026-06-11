---
tags: [type/debug, status/active, domain/frontend, domain/infra]
created: 2026-05-07
---

# Fix: Version Checker Corporate-Proxy Console Noise

## Symptom

Warehouse RF terminals (devices on `/rf-interface`, `/rf-signin`, `/rf-*` routes) flood the browser console every ~5 minutes with repeating blocks like:

```
Access to fetch at 'https://…/build-info.json?_cb=…&_sm_byp=iVVMwfVqJZ77jVQ6'
  (redirected from 'https://…/build-info.json?_cb=…')
  from origin 'https://…' has been blocked by CORS policy

[VersionChecker] Fetch error (attempt 1), backing off 5000ms: TypeError: Failed to fetch
[VersionChecker] Fetch error (attempt 2), backing off 10000ms: TypeError: Failed to fetch
[VersionChecker] Fetch error (attempt 3), backing off 20000ms: TypeError: Failed to fetch
…
Loading the stylesheet 'https://gateway.zscalertwo.net/auD?origurl=…' violates …
Access to internal resource at '…/manifest.webmanifest?_sm_byp=…' has been blocked
```

**Affected user population:** RF operators on the warehouse Zscaler-protected corporate network. Office workstations and the public-internet customer portal are NOT affected (different egress paths, no SWG interception).

## Root cause — corporate Secure Web Gateway (Zscaler / Symantec WSS)

The RF terminals' egress is intercepted by the corporate Secure Web Gateway. Two indicators in the same console session confirm the SWG is the culprit:

1. **`_sm_byp=…` query param** appended to the redirected URL — that's a Symantec-WSS / Bluecoat fingerprint, added when the gateway re-issues the request through its own proxy after SSL inspection.
2. **Explicit `gateway.zscalertwo.net`** hostname referenced in a CSP-blocked stylesheet load — that's Zscaler's CDN inserting a friendly-error stylesheet into responses it intercepts.

The failure shape on the wire:

- The browser fetches `/build-info.json?_cb=…`.
- The SWG intercepts, responds with a redirect to a re-signed URL (`?_sm_byp=…` appended).
- The browser follows the redirect, but the redirected response no longer has `Access-Control-Allow-Origin` matching the original origin — the SWG strips/rewrites it.
- Browser correctly blocks the cross-origin response. `fetch()` rejects with `TypeError: Failed to fetch`.
- `VersionChecker.handleFetchError()` logs, backs off, and retries — **forever**, because the network condition is structural, not transient.

Same failure shape applies to the PWA `manifest.webmanifest` request (also visible in the same logs).

## Why this isn't our code bug

The browser is behaving correctly: the SWG-rewritten redirect is, by definition, a same-origin policy violation. CSP correctly refuses to load `gateway.zscalertwo.net` stylesheets that the SWG is injecting into intercepted responses. Our app correctly throws `TypeError: Failed to fetch`.

The right place to fix this is at the **IT / SWG configuration layer** — by allow-listing the OneBox / OmniFrame origin in the warehouse Zscaler policy so SSL inspection skips it. We can't (and shouldn't) work around the SWG client-side because:

- Widening CORS server-side to accept a SWG-rewritten origin would defeat the SWG's protection on EVERY other site in the same warehouse network.
- Widening CSP to allow `gateway.zscalertwo.net` stylesheets would let any SWG-injected CSS run in our origin context.
- The fundamental contract of a corporate SWG is that it's a man-in-the-middle for inspection; allow-listing it from the application defeats the purpose.

So this fix is **two narrow client-side mitigations** to silence the symptoms — the noise — without shipping a workaround that compromises security.

## Fix 1 — Kiosk-route opt-out for the version checker

Warehouse RF terminals at `/rf-*` and timeclock kiosks at `/timeclock*` are dedicated devices on which IT controls the refresh cadence (manual reboot / fleet-pushed reload). Per-device polling adds no benefit, and it's exactly these devices that sit on the SWG-protected network.

- **New constant** `VERSION_CHECK_KIOSK_ROUTE_PATTERNS` exported from `src/lib/version/version-checker.ts`. Co-located with the version checker (NOT in `src/lib/presence/constants.ts`) because the patterns differ from `PRESENCE_KIOSK_ROUTE_PATTERNS`:
  - Includes `/^\/rf-/` and `/^\/timeclock(app)?(\/|$)/`.
  - **Deliberately EXCLUDES** `/^\/customer-portal(\/|$)/`. The customer portal is public-internet, customer-facing, and DOES benefit from auto-version pickup. Presence opts customer-portal out for a different reason (1:N "who's online" channel adds load with no UX benefit on public pages); version pickup is the opposite calculus.
- **New helper** `isVersionCheckKioskRoute(pathname)` mirrors `isPresenceKioskRoute()` for ergonomic parity.
- **`VersionChecker.start()`** now checks `isVersionCheckKioskRoute(window.location.pathname)` after the dev/native gate. On match, logs ONCE at `info` level (`[VersionChecker] Skipped on kiosk/RF route — manual refresh controls cadence`) and returns. No polling timer is scheduled, no listeners attached.

Why co-locate the constant with `version-checker.ts` and not with the presence constants:

1. The patterns are not the same set (customer-portal divergence).
2. Pulling a presence import into the version subsystem creates cross-domain coupling for what is, fundamentally, a 3-line constant.
3. If a third subsystem ever needs a similar opt-out with yet another pattern set (e.g. "audio assistant kiosks" excluding both presence AND version), the right move is to keep each subsystem's constant local and let the patterns diverge cleanly.

The alternative considered — a shared `kiosk-route-patterns.ts` file with multiple exports — was rejected as over-architecture for two callsites.

## Fix 2 — Self-disabling poll after consecutive failures

Even on non-kiosk routes (office users, customer portal users) the polling loop should not flood the console when the network is structurally broken. Generalises the kiosk-specific fix to ANY route on a SWG-protected (or just plain-offline) network.

New session-level state in `VersionChecker`:

- `private _consecutiveFailures = 0` — incremented in `handleFetchError()`, reset to 0 in `checkNow()` after a successful 200 OK with a valid payload.
- `private _suppressedAfterFailures = false` — one-shot latch.
- `const FAILURE_SUPPRESSION_THRESHOLD = 3` — the trip count.

New log-level ladder in `handleFetchError()`:

| Failure # | Log level | Visible in prod? | Notes |
|-----------|-----------|------------------|-------|
| 1 | `warn` | Yes | One signal that the version check is degraded — preserves the existing behavior so operators see SOMETHING when the network goes bad. |
| 2, 3 | `debug` | No (logger `minLevel='warn'` in prod) | Suppressed in prod. Visible in dev for diagnosis. |
| ≥ threshold (3) | `info` ONCE | Yes | Trip the latch, log the disable message, tear down listeners + cancel the poll timer. |

The `info`-level disable message is `[VersionChecker] Disabling auto-poll — repeated fetch failures (likely corporate proxy or offline). Manual refresh will pick up new builds.`

After the trip, `isPollingActive` flips to `false`, the next-scheduled `setTimeout` is cancelled, and the `visibilitychange` + `online` listeners are removed. The auto-updater simply stops receiving `VERSION_UPDATE_EVENT`s; users get the new build on their next manual refresh.

**Self-healing on the success path:** on a successful fetch, both `consecutiveErrors` (controls backoff) and `_consecutiveFailures` (controls the latch) reset to 0. So a single transient blip on a flaky LTE link does NOT permanently kill the poller — it has to fail 3 times in a row, and one good fetch in between resets the counter.

**Auto-updater compatibility:** `auto-updater.ts` doesn't care whether VersionChecker is polling or not — it just listens for `VERSION_UPDATE_EVENT`s on `window`. When VersionChecker self-disables, no events fire, the banner doesn't show, the navigation-detection nav-poll never starts (it's gated on `_pendingUpdate`), and nothing throws. Verified end-to-end by reading `auto-updater.ts:start()` + `handleUpdateAvailable()` + `startNavPolling()` — all of which are no-ops in the absence of a `VERSION_UPDATE_EVENT`.

## Fix 3 — Service-worker `NetworkFirst` fallback

The Workbox runtime cache for `/build-info.json` was previously `NetworkOnly`. When the SWG intercepts the request, the SW returns nothing (the network failure surfaces directly to the version checker).

Changed to `NetworkFirst` with a 1-entry, 5-min cache:

```ts
{
  urlPattern: /\/build-info\.json(\?.*)?$/,
  handler: 'NetworkFirst',
  options: {
    cacheName: 'build-info-cache',
    networkTimeoutSeconds: 5,
    expiration: {
      maxEntries: 1,
      maxAgeSeconds: 5 * 60,
    },
  },
},
```

Safety analysis (why this can't trigger spurious updates):

- The cached value is whatever the network most-recently returned, so it can NEVER be older than the running build's `__BUILD_HASH__`. Worst case it equals (no false trigger) or is newer (correct trigger).
- `NetworkFirst` still tries the network FIRST every poll. Cache only kicks in on network failure or > 5s timeout. The original "always go to the network" intent is preserved when the network works.
- 5-min TTL keeps stale values from lingering across deploys.
- `cleanupOutdatedCaches: true` already in the workbox config ensures old `build-info-cache` entries from previous deploys (different `cacheId`) are evicted on SW activation.

The one edge case — server rolls back to an OLDER hash while the cache holds the newer post-deploy value — would cause a one-time spurious reload that self-recovers on the next poll (network returns the rolled-back hash, cache resets). Acceptable trade-off for silencing the much more common SWG-block scenario.

## Recommended IT action

**Forward this to warehouse IT (Zscaler / Symantec WSS administrator):**

Please add the OneBox / OmniFrame production origin to the SWG bypass / SSL-inspection-exclusion list for warehouse devices. Specifically:

- **Domain:** `*.up.railway.app` (Railway-hosted prod) — or, more narrowly, the actual production hostname (TBD: confirm with deployment).
- **Symptom that confirms the fix is needed:** Browser console on RF handhelds shows `Access to fetch at 'https://….up.railway.app/build-info.json?_cb=…&_sm_byp=…' (redirected from 'https://….up.railway.app/build-info.json?_cb=…') has been blocked by CORS policy`. The `_sm_byp=…` query parameter on the redirected URL is the Symantec-WSS injection signature; the `gateway.zscalertwo.net` hostname (also visible in the same console) is the Zscaler injection signature.
- **Why the bypass is appropriate:** The OneBox app is a first-party internal logistics application. SSL-inspection of its traffic is rewriting redirect responses in a way that strips `Access-Control-Allow-Origin`, breaking the browser's same-origin policy on legitimate requests. The traffic does not leave corporate-owned infrastructure (Railway is the application host; the warehouse → Railway connection is the only segment that benefits from inspection, and the application's TLS terminates at Railway anyway).
- **Affected endpoints (for the IT ticket):**
  - `*.up.railway.app/build-info.json` (version-deploy detection)
  - `*.up.railway.app/manifest.webmanifest` (PWA manifest — same noise pattern in the logs)
  - **Likely candidates** that may surface the same issue once RF traffic ramps up:
    - `*.up.railway.app/api/v1/*` (Rust services REST + WS — `rust-work-service`, `rust-core-service`, `rust-streaming-service`, etc.)
    - WebSocket upgrades on `wss://*.up.railway.app/ws`
  - It's much simpler to bypass the entire origin than to enumerate paths.

The two FE mitigations (kiosk-route opt-out + self-disabling poll) silence the SYMPTOM on the device side, but the proper long-term fix is the SWG bypass — without it, every future feature that polls or WS-subscribes from RF terminals will hit the same wall.

## Verification procedure

After the FE deploy lands, on a warehouse RF terminal:

1. Open the device's chromium console (or remote-debug from a desktop).
2. Navigate to `/rf-signin`. Confirm a single line appears: `[VersionChecker] Skipped on kiosk/RF route — manual refresh controls cadence`. **No** subsequent `Fetch error (attempt N)` lines.
3. Sign in and navigate to `/rf-interface`. Same expected behavior — no version-check polling, no CORS errors from `/build-info.json`.
4. (Office user verification) Open `/admin/work-queue` on a workstation NOT behind the warehouse SWG. Confirm the version checker continues polling at 60s cadence. Confirm a deploy still triggers the in-app update banner.
5. (Customer portal verification) Open `/customer-portal/tickets/<id>` on a public-internet device. Confirm version polling still happens. Confirm a deploy triggers the banner.
6. (Repeated-failure verification — synthetic) On any non-kiosk route, in DevTools Network tab, set the `/build-info.json` URL pattern to "Block request URL". Wait ~3 minutes. Confirm the console shows ONE `warn`-level fetch-error line, then ONE `info`-level `Disabling auto-poll` line, and NO further version-checker logs. Unblock and confirm no recovery happens until the page is refreshed.

## Anything flagged for follow-up

- **`/manifest.webmanifest` blocked by SWG**: Visible in the same logs (`Access to internal resource at '…/manifest.webmanifest?_sm_byp=…' has been blocked`). The PWA manifest fetch is not under our explicit control — the browser issues it during install/refresh. The IT bypass above resolves it; no FE mitigation needed (the browser handles the failure silently — it's only verbose because Chrome's recent CORS-blocked-redirect logging is louder than it used to be).
- **`/api/v1/*` requests on RF**: Same SWG path, same likely failure shape if/when those endpoints get exercised heavily on RF terminals (WebSocket upgrades especially). If logs show repeating CORS / fetch errors against `*.up.railway.app/api/v1/*` post-deploy, apply the same self-disabling pattern (`consecutive-failure latch + tear down`) to those clients. This sprint's fix targets the version-checker noise specifically; broader hardening of API clients against SWG interception is follow-up scope.
- **Customer-portal exclusion in `VERSION_CHECK_KIOSK_ROUTE_PATTERNS`**: Decision is documented in the constant's JSDoc + this note. If the customer portal ever moves to a B2B / private-network deployment where SSL-inspection is also in play, revisit the exclusion.

## Related

- [[Patterns/Realtime-Presence-Browser-Hardening]] — Layer 4 (kiosk opt-out) is the conceptual sibling pattern this fix mirrors for the version-checker subsystem.
- [[Implementations/Harden-Presence-Service-Tenant-Overload]] — same opt-out approach played out for presence.
- [[Patterns/Async-Library-Circuit-Breaker]] — the failure-counter / one-shot-latch shape is the browser-side equivalent.
- [[Sessions/2026-05-07]] — session log this fix landed in.
