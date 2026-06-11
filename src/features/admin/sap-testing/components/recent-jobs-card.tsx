// Created and developed by Jai Singh
/**
 * RecentJobsCard — Phase 3 of the rust-work-service full-integration
 * plan (2026-05-06).
 *
 * Compact ledger of the most recent `sap_agent_jobs` rows for the
 * caller's org. Bootstraps via `getRecentJobs({ limit: 50 })` (the
 * Phase-3 server-owned snapshot endpoint) on mount, then refreshes on
 * every `WsEvent::SapJobStatusChanged` push delivered by the
 * `workServiceWs` singleton (the same WS the agents-fleet card and
 * the work-queue hooks already share).
 *
 * Mounted next to the existing `AgentsFleetCard` so an operator can
 * see which agents are online AND what they've been running, without
 * leaving the SAP Testing tab. The card intentionally renders a
 * compact 6-column table — it's a quick-glance ledger, not a full
 * job-management UI (the dedicated SAP Job Queue tab covers that).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Hourglass,
  ListChecks,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import { useOrgId } from '@/lib/auth/unified-auth-provider'
import { cn } from '@/lib/utils'
import type { WsEvent, WsEventHandler } from '@/lib/work-service'
import {
  getRecentJobs,
  type RecentJob,
} from '@/lib/work-service/sap-agents-client'
import { workServiceWs } from '@/lib/work-service/websocket'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const DEFAULT_LIMIT = 50

/** Best-effort, non-localised "12s ago / 4m ago / 2h ago / 3d ago"
 *  helper. Mirrors the same util in `agents-fleet-card.tsx` — kept
 *  inline so this module has zero new shared deps. */
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

/** Friendly duration between two ISO timestamps. Returns "—" when
 *  either is null. Used to surface "how long did this job take?". */
function duration(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return '—'
  const start = Date.parse(startIso)
  const end = Date.parse(endIso)
  if (!start || !end || end < start) return '—'
  const sec = Math.floor((end - start) / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  if (min < 60) return `${min}m${remSec > 0 ? ` ${remSec}s` : ''}`
  const hrs = Math.floor(min / 60)
  const remMin = min % 60
  return `${hrs}h${remMin > 0 ? ` ${remMin}m` : ''}`
}

function statusBadge(status: string) {
  // Maps the Postgres `sap_agent_jobs.status` enum (queued / running /
  // completed / failed / cancelled) to a coloured badge. Unknown
  // values fall through to the neutral outline.
  switch (status) {
    case 'completed':
      return (
        <Badge
          variant='outline'
          className='border-emerald-500/40 text-[10px] text-emerald-600 dark:text-emerald-400'
        >
          <CheckCircle2 className='mr-1 h-2.5 w-2.5' />
          completed
        </Badge>
      )
    case 'running':
      return (
        <Badge
          variant='outline'
          className='border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400'
        >
          <Loader2 className='mr-1 h-2.5 w-2.5 animate-spin' />
          running
        </Badge>
      )
    case 'queued':
      return (
        <Badge variant='outline' className='text-[10px]'>
          <Hourglass className='mr-1 h-2.5 w-2.5' />
          queued
        </Badge>
      )
    case 'failed':
      return (
        <Badge variant='destructive' className='text-[10px]'>
          <XCircle className='mr-1 h-2.5 w-2.5' />
          failed
        </Badge>
      )
    case 'cancelled':
      return (
        <Badge variant='secondary' className='text-[10px]'>
          cancelled
        </Badge>
      )
    default:
      return (
        <Badge variant='outline' className='text-[10px]'>
          {status}
        </Badge>
      )
  }
}

interface RecentJobsCardProps {
  defaultOpen?: boolean
  /** Override the outer Card chrome — pass e.g. `'border-0 shadow-none rounded-none gap-0 py-0'`
   *  when embedding inside a parent unified panel that owns the border/shadow itself. */
  className?: string
  /** Override the row limit. Server clamps to 1..=200; defaults to 50. */
  limit?: number
}

export function RecentJobsCard({
  defaultOpen = true,
  className,
  limit = DEFAULT_LIMIT,
}: RecentJobsCardProps) {
  const orgId = useOrgId()
  const [jobs, setJobs] = useState<RecentJob[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(defaultOpen)
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const rows = await getRecentJobs({ limit })
      setJobs(rows)
      setLastFetchedAt(Date.now())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [orgId, limit])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // WS-driven incremental updates. Migration 271 emits a NOTIFY on
  // every `sap_agent_jobs` row change; the rust-work-service
  // sap_jobs_listener fans that out as a `SapJobStatusChanged` event.
  // We re-fetch the full snapshot on each push (rather than splice)
  // because the jobs list is bounded at 50 rows and the round-trip is
  // a single indexed query — much simpler than reconciling per-row
  // state with the local cache.
  useEffect(() => {
    if (!orgId) return
    const handler: WsEventHandler = (event: WsEvent) => {
      if (event.type !== 'SapJobStatusChanged') return
      // Defence-in-depth org filter — the Rust send loop already
      // partitions per org, but a second check guards against future
      // protocol bugs.
      if (event.organization_id && event.organization_id !== orgId) return
      void refresh()
    }
    workServiceWs.connect(orgId, handler)
    return () => {
      workServiceWs.removeHandler(handler)
    }
  }, [orgId, refresh])

  const summary = useMemo(() => {
    let running = 0
    let queued = 0
    let failed = 0
    for (const j of jobs) {
      if (j.status === 'running') running++
      else if (j.status === 'queued') queued++
      else if (j.status === 'failed') failed++
    }
    return { running, queued, failed }
  }, [jobs])

  return (
    <Card className={cn('gap-0 py-0 shadow-sm', className)}>
      <CardHeader
        className='hover:bg-accent/30 flex cursor-pointer flex-row items-center justify-between space-y-0 py-2.5 transition-colors'
        onClick={() => setOpen((v) => !v)}
      >
        <CardTitle className='text-muted-foreground flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] uppercase'>
          {open ? (
            <ChevronDown className='h-3.5 w-3.5' />
          ) : (
            <ChevronRight className='h-3.5 w-3.5' />
          )}
          <ListChecks className='h-3.5 w-3.5 text-sky-500' />
          Recent SAP Jobs
          <Badge variant='outline' className='text-[10px]'>
            {jobs.length}
          </Badge>
          {summary.running > 0 && (
            <Badge
              variant='outline'
              className='border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400'
            >
              {summary.running} running
            </Badge>
          )}
          {summary.queued > 0 && (
            <Badge variant='outline' className='text-[10px]'>
              {summary.queued} queued
            </Badge>
          )}
          {summary.failed > 0 && (
            <Badge variant='destructive' className='text-[10px]'>
              {summary.failed} failed
            </Badge>
          )}
        </CardTitle>
        <div className='flex items-center gap-1'>
          <Button
            size='icon'
            variant='ghost'
            className='h-6 w-6'
            onClick={(e) => {
              e.stopPropagation()
              void refresh()
            }}
            title='Refresh recent jobs'
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className='pt-0 pb-3'>
          {error && (
            <div className='border-destructive/30 bg-destructive/5 text-destructive mb-2 flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs'>
              <AlertTriangle className='h-3 w-3' />
              <span className='truncate'>{error}</span>
            </div>
          )}
          {jobs.length === 0 ? (
            <div className='text-muted-foreground py-3 text-center text-xs'>
              <Clock className='mx-auto mb-1 h-4 w-4' />
              No recent SAP-agent jobs in this org yet. Run a queue-mode batch
              from the SAP Testing playbook to populate the ledger.
            </div>
          ) : (
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow className='[&_th]:h-8 [&_th]:px-2 [&_th]:text-[10px] [&_th]:font-semibold [&_th]:tracking-wide [&_th]:uppercase'>
                    <TableHead>TO Number</TableHead>
                    <TableHead>Warehouse</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => {
                    const toNumber = job.payload_summary?.to_number ?? '—'
                    const warehouse = job.payload_summary?.warehouse ?? '—'
                    const agentLabel =
                      job.assigned_agent_hostname ||
                      job.assigned_agent_id ||
                      '—'
                    const startedRel = relTime(job.claimed_at ?? job.created_at)
                    const dur = duration(
                      job.claimed_at ?? job.created_at,
                      job.completed_at
                    )
                    return (
                      <TableRow
                        key={job.id}
                        className='[&_td]:h-8 [&_td]:px-2 [&_td]:py-1 [&_td]:text-xs'
                        title={job.error || job.endpoint}
                      >
                        <TableCell className='font-mono'>{toNumber}</TableCell>
                        <TableCell className='font-mono text-[11px]'>
                          {warehouse}
                        </TableCell>
                        <TableCell>{statusBadge(job.status)}</TableCell>
                        <TableCell
                          className='truncate font-mono text-[11px]'
                          title={agentLabel}
                        >
                          {agentLabel}
                        </TableCell>
                        <TableCell className='text-muted-foreground'>
                          {startedRel}
                        </TableCell>
                        <TableCell className='text-muted-foreground'>
                          {dur}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {lastFetchedAt && (
            <div className='text-muted-foreground mt-2 text-right text-[10px]'>
              refreshed {new Date(lastFetchedAt).toLocaleTimeString()}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

// Created and developed by Jai Singh
