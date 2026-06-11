// Created and developed by Jai Singh
/**
 * useLL01FleetProgress — live LL01 progress for FLEET runs (2026-05-31).
 *
 * In LOCAL mode the view polls the agent's `/sap/ll01/warehouse-activity/progress`
 * endpoint directly. In FLEET mode the agent runs on a Citrix box the browser
 * can't reach, so that poll is disabled and the progress bar froze at the
 * initial "Fetching all N plants…" state.
 *
 * The agent already relays its stdout to the browser via the work-service WS
 * (`WsEvent::SapAgentConsoleLine`, org-scoped — see `useAgentConsoleStream`),
 * and the LL01 worker prints one `[ll01] Plant X/Y: PLANT` line as each plant
 * (warehouse) starts. This hook taps that existing stream and turns those
 * lines into a structured `LL01Progress` so the fleet progress bar advances as
 * warehouses complete — no agent or rust-work-service change required.
 *
 * Parsing is intentionally tolerant: an unrecognised line is ignored (progress
 * simply doesn't advance) rather than throwing, so a future change to the
 * agent's print format degrades gracefully instead of breaking the UI.
 */
import { useEffect, useRef, useState } from 'react'
import { getCurrentOrgId } from '@/lib/auth/unified-auth-provider'
import type { WsEvent, WsEventHandler } from '@/lib/work-service'
import { workServiceWs } from '@/lib/work-service/websocket'
import {
  LL01_CATEGORY_META,
  parseLL01PlantLine,
  type LL01Progress,
} from '../components/warehouse-activity-monitor-types'

/**
 * Returns the latest LL01 progress derived from the live console stream, or
 * null. Only active while `enabled` (typically `isRunning && fleet mode`).
 */
export function useLL01FleetProgress(enabled: boolean): LL01Progress | null {
  const [progress, setProgress] = useState<LL01Progress | null>(null)
  const startedAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      setProgress(null)
      startedAtRef.current = null
      return
    }
    startedAtRef.current = Date.now()
    const orgId = getCurrentOrgId()
    if (!orgId) return

    const handler: WsEventHandler = (event: WsEvent) => {
      if (event.type !== 'SapAgentConsoleLine') return
      // Defence-in-depth org check (the Rust send loop already org-filters).
      if (event.organization_id && event.organization_id !== orgId) return
      const parsed = parseLL01PlantLine(event.message ?? '')
      if (!parsed) return
      const elapsedSec = startedAtRef.current
        ? Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000))
        : 0
      setProgress({
        running: true,
        plant_index: parsed.plantIndex,
        plant_total: parsed.plantTotal,
        category_index: 0,
        category_total: LL01_CATEGORY_META.length,
        label: `Plant ${parsed.plantIndex} of ${parsed.plantTotal} · ${parsed.plant}`,
        elapsed_sec: elapsedSec,
      })
    }

    try {
      workServiceWs.connect(orgId, handler)
    } catch {
      // WS unavailable — fleet progress just won't advance (the static
      // "Fetching…" initial state remains). Non-fatal.
    }
    return () => {
      try {
        workServiceWs.removeHandler(handler)
      } catch {
        /* ignore */
      }
    }
  }, [enabled])

  return progress
}

// Created and developed by Jai Singh
