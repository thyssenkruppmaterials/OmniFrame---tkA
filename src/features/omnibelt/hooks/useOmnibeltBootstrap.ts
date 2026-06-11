// Created and developed by Jai Singh
/**
 * OmniBelt — Bootstrap Hook
 *
 * P2 of the OmniBelt MVP rollout (2026-05-24).
 *
 * Fetches the per-(org, user) bootstrap payload from the FastAPI proxy
 * (which proxies to `rust-dashboard-service` for the cached read with
 * Supabase replica fallback).
 *
 * Cache budget per spec §15.2:
 *   - `staleTime: 5 * 60_000` (5 min) — typical user-session-life cache
 *   - `gcTime: 30 * 60_000`   (30 min) — keep across route changes
 *
 * Invalidation is event-driven via `WsEvent::OmnibeltConfigChanged`
 * (see `useOmnibeltConfigInvalidator`) — there are NO setInterval /
 * refetchInterval callsites here; aligns with the polling-reduction
 * posture in the realtime policy and ADR-Scaling-Roadmap-To-100k.
 *
 * Skipped while unauthenticated to avoid 401 noise during sign-in /
 * sign-out transitions.
 *
 * ## Resilience posture (2026-05-24)
 *
 * Bootstrap MUST degrade quietly when the FastAPI backend at :8000 is
 * unreachable (e.g. local dev without `python start.py`, transient
 * Rust outage, Railway redeploy). Mirrors the local-circuit-breaker
 * pattern from [[Realtime-Presence-Browser-Hardening]] §Layer 2 but
 * sized to the bootstrap workload:
 *
 *   1. `placeholderData` — launcher renders the kill-switch-OFF /
 *      no-restriction default immediately so the host chrome never
 *      flashes blank on a cold load.
 *   2. Typed errors — `BootstrapAuthError` / `BootstrapValidationError`
 *      bypass `retry`; only `BootstrapNetworkError` (5xx, ECONNREFUSED,
 *      `TypeError('Failed to fetch')`) is retried, once, after an
 *      exponential delay capped at 30 s.
 *   3. Local circuit breaker — after 3 consecutive network failures
 *      the query is disabled for a 5-minute cooldown. Auto-resumes
 *      via `setTimeout`; tests can reset state with
 *      `__resetBootstrapCircuitBreakerForTests()`.
 *   4. Dedup logging — `logger.warn` fires ONCE per cooldown cycle
 *      with an actionable hint ("start FastAPI at :8000"), not on
 *      every retry. No `console.error` flood.
 */
import { useSyncExternalStore } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/auth-fetch'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { logger } from '@/lib/utils/logger'
import {
  BootstrapNetworkError,
  BootstrapValidationError,
  classifyResponse,
  isAuthError,
  isNetworkError,
  isValidationError,
} from '../lib/bootstrap-errors'

/** Mirror of the Rust `OmnibeltBootstrap` struct in
 * `rust-dashboard-service/src/omnibelt.rs`. Optional fields stay
 * loosely typed to absorb future shape changes (e.g. additional
 * `kill_switch.source` values). */
export interface OmnibeltBootstrap {
  kill_switch: {
    enabled: boolean
    source: 'env' | 'org' | 'none' | string
  }
  role_config: OmnibeltRoleConfigPayload | null
  user_prefs: OmnibeltUserPrefsPayload | null
  allow_list: string[]
  tool_registry_version: number
  initial_active_jobs: OmnibeltActiveJob[]
}

export interface OmnibeltRoleConfigPayload {
  id: string
  organization_id: string
  role_id: string
  default_tool_ids: string[]
  default_pinned_ids: string[]
  default_position: Record<string, unknown>
  default_skin: 'pill' | 'orb' | 'skystrip' | string
  updated_at: string
  updated_by: string | null
}

export interface OmnibeltUserPrefsPayload {
  user_id: string
  organization_id: string
  pinned_tool_ids: string[]
  hidden_tool_ids: string[]
  tool_order: string[]
  position_by_route: Record<string, unknown>
  skin: string | null
  mach3_behavior: string
  auto_hide_after_seconds: number
  user_hidden: boolean
  updated_at: string
}

export interface OmnibeltActiveJob {
  id: string
  job_type: string
  label: string
  progress: number
  started_at: number
  started_by_current_user: boolean
  cancelable: boolean
  cancel_url?: string
}

export const OMNIBELT_BOOTSTRAP_QUERY_KEY_BASE = 'omnibelt' as const
export const OMNIBELT_BOOTSTRAP_QUERY_KEY_KIND = 'bootstrap' as const

/**
 * Build the canonical query key for a given user. The base+kind tuple
 * (`['omnibelt', 'bootstrap']`) is used by
 * `useOmnibeltConfigInvalidator` for prefix-style invalidation —
 * `queryClient.invalidateQueries({ queryKey: ['omnibelt', 'bootstrap'] })`
 * matches every per-user variant.
 */
export function omnibeltBootstrapQueryKey(userId: string | null) {
  return [
    OMNIBELT_BOOTSTRAP_QUERY_KEY_BASE,
    OMNIBELT_BOOTSTRAP_QUERY_KEY_KIND,
    userId,
  ] as const
}

/**
 * Fail-closed default the launcher renders while bootstrap is in
 * flight OR after the circuit breaker has tripped. `enabled: true`
 * keeps the chrome visible (the org kill-switch is a separate hook —
 * `useOmnibeltVisibility` — so a real disable still takes effect).
 * Empty `allow_list` is treated as "no restriction" by
 * `useResolvedTools` so the v1 tool roster stays usable while
 * offline.
 */
export const OMNIBELT_BOOTSTRAP_PLACEHOLDER: OmnibeltBootstrap = Object.freeze({
  kill_switch: { enabled: true, source: 'none' },
  role_config: null,
  user_prefs: null,
  allow_list: [],
  tool_registry_version: 1,
  initial_active_jobs: [],
}) as OmnibeltBootstrap

// ─────────────────────────────────────────────────────────────────────
// Local circuit breaker (module-scoped, shared by every consumer).
// ─────────────────────────────────────────────────────────────────────

/** 3 consecutive network failures trip the breaker. Tighter than the
 *  presence-channel default (5) because the bootstrap query also
 *  consumes the retry budget once per attempt. */
const CIRCUIT_FAILURE_THRESHOLD = 3
/** 5-minute cooldown — long enough to ride out a deploy or local
 *  FastAPI restart, short enough that a forgetful dev's launcher
 *  recovers on its own. Mirrors the presence-channel default. */
const CIRCUIT_COOLDOWN_MS = 5 * 60_000

let consecutiveFailures = 0
let circuitTripped = false
let cooldownTimer: ReturnType<typeof setTimeout> | null = null
/** Set ONCE per cooldown cycle so we don't re-warn on every retry.
 *  Cleared by `recordSuccess()` and by the cooldown reset. */
let warnedThisCycle = false

const circuitListeners = new Set<() => void>()
function notifyCircuit(): void {
  for (const fn of circuitListeners) fn()
}
function subscribeCircuit(fn: () => void): () => void {
  circuitListeners.add(fn)
  return () => {
    circuitListeners.delete(fn)
  }
}
function getCircuitSnapshot(): boolean {
  return circuitTripped
}
/** SSR snapshot — the circuit can never be tripped at hydration
 *  time, so always returning `false` keeps server-rendered HTML in
 *  sync with the first client paint. */
function getCircuitServerSnapshot(): boolean {
  return false
}

function recordSuccess(): void {
  if (consecutiveFailures > 0) consecutiveFailures = 0
  warnedThisCycle = false
  if (circuitTripped) {
    circuitTripped = false
    if (cooldownTimer) {
      clearTimeout(cooldownTimer)
      cooldownTimer = null
    }
    logger.info(
      '[OmniBelt] bootstrap recovered — circuit closed, backend reachable again'
    )
    notifyCircuit()
  }
}

function recordFailure(error: unknown): void {
  consecutiveFailures += 1

  if (!warnedThisCycle) {
    warnedThisCycle = true
    logger.warn(
      '[OmniBelt] bootstrap unreachable; using local defaults — start FastAPI at :8000 to enable full functionality',
      error
    )
  }

  if (consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD && !circuitTripped) {
    circuitTripped = true
    if (cooldownTimer) clearTimeout(cooldownTimer)
    cooldownTimer = setTimeout(() => {
      // Half-open: clear the trip + counter so the next query attempt
      // can succeed and call `recordSuccess()`. If it fails again, we
      // re-trip on the next failure threshold breach.
      circuitTripped = false
      consecutiveFailures = 0
      warnedThisCycle = false
      cooldownTimer = null
      logger.info(
        '[OmniBelt] bootstrap circuit half-open after 5 min cooldown — retrying on next consumer mount'
      )
      notifyCircuit()
    }, CIRCUIT_COOLDOWN_MS)
    logger.warn(
      `[OmniBelt] bootstrap circuit OPEN after ${CIRCUIT_FAILURE_THRESHOLD} consecutive failures — pausing fetches for ${
        CIRCUIT_COOLDOWN_MS / 60_000
      } min`
    )
    notifyCircuit()
  }
}

/**
 * Test-only — clears circuit-breaker state between cases. NEVER call
 * from production code; the underscore prefix is the project's
 * convention for "tests are the only legitimate consumer".
 */
export function __resetBootstrapCircuitBreakerForTests(): void {
  consecutiveFailures = 0
  circuitTripped = false
  warnedThisCycle = false
  if (cooldownTimer) {
    clearTimeout(cooldownTimer)
    cooldownTimer = null
  }
  notifyCircuit()
}

/** Test-only — drives a failure synchronously without going through
 *  the network mock. Lets the circuit-breaker contract be verified as
 *  a unit instead of dancing with TanStack's retry timers. */
export function __recordBootstrapFailureForTests(error: unknown): void {
  recordFailure(error)
}

/** Test-only — observe the breaker without `useSyncExternalStore`. */
export function __isBootstrapCircuitOpenForTests(): boolean {
  return circuitTripped
}

// ─────────────────────────────────────────────────────────────────────
// Fetch + hook.
// ─────────────────────────────────────────────────────────────────────

async function fetchOmnibeltBootstrap(): Promise<OmnibeltBootstrap> {
  let resp: Response
  try {
    // `apiFetch` injects `Authorization: Bearer <supabase access token>` —
    // the FastAPI proxy's `get_current_user` dependency reads the JWT
    // from the header (NOT from cookies). Without it every call here
    // returned `401 {"detail":"Authentication required"}` in production.
    resp = await apiFetch('/api/omnibelt/bootstrap', {
      method: 'GET',
    })
  } catch (cause) {
    // Native fetch failure (ECONNREFUSED via the Vite proxy, DNS,
    // offline, CORS preflight bounce). Reclassify as our typed
    // network error so TanStack Query's `retry` predicate can branch.
    const networkError = new BootstrapNetworkError(
      `OmniBelt bootstrap fetch failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      cause
    )
    recordFailure(networkError)
    throw networkError
  }

  if (!resp.ok) {
    const typed = await classifyResponse(resp)
    // Only network errors feed the circuit breaker — auth and
    // validation failures are sticky-by-shape, not transient.
    if (isNetworkError(typed)) recordFailure(typed)
    throw typed
  }

  let data: OmnibeltBootstrap
  try {
    data = (await resp.json()) as OmnibeltBootstrap
  } catch (cause) {
    throw new BootstrapValidationError(
      `OmniBelt bootstrap JSON parse failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      resp.status,
      cause
    )
  }

  recordSuccess()
  logger.debug('[OmniBelt] bootstrap fetched', {
    enabled: data.kill_switch?.enabled,
    source: data.kill_switch?.source,
    hasRoleConfig: Boolean(data.role_config),
    hasUserPrefs: Boolean(data.user_prefs),
    allowListLen: data.allow_list?.length ?? 0,
    toolRegistryVersion: data.tool_registry_version,
  })
  return data
}

export function useOmnibeltBootstrap(): UseQueryResult<OmnibeltBootstrap> {
  const { authState } = useUnifiedAuth()
  const userId = authState.user?.id ?? null
  const isAuthenticated = authState.isAuthenticated

  // `useSyncExternalStore` keeps every consumer re-rendered in lock
  // step with the breaker state without re-fetching. When tripped,
  // `enabled: false` short-circuits the query (no fetch fired); the
  // last-known `data` (or the placeholder on first mount) keeps
  // rendering.
  const circuitOpen = useSyncExternalStore(
    subscribeCircuit,
    getCircuitSnapshot,
    getCircuitServerSnapshot
  )

  return useQuery<OmnibeltBootstrap>({
    queryKey: omnibeltBootstrapQueryKey(userId),
    queryFn: fetchOmnibeltBootstrap,
    enabled: isAuthenticated && Boolean(userId) && !circuitOpen,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Only retry transient network errors. Auth / validation errors
    // are sticky-by-shape; retrying them just doubles the dev-console
    // noise without any chance of success.
    retry: (failureCount, error) => {
      if (isAuthError(error) || isValidationError(error)) return false
      return failureCount < 1
    },
    // Exponential backoff capped at 30 s so a missing FastAPI doesn't
    // hit the proxy every few hundred ms. With `retry: 1` the only
    // delay we'll observe in practice is the first one (~2 s).
    retryDelay: (attempt) => Math.min(30_000, 1000 * 2 ** attempt),
    // Launcher renders this synthetic payload while the real one is
    // loading OR while the circuit breaker is open. Frozen so a
    // careless consumer can't mutate the singleton.
    placeholderData: OMNIBELT_BOOTSTRAP_PLACEHOLDER,
  })
}

// Created and developed by Jai Singh
