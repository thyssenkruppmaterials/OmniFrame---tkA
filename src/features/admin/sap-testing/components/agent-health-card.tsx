// Created and developed by Jai Singh
import { useEffect, useState } from 'react'
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { agentFetch } from '../lib/agent-fetch'
import { AgentSupabaseStatusButton } from './agent-supabase-status-button'

/**
 * Phase B6 — AgentHealthCard
 *
 * Polls `/metrics` every 30s and renders a collapsible panel showing
 * uptime, current action, per-action transaction breakdown, and the
 * last 5 errors. Designed to live below the status bar in the Inventory
 * Management tab.
 *
 * The numbers are lifetime-of-process (in-memory on the agent). For a
 * persistent rollup, query `sap_audit_log` directly.
 */

interface ActionStats {
  success: number
  fail: number
  warning: number
  avg_ms: number
  total: number
}

interface AgentMetrics {
  ok: boolean
  version?: string
  uptime_seconds?: number
  sap_connected?: boolean
  session_info?: {
    system?: string
    client?: string
    user?: string
    transaction?: string
  }
  transactions_24h?: Record<string, ActionStats>
  current_action?: { action?: string; started_at?: string } | null
  last_5_errors?: Array<{ action?: string; error?: string; at?: string }>
  queue_poller_active?: boolean
  capabilities?: string[]
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 1) return '<1s'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  if (mins > 0) return `${mins}m`
  return `${seconds}s`
}

interface AgentHealthCardProps {
  agentConnected: boolean
  defaultOpen?: boolean
  /** Override the outer Card chrome — pass e.g. `'border-0 shadow-none rounded-none gap-0 py-0'`
   *  when embedding inside a parent unified panel that owns the border/shadow itself. */
  className?: string
}

export function AgentHealthCard({
  agentConnected,
  defaultOpen = false,
  className,
}: AgentHealthCardProps) {
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null)
  const [open, setOpen] = useState(defaultOpen)
  const [loading, setLoading] = useState(false)
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null)

  const refresh = async () => {
    if (!agentConnected) {
      setMetrics(null)
      return
    }
    setLoading(true)
    try {
      const res = await agentFetch('/metrics', {
        signal: AbortSignal.timeout(2500),
      })
      if (res.ok) {
        const data = (await res.json()) as AgentMetrics
        setMetrics(data)
        setLastFetchedAt(Date.now())
      }
    } catch {
      /* keep last known */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 30_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentConnected])

  const txns = metrics?.transactions_24h ?? {}
  const txnEntries = Object.entries(txns).sort(
    ([, a], [, b]) => (b.total || 0) - (a.total || 0)
  )
  const totalAll = txnEntries.reduce((acc, [, v]) => acc + (v.total || 0), 0)
  const totalErrors = txnEntries.reduce((acc, [, v]) => acc + (v.fail || 0), 0)

  return (
    <Card className={cn('gap-0 py-0 shadow-sm', className)}>
      <CardHeader
        className='hover:bg-accent/30 flex cursor-pointer flex-row items-center justify-between space-y-0 py-2.5 transition-colors'
        onClick={() => setOpen((v) => !v)}
      >
        <CardTitle className='text-muted-foreground flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] uppercase'>
          <Activity className='h-3.5 w-3.5 text-blue-500' />
          Agent Health
          {metrics?.uptime_seconds !== undefined && (
            <Badge variant='outline' className='text-[10px]'>
              <Clock className='mr-1 h-2.5 w-2.5' />
              up {formatDuration(metrics.uptime_seconds)}
            </Badge>
          )}
          {metrics?.current_action && (
            <Badge
              variant='outline'
              className='border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400'
            >
              <Cpu className='mr-1 h-2.5 w-2.5 animate-pulse' />
              {metrics.current_action.action}
            </Badge>
          )}
          {totalAll > 0 && (
            <Badge variant='secondary' className='text-[10px]'>
              {totalAll} txns · {totalErrors} errors
            </Badge>
          )}
          {metrics?.queue_poller_active && (
            <Badge
              variant='outline'
              className='border-emerald-500/40 text-[10px] text-emerald-600 dark:text-emerald-400'
            >
              queue: live
            </Badge>
          )}
        </CardTitle>
        <div className='flex items-center gap-1'>
          {agentConnected && (
            <AgentSupabaseStatusButton size='compact' className='mr-1' />
          )}
          <Button
            size='icon'
            variant='ghost'
            className='h-6 w-6'
            onClick={(e) => {
              e.stopPropagation()
              void refresh()
            }}
            disabled={!agentConnected}
            title='Refresh metrics'
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          </Button>
          {open ? (
            <ChevronUp className='text-muted-foreground h-4 w-4' />
          ) : (
            <ChevronDown className='text-muted-foreground h-4 w-4' />
          )}
        </div>
      </CardHeader>
      {open && metrics && (
        <CardContent className='space-y-3 pt-0 pb-3 text-xs'>
          {metrics.session_info?.system && (
            <div className='text-muted-foreground'>
              <span className='font-medium'>Session: </span>
              <span className='font-mono'>
                {metrics.session_info.system} / cl{metrics.session_info.client}{' '}
                / {metrics.session_info.user}
              </span>
              {metrics.session_info.transaction && (
                <Badge variant='outline' className='ml-2 font-mono text-[10px]'>
                  tx: {metrics.session_info.transaction}
                </Badge>
              )}
            </div>
          )}

          {txnEntries.length > 0 && (
            <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
              {txnEntries.map(([action, stats]) => {
                const errPct =
                  stats.total > 0
                    ? Math.round((stats.fail / stats.total) * 100)
                    : 0
                return (
                  <div
                    key={action}
                    className='bg-muted/30 rounded-md border p-2'
                  >
                    <div className='flex items-center justify-between'>
                      <span className='truncate font-mono text-[10px]'>
                        {action}
                      </span>
                      <span className='text-muted-foreground text-[10px]'>
                        {stats.avg_ms}ms avg
                      </span>
                    </div>
                    <div className='mt-1 flex items-center gap-2 text-[10px]'>
                      <span className='text-emerald-600 dark:text-emerald-400'>
                        ✓ {stats.success}
                      </span>
                      {stats.warning > 0 && (
                        <span className='text-amber-600 dark:text-amber-400'>
                          ⚠ {stats.warning}
                        </span>
                      )}
                      <span className='text-red-600 dark:text-red-400'>
                        ✗ {stats.fail}
                      </span>
                      {errPct > 0 && (
                        <span className='ml-auto text-red-600 dark:text-red-400'>
                          {errPct}%
                        </span>
                      )}
                    </div>
                    {/* mini sparkline-ish: success bar */}
                    <div className='bg-muted mt-1 flex h-1 overflow-hidden rounded'>
                      {stats.success > 0 && (
                        <div
                          className='bg-emerald-500'
                          style={{
                            width: `${(stats.success / stats.total) * 100}%`,
                          }}
                        />
                      )}
                      {stats.warning > 0 && (
                        <div
                          className='bg-amber-500'
                          style={{
                            width: `${(stats.warning / stats.total) * 100}%`,
                          }}
                        />
                      )}
                      {stats.fail > 0 && (
                        <div
                          className='bg-red-500'
                          style={{
                            width: `${(stats.fail / stats.total) * 100}%`,
                          }}
                        />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {(metrics.last_5_errors ?? []).length > 0 && (
            <div className='space-y-1'>
              <div className='text-muted-foreground flex items-center gap-1 text-[10px] uppercase'>
                <AlertCircle className='h-3 w-3 text-red-500' />
                Last errors
              </div>
              <ul className='space-y-1'>
                {(metrics.last_5_errors ?? []).map((err, i) => (
                  <li
                    key={`${err.at}-${i}`}
                    className='rounded border border-red-500/30 bg-red-500/5 p-1.5 font-mono text-[10px] text-red-600 dark:text-red-400'
                  >
                    <span className='font-semibold'>{err.action}</span>:{' '}
                    {err.error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {txnEntries.length === 0 && (
            <div className='text-muted-foreground py-2 text-center'>
              <CheckCircle2 className='mx-auto mb-1 h-3 w-3 text-emerald-500' />
              No transactions yet — run a SAP action to see metrics here.
            </div>
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

// Created and developed by Jai Singh
