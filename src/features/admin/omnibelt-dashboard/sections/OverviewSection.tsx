// Created and developed by Jai Singh
/**
 * OverviewSection — landing tab for the OmniBelt admin dashboard.
 *
 * 6-tile grid that gives an admin every signal they need to know
 * the launcher is healthy in one glance:
 *
 *   1. Master Kill Switch         — toggle + env-override + last-changed
 *   2. Allow-list summary         — N of M tools allowed + top-3 disabled chips
 *   3. Hot-reload health          — last `OmnibeltConfigChanged` WS ping
 *   4. Live KPIs (last 5 min)     — active users + panel opens + tool launches
 *   5. Top tools (24h)            — bar chart from the 24h MV
 *   6. Skin distribution          — pie chart from prefs aggregate
 *
 * Plus a "Recent admin changes" strip below the grid pulling the
 * last 5 entries from the derived audit log.
 *
 * Every read flows through `supabaseRead`; every write goes through
 * a hook backed by the existing FastAPI admin endpoint. Tiles
 * degrade gracefully when their data isn't available (RLS,
 * pre-launch org with empty MV, etc.).
 */
import { useEffect, useMemo, useState } from 'react'
import {
  IconActivity,
  IconBolt,
  IconChartPie,
  IconListCheck,
  IconRadar2,
  IconUsers,
} from '@tabler/icons-react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { workServiceWs } from '@/lib/work-service'
import type { WsEvent } from '@/lib/work-service'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TOOL_REGISTRY } from '@/features/omnibelt/tools/registry'
import { KillSwitchPanel } from '../components/KillSwitchPanel'
import { SkinDistributionPie } from '../components/SkinDistributionPie'
import { TopToolsTable } from '../components/TopToolsTable'
import { useAuditLog } from '../hooks/useAuditLog'
import { useOmnibeltAdminBootstrap } from '../hooks/useOmnibeltAdminBootstrap'
import { useEvents24h, usePrefsAggregate } from '../hooks/useUsageStats'

export function OverviewSection() {
  const bootstrap = useOmnibeltAdminBootstrap()
  const events24h = useEvents24h()
  const prefsAgg = usePrefsAggregate()
  const auditQuery = useAuditLog(bootstrap.data?.roles)

  const live = useLiveKpis(events24h.data ?? [])
  const lastWsPing = useLastConfigPing()

  if (bootstrap.isLoading) {
    return (
      <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className='h-44 w-full rounded-xl' />
        ))}
      </div>
    )
  }

  if (bootstrap.isError || !bootstrap.data) {
    return (
      <Card className='border-rose-500/40 bg-rose-500/5'>
        <CardHeader>
          <CardTitle className='text-sm'>
            Failed to load OmniBelt admin bootstrap
          </CardTitle>
        </CardHeader>
        <CardContent className='text-muted-foreground text-xs'>
          {bootstrap.error instanceof Error
            ? bootstrap.error.message
            : 'Unknown error.'}
        </CardContent>
      </Card>
    )
  }

  const data = bootstrap.data
  const totalTools = TOOL_REGISTRY.length
  const allowed = data.allowList === null ? totalTools : data.allowList.length

  return (
    <div className='space-y-4'>
      <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
        <KillSwitchPanel killSwitch={data.killSwitch} />

        <AllowListSummary
          allowedCount={allowed}
          totalCount={totalTools}
          allowList={data.allowList}
        />

        <HotReloadHealthCard lastPing={lastWsPing} />

        <LiveKpisCard
          activeUsers={data.activeUsersLast5m}
          panelOpens={live.panelOpens}
          toolLaunches={live.toolLaunches}
        />

        <TopToolsTable
          buckets={events24h.data ?? []}
          isLoading={events24h.isLoading}
        />

        <SkinDistributionPie
          distribution={prefsAgg.data?.skinDistribution ?? {}}
          isLoading={prefsAgg.isLoading}
        />
      </div>

      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='flex items-center gap-2 text-base'>
            <IconListCheck size={16} aria-hidden /> Recent admin changes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {auditQuery.entries.length === 0 ? (
            <p className='text-muted-foreground text-sm'>
              No role-config edits yet. Saves from the Role Defaults tab will
              appear here.
            </p>
          ) : (
            <ul className='divide-border divide-y'>
              {auditQuery.entries.slice(0, 5).map((entry) => (
                <li
                  key={entry.id}
                  className='flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:justify-between'
                >
                  <div className='flex items-center gap-2'>
                    <Badge variant='outline' className='text-[10px] uppercase'>
                      {entry.kind.replace('_', ' ')}
                    </Badge>
                    <span className='font-medium'>{entry.target}</span>
                  </div>
                  <div className='text-muted-foreground flex items-center gap-3 text-xs'>
                    <span>{entry.actor_label}</span>
                    <time>{formatRelative(entry.timestamp)}</time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

interface AllowListSummaryProps {
  allowedCount: number
  totalCount: number
  allowList: string[] | null
}

function AllowListSummary({
  allowedCount,
  totalCount,
  allowList,
}: AllowListSummaryProps) {
  const disabled = useMemo(() => {
    if (allowList === null) return []
    const allow = new Set(allowList)
    return TOOL_REGISTRY.filter((t) => !allow.has(t.id)).slice(0, 3)
  }, [allowList])

  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <IconListCheck size={16} aria-hidden /> Tool Allow-list
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        <div>
          <p className='text-2xl font-semibold tabular-nums'>
            {allowedCount}
            <span className='text-muted-foreground ml-1 text-sm font-normal'>
              / {totalCount} tools allowed
            </span>
          </p>
          <p className='text-muted-foreground text-xs'>
            {allowList === null
              ? 'No restriction row — every registry tool is currently allowed by default.'
              : `${totalCount - allowedCount} disabled org-wide.`}
          </p>
        </div>
        {disabled.length > 0 && (
          <div className='flex flex-wrap gap-1.5'>
            {disabled.map((tool) => (
              <Badge
                key={tool.id}
                variant='outline'
                className='border-rose-500/40 text-rose-700'
              >
                {tool.label}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface HotReloadHealthCardProps {
  lastPing: number | null
}

function HotReloadHealthCard({ lastPing }: HotReloadHealthCardProps) {
  const [, force] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => force((v) => v + 1), 15_000)
    return () => window.clearInterval(id)
  }, [])

  const seconds = lastPing ? Math.round((Date.now() - lastPing) / 1000) : null
  const fresh = seconds !== null && seconds < 60

  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <IconRadar2 size={16} aria-hidden /> Hot-reload health
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-2'>
        <p className='text-2xl font-semibold tabular-nums'>
          {seconds === null ? '—' : fresh ? 'Live' : `${seconds}s ago`}
        </p>
        <p className='text-muted-foreground text-xs'>
          Time since the last <code>OmnibeltConfigChanged</code> event arrived
          from the work-service WebSocket.
        </p>
        <Badge
          variant='outline'
          className={
            fresh
              ? 'border-emerald-500/50 text-emerald-700'
              : 'border-muted-foreground/40 text-muted-foreground'
          }
        >
          {fresh ? 'Streaming OK' : 'Idle'}
        </Badge>
      </CardContent>
    </Card>
  )
}

interface LiveKpisCardProps {
  activeUsers: number
  panelOpens: number
  toolLaunches: number
}

function LiveKpisCard({
  activeUsers,
  panelOpens,
  toolLaunches,
}: LiveKpisCardProps) {
  const Cell = ({
    label,
    value,
    icon,
  }: {
    label: string
    value: number
    icon: React.ReactNode
  }) => (
    <div className='flex flex-col items-start gap-1'>
      <div className='text-muted-foreground flex items-center gap-1 text-[11px] tracking-wide uppercase'>
        {icon}
        {label}
      </div>
      <p className='text-xl font-semibold tabular-nums'>{value}</p>
    </div>
  )

  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <IconBolt size={16} aria-hidden /> Live (last 5 min)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className='grid grid-cols-3 gap-3'>
          <Cell
            label='Users'
            value={activeUsers}
            icon={<IconUsers size={12} aria-hidden />}
          />
          <Cell
            label='Opens'
            value={panelOpens}
            icon={<IconActivity size={12} aria-hidden />}
          />
          <Cell
            label='Launches'
            value={toolLaunches}
            icon={<IconChartPie size={12} aria-hidden />}
          />
        </div>
      </CardContent>
    </Card>
  )
}

interface LiveKpis {
  panelOpens: number
  toolLaunches: number
}

/**
 * Derive 5-minute counters from the hourly MV. The MV is bucketed
 * by hour so the "5 minute" window is approximated by the last
 * fully-populated hour bucket — this isn't perfect but is fast and
 * doesn't add a second raw-table query per render.
 */
function useLiveKpis(
  buckets: Array<{
    event_type: string | null
    event_count: number | null
    bucket_hour: string | null
  }>
): LiveKpis {
  return useMemo(() => {
    if (buckets.length === 0) {
      return { panelOpens: 0, toolLaunches: 0 }
    }
    const cutoff = Date.now() - 60 * 60 * 1000
    let panelOpens = 0
    let toolLaunches = 0
    for (const row of buckets) {
      if (!row.bucket_hour) continue
      const t = new Date(row.bucket_hour).getTime()
      if (Number.isNaN(t) || t < cutoff) continue
      const count = row.event_count ?? 0
      if (row.event_type === 'panel_open') panelOpens += count
      else if (row.event_type === 'tool_launch') toolLaunches += count
    }
    return { panelOpens, toolLaunches }
  }, [buckets])
}

/**
 * Subscribe to the existing `workServiceWs` singleton for
 * `OmnibeltConfigChanged` pings — purely observational; the
 * launcher-side `useOmnibeltConfigInvalidator` already handles
 * cache invalidation. Returns the timestamp of the most recent
 * event (or null if we haven't seen one).
 */
function useLastConfigPing(): number | null {
  const { authState } = useUnifiedAuth()
  const orgId = authState.profile?.organization_id ?? null
  const [lastPing, setLastPing] = useState<number | null>(null)

  useEffect(() => {
    if (!orgId) return
    const handler = (event: WsEvent) => {
      if (event.type !== 'OmnibeltConfigChanged') return
      if (event.organization_id && event.organization_id !== orgId) return
      setLastPing(Date.now())
    }
    workServiceWs.connect(orgId, handler)
    return () => {
      workServiceWs.removeHandler(handler)
    }
  }, [orgId])

  return lastPing
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return iso
  const seconds = Math.round(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

// Created and developed by Jai Singh
