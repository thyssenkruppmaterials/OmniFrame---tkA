---
tags: [type/pattern, status/active, domain/frontend, domain/realtime]
created: 2026-05-06
---

# Pattern: Realtime Presence Browser Hardening

## Purpose / Context

Distilled, reusable pattern for surviving a degraded Supabase Realtime tenant from a browser client. Captured 2026-05-06 from the Customer Portal Presence overload incident on tenant `c9d89a74` ([[Debug/Fix-CustomerPortal-Presence-Tenant-Overload]]); pairs with the agent-side equivalent ([[Patterns/Async-Library-Circuit-Breaker]]).

Applies to ANY long-lived browser session that joins a high-fanout Realtime channel (presence, broadcast, postgres_changes). The Customer Portal case is the canonical example because CSRs leave the tab open all day, multiplying every per-tab cost by hours of dwell time.

## When to apply

- Long-lived authenticated tab with continuous Realtime subscription.
- Channel is shared org-wide / tenant-wide (single channel per tenant → single Realtime worker → single GenServer at risk of wedging).
- The product can tolerate seconds of staleness on the affected surface (presence, "who's online", typing indicators, etc.).
- You have multiple tabs of the same app per user (compounds load).
- You have device-class views (RF terminal, kiosk) that don't need the affordance the channel provides.

## Pattern — Six layers of defense

### Layer 1: Coalesce outbound RPCs (track / send / broadcast)

Wrap every outbound RPC in a debouncer/coalescer. The single biggest reduction in server-side load comes from collapsing back-to-back state mutations into one RPC, AND collapsing reconnect-storm `SUBSCRIBED` events into one re-track.

```ts
private scheduleTrack(): void {
  if (this.trackDebounceTimer) return
  this.trackDebounceTimer = setTimeout(() => {
    this.trackDebounceTimer = null
    void this.flushTrack() // always sends LATEST payload
  }, TRACK_DEBOUNCE_MS) // ~1500ms is a good default
}
```

Key property: the flush ALWAYS reads the latest local state. No stale payloads on the wire.

### Layer 2: Local channel-error circuit breaker

`supabase-js` has its own internal retry, but it's tenant-blind. Mirror the agent's pattern client-side:

- Count `CHANNEL_ERROR` / `TIMED_OUT` events in a rolling window (~60s).
- On threshold breach: untrack → `removeChannel` → schedule auto re-join after a cooldown.
- Cooldown grows exponentially per consecutive trip (5→10→20→30 min cap).
- Reset `consecutive_trips` counter when a connection survives a stable window (~60s).
- Add small per-tab jitter (~250ms) on the auto re-join so multiple tabs don't sync up.

Mirrors [[Patterns/Async-Library-Circuit-Breaker]] but client-side instead of in a long-running Python process.

### Layer 3: Visibility-aware DB writes

If the channel-adjacent code does periodic Postgres writes (e.g. `last_seen` heartbeats), make the cadence visibility-aware:

- Foreground: normal cadence (e.g. 60s).
- `document.hidden`: 5× backoff (e.g. 5min).
- User-set "offline" / "do not disturb": stop the writes entirely.

Wire to a single `visibilitychange` listener that tears down and rebuilds the timer at the new cadence. Hidden tabs already throttle `setInterval` aggressively, but explicit backoff documents intent and avoids waking the timer to write a row no one is watching.

### Layer 4: Route-class opt-out

Not every authenticated route benefits from presence. Pre-auth screens (e.g. `/rf-signin`), time-clock kiosks, and other device-class apps need DEVICE connectivity tracking, not Teams-style "who's online". Pattern:

- Define a regex array of opt-out path prefixes.
- Snapshot `location.pathname` at provider mount (not on every navigation — that would constantly toggle).
- Pass the kiosk decision into the service init; service stores user identity but skips channel join + heartbeat.
- Provider stays mounted so consumer hooks don't crash; the SERVICE just no-ops.

> **2026-05-07 narrowing.** The opt-out originally caught the entire `/rf-*` tree because RF terminals leaving Realtime channels open all shift were load-amplifying on the shared Supabase Realtime presence shard. **Layer 7 (server-side Rust presence on `rust-work-service`, see below) shipped same-day, retiring that load argument** — Redis-HSET-backed per-org presence costs ~1 HSET per ~30s heartbeat. The current opt-out catches only `/rf-signin/` (pre-auth) + `/timeclock(app)?/` + `/customer-portal/` (pre-auth public landing). RF interface workflow routes (`/rf-interface/*`) participate in presence so supervisors see RF operators in `<LiveOperatorStatus>`'s "In Building" tab AND see granular RF activity telemetry on operator cards. See [[ADR-RF-Activity-Telemetry]] for the rationale.

### Layer 5: Build-time kill switch

Add an env-gated boot-time disable: e.g. `VITE_PRESENCE_DISABLED=true`. When set:

- `initialize()` returns immediately after storing identity.
- `onConnectionChange?.(false, 'Disabled via env var')` fires once so the UI can show a banner.
- All other code paths short-circuit on `disabledReason !== null`.

Mirrors the agent's `OMNIFRAME_DISABLE_REALTIME=1` escape hatch. The fleet-wide bleed-off button when the tenant goes red and you need to stop the bleeding without a code rollback.

### Layer 6: Permission-gated subscription

Built on top of Layer 4 (route opt-out) and Layer 5 (env kill switch). Where Layer 4 says "this ROUTE doesn't need presence" and Layer 5 says "the WHOLE FLEET is sick", Layer 6 says "this USER doesn't need to be on the channel".

If your app already has a permission system around the presence affordance ("who can see who's online"), use it to ALSO gate whether the user joins the channel at all. Two strategies:

- **Strategy A (preferred):** opt-OUT permission. Add a new permission key (e.g. `presence:hidden`) that, if granted, says "this user does not need to be seen and does not see others, so skip the channel entirely". Default behaviour is unchanged for orgs that don't grant the permission. No auth-flow change, no migration, no Supabase roundtrip at sign-in. Largest win when admins want to opt SPECIFIC roles out (e.g. a back-office automation role).
- **Strategy B:** query the org at sign-in for any user with `presence:view*`. If none, skip the channel for everyone in the org. Cache for the session. More expressive but requires an extra request per session and only pays off when an entire org turns presence off, which Layer 5's env-var kill switch already covers.

Logic in the candidate hook:

```ts
// Candidate iff: user has view permission OR doesn't have the opt-out permission.
function useIsPresenceCandidate(): boolean {
  const { permissions } = usePermissionStore()
  return useMemo(() => {
    if (permissions.includes('presence:view')) return true
    if (permissions.includes('presence:view_details')) return true
    if (permissions.includes('presence:hidden')) return false
    return true // default: be seen by view-permitted colleagues
  }, [permissions])
}
```

Wiring:

- The candidate hook MUST be decoupled from the presence context (the visibility-style hook that consumes `usePresenceOptional()`). The candidate hook is consumed BEFORE the context exists; touching the context creates a circular dep at provider-mount time.
- Pass the boolean into `service.initialize({ ..., presenceCandidate })`.
- In the service, add a third value to the `disabledReason` union (e.g. `'permission'`) and a third gate in the init order: **env → kiosk → permission**. The kiosk branch wins over the permission branch deliberately so a kiosk-mounted user reports `disabledReason='kiosk'`, not `'permission'` (logs stay accurate).
- Wire the candidate value into the React-effect deps + a same-init bypass ref so a permission-store hydration after mount triggers a clean `destroy() → initialize()` re-run with the new decision.

### Layer 7: Server-side presence on a dedicated Rust WS bus

Where Layers 1–6 are all browser-side defences against the WRONG channel (a multi-tenant managed Realtime shard that can be wedged from outside the app), Layer 7 retires the underlying dependency entirely.

The per-org presence map moves out of `presence-org-{org_id}` (Supabase Realtime) and into `presence:org:{org_id}` (Redis HSET, owned by `rust-work-service`). Browsers heartbeat to `POST /api/v1/presence/heartbeat`; deltas land via the existing `WorkServiceWebSocket` singleton through three new `WsEvent` variants (`PresenceJoined`, `PresenceUpdated`, `PresenceLeft`). A 30s tokio evictor sweeps expired rows and broadcasts `PresenceLeft` for each.

Apply this layer when:

- Layers 1–6 have run their course and the channel still struggles, OR
- The org grew past the point where Phase A's debouncer keeps the shard healthy, OR
- The team made the strategic call to retire the multi-tenant Realtime dependency for ops-control reasons (on-prem deployment, observability, etc.).

Properties:

- **Self-healing TTL** (90s in the reference impl) means a tab disappearing has the same auto-departure semantics as Supabase Presence — no explicit "sign-out" RPC required.
- **Sub-second push retained** — same UX as Supabase Presence; the WS singleton is already in the FE.
- **Inspectable state** — `redis-cli HGETALL presence:org:{org_id}` shows live state, vs. an opaque Phoenix GenServer at the cloud provider.
- **Single SPOF** — `rust-work-service` outage breaks presence org-wide. Mitigated by the Layer 2 circuit-breaker + a defence-in-depth poll fallback when WS state ≠ 'connected'.
- **Inherits the auth + org-isolation infrastructure** — `WS-Subscribe-Token` issuance + Subscribe deny-by-default + `broadcast::channel(1000)` fan-out + the `RecvError::Lagged` metric ([[Add-WsEvent-Lagged-Metric]]) all apply for free.

Reference implementation: [[Implement-Presence-On-Rust-Option-2]]. Distilled Pattern: [[Server-Side-Presence-Redis-HSET]]. Migration is additive (Layer 7 ships behind a `VITE_PRESENCE_MODE='supabase' | 'rust' | 'disabled'` env var; default keeps Phase A / B2 / B3 untouched).

## Tuning rules of thumb

| Knob | Default | Rationale |
|---|---|---|
| Outbound coalesce window | 1500ms | Fast enough that humans don't notice; slow enough that flapping idle / reconnect storms collapse. |
| Inbound sync throttle | 1000ms | A logistics app does not need sub-second "who's online" freshness. |
| Hidden-tab cadence multiplier | 5× | Empirically the right balance — keeps `last_seen` useful without burning writes on backgrounded tabs. |
| Channel-error window | 60s | Same as the agent. |
| Channel-error threshold | 3 errors | Browser sees more transient blips than a server process; tighter than the agent's 2. |
| Initial cooldown | 5 min | Long enough for the wedged shard to recover; short enough that a transient incident self-heals. |
| Cooldown ceiling | 30 min | Hard cap so a chronically broken tenant doesn't lock the user out forever. |
| Stable-connection reset | 60s | One stable connection clears the trip counter. |

## Anti-patterns to avoid

- **Calling `.track()` on every `SUBSCRIBED` event.** supabase-js fires `SUBSCRIBED` repeatedly during reconnect cycles — each one becomes a fresh RPC against the wedged shard. Always coalesce.
- **Per-page presence init.** Mount once at the layout, never per-route. Constantly tearing down + re-creating the channel is a load multiplier.
- **Subscribing without a key.** Anonymous-key presence makes deduping impossible and turns N tabs of the same user into N "different" presences.
- **Logging errors and moving on.** No local circuit breaker = no upper bound on the load you contribute when the tenant is sick.
- **Same cadence regardless of state.** Tab hidden + idle + offline-by-choice are all different signals; treat them differently.
- **Heartbeat writes hitting the same Postgres instance Realtime is using for replication.** Backing off when the user isn't watching is not just polite — it directly relieves Realtime pressure.

## Privacy considerations

Presence channels are a near-public broadcast: every member sees every other member's payload, throttled or not. Treat the payload like a public announcement.

- **Don't broadcast navigation context.** A `current_page` field on the payload leaks where every coworker is in the app. The original "Online — viewing /rf-interface" tooltip felt useful but cost privacy AND payload size (30–50 bytes per member × every `.track()` RPC). If you need cross-user navigation visibility, use server-side activity logs (e.g. `ticket_user_actions`), not the broadcast channel.
- **Don't broadcast device fingerprints.** A `device_type: 'mobile' | 'desktop' | 'tablet'` is fine; an IP, a user-agent string, or a fine-grained device id is not.
- **Don't broadcast custom-status text without UI gating.** Custom status is user-set and explicit-by-design, but if the panel that shows it has its own permission gate (e.g. `presence:view_details`), strip it on the consumer side at the basic-visibility level.
- **Coalesce + minimise.** Every payload byte is multiplied by N members on a busy org-wide channel. Cut what isn't load-bearing for the affordance.

When Layer 6 (permission-gated subscription) is in place, users who are CONFIGURED-out of presence don't even appear in the broadcast. That's the cleanest privacy story you can give: not "this user is filtered", but "this user was never on the channel".

**Scoped exception (2026-05-07):** [[ADR-Scoped-CurrentPage-In-ActiveOperators]] partially re-enables `current_page` on the broadcast payload because exactly one downstream surface needed it (the `<LiveOperatorStatus>` panel inside the Inventory Counts tab, which is already RBAC-gated by `view inventory_apps`). The privacy contract is enforced at the CONSUMER level rather than at broadcast time — the field is broadcast for everyone, but only one component reads it, and that component is gated by an existing route permission. Future consumers MUST file a new ADR or use a render-time RBAC gate. The org-wide `<OnlineUsersPanel>` / `<StatusSelector>` / `<PresenceAvatar>` surfaces stay `current_page`-agnostic. Pattern for the URL→label resolver used at render time: [[Route-To-Feature-Name-Mapping]].

## Reference implementation

- `src/lib/presence/constants.ts` — all tunable knobs + the `PRESENCE_PERMISSION_*` keys.
- `src/lib/presence/presence.service.ts` — the full implementation: `scheduleTrack()`, `recordChannelError()`, `currentHeartbeatInterval()`, `startVisibilityWatcher()`, `initialize()` kill-switch checks (env / kiosk / permission, in that order).
- `src/hooks/use-presence-tracker.ts` — kiosk-route detection + `useIsPresenceCandidate()` decision passed into `initialize()`.
- `src/hooks/use-presence-visibility.ts` — `usePresenceVisibility()` (panel-side filtering by `presence:view*`) and `useIsPresenceCandidate()` (Layer 6 channel-join gate using `presence:hidden`).

## Related

- [[Patterns/Async-Library-Circuit-Breaker]] — the server-side / agent-side counterpart pattern.
- [[Debug/Fix-CustomerPortal-Presence-Tenant-Overload]] — the incident this pattern was distilled from.
- [[Debug/Fix-Realtime-Tenant-Overload]] — agent v1.8.4 fix that uses the same shape.
- [[Implementations/Harden-Presence-Service-Tenant-Overload]] — the implementation note.
- [[Decisions/ADR-Presence-Architecture-Next-Steps]] — when this pattern's six layers stop being enough: option-space review for moving presence into Rust (or just monitoring and doing nothing more).
- [[Components/PresenceUI - Status Indicators]] — the affected component family.
