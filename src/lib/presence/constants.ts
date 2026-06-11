// Created and developed by Jai Singh
/**
 * Presence System Constants
 *
 * Tuned to minimise pressure on the shared org-wide Supabase Realtime
 * Presence channel (`presence-org-{org_id}`). All authenticated tabs in
 * the org share that single channel, so any per-tab work multiplies by
 * the number of concurrent sessions.
 *
 * Background: 2026-05-06 the `Presence_shard112` GenServer for tenant
 * `c9d89a74` wedged on `:track` calls because the channel was being
 * hammered from multiple sources (OmniFrame agent reconnect cycle +
 * long-lived browser sessions in the Customer Portal). The agent fix
 * (v1.8.4) tightened circuit-breaker thresholds; these constants do the
 * equivalent on the browser side.
 */

// ---- DB heartbeat -----------------------------------------------------------

/**
 * How often a foreground/active tab UPDATEs `user_profiles.last_seen`.
 * One write per tab per minute — kept conservative because every
 * authenticated tab does this.
 */
export const DB_HEARTBEAT_INTERVAL = 60_000

/**
 * How often a hidden tab updates `last_seen`. Hidden tabs throttle
 * setInterval anyway, but explicit back-off avoids waking the timer
 * just to write a row that no one is watching.
 *
 * 5 minutes — keeps the row "recent enough" to be useful while cutting
 * write volume by 5× for tabbed-away sessions (the customer portal's
 * dominant state).
 */
export const DB_HEARTBEAT_INTERVAL_HIDDEN = 5 * 60_000

// ---- Idle detection ---------------------------------------------------------

/** How long before user is considered "away" due to inactivity (ms). */
export const IDLE_TIMEOUT = 5 * 60_000

/** How long a hidden tab waits before setting away (ms). */
export const TAB_HIDDEN_TIMEOUT = 2 * 60_000

// ---- Realtime channel -------------------------------------------------------

export const PRESENCE_CHANNEL_PREFIX = 'presence-org'

/**
 * Throttle for inbound presence-state sync events. Bumped from 500ms to
 * 1000ms — a logistics app does not need sub-second freshness on the
 * "who's online" panel and the doubled window cuts re-render churn in
 * half on busy orgs.
 */
export const PRESENCE_SYNC_THROTTLE = 1_000

/**
 * Maximum rate at which the local tab calls `channel.track()`. Every
 * track is an RPC to the org's Realtime worker; coalescing back-to-back
 * mutations (status flip → custom-text → idle re-entry) into a single
 * track call is the single biggest reduction in server-side Presence
 * load.
 *
 * 1500ms — fast enough that human-visible status changes feel instant,
 * slow enough that a flapping idle detector or a reconnect-storm cannot
 * generate a track-per-second.
 */
export const TRACK_DEBOUNCE_MS = 1_500

// ---- Channel error circuit breaker ------------------------------------------
// Mirrors the OmniFrame agent v1.8.4 strategy: count repeated
// CHANNEL_ERROR / TIMED_OUT events from supabase-js, trip a local
// circuit when the tenant looks degraded, and let the auto-retry
// cooldown grow exponentially so we don't hammer a wedged shard.

export const CHANNEL_ERROR_WINDOW_MS = 60_000
export const CHANNEL_ERROR_THRESHOLD = 3

/** Initial cooldown after the breaker trips. */
export const CHANNEL_BREAK_INITIAL_COOLDOWN_MS = 5 * 60_000

/** Hard ceiling for the cooldown ladder. Doubles per consecutive trip. */
export const CHANNEL_BREAK_MAX_COOLDOWN_MS = 30 * 60_000

/**
 * How long a connection has to survive (no errors) before the
 * `consecutive_trips` counter resets to 0. Mirrors the agent's
 * `_REALTIME_STABLE_CONNECTION_SEC = 60`.
 */
export const CHANNEL_STABLE_CONNECTION_MS = 60_000

// ---- Toast / UX -------------------------------------------------------------

export const PRESENCE_TOAST_THROTTLE = 5_000

// ---- Local storage ----------------------------------------------------------

export const STATUS_PREFERENCE_KEY = 'onebox-presence-status'
export const CUSTOM_STATUS_KEY = 'onebox-custom-status'

// ---- Kill switch + opt-outs -------------------------------------------------

/**
 * Read the `VITE_PRESENCE_DISABLED` env var at module load. When set to
 * `'true'` or `'1'`, the presence service skips channel join + DB
 * heartbeat entirely. This is the browser-side equivalent of the agent's
 * `OMNIFRAME_DISABLE_REALTIME=1` escape hatch — flip it for the whole
 * fleet (Vite build-time env) when the Realtime tenant is degraded and
 * we need to bleed off Presence load immediately.
 *
 * Resolved at module load because Vite inlines `import.meta.env.*` at
 * build time; runtime mutation isn't supported.
 */
export const PRESENCE_DISABLED_ENV: boolean = (() => {
  const raw = import.meta.env.VITE_PRESENCE_DISABLED
  if (raw === undefined || raw === null) return false
  const v = String(raw).toLowerCase().trim()
  return v === 'true' || v === '1' || v === 'yes' || v === 'on'
})()

/**
 * Backend-selection knob for the presence subsystem.
 *
 *   - `'supabase'` (default) — Phase A + B2 + B3 implementation on
 *     Supabase Realtime presence channels (`presence-org-{org_id}`).
 *     The behaviour shipped through 2026-05-06.
 *   - `'rust'`               — Option 2 from
 *     `memorybank/OmniFrame/Decisions/ADR-Presence-Architecture-Next-Steps.md`:
 *     server-side presence in `rust-work-service`. Browsers heartbeat
 *     to `POST /api/v1/presence/heartbeat` and consume
 *     `Presence{Joined,Updated,Left}` events from the existing
 *     `WorkServiceWebSocket` singleton. Removes Supabase Realtime
 *     presence dependency entirely for the org.
 *   - `'disabled'`           — same effect as `VITE_PRESENCE_DISABLED=true`.
 *     Provided so a per-tenant build can express "presence off" in
 *     one knob instead of two.
 *
 * Resolved at module load (Vite inlines `import.meta.env.*` at build
 * time). `VITE_PRESENCE_DISABLED=true` always wins, so a fleet-wide
 * kill switch can be flipped without re-flipping `VITE_PRESENCE_MODE`.
 *
 * Per-org rollout (the "would be nice" path in the ADR) remains
 * future work — for now the env var flips the whole fleet at once.
 * When per-org rollout lands, the facade in
 * `src/lib/presence/index.ts` can read a per-org override from the
 * `useUnifiedAuth` profile before falling back to this build-time
 * default.
 */
export const PRESENCE_MODE: 'supabase' | 'rust' | 'disabled' = (() => {
  if (PRESENCE_DISABLED_ENV) return 'disabled'
  const raw = import.meta.env.VITE_PRESENCE_MODE
  if (raw === undefined || raw === null) return 'supabase'
  const v = String(raw).toLowerCase().trim()
  if (v === 'rust') return 'rust'
  if (v === 'disabled') return 'disabled'
  return 'supabase'
})()

/**
 * Route patterns that opt out of presence tracking. Time-clock kiosks
 * and the public customer-portal landing pages are device-class
 * surfaces that don't benefit from Teams-style "who's online"
 * awareness — they need device connectivity, not human-presence.
 *
 * **2026-05-07 narrowed.** Originally `/^\/rf-/` matched the entire
 * RF tree (sign-in + interface + workflows). The opt-out was added
 * during Phase B (2026-05-06) to defend tenant-overload on the shared
 * Supabase Realtime presence shard — RF terminals leaving channels
 * open all shift were load-amplifying. **Layer 7 (server-side Rust
 * presence on `rust-work-service`) shipped same-day, retiring that
 * load argument.** With Redis-HSET-backed per-org presence and a 90s
 * TTL evictor, an RF terminal heartbeat is ~1 HSET per ~30s — the
 * cost basis that motivated the opt-out is gone.
 *
 * Now only `/rf-signin/` (the unauthenticated sign-in screen) opts
 * out. `/rf-interface/*` workflow routes participate in presence so
 * supervisors can see RF operators in `<LiveOperatorStatus>`'s "In
 * Building" tab AND see granular RF activity telemetry on operator
 * cards (current workflow step, last scan, idle indicator, work
 * task / zone). See
 * `memorybank/OmniFrame/Decisions/ADR-RF-Activity-Telemetry.md`.
 *
 * Patterns are evaluated against `location.pathname`.
 */
export const PRESENCE_KIOSK_ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/rf-signin(\/|$)/, // RF sign-in screen (pre-auth; no point broadcasting)
  /^\/timeclock(app)?(\/|$)/, // Time clock kiosks: /timeclock, /timeclockapp
  /^\/customer-portal(\/|$)/, // Public customer-portal landing (unauthenticated)
] as const

export function isPresenceKioskRoute(pathname: string): boolean {
  return PRESENCE_KIOSK_ROUTE_PATTERNS.some((re) => re.test(pathname))
}

// ---- Permission keys -------------------------------------------------------
//
// Centralised so the service-side gating (`useIsPresenceCandidate`) and
// the panel-side gating (`usePresenceVisibility`) can never disagree
// about the wire format. Names mirror the existing role-permission
// strings stored in `role_permissions` rows.

/**
 * Granted: user can see other users' presence + status (no current page,
 * no extras). The basic "is X online?" affordance.
 */
export const PRESENCE_PERMISSION_VIEW = 'presence:view'

/**
 * Granted: user can see everything `presence:view` covers plus any
 * future detail fields. Treated as a strict superset.
 */
export const PRESENCE_PERMISSION_VIEW_DETAILS = 'presence:view_details'

/**
 * Granted: user opts OUT of being seen by colleagues with `presence:view*`
 * AND skips the org-wide presence channel entirely. Used by
 * `useIsPresenceCandidate` to decide whether to subscribe at all.
 *
 * Default behaviour for orgs that don't define this permission is
 * unchanged — every user stays visible to view-permitted colleagues
 * (Strategy A from Phase B2: opt-out via permission, no roundtrip
 * required at sign-in). Add the permission to a role only when you
 * want that role's users to disappear from presence completely (e.g.
 * a "Stealth" or "Background" role for back-office automation users).
 */
export const PRESENCE_PERMISSION_HIDDEN = 'presence:hidden'

// Created and developed by Jai Singh
