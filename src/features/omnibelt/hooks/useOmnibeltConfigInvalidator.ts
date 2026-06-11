// Created and developed by Jai Singh
/**
 * OmniBelt — Config Invalidator Hook
 *
 * P2 of the OmniBelt MVP rollout (2026-05-24).
 *
 * Subscribes to the existing `workServiceWs` singleton and invalidates
 * the bootstrap query whenever
 * `WsEvent::OmnibeltConfigChanged { organization_id }` arrives. The
 * Rust send-loop's deny-by-default org-scope filter guarantees we
 * only receive events for our own org, but we defensively double-
 * check on the FE anyway.
 *
 * Mirrors the canonical `useWorkQueue` subscribe / invalidate shape
 * (`src/hooks/use-work-queue.ts`):
 *   1. Connect with the user's `organization_id` and the handler.
 *   2. Track connection state for observability.
 *   3. Remove the handler on unmount — `removeHandler` auto-disconnects
 *      when no more handlers remain.
 *
 * Aligns with the no-new-Supabase-channel policy in
 * `.cursor/rules/realtime-policy.mdc` — extends the Rust WS variant
 * set rather than spinning up a new Supabase Realtime subscription.
 */
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { logger } from '@/lib/utils/logger'
import { workServiceWs, type ConnectionState } from '@/lib/work-service'
import type { WsEvent } from '@/lib/work-service'
import {
  OMNIBELT_BOOTSTRAP_QUERY_KEY_BASE,
  OMNIBELT_BOOTSTRAP_QUERY_KEY_KIND,
} from './useOmnibeltBootstrap'

export type OmnibeltConfigInvalidatorState = {
  /** Tracks the underlying WS state so observers (Mach 3 status,
   *  admin tooling) can render a connection indicator. The hook
   *  itself doesn't gate on this — the WS resilience layer manages
   *  reconnects autonomously. */
  wsConnectionState: ConnectionState
}

/**
 * Mount this hook from `OmniBeltHost` (P3+). Returns the current WS
 * connection state for any UI that wants to surface it; the
 * invalidation side-effect happens silently regardless.
 */
export function useOmnibeltConfigInvalidator(): OmnibeltConfigInvalidatorState {
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id ?? null
  const [wsConnectionState, setWsConnectionState] = useState<ConnectionState>(
    () => workServiceWs.getConnectionState()
  )

  useEffect(() => {
    if (!organizationId) return

    const handler = (event: WsEvent) => {
      if (event.type !== 'OmnibeltConfigChanged') return
      // Defence-in-depth — the Rust send-loop already filters per
      // org, but we double-check here so a misconfigured WS server
      // can't accidentally invalidate cross-tenant.
      if (event.organization_id && event.organization_id !== organizationId) {
        return
      }
      logger.debug(
        '[useOmnibeltConfigInvalidator] OmnibeltConfigChanged → invalidate bootstrap',
        { organization_id: event.organization_id }
      )
      // Prefix invalidation matches every per-user variant of the
      // bootstrap key (`['omnibelt', 'bootstrap', userId]`). Concurrent
      // invalidations dedupe automatically inside TanStack Query.
      queryClient.invalidateQueries({
        queryKey: [
          OMNIBELT_BOOTSTRAP_QUERY_KEY_BASE,
          OMNIBELT_BOOTSTRAP_QUERY_KEY_KIND,
        ],
      })
    }

    workServiceWs.connect(organizationId, handler)
    const unsubscribe = workServiceWs.onStateChange((state) => {
      setWsConnectionState(state)
    })
    setWsConnectionState(workServiceWs.getConnectionState())

    return () => {
      workServiceWs.removeHandler(handler)
      unsubscribe()
    }
  }, [organizationId, queryClient])

  return { wsConnectionState }
}

// Created and developed by Jai Singh
