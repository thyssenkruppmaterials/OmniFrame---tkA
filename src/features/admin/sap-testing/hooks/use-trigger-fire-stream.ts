// Created and developed by Jai Singh
/**
 * useTriggerFireStream — Phase 9 (rust-work-service integration plan,
 * 2026-05-07) WS bridge for the rewritten "Agent Triggers" admin tab.
 *
 * Replaces the in-memory `EventLogEntry` list that the deleted
 * `useAgentTriggerRuntime` hook used to maintain. The browser is no
 * longer the trigger evaluator — `rust-work-service::triggers::evaluator`
 * is — so this hook ONLY observes the broadcast stream of
 * `WsEvent::TriggerFired` events and surfaces them to the FE.
 *
 * Each fire is appended to a bounded ring buffer (default 200 entries)
 * so the recent-fires panel can render the live tail without unbounded
 * memory growth.
 *
 * See:
 *   - Implementation: `Implementations/Implement-Rust-Work-Service-Phase9.md`
 *   - WS variant: `rust-work-service/src/websocket/mod.rs::WsEvent::TriggerFired`
 *   - Backend evaluator: `rust-work-service/src/triggers/evaluator.rs`
 */
import { useEffect, useRef, useState } from 'react'
import { getCurrentOrgId } from '@/lib/auth/unified-auth-provider'
import type { WsEvent, WsEventHandler } from '@/lib/work-service'
import { workServiceWs } from '@/lib/work-service/websocket'

/** Maximum entries kept in the in-memory ring buffer. */
const DEFAULT_MAX_ENTRIES = 200

export interface TriggerFireEntry {
  id: string
  timestamp: string
  trigger_id: string
  source_row_id: string
  target_endpoint: string
  job_id: string
}

export interface UseTriggerFireStreamOptions {
  /** Bounded ring-buffer size. Default {@link DEFAULT_MAX_ENTRIES}. */
  maxEntries?: number
  /** When false, the hook is fully inert (no WS subscription). */
  enabled?: boolean
}

export interface UseTriggerFireStreamReturn {
  fires: TriggerFireEntry[]
  /** Drop the in-memory list. The actual `sap_agent_jobs` rows are
   *  unaffected — this is purely a UI-state reset. */
  clear: () => void
}

export function useTriggerFireStream(
  options: UseTriggerFireStreamOptions = {}
): UseTriggerFireStreamReturn {
  const { maxEntries = DEFAULT_MAX_ENTRIES, enabled = true } = options
  const [fires, setFires] = useState<TriggerFireEntry[]>([])
  // Stable reset target — React Compiler-friendly and lets us clear
  // the buffer from outside an effect.
  const setFiresRef = useRef(setFires)
  setFiresRef.current = setFires

  useEffect(() => {
    if (!enabled) return
    const orgId = getCurrentOrgId()
    if (!orgId) return

    const handler: WsEventHandler = (event: WsEvent) => {
      if (event.type !== 'TriggerFired') return
      // Defence-in-depth org check (Rust send-loop already filters).
      if (event.organization_id && event.organization_id !== orgId) return

      const trigger_id = event.trigger_id
      const job_id = event.job_id
      const source_row_id = event.row_id
      const target_endpoint = event.target_endpoint
      if (!trigger_id || !job_id || !source_row_id || !target_endpoint) return

      const entry: TriggerFireEntry = {
        id: `${trigger_id}:${job_id}`,
        timestamp: new Date().toISOString(),
        trigger_id,
        source_row_id,
        target_endpoint,
        job_id,
      }
      setFiresRef.current((prev) => [entry, ...prev].slice(0, maxEntries))
    }

    try {
      workServiceWs.connect(orgId, handler)
    } catch {
      // Non-fatal — list stays empty until the WS recovers; the
      // server-side evaluator keeps firing regardless.
    }

    return () => {
      try {
        workServiceWs.removeHandler(handler)
      } catch {
        /* ignore */
      }
    }
  }, [enabled, maxEntries])

  return {
    fires,
    clear: () => setFires([]),
  }
}

// Created and developed by Jai Singh
