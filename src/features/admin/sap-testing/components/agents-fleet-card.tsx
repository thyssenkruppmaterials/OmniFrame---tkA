// Created and developed by Jai Singh
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Cloud,
  CloudOff,
  Cpu,
  Eye,
  EyeOff,
  Pin,
  RefreshCw,
  Server,
  Signal,
  Trash2,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { useOrgId } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { WsEvent, WsEventHandler } from '@/lib/work-service'
import { getFleet } from '@/lib/work-service/sap-agents-client'
import { workServiceWs } from '@/lib/work-service/websocket'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAgentDetection } from '../hooks/use-agent-detection'

/**
 * Phase D #13 — AgentsFleetCard
 *
 * Lists every OmniFrame on-prem agent registered with this org, pulled
 * from `public.sap_agents`. Agents heartbeat every 30s; the card
 * subscribes to UPDATEs on the table so status flips appear in real
 * time without a manual refresh.
 *
 * Lives below `AgentHealthCard` in the Inventory Management header so
 * users can pick which Citrix box to pin a queue batch to (see the
 * "Pin to agent" dropdown in `BatchModePanel`).
 */

export interface SapAgentRow {
  id: string
  organization_id: string
  display_name: string | null
  hostname: string | null
  citrix_session: string | null
  version: string | null
  sap_system: string | null
  sap_client: string | null
  sap_user: string | null
  capabilities: string[] | null
  status: 'online' | 'offline' | 'draining'
  current_action: { job_id?: string; kind?: string } | null
  transactions_per_hour: number | null
  last_seen_at: string | null
  registered_at: string | null
  /** v1.6.5 — added by migration 250. NULL on rows last heartbeat'd by
   *  pre-1.6.5 agents (which didn't send the field). */
  process_started_at?: string | null
}

/** v1.6.5 — agents marked `offline` AND last seen >24h ago are
 *  considered "ancient" and hidden from the default fleet card view.
 *  The user can flip the "Show all" toggle to see them, and the
 *  "Purge offline" button DELETEs them outright (>7d) via the
 *  `purge_old_offline_sap_agents` RPC.
 *
 *  Why 24h: the agent self-rebuilds aggressively during dev (the
 *  reported user has 4-5 rebuilds in a workday); a stable id format
 *  (no PID) means rebuilds merge into one row, but operators still
 *  occasionally rotate machines. 24h is long enough that a brief
 *  Citrix outage doesn't hide a real agent, short enough to keep the
 *  card uncluttered.  */
const ANCIENT_OFFLINE_CUTOFF_MS = 24 * 60 * 60_000

function relTime(ts: string | null): string {
  if (!ts) return '—'
  const t = Date.parse(ts)
  if (!t) return ts
  const diff = Math.max(0, Date.now() - t)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

interface AgentsFleetCardProps {
  defaultOpen?: boolean
  /** Override the outer Card chrome — pass e.g. `'border-0 shadow-none rounded-none gap-0 py-0'`
   *  when embedding inside a parent unified panel that owns the border/shadow itself. */
  className?: string
}

export function AgentsFleetCard({
  defaultOpen = true,
  className,
}: AgentsFleetCardProps) {
  const [agents, setAgents] = useState<SapAgentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [purging, setPurging] = useState(false)
  const [open, setOpen] = useState(defaultOpen)
  const [showAncient, setShowAncient] = useState(false)
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null)
  // v1.7.4 — org_id is read from the auth-state cache (populated once
  // on sign-in) instead of re-queried from `user_profiles` on every
  // refresh / 30s tick / Realtime event. This used to be one of the
  // hottest incidental read paths in the product.
  const orgId = useOrgId()

  const refresh = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      // Phase 3 of the rust-work-service full-integration plan
      // (2026-05-06): bootstrap snapshot is owned by the work-service
      // `/api/v1/sap-agents/fleet` endpoint, server-side scoped to
      // org and capability-decoded. We request `status: 'all'` so the
      // card can show online + offline + draining (the toggle for
      // "ancient offline" rows runs FE-side after).
      try {
        const fleetRows = await getFleet({
          status: 'all',
          includeCapabilities: true,
        })
        // The work-service projection lacks fields the card never
        // displays (display_name, current_action, transactions_per_hour,
        // registered_at) — backfill them with null so the row shape
        // stays compatible with `SapAgentRow`.
        const rows: SapAgentRow[] = fleetRows.map((r) => ({
          id: r.id,
          organization_id: orgId,
          display_name: null,
          hostname: r.hostname,
          citrix_session: r.citrix_session,
          version: r.version,
          sap_system: r.sap_system,
          sap_client: r.sap_client,
          sap_user: r.sap_user,
          capabilities: r.capabilities ?? [],
          status: (r.status as SapAgentRow['status']) ?? 'offline',
          current_action: null,
          transactions_per_hour: null,
          last_seen_at: r.last_seen_at,
          registered_at: null,
          process_started_at: r.process_started_at,
        }))
        setAgents(rows)
        setLastFetchedAt(Date.now())
        return
      } catch {
        // Fall through to the legacy Supabase REST path below.
      }
      // TODO(rust-work-service Phase 11): delete this fallback once
      // the work-service path has soaked in production. Today we
      // keep the original Supabase REST query as a safety net so a
      // work-service outage doesn't blank the agents fleet card.
      // sap_agents is added in migration 247 — generated DB types
      // don't include it yet, so cast through to bypass the typed
      // overload.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = supabase as any
      const { data } = await client
        .from('sap_agents')
        .select('*')
        .eq('organization_id', orgId)
        .order('last_seen_at', { ascending: false, nullsFirst: false })
      const rows = (data ?? []) as SapAgentRow[]
      setAgents(rows)
      setLastFetchedAt(Date.now())
    } catch {
      /* keep last known */
    } finally {
      setLoading(false)
    }
  }, [orgId])

  // v1.6.5 — "Purge offline" calls the new `purge_old_offline_sap_agents`
  // RPC (migration 250). DELETEs (not just marks offline) any sap_agents
  // row that has been offline for >7 days. Wrapped in a tiny confirm
  // because it's a destructive op.
  const purgeOffline = useCallback(async () => {
    if (
      !window.confirm(
        'Delete every sap_agents row that has been offline for 7+ days? This cannot be undone (rows will re-register on the next agent heartbeat from a live machine).'
      )
    ) {
      return
    }
    setPurging(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = supabase as any
      const { data, error } = await client.rpc('purge_old_offline_sap_agents', {
        p_max_age_days: 7,
      })
      if (error) {
        toast.error('Purge failed', { description: error.message })
        return
      }
      const count = typeof data === 'number' ? data : 0
      toast.success(
        count === 0
          ? 'No agents needed purging.'
          : `Purged ${count} stale agent row${count === 1 ? '' : 's'}.`
      )
      void refresh()
    } catch (e) {
      toast.error('Purge failed', {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setPurging(false)
    }
  }, [refresh])

  // 2026-05-06 — initial-load + 5-min safety-net poll. The 30s
  // `setInterval(refresh, 30_000)` previously here was paired with the
  // `supabase.channel('sap-agents-fleet')` listener (now retired). The
  // WS push (`WsEvent::SapAgentChanged`) handles the snappy path; this
  // safety net only fires when the WS isn't connected, so the card
  // self-heals during a Rust WS outage without hammering Postgres on
  // the happy path.
  useEffect(() => {
    void refresh()
    const t = setInterval(() => {
      if (workServiceWs.getConnectionState() === 'connected') return
      void refresh()
    }, 5 * 60_000)
    return () => clearInterval(t)
  }, [refresh])

  // 2026-05-06 — `WsEvent::SapAgentChanged` handler on the singleton
  // `WorkServiceWebSocket`. Replaces the prior
  // `supabase.channel('sap-agents-fleet')` `postgres_changes` listener.
  // Migration 270 emits a Postgres NOTIFY on every sap_agents row
  // change; rust-work-service's sap_agents listener fans that out as
  // an org-scoped WS event. See
  // `[[Implementations/Migrate-SapAgentChanged-To-Rust-WS]]` for the
  // end-to-end migration writeup.
  useEffect(() => {
    if (!orgId) return
    const handler: WsEventHandler = (event: WsEvent) => {
      if (event.type !== 'SapAgentChanged') return
      // Defence-in-depth: the Rust send loop already filters org-scoped
      // events to the matching subscriber. A second check here means a
      // future protocol bug or misconfigured dev server can't leak
      // cross-org rows into this card.
      if (event.organization_id && event.organization_id !== orgId) return
      void refresh()
    }
    workServiceWs.connect(orgId, handler)
    return () => {
      workServiceWs.removeHandler(handler)
    }
  }, [orgId, refresh])

  const onlineCount = useMemo(
    () => agents.filter((a) => a.status === 'online').length,
    [agents]
  )

  // v1.6.5 — by default hide rows that are offline AND haven't been
  // heard from in >24h, so a workday's worth of rebuild iterations
  // doesn't bloat the card. Online + draining always render. The
  // `Show all` toggle reveals everything for ops drill-down.
  const visibleAgents = useMemo(() => {
    if (showAncient) return agents
    const now = Date.now()
    return agents.filter((a) => {
      if (a.status !== 'offline') return true
      if (!a.last_seen_at) return true
      const lastSeenMs = Date.parse(a.last_seen_at)
      if (!lastSeenMs) return true
      return now - lastSeenMs <= ANCIENT_OFFLINE_CUTOFF_MS
    })
  }, [agents, showAncient])
  const hiddenCount = agents.length - visibleAgents.length
  const purgeableCount = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60_000
    return agents.filter(
      (a) =>
        a.status === 'offline' &&
        a.last_seen_at &&
        Date.parse(a.last_seen_at) < cutoff
    ).length
  }, [agents])

  return (
    <Card className={cn('gap-0 py-0 shadow-sm', className)}>
      <CardHeader
        className='hover:bg-accent/30 flex cursor-pointer flex-row items-center justify-between space-y-0 py-2.5 transition-colors'
        onClick={() => setOpen((v) => !v)}
      >
        <CardTitle className='text-muted-foreground flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] uppercase'>
          <Server className='h-3.5 w-3.5 text-emerald-500' />
          Agents Fleet
          <Badge variant='outline' className='text-[10px]'>
            {onlineCount}/{visibleAgents.length} online
            {hiddenCount > 0 && (
              <span
                className='text-muted-foreground ml-1 font-normal'
                title={`${hiddenCount} row(s) hidden — offline for >24h. Click "Show all" to reveal.`}
              >
                (+{hiddenCount} hidden)
              </span>
            )}
          </Badge>
        </CardTitle>
        <div className='flex items-center gap-1'>
          <Button
            size='icon'
            variant='ghost'
            className='h-6 w-6'
            onClick={(e) => {
              e.stopPropagation()
              setShowAncient((v) => !v)
            }}
            title={
              showAncient
                ? 'Hide agents offline >24h'
                : 'Show all (incl. ancient offline)'
            }
          >
            {showAncient ? (
              <EyeOff className='h-3 w-3' />
            ) : (
              <Eye className='h-3 w-3' />
            )}
          </Button>
          {purgeableCount > 0 && (
            <Button
              size='icon'
              variant='ghost'
              className='hover:text-destructive h-6 w-6'
              onClick={(e) => {
                e.stopPropagation()
                void purgeOffline()
              }}
              title={`Purge ${purgeableCount} agent row(s) offline >7 days`}
              disabled={purging}
            >
              <Trash2 className={cn('h-3 w-3', purging && 'animate-pulse')} />
            </Button>
          )}
          <Button
            size='icon'
            variant='ghost'
            className='h-6 w-6'
            onClick={(e) => {
              e.stopPropagation()
              void refresh()
            }}
            title='Refresh fleet'
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className='space-y-2 pt-0 pb-3 text-xs'>
          {visibleAgents.length === 0 ? (
            <div className='text-muted-foreground py-3 text-center'>
              <CloudOff className='mx-auto mb-1 h-4 w-4' />
              {agents.length === 0 ? (
                <>
                  No agents have registered yet. Agents register on first
                  heartbeat (within 30s of agent boot) once the user has logged
                  in via the agent.
                </>
              ) : (
                <>
                  All {agents.length} registered agents have been offline for
                  more than 24h. Click the eye icon to show them.
                </>
              )}
            </div>
          ) : (
            <ul className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
              {visibleAgents.map((agent) => {
                const isOnline = agent.status === 'online'
                return (
                  <li
                    key={agent.id}
                    className={cn(
                      'rounded-md border p-2',
                      isOnline
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : 'border-muted bg-muted/30 opacity-80'
                    )}
                  >
                    <div className='flex items-center justify-between gap-2'>
                      <span
                        className='truncate font-mono text-[11px] font-semibold'
                        title={agent.id}
                      >
                        {agent.hostname || agent.id}
                      </span>
                      {isOnline ? (
                        <Badge
                          variant='outline'
                          className='border-emerald-500/40 text-[10px] text-emerald-600 dark:text-emerald-400'
                        >
                          <Signal className='mr-1 h-2.5 w-2.5' />
                          online
                        </Badge>
                      ) : agent.status === 'draining' ? (
                        <Badge
                          variant='outline'
                          className='border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400'
                        >
                          draining
                        </Badge>
                      ) : (
                        <Badge variant='outline' className='text-[10px]'>
                          <WifiOff className='mr-1 h-2.5 w-2.5' />
                          offline
                        </Badge>
                      )}
                    </div>
                    <div className='text-muted-foreground mt-1 flex items-center gap-2 text-[10px]'>
                      <Cloud className='h-2.5 w-2.5' />
                      <span className='truncate'>
                        {agent.citrix_session || '—'}
                      </span>
                      {agent.version && (
                        <Badge
                          variant='secondary'
                          className='ml-auto font-mono text-[9px]'
                        >
                          v{agent.version}
                        </Badge>
                      )}
                    </div>
                    {(agent.sap_system || agent.sap_user) && (
                      <div className='text-muted-foreground mt-1 flex items-center gap-1 text-[10px]'>
                        <Cpu className='h-2.5 w-2.5' />
                        <span className='font-mono'>
                          {agent.sap_system || '?'} / cl
                          {agent.sap_client || '?'} / {agent.sap_user || '?'}
                        </span>
                      </div>
                    )}
                    {agent.current_action?.job_id && (
                      <div className='mt-1 flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400'>
                        <Activity className='h-2.5 w-2.5 animate-pulse' />
                        running job {agent.current_action.job_id.slice(0, 8)}…
                      </div>
                    )}
                    <div className='text-muted-foreground mt-1 flex items-center justify-between text-[10px]'>
                      <span>
                        {agent.transactions_per_hour
                          ? `${Math.round(agent.transactions_per_hour)} txn/hr`
                          : '—'}
                      </span>
                      <span>{relTime(agent.last_seen_at)}</span>
                    </div>
                    {(agent.capabilities?.length ?? 0) > 0 && (
                      <div
                        className='text-muted-foreground mt-1 truncate text-[9px]'
                        title={(agent.capabilities ?? []).join(', ')}
                      >
                        <Pin className='mr-0.5 inline h-2 w-2' />
                        {(agent.capabilities ?? []).length} capabilities
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {lastFetchedAt && (
            <div className='text-muted-foreground text-right text-[10px]'>
              refreshed {new Date(lastFetchedAt).toLocaleTimeString()}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

/**
 * Hook variant that exposes just the list — used by BatchModePanel so
 * it can render a "Pin to agent" picker without re-rendering the
 * whole card. Returns only online agents (the only ones that can
 * actually pick up a pinned job).
 *
 * v1.7.4 — this used to spin up its OWN 30s `setInterval` + its OWN
 * `sap_agents` Realtime channel, on top of the one already run by
 * `useAgentDetection` and the one in `<AgentsFleetCard />`. With 4
 * consumers (inventory-management, scheduled-jobs, agent-triggers,
 * import-lt22-dialog) that was 3 independent Realtime channels + 3
 * independent interval pollers per user tab. Now it simply delegates
 * to `useAgentDetection().fleet.agents`, which is already Realtime-
 * subscribed, visibility-gated, and org-id-filtered.
 *
 * The shape returned is a SUBSET of `SapAgentRow` — the `FleetAgent`
 * slim projection (see `use-agent-detection.ts`). All existing
 * consumers only read `id`, `hostname`, `citrix_session`, `version`,
 * and `capabilities`, all of which are present. We widen the return
 * type to `Partial<SapAgentRow> & FleetAgent` so call sites that
 * annotate their props with a smaller shape (e.g. `{ id, hostname,
 * citrix_session }`) keep type-checking without any change.
 */
export function useOnlineSapAgents(): SapAgentRow[] {
  const { fleet } = useAgentDetection()
  return useMemo(() => {
    // `FleetAgent` already guarantees `capabilities: string[]` (never
    // null) which matches one of the `SapAgentRow` invariants callers
    // rely on via `Array.isArray(a.capabilities)` checks.
    return fleet.agents.map(
      (a) =>
        ({
          id: a.id,
          version: a.version,
          capabilities: a.capabilities,
          last_seen_at: a.last_seen_at,
          sap_system: a.sap_system,
          sap_client: a.sap_client,
          hostname: a.hostname,
          citrix_session: a.citrix_session,
          // Fields not exposed by the shared fleet projection.
          // `status` is always 'online' here (the fleet snapshot is
          // online-only); the rest default to null so the shape is a
          // structurally-compatible `SapAgentRow`.
          organization_id: '',
          display_name: null,
          sap_user: null,
          status: 'online',
          current_action: null,
          transactions_per_hour: null,
          registered_at: null,
        }) as SapAgentRow
    )
  }, [fleet.agents])
}

// Created and developed by Jai Singh
