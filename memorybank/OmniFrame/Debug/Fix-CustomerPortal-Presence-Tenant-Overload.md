---
tags: [type/debug, status/active, domain/frontend, domain/infra, domain/realtime]
created: 2026-05-06
---

# Fix: Customer-Portal-Side Presence Hardening — Browser Companion to v1.8.4 Agent Fix

## Symptom (recap)

Supabase Realtime `Presence_shard112` GenServer wedging for tenant `c9d89a74` on `:track` calls. The agent fix ([[Debug/Fix-Realtime-Tenant-Overload]] / v1.8.4) eliminated the agent's contribution to the load, but the customer-portal browser sessions were the actual source named in the original Supabase logs. This note covers the browser-side hardening so a future flare-up doesn't re-wedge the shard.

## What "Customer Portal" actually means in the architecture

The `/_authenticated/apps/customer-portal` route is rendered inside `AuthenticatedLayout`, which wraps EVERY authenticated page with `<PresenceProvider>`. So:

- ALL authenticated tabs in the org join ONE channel: `presence-org-{org_id}` → consistently hashes to `Presence_shard112` for tenant `c9d89a74`.
- ALL authenticated tabs call `.track()` on that channel and run a 60-second DB heartbeat against `user_profiles`.
- The customer portal happens to be the longest-lived authenticated tab (CSRs leave it open all day), so its sessions accumulate the most pressure on the shard.

The "customer portal" page itself does NOT use Presence directly — the load comes from the always-on `PresenceProvider` in the shared layout.

## Audit findings

Nine specific issues identified in the original `presence.service.ts`:

1. **Single org-wide channel.** O(N²) message volume on a single Realtime worker. Architectural — left as-is for now.
2. **DB heartbeat ran every 60s for every authenticated tab regardless of state.** Hidden tab, idle, even `Appear Offline` → still writing `user_profiles.last_seen` every minute. Hits Postgres on the same instance Realtime is using for replication.
3. **No throttling/debouncing on `.track()`.** Every `subscribe → SUBSCRIBED` triggered a fresh `.track()`. On a degraded tenant supabase-js retries aggressively, so a wedging shard saw a `.track()` storm from each browser tab — exactly the trigger pattern the GenServer kept timing out on.
4. **No multi-tab coordination.** N tabs of one user generated N× the load on the same `presence: { key: userId }` slot — the GenServer had to reconcile racing tracks/untracks for the same key.
5. **No reconnection backoff on `CHANNEL_ERROR` / `TIMED_OUT`.** Errors were logged but not counted; supabase-js retried internally without local guardrails, so a wedged shard kept getting hammered.
6. **Mounted on every authenticated route.** RF terminals, time-clock kiosks, even drone-scanner-style device apps all participated in the org-wide presence channel — pure overhead, no UX benefit.
7. **Visibility permissions didn't gate subscription.** Even users with `presence: 'none'` permission still consumed Realtime resources.
8. **`online_at` reset on every reconnect.** Every WebSocket reconnect (JWT refresh, focus event) created a fresh sync event for ALL org users → re-render → re-fetch derived state.
9. **`current_page` already non-broadcast** (good). Only mutates next-track payload — heavy navigation does not generate Realtime traffic. Verified.

## Fix — surgical Phase A patch (Tier 1)

Six coordinated changes inside `src/lib/presence/`. No schema changes, no migration, no RLS, no Supabase Storage touched, no consumer hooks changed (`usePresence`, `OnlineUsersPanel`, `StatusSelector` etc. all keep the same surface).

### 1. `scheduleTrack()` debouncer/coalescer (THE big one)

- All `.track()` / `.untrack()` paths route through a single `scheduleTrack()` / `scheduleUntrack()` debouncer (default `TRACK_DEBOUNCE_MS = 1500`).
- Back-to-back mutations (status flip → custom-text edit → idle re-entry) collapse into ONE RPC.
- Reconnect storms (supabase-js firing `SUBSCRIBED` repeatedly on a flaky tenant) now produce ONE `.track()` per 1.5s instead of one per `SUBSCRIBED` event.
- Always sends the LATEST payload — no stale state on the wire.

### 2. Channel-error circuit breaker

Mirror of the agent v1.8.4 strategy:

| Setting | Value | Rationale |
|---|---|---|
| `CHANNEL_ERROR_WINDOW_MS` | 60s | Same observation window as the agent. |
| `CHANNEL_ERROR_THRESHOLD` | 3 errors | Tighter than the agent (was 2 there) — browser sees more transient blips. |
| `CHANNEL_BREAK_INITIAL_COOLDOWN_MS` | 5min | First trip → 5 min off. |
| `CHANNEL_BREAK_MAX_COOLDOWN_MS` | 30min | Hard ceiling. Doubles per consecutive trip (5→10→20→30). |
| `CHANNEL_STABLE_CONNECTION_MS` | 60s | One stable connection clears `consecutive_trips` to 0. |

When tripped: untrack → `removeChannel` → schedule auto re-join after cooldown + 250ms jitter (so multiple tabs don't sync up). The service stays "alive" — the next user action that needs presence will succeed on the post-cooldown re-join.

### 3. Visibility-aware DB heartbeat

- Foreground tab: `DB_HEARTBEAT_INTERVAL = 60s` (unchanged).
- Tab hidden: `DB_HEARTBEAT_INTERVAL_HIDDEN = 5min` (5× reduction).
- `Appear Offline` selected: heartbeat stops entirely (writing `last_seen` while "offline" was a lie anyway).
- Page-visibility listener tears down the timer and rebuilds it at the new cadence whenever `document.hidden` flips.

For a customer-portal session that's tab-backgrounded most of the day (typical CSR workflow), this cuts DB heartbeat writes from ~480/day to ~95/day per session.

### 4. `VITE_PRESENCE_DISABLED` kill-switch env var

Browser-side equivalent of the agent's `OMNIFRAME_DISABLE_REALTIME=1`. Set to `'true'` / `'1'` at build time → service skips channel join + DB heartbeat entirely; `onConnectionChange?.(false, 'Disabled via env var')` fires once. The fleet-wide bleed-off button when the tenant goes red.

### 5. Kiosk/RF route opt-out

`PRESENCE_KIOSK_ROUTE_PATTERNS` matches `/^\/rf-/`, `/^\/timeclock(app)?(\/|$)/`, `/^\/customer-portal(\/|$)/`. `usePresenceTracker` snapshots the *initial* pathname on mount and passes `kioskRoute: true` to `presenceService.initialize()` for matching routes. Service stores user identity (so `getEffectiveStatus()` etc. still work) but skips channel + heartbeat.

Device-class apps don't need Teams-style "who's online" — they need device connectivity, which is tracked separately (e.g. `last_seen_at` on `sap_agents`).

### 6. Sync-event throttle bumped 500ms → 1000ms

A logistics app does not need sub-second freshness on the "who's online" panel. Doubling the inbound throttle window halves re-render churn on busy orgs at zero UX cost.

## What stayed the same

- `usePresence`, `usePresenceOptional`, `usePresenceVisibility` — same hook surface.
- `OnlineUsersPanel`, `StatusSelector`, `PresenceAvatar`, `StatusIndicator` — unchanged.
- `PresencePayload`, `PresenceUser`, `PRESENCE_STATUS_CONFIG` — unchanged.
- `PresenceProvider` mount in `AuthenticatedLayout` — unchanged. (Provider stays mounted on kiosk routes; the SERVICE just no-ops.)
- All localStorage keys (`onebox-presence-status`, `onebox-custom-status`).
- `current_page` mutation-only behaviour (already correct; verified).

## Files modified

| File | LOC delta | Notes |
|---|---|---|
| `src/lib/presence/constants.ts` | rewrite (~140 LOC) | New tuning knobs, env-var resolver, kiosk patterns + helper. Keeps all original exports. |
| `src/lib/presence/presence.service.ts` | rewrite (~530 LOC, +~140 LOC) | `scheduleTrack()` coalescer, channel-error breaker, visibility-aware heartbeat, env + kiosk kill switches, defensive cleanup in `destroy()`. |
| `src/hooks/use-presence-tracker.ts` | +~10 LOC | `initialKioskRoute` snapshot via `useMemo`, passed to `initialize()`. |
| `.env.example` | +~10 LOC | Documents `VITE_PRESENCE_DISABLED`. |

## Quality gates

- `pnpm tsc -b --noEmit` — clean.
- `npx eslint <touched files>` — 0 warnings, 0 errors on touched files. (Workspace-wide warnings are a pre-existing condition unrelated to this work.)
- `pnpm build` — clean in 9.59s; no bundle-budget violations; no new chunks.

## Phase B — partial follow-up

Three higher-leverage but higher-complexity additions, ordered by ROI:

1. **B1 — Multi-tab leader election via `BroadcastChannel`.** _DEFERRED._ A power user with N tabs of OmniFrame currently generates N× the presence load. Leader-elect one tab per `userId` to own the channel + heartbeat; followers consume state via BroadcastChannel relay. Reduces concurrent connections per power user by ~75%. Needs careful handling for leader handoff on tab close + crash.
2. **B2 — Visibility-permission-gated subscription.** _DONE 2026-05-06._ New `presence:hidden` opt-out permission via Strategy A (no auth-flow change, no roundtrip). Users with `presence:hidden` AND no `presence:view*` skip the org-wide channel entirely — service sets `disabledReason='permission'`. Resolution order in `initialize()` is env → kiosk → permission. Default behaviour for orgs that don't define `presence:hidden` is unchanged. See [[Implementations/Harden-Presence-Service-Tenant-Overload]] § "Phase B2 + B3 follow-up".
3. **B3 — Drop `current_page` from payload.** _DONE 2026-05-06._ Removed from `PresencePayload` and `PresenceUser` types, from `initialize()`'s initial payload, and from the `updateCurrentPage()` method (deleted entirely). Removed the page-tracking `useEffect` in `usePresenceTracker`. Privacy + 30–50-byte-per-member payload-size win. No fallback, no feature flag — clean removal. Snapshot grep verified before deletion: only the type defs, the service, and `usePresenceVisibility`'s `stripDetails` helper referenced the field; no UI consumer was load-bearing on it.

## Open Supabase support items

- Open ticket re. `RealtimeWeb.Presence_shard112` GenServer terminating during `:track` for tenant `c9d89a74`. Provide repro context (50–80 concurrent customer-portal sessions, single org-wide channel `presence-org-c9d89a74-7179-4033-93ea-56267cf42a17`).
- Confirm whether the project tier's Realtime quota is the binding limit before/after this fix lands.

## Related

- [[Debug/Fix-Realtime-Tenant-Overload]] — agent v1.8.4 companion fix.
- [[Patterns/Realtime-Presence-Browser-Hardening]] — distilled pattern.
- [[Implementations/Harden-Presence-Service-Tenant-Overload]] — implementation note.
- [[Decisions/ADR-Presence-Architecture-Next-Steps]] — option-space review and recommendation for what (if anything) to ship next; B1 is NOT recommended.
- [[Components/PresenceUI - Status Indicators]] — consumer surface (unchanged).
- [[Patterns/Async-Library-Circuit-Breaker]] — broader breaker pattern shared with the agent.
- [[Sessions/2026-05-06]] — this session.
