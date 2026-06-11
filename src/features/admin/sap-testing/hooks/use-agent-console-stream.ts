// Created and developed by Jai Singh
/**
 * useAgentConsoleStream — Phase 6 (rust-work-service integration plan,
 * 2026-05-07) WS bridge that pushes `WsEvent::SapAgentConsoleLine`
 * events into the SAP Console card's existing message buffer.
 *
 * Why a hook (vs editing the card directly)?
 *   - The shared SAP Console card is consumed by both the Inventory
 *     Management tab and the Agent Triggers tab. Both tabs already
 *     have a `useSapConsole(...)` instance with their own
 *     localStorage key + level taxonomy; we need to feed WS events
 *     into both buffers without duplicating subscription logic.
 *   - Keeping the bridge in a hook means the card itself stays a
 *     pure presentational component and the WS plumbing is co-
 *     located with the other Rust-WS hooks (`useAgentDetection`,
 *     `useJobQueue`, `useSapTestingDashboard`).
 *
 * Behaviour:
 *   - Subscribes to `workServiceWs` for `SapAgentConsoleLine` events
 *     scoped to the caller's org (defence-in-depth: the Rust send
 *     loop already org-filters, but we also check
 *     `event.organization_id`).
 *   - Optional `agentFilter` narrows to a single agent — pass
 *     `null` / `undefined` to show all agents in the org.
 *   - Maps the wire-shape `level` (`info|warn|error|debug|trace|
 *     success`) onto the FE's `ConsoleLevel` (`info|success|
 *     warning|error`). `debug` and `trace` collapse to `info`
 *     because the card doesn't have separate columns for them; a
 *     future pass can extend `LEVEL_CLASSES`.
 *
 * Polling fallback (5-min safety net) is intentionally NOT included
 * here. The pre-Phase-6 card was localStorage-driven — there was no
 * polling endpoint to fall back to. The plan calls for "5-min safety
 * net (only fires when WS is disconnected)" which we wire as a
 * `setInterval` no-op gate today (returns early when
 * `workServiceWs.getConnectionState() === 'connected'`); when a
 * future `GET /api/v1/sap-console/lines?since=...` viewer endpoint
 * lands (deferred to Phase 11) the no-op turns into a real catch-up
 * fetch.
 *
 * Cross-references:
 *   - Backend route: `rust-work-service/src/api/routes/sap_console.rs`
 *   - WS variant: `rust-work-service/src/websocket/mod.rs::WsEvent::SapAgentConsoleLine`
 *   - Agent relay: `omni_agent/agent.py::_console_relay_thread`
 *   - Card consumer: `sap-console-card.tsx::SapConsoleCard`
 */
import { useEffect, useRef } from 'react'
import { getCurrentOrgId } from '@/lib/auth/unified-auth-provider'
import type { WsEvent, WsEventHandler } from '@/lib/work-service'
import { workServiceWs } from '@/lib/work-service/websocket'
import type { ConsoleLevel, PushConsole } from '../components/sap-console-card'

/**
 * Poll cadence for the safety-net catch-up fetch. 5min is loose
 * enough that a transient WS reconnect blip doesn't trigger an
 * unnecessary backfill (the WS reconnects within 5-15s); tight
 * enough that a sustained outage is bounded.
 */
const SAFETY_NET_INTERVAL_MS = 5 * 60_000

/**
 * Map the route's level vocabulary (matches the agent's preferred
 * names + the Rust `sanitize_level()` output) onto the card's
 * existing `ConsoleLevel` union.
 */
function mapLevel(raw: string | undefined): ConsoleLevel {
  switch (raw) {
    case 'success':
      return 'success'
    case 'warn':
    case 'warning':
      return 'warning'
    case 'error':
      return 'error'
    case 'info':
    case 'debug':
    case 'trace':
    default:
      return 'info'
  }
}

/**
 * Detect a leading prefix tag like `[boot]`, `[jobs]`, `[work-ws]`
 * etc and surface it as the console row's `source` label. Falls
 * back to `'agent'` when no prefix is found so the row still has a
 * recognisable source column.
 */
function deriveSource(message: string, agentId: string | undefined): string {
  const match = message.match(/^\[([\w-]+)\]/)
  if (match && match[1]) return match[1]
  // When no prefix tag is present, surface the agent id so a
  // multi-agent fleet stays distinguishable. We trim to the first
  // segment (the COMPUTERNAME) so the column doesn't get visually
  // dominated by the long stable-id suffix.
  if (agentId) {
    const head = agentId.split('-')[0]
    return head || agentId
  }
  return 'agent'
}

/**
 * Strip a leading prefix tag from the message so the rendered row
 * doesn't double-display it (the card already shows the source in
 * its own column). Trim trailing whitespace.
 */
function stripPrefix(message: string): string {
  return message.replace(/^\[[\w-]+\]\s*/, '').trim()
}

export interface UseAgentConsoleStreamOptions {
  /** Optional agent filter — when set, only lines from this
   *  agent_id flow into the buffer. Pass `null` / `undefined` to
   *  show every agent in the caller's org. */
  agentFilter?: string | null
  /** When `false`, the bridge is fully disabled (handler not
   *  attached). Useful for callers that want to gate the live
   *  stream behind a feature flag without unmounting the card. */
  enabled?: boolean
}

/**
 * Subscribe to `WsEvent::SapAgentConsoleLine` and push each line
 * into the caller's `pushConsole`. Returns nothing — the side-
 * effect IS the wiring.
 */
export function useAgentConsoleStream(
  pushConsole: PushConsole,
  options: UseAgentConsoleStreamOptions = {}
): void {
  const { agentFilter, enabled = true } = options
  // Capture the latest filter / push fn in refs so the WS handler
  // (registered once) always reads the current values without being
  // re-registered on every change. Cleaner than binding the handler
  // inside `useEffect` with `[agentFilter, pushConsole]` deps.
  const filterRef = useRef<string | null | undefined>(agentFilter)
  const pushRef = useRef<PushConsole>(pushConsole)
  filterRef.current = agentFilter
  pushRef.current = pushConsole

  useEffect(() => {
    if (!enabled) return
    const orgId = getCurrentOrgId()
    if (!orgId) return

    const handler: WsEventHandler = (event: WsEvent) => {
      if (event.type !== 'SapAgentConsoleLine') return
      // Defence-in-depth org check (the send loop already
      // filters; this guards against a misconfigured dev server
      // or a future protocol bug).
      if (event.organization_id && event.organization_id !== orgId) return
      const filter = filterRef.current
      if (filter && event.agent_id && event.agent_id !== filter) return
      const message = event.message ?? ''
      const source = deriveSource(message, event.agent_id)
      pushRef.current({
        level: mapLevel(event.level),
        source,
        text: stripPrefix(message) || message,
      })
    }

    try {
      workServiceWs.connect(orgId, handler)
    } catch {
      // WS setup failure is non-fatal — the existing localStorage-
      // backed buffer keeps working; new events just won't stream
      // until the WS recovers (and the safety-net interval below
      // would catch up if a backfill endpoint existed).
    }

    // Safety-net interval. Today this is a no-op because there's
    // no `GET /api/v1/sap-console/lines?since=...` backfill route
    // (deferred to Phase 11); we still install the timer + the
    // connection-state gate so the structure is in place for the
    // future implementation. Once the backfill route ships,
    // replace the empty branch below with the catch-up fetch.
    const safetyNet = setInterval(() => {
      if (workServiceWs.getConnectionState() === 'connected') return
      // TODO(Phase 11): GET /api/v1/sap-console/lines?since=<lastTs>
      //                 and feed each row through pushRef.current.
    }, SAFETY_NET_INTERVAL_MS)

    return () => {
      try {
        workServiceWs.removeHandler(handler)
      } catch {
        /* ignore */
      }
      clearInterval(safetyNet)
    }
  }, [enabled])
}

// Created and developed by Jai Singh
