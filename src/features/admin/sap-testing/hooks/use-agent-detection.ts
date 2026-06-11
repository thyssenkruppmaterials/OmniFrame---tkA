// Created and developed by Jai Singh
/**
 * useAgentDetection — light-weight, app-wide on-prem agent presence hook.
 *
 * Polls `${AGENT_URL}/health` with a short timeout every 5s and returns
 * the agent's reported capabilities + a friendly name. v1.6.5 also
 * follows up with `/agent-token/check` (auth-required) so the UI can
 * tell "agent process up" apart from "agent process up + token valid".
 *
 * v1.6.6 follow-up — **fleet awareness** (this commit):
 *   - In addition to the local /health probe the hook now exposes a
 *     module-scoped snapshot of the org's online agent fleet from
 *     `public.sap_agents` (Realtime-subscribed, refreshed on the same
 *     5s cadence as the local probe) so SmartImportButton + similar
 *     surfaces can route through a remote Citrix agent when the local
 *     agent is too old / lacks a capability.
 *   - `fleetHasCapability(cap)` — true when ANY online fleet agent
 *     reports the capability.
 *   - `bestAgentFor(cap)` — routing decision: prefer local if it's
 *     reachable + recent + has the capability, else fleet if any
 *     online agent has it, else null (caller falls back to manual).
 *   - Anonymous web sessions (no signed-in Supabase user) get an empty
 *     fleet — Supabase queries are skipped entirely, so the hook stays
 *     usable on public/anonymous surfaces without RLS errors.
 *
 * Module-scope cache:
 *   - All consumers share a single in-flight probe and a single
 *     setInterval timer. Mounting N components doesn't fire N polls.
 *   - The first consumer kicks off the poller; the last unmount tears
 *     it down. Subsequent mounts within ~5s reuse the cached snapshot
 *     so the UI doesn't flicker between known-good states.
 *
 * Failure model:
 *   - Network error / timeout on /health → `available = false`,
 *     `authenticated = false`, `health = null`.
 *   - /health 200 but /agent-token/check 401 → `available = true`,
 *     `authenticated = false`. The SAP Testing tab renders a yellow
 *     "Agent online but session expired" banner instead of the
 *     misleading red "SAP Agent Not Detected" banner.
 *   - /health 200 + /agent-token/check 200 → `available = true`,
 *     `authenticated = true` (the happy path).
 *   - Cached snapshots are evicted after a successful 'missing' result
 *     so the UI can react when the agent goes down.
 *
 * The hook also subscribes to the `omniframe:agent-token-stale` event
 * fired by `agentFetch()` whenever it observes a 401, so the detection
 * state flips to `authenticated=false` instantly without waiting for
 * the next 5s tick.
 */
import { useEffect, useState } from 'react'
import { getCurrentOrgId } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import type { WsEvent, WsEventHandler } from '@/lib/work-service'
import { getFleet } from '@/lib/work-service/sap-agents-client'
import { workServiceWs } from '@/lib/work-service/websocket'
import {
  AGENT_TOKEN_STALE_EVENT,
  AGENT_URL,
  agentFetch,
  getAgentToken,
  hasCapability as agentHasCapability,
  type AgentHealth,
} from '../lib/agent-fetch'

/**
 * v1.6.6 — slim view of `public.sap_agents` for routing + UI labels.
 * Only the fields SmartImportButton + similar surfaces need; the full
 * `SapAgentRow` shape lives in `agents-fleet-card.tsx` for the admin
 * card. Capabilities are normalised to `string[]` (never null) so
 * callers can `.includes(cap)` without a nil-check.
 */
export interface FleetAgent {
  id: string
  version: string | null
  capabilities: string[]
  last_seen_at: string | null
  sap_system: string | null
  sap_client: string | null
  hostname: string | null
  citrix_session: string | null
}

export interface FleetSnapshot {
  /** Number of agents currently `status='online'` in the org. */
  online: number
  /** Online agents only. Offline / draining are excluded — pinning to
   *  one of those can never succeed because the queue claim function
   *  filters by status, and the SmartImportButton's whole purpose is
   *  to route to something that will actually run. */
  agents: FleetAgent[]
}

export interface AgentDetection {
  /** True when the most recent /health probe returned ok. Reflects
   *  whether the local agent process is reachable at all (token-exempt
   *  endpoint, so this doesn't depend on a valid X-Agent-Token). */
  available: boolean
  /** v1.6.5 — true when /agent-token/check returned 200. False when
   *  /health was reachable but /agent-token/check 401'd, indicating a
   *  stale token in localStorage. UI surfaces should distinguish these
   *  two cases (process down vs token stale) — they need different CTAs.
   *
   *  For pre-v1.6.5 agents that don't expose /agent-token/check, the
   *  hook treats `authenticated = available` (best-effort fallback) so
   *  older agents don't trip the "session expired" banner. */
  authenticated: boolean
  /** Last successful /health response, or null. */
  health: AgentHealth | null
  /** Friendly name used by SmartImportButton's subLabel. */
  agentName: string | null
  /** Convenience capability check shortcut. */
  hasCapability: (cap: string) => boolean
  /** v1.6.6 — snapshot of online agents in the org (Realtime-driven).
   *  `{online: 0, agents: []}` for anonymous web sessions OR when the
   *  org has no online agents. */
  fleet: FleetSnapshot
  /** v1.6.6 — true when ANY online fleet agent reports `cap`. */
  fleetHasCapability: (cap: string) => boolean
  /** v1.6.6 — routing decision for a given capability:
   *    'local' — local agent is reachable, recent, and has the cap.
   *    'fleet' — at least one online fleet agent has the cap.
   *    null   — neither path works; caller should fall back to its
   *             manual UI (CSV upload, "agent unavailable" hint, …).
   *
   *  Local wins ties because:
   *    1. Latency: in-process SAP COM bridge → ms-scale; queue → ~5s
   *       (5s poll interval on the agent side).
   *    2. Visibility: the user can WATCH SAP GUI execute the action.
   *    3. Auth simplicity: local agent already has the user's JWT;
   *       no per-job RLS surprise.
   *
   *  Fleet wins when local lacks the cap (e.g. SmartImportButton's
   *  outbound LT22 import on a v1.0.0 dev/test agent) — the queue is
   *  literally what unblocks "user opens app from outside Citrix" and
   *  "remote Citrix box has the v1.6.6+ agent that can do the work". */
  bestAgentFor: (cap: string) => 'local' | 'fleet' | null
}

// v1.7.4 — cadence tuned for aggregate Supabase load reduction. The
// previous 5s cadence produced ~12 req/min of local /health probes PLUS
// 12 req/min of Supabase `sap_agents` selects per tab per user. At 50
// concurrent users that's 1,200 req/min of unfiltered fleet polls — enough
// to make `sap_agents` one of the hottest read paths in the workspace.
//
//   * Foreground (tab visible): 15s — still fast enough that SmartImport-
//     Button promotes within ~15s of the user launching the agent EXE,
//     and Citrix session flaps become visible within one cycle.
//   * Background (tab hidden):  60s — the user is not looking; we only
//     keep a minimal heartbeat so the snapshot isn't ancient when they
//     tab back. Combined with the visibilitychange listener below, the
//     first tick on re-show runs immediately anyway, so the hidden-tab
//     cadence is basically a safety net.
//
// Localhost /health is cheap (loopback), but the /agent-token/check leg
// hits the agent's token validation which cascades into a Supabase JWT
// check in some builds, so gating both on visibility matters.
const POLL_INTERVAL_VISIBLE_MS = 15_000
const POLL_INTERVAL_HIDDEN_MS = 60_000
const PROBE_TIMEOUT_MS = 1_500
/** v1.6.6 — `bestAgentFor()` treats a local snapshot as stale if its
 *  last successful probe is older than this. Guards against a
 *  background-tab / paused-poller scenario where `cachedSnapshot.available`
 *  is `true` but the agent silently went down hours ago. The 15s
 *  foreground poll keeps `lastProbeAt` fresh; this floor bumps to 90s
 *  so a single missed hidden-tab tick doesn't flip routing off. */
const LOCAL_RECENT_MS = 90_000

type Listener = (snapshot: AgentDetection) => void

const EMPTY_FLEET: FleetSnapshot = { online: 0, agents: [] }

let fleetState: FleetSnapshot = EMPTY_FLEET
let lastHealth: AgentHealth | null = null
let lastAuthenticated = false

let cachedSnapshot: AgentDetection = {
  available: false,
  authenticated: false,
  health: null,
  agentName: null,
  hasCapability: () => false,
  fleet: EMPTY_FLEET,
  fleetHasCapability: () => false,
  bestAgentFor: () => null,
}
const listeners = new Set<Listener>()
let pollerHandle: ReturnType<typeof setInterval> | null = null
let lastProbeAt = 0
let inFlightProbe: Promise<void> | null = null
let staleListenerWired = false

// 2026-05-06 — fleet realtime is now driven by `WsEvent::SapAgentChanged`
// from `rust-work-service` (migration 270 + sap_agents_listener). The
// previous `supabase.channel('omniframe-agent-detection-fleet')` is
// retired entirely; the WS singleton's reconnect/breaker is reused.
//
// `fleetSafetyNetHandle` is the safety-net only — it polls once every
// 5 minutes AND only when the WS is not in `connected` state, so the
// snapshot can self-heal during a Rust WS outage without hammering
// Postgres on the happy path. The 15s/60s `fleetPollerHandle` cadence
// it replaces was needed when Realtime could silently drop events; the
// WS handler now obsoletes that.
let fleetSafetyNetHandle: ReturnType<typeof setInterval> | null = null
let fleetWsHandler: WsEventHandler | null = null
let fleetWsHandlerOrgId: string | null = null
let inFlightFleetProbe: Promise<void> | null = null
let lastFleetProbeAt = 0
const FLEET_SAFETY_NET_INTERVAL_MS = 5 * 60_000

// v1.7.4 — visibility-gated cadence state. `visibilityListenerWired`
// makes the listener idempotent across HMR / multiple start/stop cycles.
let currentPollIntervalMs = POLL_INTERVAL_VISIBLE_MS
let visibilityListenerWired = false

// 2026-05-09 — local-probe suppression registry. The Inventory
// Management tab's Local/Fleet toggle (see `useExecutionMode`) calls
// `suppressLocalProbe(token)` when the user has opted into fleet
// routing — at that point the user explicitly does NOT want the
// browser to keep hammering `localhost:8765/health`, which (when no
// local agent is running) floods the dev console with hundreds of
// `ERR_CONNECTION_REFUSED` lines per session. Browsers log these at
// the network layer regardless of try/catch, so the only way to
// silence the noise is to NOT make the fetch.
//
// Trade-off: while ANY consumer is in suppress mode, ALL local-probe
// readers see `available=false` and `health=null` — including other
// open tabs (e.g. Agent Triggers). This is acceptable because:
//   1. Typical user has one SAP-related tab open at a time.
//   2. Fleet-mode users are saying "I don't have / don't care about
//      a local agent" — surfaces that DO depend on the local agent
//      can fall back to fleet routing or render the same neutral
//      "Local agent offline" copy our gating fix already surfaces.
//   3. `unsuppressLocalProbe(token)` immediately fires a fresh probe
//      so the "back to local" transition resolves within ~1.5s
//      instead of waiting for the next 15s tick.
//
// Consumer protocol: each consumer that wants to suppress mints a
// unique `Symbol()` token, calls `suppressLocalProbe(token)` on opt-in,
// and `unsuppressLocalProbe(token)` on cleanup. Suppression is active
// while the registry is non-empty.
const localProbeSuppressors = new Set<symbol>()

export function suppressLocalProbe(token: symbol): void {
  if (localProbeSuppressors.has(token)) return
  localProbeSuppressors.add(token)
  // Reset the local snapshot to "missing" so consumers see a coherent
  // state (rather than stale lastHealth left over from before the
  // user flipped to fleet mode).
  if (lastHealth !== null || lastAuthenticated) {
    lastHealth = null
    lastAuthenticated = false
    republish()
  }
}

export function unsuppressLocalProbe(token: symbol): void {
  if (!localProbeSuppressors.has(token)) return
  localProbeSuppressors.delete(token)
  // Trigger an immediate probe on un-suppression so the toggle's
  // "back to Local Agent" transition resolves snappily — the user
  // doesn't want to wait for the next 15s tick to find out their
  // local agent is up.
  if (localProbeSuppressors.size === 0) {
    void probeOnce()
  }
}

function isLocalProbeSuppressed(): boolean {
  return localProbeSuppressors.size > 0
}

/** Pull a friendly display name out of the /health body. Falls back to
 *  the host portion of AGENT_URL so the UI always has something to show. */
function deriveAgentName(health: AgentHealth | null): string | null {
  if (!health?.ok) return null
  const citrix = health.citrix
  const host = citrix?.computer_name || citrix?.client_name || ''
  const session = citrix?.session_name ? ` (${citrix.session_name})` : ''
  if (host) return `${host}${session}`
  // Strip protocol so the label is short.
  try {
    return new URL(AGENT_URL).host
  } catch {
    return AGENT_URL
  }
}

function buildSnapshot(
  health: AgentHealth | null,
  authenticated: boolean,
  fleet: FleetSnapshot
): AgentDetection {
  const available = !!health?.ok
  // Identity-stable closures — these read the captured args so consumers
  // don't need to thread the response themselves.
  const localHasCap = (cap: string) => agentHasCapability(health, cap)
  const fleetHasCap = (cap: string) =>
    fleet.agents.some((a) => a.capabilities.includes(cap))
  const bestAgentFor = (cap: string): 'local' | 'fleet' | null => {
    const localRecent = Date.now() - lastProbeAt < LOCAL_RECENT_MS
    if (available && localRecent && localHasCap(cap)) return 'local'
    if (fleetHasCap(cap)) return 'fleet'
    return null
  }
  return {
    available,
    authenticated: available && authenticated,
    health,
    agentName: deriveAgentName(health),
    hasCapability: localHasCap,
    fleet,
    fleetHasCapability: fleetHasCap,
    bestAgentFor,
  }
}

/** Re-publish the current snapshot using the latest local + fleet state.
 *  Called by both the local probe (after a /health round-trip) and the
 *  fleet probe (after a Supabase sap_agents query) so listeners see
 *  fresh data regardless of which leg ticked. */
function republish() {
  cachedSnapshot = buildSnapshot(lastHealth, lastAuthenticated, fleetState)
  for (const listener of listeners) {
    listener(cachedSnapshot)
  }
}

/**
 * v1.6.5 — second-leg probe that calls `/agent-token/check` (auth-required)
 * to verify the localStorage token is still valid. Returns:
 *   - true  → 200 OK, token valid.
 *   - false → 401 (stale token) OR /agent-token/check missing on
 *             pre-v1.6.5 agents (we treat the 404 as "skip this leg
 *             and trust /health" — same as the legacy behaviour).
 *   - null  → network error / timeout (we'll keep last known state
 *             rather than flap on transient errors).
 */
async function probeAuthenticated(
  health: AgentHealth | null
): Promise<boolean | null> {
  // No /health → don't bother with the auth probe; the agent is down.
  if (!health?.ok) return false
  // No token in localStorage → user hasn't connected yet. From the
  // detection hook's POV that's still "not authenticated" but it's
  // not a stale-token recovery scenario.
  if (!getAgentToken()) return false
  // Pre-v1.6.5 agents won't have /agent-token/check at all. Capability
  // gate so we don't spam 404s on older builds.
  if (
    Array.isArray(health.capabilities) &&
    !health.capabilities.includes('agent-token-check')
  ) {
    return true // legacy assume-authenticated (matches pre-v1.6.5 UX)
  }
  try {
    // Suppress the toast so a single 401 here doesn't spam the user —
    // we'll surface the state via the banner instead.
    const res = await agentFetch(
      '/agent-token/check',
      {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        cache: 'no-store',
      },
      { suppressStaleToast: true }
    )
    if (res.ok) return true
    if (res.status === 401) return false
    // Other non-2xx (404, 500, etc.) — treat as "can't tell", keep
    // last known.
    return null
  } catch {
    return null
  }
}

async function probeOnce(): Promise<void> {
  if (inFlightProbe) return inFlightProbe
  // 2026-05-09 — short-circuit when a consumer (Inventory Management
  // tab in fleet mode, today) has registered a suppress request. This
  // is the FIX for the `ERR_CONNECTION_REFUSED` console-spam bug —
  // skipping the fetch is the only way to keep the browser's network-
  // layer error logging silent (try/catch in JS doesn't suppress the
  // browser's DevTools console line). We still tick `lastProbeAt` so
  // `bestAgentFor()`'s LOCAL_RECENT_MS check stays coherent — a
  // suppressed snapshot is treated as "fresh and known to be
  // missing" rather than "stale and unknown".
  if (isLocalProbeSuppressed()) {
    if (lastHealth !== null || lastAuthenticated) {
      lastHealth = null
      lastAuthenticated = false
    }
    lastProbeAt = Date.now()
    republish()
    return
  }
  inFlightProbe = (async () => {
    let healthBody: AgentHealth | null = null
    try {
      const res = await agentFetch(
        '/health',
        {
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          cache: 'no-store',
        },
        { suppressStaleToast: true }
      )
      if (res.ok) {
        healthBody = (await res.json()) as AgentHealth
      }
    } catch {
      healthBody = null
    }
    let authed: boolean
    if (!healthBody?.ok) {
      authed = false
    } else {
      const result = await probeAuthenticated(healthBody)
      // null = transient — keep the previously-known authenticated flag
      // so a flaky probe doesn't oscillate the banner.
      authed = result === null ? lastAuthenticated : result
    }
    lastHealth = healthBody
    lastAuthenticated = authed
    lastProbeAt = Date.now()
    republish()
    inFlightProbe = null
  })()
  return inFlightProbe
}

/**
 * v1.6.6 — fleet probe. Reads online agents in the user's org.
 *
 * Phase 3 of the rust-work-service full-integration plan
 * (2026-05-06): the bootstrap snapshot now goes through
 * `GET /api/v1/sap-agents/fleet` (server-side joined, server-side org
 * scoping, server-side capability decode). The previous direct
 * `supabase.from('sap_agents')` SELECT is kept as a one-release
 * safety net — if the work-service is unreachable (network blip,
 * cold deploy, regional outage) we transparently fall back to the
 * Supabase REST path so the local-vs-fleet routing decision still
 * resolves. Phase 11 of the plan deletes the fallback entirely once
 * the new path has soaked in production.
 *
 * v1.7.4 — `auth.getUser()` → `auth.getSession()` + cached org_id.
 *   `getUser()` round-trips the GoTrue server on every call;
 *   `getSession()` reads localStorage (synchronous IO, no network).
 *   We also pull `organization_id` from the auth-provider-managed
 *   cache rather than re-querying `user_profiles` once per tick — at
 *   a 15s cadence × 50 users × 3 fleet hooks, that alone was ~600
 *   req/min of redundant `user_profiles` selects.
 */
async function probeFleetOnce(): Promise<void> {
  if (inFlightFleetProbe) return inFlightFleetProbe
  inFlightFleetProbe = (async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData.session?.user?.id ?? null
      if (!userId) {
        // Anonymous web session — nothing to fetch, nothing to publish
        // unless we previously had something cached (rare; on logout we
        // want to drop the fleet immediately).
        if (fleetState.agents.length > 0) {
          fleetState = EMPTY_FLEET
          republish()
        }
        return
      }
      const orgId = getCurrentOrgId()
      if (!orgId) {
        // Profile hasn't hydrated yet (first-tick race) OR user has no
        // org. Either way, empty fleet + bail. The auth state listener
        // will fire a re-publish once the profile lands.
        if (fleetState.agents.length > 0) {
          fleetState = EMPTY_FLEET
          republish()
        }
        return
      }

      let next: FleetSnapshot | null = null
      try {
        // Phase 3 happy path — server-owned snapshot. Capabilities are
        // requested explicitly because `bestAgentFor()` consumes them
        // for routing decisions.
        const fleetRows = await getFleet({
          status: 'online',
          includeCapabilities: true,
        })
        next = {
          online: fleetRows.length,
          agents: fleetRows.map((r) => ({
            id: r.id,
            version: r.version,
            capabilities: Array.isArray(r.capabilities) ? r.capabilities : [],
            last_seen_at: r.last_seen_at,
            sap_system: r.sap_system,
            sap_client: r.sap_client,
            hostname: r.hostname,
            citrix_session: r.citrix_session,
          })),
        }
      } catch {
        // TODO(rust-work-service Phase 11): delete this fallback once
        // the work-service path has soaked in production. Today we
        // keep the original Supabase REST query as a safety net so a
        // work-service outage doesn't blank the routing decision —
        // SmartImportButton, ImportLt22Dialog, and the agent banner
        // all consult the snapshot synchronously.
        // sap_agents is added in migration 247 — generated DB types
        // don't include it yet, so cast through to bypass the typed
        // overload. Same pattern as agents-fleet-card.tsx +
        // import-lt22-dialog.tsx.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const client = supabase as any
        const { data, error } = await client
          .from('sap_agents')
          .select(
            'id, version, capabilities, last_seen_at, sap_system, sap_client, hostname, citrix_session, status'
          )
          .eq('organization_id', orgId)
          .eq('status', 'online')
          .order('id', { ascending: true })
        if (error) return // silent; keep last known
        const rows = (data ?? []) as Array<{
          id: string
          version: string | null
          capabilities: string[] | null
          last_seen_at: string | null
          sap_system: string | null
          sap_client: string | null
          hostname: string | null
          citrix_session: string | null
        }>
        next = {
          online: rows.length,
          agents: rows.map((r) => ({
            id: r.id,
            version: r.version,
            capabilities: Array.isArray(r.capabilities) ? r.capabilities : [],
            last_seen_at: r.last_seen_at,
            sap_system: r.sap_system,
            sap_client: r.sap_client,
            hostname: r.hostname,
            citrix_session: r.citrix_session,
          })),
        }
      }

      fleetState = next
      lastFleetProbeAt = Date.now()
      republish()
      // 2026-05-06 — lazy-wire the WS handler + connection once we know
      // the org id. (Was previously the
      // `supabase.channel('omniframe-agent-detection-fleet')` setup.)
      // Kept on the fleet-probe path (rather than eagerly in
      // `startFleetPoller`) because the org id is resolved here.
      ensureFleetWsHandler(orgId)
    } catch {
      // network blip / RLS hiccup — keep last known fleet
    } finally {
      inFlightFleetProbe = null
    }
  })()
  return inFlightFleetProbe
}

function ensureStaleListener() {
  if (staleListenerWired) return
  staleListenerWired = true
  if (typeof window === 'undefined') return
  window.addEventListener(AGENT_TOKEN_STALE_EVENT, () => {
    // Fast-path: flip authenticated → false immediately so banners
    // react without waiting for the next tick. The next probeOnce()
    // will reaffirm the state.
    if (lastAuthenticated) {
      lastAuthenticated = false
      republish()
    }
    // Kick off a fresh probe so the snapshot fully reconciles.
    void probeOnce()
  })
}

/**
 * v1.7.4 — visibility-aware cadence. When the tab is hidden, the user
 * isn't looking, and every poll is a waste: /health hits the local
 * agent process (cheap per-call, but cumulative in Citrix), and the
 * fleet probe hits Supabase (not cheap at all).
 *
 * Approach: one shared `setInterval` per poller that we restart (and
 * whose delay we swap) on visibilitychange. On show, we also fire an
 * immediate probe so the snapshot is fresh by the time the user's
 * first interaction reads it.
 */
function getPollInterval(): number {
  if (typeof document === 'undefined') return POLL_INTERVAL_VISIBLE_MS
  return document.visibilityState === 'hidden'
    ? POLL_INTERVAL_HIDDEN_MS
    : POLL_INTERVAL_VISIBLE_MS
}

function rescheduleLocalPoller() {
  if (!pollerHandle) return
  clearInterval(pollerHandle)
  pollerHandle = setInterval(() => {
    void probeOnce()
  }, currentPollIntervalMs)
}

// 2026-05-06 — the fleet poller no longer rides the
// foreground/background visibility cadence; it is a fixed 5-min safety
// net only (Rust WS push handles the snappy path). `rescheduleLocalPoller`
// stays — local /health probing is unrelated to the fleet migration.

function handleVisibilityChange() {
  const next = getPollInterval()
  if (next === currentPollIntervalMs) return
  currentPollIntervalMs = next
  rescheduleLocalPoller()
  if (
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible'
  ) {
    // Immediate probe on tab-show so the UI isn't reading a
    // minute-old snapshot. The fleet probe still fires unconditionally
    // here (one-shot, not a setInterval) so a Rust-WS-disconnected user
    // who tabs back gets a fresh snapshot.
    void probeOnce()
    void probeFleetOnce()
  }
}

function ensureVisibilityListener() {
  if (visibilityListenerWired) return
  if (typeof document === 'undefined') return
  visibilityListenerWired = true
  document.addEventListener('visibilitychange', handleVisibilityChange)
}

function startPoller() {
  if (pollerHandle) return
  ensureStaleListener()
  ensureVisibilityListener()
  currentPollIntervalMs = getPollInterval()
  // Kick off an immediate probe (don't wait currentPollIntervalMs for
  // the first reading) and schedule subsequent ones at the
  // visibility-aware cadence.
  void probeOnce()
  pollerHandle = setInterval(() => {
    void probeOnce()
  }, currentPollIntervalMs)
  startFleetPoller()
}

function stopPoller() {
  if (pollerHandle) {
    clearInterval(pollerHandle)
    pollerHandle = null
  }
  stopFleetPoller()
}

/**
 * 2026-05-06 — fleet poller + WS subscription. Same lifecycle as the
 * local poller (started on first listener, torn down on last). The WS
 * push (driven by `WsEvent::SapAgentChanged` in `rust-work-service`,
 * via the `sap_agent_changed` Postgres NOTIFY trigger added in
 * migration 270) is the snappy path; the safety-net interval is a
 * 5-minute backstop that ONLY fires while the WS is not connected.
 *
 * Previously this used `supabase.channel('omniframe-agent-detection-
 * fleet')` for the snappy path and a 15s/60s visible/hidden interval
 * for the safety net. The migration retires the highest-fanout
 * Realtime consumer in the app per the roadmap in
 * `[[Decisions/Roadmap-Rust-WS-Unlocks]]`.
 *
 * The WS handler is wired lazily inside `probeFleetOnce` once the
 * caller's org_id is known (see `ensureFleetWsHandler` below).
 */
function startFleetPoller() {
  if (fleetSafetyNetHandle) return
  void probeFleetOnce()
  fleetSafetyNetHandle = setInterval(() => {
    // Skip the refetch on the happy path — the WS push is keeping the
    // snapshot fresh. Only fire when the WS isn't currently connected
    // (disconnected / connecting / reconnecting / unavailable).
    if (workServiceWs.getConnectionState() === 'connected') return
    void probeFleetOnce()
  }, FLEET_SAFETY_NET_INTERVAL_MS)
}

/**
 * 2026-05-06 — (re)attach the `WsEvent::SapAgentChanged` handler on
 * the singleton `WorkServiceWebSocket` and ensure the singleton is
 * connected to the user's org. Replaces the prior Supabase Realtime
 * channel — same intent (snappy fleet refresh), routed through the
 * Rust per-org fan-out instead.
 *
 * If the org id changes (sign-out → sign-in as different user on the
 * same tab), the prior handler is removed first. The singleton's
 * `removeHandler` will tear down the underlying WS only if no other
 * consumers (use-pushed-work, use-active-workers, …) are still
 * registered.
 */
function ensureFleetWsHandler(orgId: string) {
  if (fleetWsHandler && fleetWsHandlerOrgId === orgId) return
  if (fleetWsHandler) {
    try {
      workServiceWs.removeHandler(fleetWsHandler)
    } catch {
      /* ignore */
    }
    fleetWsHandler = null
    fleetWsHandlerOrgId = null
  }
  const handler: WsEventHandler = (event: WsEvent) => {
    if (event.type !== 'SapAgentChanged') return
    // Belt-and-braces org check — the Rust send loop already filters
    // org-scoped events to the matching subscriber, but a defence-in-
    // depth check here means a future protocol bug or a misconfigured
    // dev server can never leak cross-org rows into our snapshot.
    if (event.organization_id && event.organization_id !== orgId) return
    void probeFleetOnce()
  }
  try {
    workServiceWs.connect(orgId, handler)
    fleetWsHandler = handler
    fleetWsHandlerOrgId = orgId
  } catch {
    // WS setup failure is non-fatal — the safety-net timer keeps the
    // fleet snapshot fresh, just less snappy on status flips.
  }
}

function stopFleetPoller() {
  if (fleetSafetyNetHandle) {
    clearInterval(fleetSafetyNetHandle)
    fleetSafetyNetHandle = null
  }
  if (fleetWsHandler) {
    try {
      workServiceWs.removeHandler(fleetWsHandler)
    } catch {
      /* ignore */
    }
    fleetWsHandler = null
    fleetWsHandlerOrgId = null
  }
}

export function useAgentDetection(): AgentDetection {
  const [snapshot, setSnapshot] = useState<AgentDetection>(cachedSnapshot)

  useEffect(() => {
    listeners.add(setSnapshot)

    // If the cache is stale (>1.5× foreground poll interval) trigger a
    // fresh probe so the new mount doesn't surface obviously-out-of-date
    // data. We intentionally use the VISIBLE cadence as the staleness
    // floor regardless of tab state — the user just mounted something,
    // so they're clearly looking.
    if (Date.now() - lastProbeAt > POLL_INTERVAL_VISIBLE_MS * 1.5) {
      void probeOnce()
    } else {
      // Otherwise just hand the consumer the cached snapshot immediately.
      setSnapshot(cachedSnapshot)
    }
    if (Date.now() - lastFleetProbeAt > POLL_INTERVAL_VISIBLE_MS * 1.5) {
      void probeFleetOnce()
    }

    if (listeners.size === 1) {
      startPoller()
    }

    return () => {
      listeners.delete(setSnapshot)
      if (listeners.size === 0) {
        stopPoller()
      }
    }
  }, [])

  return snapshot
}

/**
 * Force an immediate health + fleet probe. Used by callers that just
 * performed an action that should change the agent's state (e.g. the
 * user just launched the agent EXE, or a fleet agent just came online
 * via the agents-fleet-card refresh button) — speeds up the next UI
 * tick on both legs.
 */
export function refreshAgentDetection(): Promise<void> {
  return Promise.all([probeOnce(), probeFleetOnce()]).then(() => undefined)
}

// Created and developed by Jai Singh
