// Created and developed by Jai Singh
/**
 * useExecutionMode — fleet-vs-local routing for the SAP Testing
 * Inventory Management tab (2026-05-09).
 *
 * Generalises the LT22 fleet-routing pattern documented in
 * `Patterns/Fleet-Aware-Smart-Routing` so EVERY in-scope inventory
 * action (LT10/MB52/MMBE queries, ZMM60 lookup, LT01 transfer, MM02
 * material-master, LS01N create-bin) can flip between two execution
 * modes via a single toggle:
 *
 *   - 'local' — browser → `localhost:8765` → on-prem Omni Agent →
 *     SAP GUI on the SAME machine (today's default).
 *   - 'fleet' — browser → `sap_agent_jobs` row INSERT (claim-pinned to
 *     the picked fleet agent) → fleet agent on a different Citrix
 *     box → SAP GUI on that box → result returns via the same
 *     `WsEvent::SapJobStatusChanged` channel `useJobQueue` already
 *     consumes.
 *
 * The hook owns:
 *   - localStorage persistence of `mode` + `fleetAgentId`
 *     (`omniframe.sap-testing.inventory.executionMode` /
 *      `omniframe.sap-testing.inventory.fleetAgentId`).
 *   - Capability + online-status validation against the picked fleet
 *     agent (via `useAgentDetection().fleet.agents`).
 *   - The `dispatch()` entry-point that BOTH paths funnel through —
 *     identical normalised return shape so call sites don't branch.
 *
 * Out-of-scope tools (SAP Recorder, Reversal Engine) bypass the toggle
 * entirely. They keep calling `agentFetch()` directly because the
 * recorder needs the live local SAP GUI session, and the reversal
 * engine's "compute inverse" is a synchronous-response shape that
 * doesn't fit a queue-claim round-trip.
 *
 * Why a separate hook (vs. extending `useAgentDetection`)
 * --------------------------------------------------------
 * `useAgentDetection.bestAgentFor(cap)` is the existing AUTO-routing
 * decision used by the SmartImportButton (it prefers local when both
 * paths work). The Inventory Management toggle is the OPPOSITE shape
 * — explicit user-controlled override. Mixing the two semantics in
 * one hook would force every consumer to disambiguate "did the user
 * pick this, or did the auto-router?" which is exactly the
 * confusion the toggle is meant to eliminate.
 *
 * Related:
 *   - [[Patterns/Fleet-Aware-Smart-Routing]]
 *   - [[Implementations/Implement-Fleet-Aware-SmartImportButton]]
 *   - [[Implementations/Implement-Inventory-Management-Fleet-Routing]]
 *     (this file's anchor design doc)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { agentFetch, LATEST_AGENT_VERSION } from '../lib/agent-fetch'
import {
  suppressLocalProbe,
  unsuppressLocalProbe,
  useAgentDetection,
  type FleetAgent,
} from './use-agent-detection'
import { useJobQueue, type SapAgentJobRow } from './use-job-queue'

// ─────────────────────────────────────────────────────────────────────
// Storage keys
// ─────────────────────────────────────────────────────────────────────
const STORAGE_PREFIX = 'omniframe.sap-testing.inventory.'
const KEY_MODE = `${STORAGE_PREFIX}executionMode`
const KEY_FLEET_AGENT_ID = `${STORAGE_PREFIX}fleetAgentId`

// ─────────────────────────────────────────────────────────────────────
// 2026-05-10 — boot-time local-probe suppression token.
//
// Without this, the very first `probeOnce()` invocation inside
// `useAgentDetection.startPoller()` fires BEFORE any consumer has had
// a chance to call `suppressLocalProbe()` from a `useEffect`. React
// runs effects in declaration order: `useExecutionMode()` (which
// calls `useAgentDetection()` first thing) registers its effect
// before `inventory-management-tab.tsx` registers its
// suppress-on-fleet effect, so on page load in fleet mode the
// browser still logs one `ERR_CONNECTION_REFUSED` per session even
// after the suppression mechanism shipped.
//
// Reading `localStorage[KEY_MODE]` at MODULE load (before any React
// render) lets us pre-register a suppression token on the same tick
// the `useAgentDetection` module's `cachedSnapshot` is initialised —
// `startPoller()`'s first `probeOnce()` then short-circuits via
// `isLocalProbeSuppressed()` and the network call never goes out.
//
// `setMode` flips the suppression in lockstep with the user toggle so
// flipping back to 'local' synchronously un-suppresses (and the next
// `probeOnce()` re-resolves the local agent's state).
// ─────────────────────────────────────────────────────────────────────
const BOOT_FLEET_SUPPRESSION_TOKEN = Symbol(
  'use-execution-mode/boot-fleet-suppress'
)

try {
  if (
    typeof window !== 'undefined' &&
    typeof localStorage !== 'undefined' &&
    localStorage.getItem(KEY_MODE) === 'fleet'
  ) {
    suppressLocalProbe(BOOT_FLEET_SUPPRESSION_TOKEN)
  }
} catch {
  /* localStorage unavailable (SSR / test stub / disabled storage) */
}

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────
export type ExecutionMode = 'local' | 'fleet'

/** Per-call options recognised by `dispatch()`. None are required —
 *  defaults match the existing direct-fetch behaviour as closely as
 *  possible so a call site can swap `agentFetch` for `dispatch` with
 *  minimal changes. */
export interface DispatchOptions {
  /** Capability id used for fleet-mode routing validation. When set
   *  AND mode='fleet' AND the picked agent doesn't advertise the
   *  capability, dispatch rejects fast (no queue INSERT) so the user
   *  sees an inline failure instead of a stuck `queued` row that no
   *  agent will ever claim. Local mode does NOT validate capabilities
   *  here — `agentFetch` just calls and lets the agent 404 if it
   *  doesn't have the endpoint (existing behaviour). */
  capability?: string
  /** Job priority for the fleet-mode `sap_agent_jobs` INSERT.
   *  Defaults to 90 for interactive queries (jumps ahead of the
   *  default 100 used for background batch rows so a UI click feels
   *  snappy). Ignored in local mode. */
  priority?: number
  /** Per-call timeout for the fleet-mode wait. Defaults to 5min,
   *  matching `useJobQueue.submitAndWait`'s default. */
  timeoutMs?: number
  /** Optional idempotency key. Prevents duplicate enqueues if the
   *  user mashes the Run button. Defaults to a fresh `crypto.randomUUID()`
   *  per invocation when omitted. Ignored in local mode. */
  idempotencyKey?: string
  /** When true, fail BEFORE the network/queue submit if the picked
   *  fleet agent isn't online. Default true. */
  validateOnline?: boolean
}

/** Normalised dispatch response. Identical shape regardless of mode so
 *  call sites can `data.ok` / `data.error` / `data.<extra>` without
 *  branching on the routing decision.
 *
 *  T is intentionally bounded to `object` (not `Record<string, unknown>`)
 *  so caller-defined response types like `QueryResult` /
 *  `TransferInventoryResponse` / `BinBlocksResponse` (which use
 *  explicit fields without an index signature) flow through without
 *  the caller having to widen their interfaces. */
export type NormalizedDispatchResult<T extends object = object> = T & {
  ok: boolean
  error?: string
  step?: string
}

/** Composite gating signal returned by `executionMode.ready(capability?)`.
 *  Distinct from `canDispatch` — `canDispatch` keeps its existing
 *  semantics (fleet-only validation; local mode short-circuits to true so
 *  `dispatch()` falls through to `agentFetch`). `ReadinessReport` is the
 *  signal UI surfaces consume to decide WHETHER TO RENDER the "agent not
 *  detected" banner / disable the Run button / show the per-query "Start
 *  the SAP agent" pill. The two reports differ in local mode: dispatch
 *  cares whether the network call CAN go out (always true — the agent
 *  itself surfaces its 401/404), gating cares whether the user's pick is
 *  ACTUALLY READY (which considers `available` + `authenticated` +
 *  `hasCapability` for local mode). */
export interface ReadinessReport {
  /** True when the active mode + picked agent + (optional) capability
   *  combination is currently ready. */
  ok: boolean
  /** Human-readable reason. Null when `ok=true`. The copy is mode-aware
   *  and ready to drop into a tooltip / banner / per-query pill — it
   *  always names BOTH knobs the user can turn (e.g. "switch to Fleet
   *  Agent mode"), so the user always has an out. */
  reason: string | null
  /** Which side of the toggle the readiness check is gating against.
   *  Useful for picking the right call-to-action — `'local'` →
   *  AgentSupabaseStatusButton's "Reconnect Account" pill makes sense;
   *  `'fleet'` → the toggle's agent picker is the right thing to focus. */
  surface: 'local' | 'fleet'
}

export interface ExecutionModeApi {
  /** Active routing mode. Source of truth for the toggle UI. */
  mode: ExecutionMode
  /** Persist + broadcast a new mode. Defaults `fleetAgentId` to the
   *  first online fleet agent when flipping to 'fleet' with no prior
   *  pick (so the dropdown always has something resolved on first
   *  flip). */
  setMode: (mode: ExecutionMode) => void
  /** Picked fleet agent id (when mode='fleet'). May reference an
   *  agent that's gone offline since the last persist — consumers
   *  should consult `fleetAgent` (which resolves against the live
   *  `useAgentDetection().fleet.agents` snapshot). */
  fleetAgentId: string | null
  setFleetAgentId: (id: string | null) => void
  /** Resolved fleet agent — null when mode='local', when no agent is
   *  picked, or when the picked id no longer matches an online
   *  agent. */
  fleetAgent: FleetAgent | null
  /** Convenience flag — true when `mode === 'fleet'`. */
  isFleet: boolean
  /** True when dispatch() can route a call requiring `capability`
   *  RIGHT NOW. Local mode → ignores capability (matches existing
   *  agentFetch behaviour); fleet mode → requires the picked agent
   *  to be online AND advertise the capability. */
  canDispatch: (capability?: string) => boolean
  /** Human-readable reason `canDispatch` returns false. Null when
   *  canDispatch returns true. Useful for tooltip / inline-warning
   *  copy on disabled action buttons. */
  blockedReason: (capability?: string) => string | null
  /** Single dispatch entry-point. Same signature for both modes;
   *  callers don't branch.
   *
   *  Local mode: POSTs `{endpoint}` with `payload` and parses the
   *  JSON body — IDENTICAL to what `agentFetch(endpoint, {method:
   *  'POST', body: JSON.stringify(payload)})` returned before this
   *  hook landed.
   *
   *  Fleet mode: INSERTs a `sap_agent_jobs` row with
   *  `endpoint=<endpoint>`, `payload=<payload>`, `assigned_agent_id=
   *  fleetAgentId` so only the picked agent claims it. Awaits the
   *  row via the shared `useJobQueue.submitAndWait`. Unwraps
   *  `JobRow.result` and overlays `JobRow.error/step/status` so the
   *  return shape matches the local response.
   *
   *  Throws when the picked fleet agent doesn't advertise
   *  `options.capability`, when no fleet agent is picked at all, or
   *  when the queue path itself fails (network, RLS, agent claim
   *  mismatch, etc.). Caller is responsible for `try/catch` —
   *  matching today's `agentFetch` semantics. */
  dispatch: <T extends object = object>(
    endpoint: string,
    payload: Record<string, unknown>,
    options?: DispatchOptions
  ) => Promise<NormalizedDispatchResult<T>>
  /** Effective `assigned_agent_id` to send when calling other
   *  queue-aware APIs (e.g. the Phase 5 Material Master client).
   *  Returns `fleetAgentId` when mode='fleet', null when mode='local'
   *  (any agent claim). */
  getAssignedAgentId: () => string | null
  /** Composite gating signal — drives every "agent not detected" /
   *  "Start the SAP agent" UI surface in the Inventory Management tab.
   *  Returns `{ ok, reason, surface }` so call sites can decide
   *  WHETHER TO RENDER a warning AND show the right copy without
   *  branching on `mode` themselves. Pass the active query's
   *  `requiredCapability` to get a per-query report; pass nothing for
   *  a tab-level report. See `ReadinessReport` doc-block above for the
   *  per-mode logic + why this is distinct from `canDispatch`. */
  ready: (capability?: string) => ReadinessReport
}

// ─────────────────────────────────────────────────────────────────────
// Persistence helpers
// ─────────────────────────────────────────────────────────────────────
function readStoredMode(): ExecutionMode {
  try {
    const raw = localStorage.getItem(KEY_MODE)
    if (raw === 'fleet') return 'fleet'
  } catch {
    /* localStorage unavailable */
  }
  return 'local'
}

function readStoredFleetAgentId(): string | null {
  try {
    return localStorage.getItem(KEY_FLEET_AGENT_ID) || null
  } catch {
    return null
  }
}

function writeStoredMode(mode: ExecutionMode): void {
  try {
    localStorage.setItem(KEY_MODE, mode)
  } catch {
    /* ignore */
  }
}

function writeStoredFleetAgentId(id: string | null): void {
  try {
    if (id) localStorage.setItem(KEY_FLEET_AGENT_ID, id)
    else localStorage.removeItem(KEY_FLEET_AGENT_ID)
  } catch {
    /* ignore */
  }
}

// ─────────────────────────────────────────────────────────────────────
// The hook
// ─────────────────────────────────────────────────────────────────────
export function useExecutionMode(): ExecutionModeApi {
  const detection = useAgentDetection()
  const jobQueue = useJobQueue()

  const [mode, setModeState] = useState<ExecutionMode>(() => readStoredMode())
  const [fleetAgentId, setFleetAgentIdState] = useState<string | null>(() =>
    readStoredFleetAgentId()
  )

  // Persist mode whenever it changes. Using a useEffect (rather than
  // writing in setMode directly) so external mutations of the state
  // (e.g. test harnesses) stay in sync.
  useEffect(() => {
    writeStoredMode(mode)
  }, [mode])
  useEffect(() => {
    writeStoredFleetAgentId(fleetAgentId)
  }, [fleetAgentId])

  // 2026-05-10 — keep the boot-time local-probe suppression token in
  // lockstep with the live `mode` state. The module-level pre-suppress
  // covers the first-render race, this effect covers every subsequent
  // toggle. Idempotent — `suppress`/`unsuppress` no-op when the token
  // is already in (or out of) the registry.
  useEffect(() => {
    if (mode === 'fleet') {
      suppressLocalProbe(BOOT_FLEET_SUPPRESSION_TOKEN)
    } else {
      unsuppressLocalProbe(BOOT_FLEET_SUPPRESSION_TOKEN)
    }
  }, [mode])

  // Resolve the picked fleet agent against the live online snapshot
  // every render. When the persisted id no longer matches an online
  // agent (offline, removed, hostname rotation), `fleetAgent` is null
  // — `canDispatch` treats that the same as "no pick" and surfaces
  // the appropriate blockedReason.
  const fleetAgent = useMemo<FleetAgent | null>(() => {
    if (mode !== 'fleet' || !fleetAgentId) return null
    return detection.fleet.agents.find((a) => a.id === fleetAgentId) ?? null
  }, [mode, fleetAgentId, detection.fleet.agents])

  // 2026-05-10 — auto-recover from a stale persisted `fleetAgentId`.
  //
  // When a user iterates on the agent EXE the agent's primary key in
  // `public.sap_agents` may rotate (hostname swap, Citrix session
  // change, COMPUTERNAME change after a Citrix box re-image). The
  // previous pick then no longer matches any agent in the
  // `detection.fleet.agents` snapshot (which is filtered to
  // `status='online'` server-side). The dropdown's `<select
  // value={fleetAgentId}>` falls back to displaying the FIRST option
  // whose id doesn't match — visually it looks like the agent IS
  // selected, but `fleetAgent` resolves to null and BOTH the toggle's
  // "Pick a fleet agent above" warning AND the per-query gate's
  // "Picked fleet agent X is offline" warning fire simultaneously.
  //
  // Auto-promoting the picked id to the first online agent in that
  // case fixes the visible state in one render: the dropdown's
  // selection matches an option that exists, `fleetAgent` resolves,
  // both warnings disappear, and the user gets the working agent
  // they thought they had picked.
  //
  // We deliberately do NOT auto-promote when the fleet snapshot is
  // EMPTY — that's the genuine "no online agents" case the toggle
  // already surfaces with a different, clearer warning.
  useEffect(() => {
    if (mode !== 'fleet') return
    if (!fleetAgentId) return
    if (detection.fleet.agents.length === 0) return
    if (detection.fleet.agents.some((a) => a.id === fleetAgentId)) return
    const firstOnline = detection.fleet.agents[0]?.id
    if (firstOnline) setFleetAgentIdState(firstOnline)
  }, [mode, fleetAgentId, detection.fleet.agents])

  const setMode = useCallback(
    (next: ExecutionMode) => {
      setModeState(next)
      // Auto-pick the first online fleet agent when flipping to
      // 'fleet' for the first time. The user can override via the
      // dropdown immediately after; this just removes the
      // "click toggle → click dropdown → click an agent" three-step
      // hop on first use.
      if (next === 'fleet' && !readStoredFleetAgentId()) {
        const firstOnline = detection.fleet.agents[0]?.id ?? null
        if (firstOnline) setFleetAgentIdState(firstOnline)
      }
    },
    [detection.fleet.agents]
  )

  const setFleetAgentId = useCallback((id: string | null) => {
    setFleetAgentIdState(id)
  }, [])

  const canDispatch = useCallback(
    (capability?: string): boolean => {
      if (mode === 'local') {
        // Local mode mirrors agentFetch's existing semantics — the
        // caller pre-validates `agentStatus === 'connected'` at the
        // call site (we don't duplicate that check here because the
        // tab already consults `useAgentDetection` for the
        // status-bar). Local mode ALWAYS returns true so the dispatch
        // call falls through to a real fetch and surfaces the
        // network / 401 / 404 with the existing toast plumbing.
        return true
      }
      // Fleet mode requires (a) a picked agent, (b) the agent
      // currently online, and (c) the capability advertised.
      if (!fleetAgent) return false
      if (!capability) return true
      return fleetAgent.capabilities.includes(capability)
    },
    [mode, fleetAgent]
  )

  const blockedReason = useCallback(
    (capability?: string): string | null => {
      if (canDispatch(capability)) return null
      if (mode === 'local') return null // canDispatch always true; defensive
      if (!fleetAgentId) {
        return 'Pick a fleet agent in the toggle above, or switch to Local Agent mode.'
      }
      if (!fleetAgent) {
        return `Picked agent ${fleetAgentId} is offline. Pick another or switch to Local Agent mode.`
      }
      if (capability && !fleetAgent.capabilities.includes(capability)) {
        const label = fleetAgent.hostname || fleetAgent.id
        const ver = fleetAgent.version ? ` v${fleetAgent.version}` : ''
        return `${label}${ver} doesn't advertise '${capability}'. Pick another fleet agent or switch to Local Agent mode.`
      }
      return null
    },
    [canDispatch, mode, fleetAgentId, fleetAgent]
  )

  const dispatch = useCallback(
    async <T extends object = object>(
      endpoint: string,
      payload: Record<string, unknown>,
      options?: DispatchOptions
    ): Promise<NormalizedDispatchResult<T>> => {
      if (mode === 'local') {
        // Local fetch path — identical wire format to today's
        // `agentFetch` callers. We deliberately don't map non-2xx
        // status codes to thrown errors here because most call sites
        // already inspect `data.ok` and surface their own toasts; a
        // throw would change the failure path and could hide useful
        // `error` strings the agent put in the body.
        const res = await agentFetch(endpoint, {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        let data: NormalizedDispatchResult<T>
        try {
          data = (await res.json()) as NormalizedDispatchResult<T>
        } catch {
          // Body wasn't JSON — synthesise a minimal failure shape so
          // the caller's `data.ok` / `data.error` branches still work.
          data = {
            ok: false,
            error: `Agent returned ${res.status} ${res.statusText} (non-JSON body)`,
          } as NormalizedDispatchResult<T>
        }
        if (!res.ok && data.ok === undefined) {
          // The agent normally puts ok=false on a non-2xx response;
          // this branch is the defensive belt for cases where it
          // returns a 4xx with a body that lacks the `ok` field.
          data = {
            ...data,
            ok: false,
            error:
              data.error || `Agent returned ${res.status} ${res.statusText}`,
          }
        }
        return data
      }

      // Fleet path — pre-validate so we never enqueue a row no agent
      // can claim.
      const validateOnline = options?.validateOnline ?? true
      if (validateOnline) {
        if (!fleetAgentId) {
          throw new Error(
            'Fleet mode active but no fleet agent picked. Pick one in the toggle or switch to Local Agent mode.'
          )
        }
        if (!fleetAgent) {
          throw new Error(`Picked fleet agent ${fleetAgentId} is offline.`)
        }
        if (
          options?.capability &&
          !fleetAgent.capabilities.includes(options.capability)
        ) {
          const label = fleetAgent.hostname || fleetAgent.id
          throw new Error(
            `Fleet agent ${label} doesn't advertise '${options.capability}' — pick another agent or switch to Local Agent mode.`
          )
        }
      }

      const finalRow: SapAgentJobRow = await jobQueue.submitAndWait(
        {
          endpoint,
          payload,
          priority: options?.priority ?? 90,
          assignedAgentId: fleetAgentId ?? null,
          idempotencyKey: options?.idempotencyKey ?? crypto.randomUUID(),
        },
        { timeoutMs: options?.timeoutMs ?? 5 * 60_000 }
      )

      // Mirror the existing Phase 5 unwrap pattern from
      // `runMutation` in `inventory-management-tab.tsx` — overlay the
      // job row's terminal status / error / step OVER the agent's
      // result body so a row that PostgREST flipped to 'failed' (e.g.
      // claim-lease watchdog) still surfaces ok=false even if the
      // agent never wrote a result body. Spread `result` LAST so a
      // handler-returned `ok=false` (soft warning, etc.) wins over the
      // row-derived `ok=true`.
      return {
        ok: finalRow.status === 'completed',
        error: finalRow.error || undefined,
        step: finalRow.step || undefined,
        ...((finalRow.result ?? {}) as Record<string, unknown>),
      } as NormalizedDispatchResult<T>
    },
    [mode, fleetAgent, fleetAgentId, jobQueue]
  )

  const getAssignedAgentId = useCallback((): string | null => {
    if (mode === 'fleet' && fleetAgentId) return fleetAgentId
    return null
  }, [mode, fleetAgentId])

  const ready = useCallback(
    (capability?: string): ReadinessReport => {
      if (mode === 'local') {
        // Local mode — gate on `available` + `authenticated` so the UI
        // can SURFACE the right CTA (start the EXE vs. Reconnect
        // Account) instead of the catch-all "agent offline" banner that
        // misled users in fleet mode (which is what this hook fixes).
        if (!detection.available) {
          return {
            ok: false,
            reason:
              'Local agent not detected — start it from the One Click Ship tab, or switch to Fleet Agent mode.',
            surface: 'local',
          }
        }
        if (!detection.authenticated) {
          return {
            ok: false,
            reason:
              'Local agent online but session expired — click Reconnect Account, or switch to Fleet Agent mode.',
            surface: 'local',
          }
        }
        if (capability && !detection.hasCapability(capability)) {
          const ver = detection.health?.version
            ? ` v${detection.health.version}`
            : ''
          return {
            ok: false,
            reason: `Local agent${ver} doesn't advertise '${capability}' — update to v${LATEST_AGENT_VERSION}+, or switch to Fleet Agent mode.`,
            surface: 'local',
          }
        }
        return { ok: true, reason: null, surface: 'local' }
      }
      // Fleet mode — `fleetAgent` is the live-resolved snapshot
      // (already returns null when the persisted id is no longer in
      // the online list, so the "offline" branch covers both "no pick"
      // and "pick went stale" cleanly).
      if (!fleetAgentId) {
        return {
          ok: false,
          reason:
            'No fleet agent selected — pick one from the toggle dropdown above, or switch to Local Agent mode.',
          surface: 'fleet',
        }
      }
      if (!fleetAgent) {
        return {
          ok: false,
          reason: `Picked fleet agent ${fleetAgentId} is offline — pick another from the toggle, or switch to Local Agent mode.`,
          surface: 'fleet',
        }
      }
      if (capability && !fleetAgent.capabilities.includes(capability)) {
        const label = fleetAgent.hostname || fleetAgent.id
        const ver = fleetAgent.version ? ` v${fleetAgent.version}` : ''
        return {
          ok: false,
          reason: `Picked fleet agent ${label}${ver} doesn't support '${capability}' — pick another from the toggle, or switch to Local Agent mode.`,
          surface: 'fleet',
        }
      }
      return { ok: true, reason: null, surface: 'fleet' }
    },
    // `detection` is referentially stable across renders (cached
    // module-level snapshot in `useAgentDetection` that only re-emits
    // when state actually changes), so depending on the whole object
    // is correct AND keeps the linter happy. Listing individual fields
    // (`detection.available`, `.authenticated`, `.health`,
    // `.hasCapability`) tripped `react-hooks/exhaustive-deps` because
    // it can't statically verify property access.
    [mode, detection, fleetAgentId, fleetAgent]
  )

  return {
    mode,
    setMode,
    fleetAgentId,
    setFleetAgentId,
    fleetAgent,
    isFleet: mode === 'fleet',
    canDispatch,
    blockedReason,
    dispatch,
    getAssignedAgentId,
    ready,
  }
}

// Created and developed by Jai Singh
