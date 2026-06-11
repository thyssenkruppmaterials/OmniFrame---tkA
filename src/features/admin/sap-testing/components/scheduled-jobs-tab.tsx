// Created and developed by Jai Singh
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlarmClock,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  Pencil,
  Pin,
  PlayCircle,
  Plus,
  Power,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useOnlineSapAgents } from './agents-fleet-card'

/**
 * Phase D #14 — Scheduled / Recurring SAP Agent Jobs
 *
 * Browser-side CRUD over `public.sap_agent_schedules`. The Postgres
 * function `enqueue_due_schedules()` (run by pg_cron every minute, or
 * called manually as a fallback) promotes due rows into
 * `public.sap_agent_jobs`, which the on-prem agent then claims and runs
 * exactly like any other queued job.
 *
 * Cron expression UX:
 *   - One-click presets ("Every 15 minutes", "Daily at 03:00", etc.)
 *     for the common ops use cases.
 *   - Free-form text box for power users. The Postgres-side parser
 *     supports `*\/N * * * *`, `0 *\/N * * *`, `0 H * * *`,
 *     `0 H * * D` — anything else is treated as "+1 hour" with a
 *     `last_error` stamped on the row.
 */

interface ScheduleRow {
  id: string
  organization_id: string
  name: string
  description: string | null
  enabled: boolean
  cron_expression: string
  endpoint: string
  payload: Record<string, unknown>
  assigned_agent_id: string | null
  max_attempts: number
  priority: number
  last_run_at: string | null
  last_job_id: string | null
  last_error: string | null
  next_run_at: string
  created_by: string | null
  created_at: string
  updated_at: string
}

interface ScheduleDraft {
  id?: string
  name: string
  description: string
  enabled: boolean
  cron_expression: string
  endpoint: string
  payload_text: string
  assigned_agent_id: string | null
}

const CRON_PRESETS: Array<{ label: string; expr: string; help: string }> = [
  {
    label: 'Every 15 minutes',
    expr: '*/15 * * * *',
    help: 'Runs every quarter-hour.',
  },
  {
    label: 'Every 30 minutes',
    expr: '*/30 * * * *',
    help: 'Runs every half-hour.',
  },
  {
    label: 'Every hour',
    expr: '0 */1 * * *',
    help: 'Runs at minute 0 of every hour.',
  },
  {
    label: 'Every 4 hours',
    expr: '0 */4 * * *',
    help: 'Runs at 00:00, 04:00, 08:00 …',
  },
  {
    label: 'Daily at 03:00',
    expr: '0 3 * * *',
    help: 'Runs once per day at 3am UTC.',
  },
  {
    label: 'Daily at 06:00',
    expr: '0 6 * * *',
    help: 'Runs once per day at 6am UTC.',
  },
  {
    label: 'Weekly Monday 06:00',
    expr: '0 6 * * 1',
    help: 'Runs every Monday at 6am UTC.',
  },
]

const ENDPOINT_PRESETS: Array<{ label: string; value: string }> = [
  { label: '/sap/confirm-to', value: '/sap/confirm-to' },
  { label: '/sap/transfer-inventory', value: '/sap/transfer-inventory' },
  { label: '/sap/bin-blocks', value: '/sap/bin-blocks' },
  { label: '/sap/material-master-bin', value: '/sap/material-master-bin' },
  {
    label: '/sap/material-master-storage-types',
    value: '/sap/material-master-storage-types',
  },
  { label: '/sap/create-storage-bin', value: '/sap/create-storage-bin' },
  { label: '/sap/process-shipment', value: '/sap/process-shipment' },
  { label: '/sap/query', value: '/sap/query' },
]

const EMPTY_DRAFT: ScheduleDraft = {
  name: '',
  description: '',
  enabled: true,
  cron_expression: '0 6 * * *',
  endpoint: '/sap/confirm-to',
  payload_text: '{\n  \n}',
  assigned_agent_id: null,
}

function relTime(ts: string | null | undefined): string {
  if (!ts) return '—'
  const t = Date.parse(ts)
  if (!t) return ts
  const diff = Date.now() - t
  const past = diff >= 0
  const abs = Math.abs(diff)
  const sec = Math.floor(abs / 1000)
  if (sec < 60) return past ? `${sec}s ago` : `in ${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return past ? `${min}m ago` : `in ${min}m`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return past ? `${hrs}h ago` : `in ${hrs}h`
  const days = Math.floor(hrs / 24)
  return past ? `${days}d ago` : `in ${days}d`
}

function describeCron(expr: string): string {
  const trimmed = (expr || '').trim()
  for (const p of CRON_PRESETS) if (p.expr === trimmed) return p.label
  return trimmed || '(empty)'
}

export function ScheduledJobsTab() {
  const [rows, setRows] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(false)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState<ScheduleDraft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [runNowBusy, setRunNowBusy] = useState<string | null>(null)
  const onlineAgents = useOnlineSapAgents()

  const loadOrg = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser()
    const uid = authData.user?.id ?? null
    setUserId(uid)
    if (!uid) {
      setOrgId(null)
      return null
    }
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', uid)
      .maybeSingle()
    const oid = (profile?.organization_id as string | undefined) ?? null
    setOrgId(oid)
    return oid
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const oid = orgId ?? (await loadOrg())
      if (!oid) {
        setRows([])
        return
      }
      // sap_agent_schedules is added in migration 248 — generated DB
      // types don't include it yet; cast through to bypass the
      // typed-table overload.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = supabase as any
      const { data, error } = await client
        .from('sap_agent_schedules')
        .select('*')
        .eq('organization_id', oid)
        .order('next_run_at', { ascending: true })
      if (error) {
        toast.error('Failed to load schedules', { description: error.message })
        return
      }
      setRows((data ?? []) as ScheduleRow[])
    } finally {
      setLoading(false)
    }
  }, [loadOrg, orgId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Realtime: refresh when any schedule row changes (so manual "Run now"
  // and pg_cron promotions update last_run_at without a manual reload).
  //
  // 2026-05-06 — added `organization_id=eq.<orgId>` server-side filter.
  // Previously this channel subscribed to `postgres_changes *` on
  // `sap_agent_schedules` with NO filter, which caused row UPDATEs from
  // every other tenant to fan out into this tab and trigger an
  // unrelated `refresh()` per cross-tenant change. The refresh itself
  // is org-scoped via the `eq('organization_id', oid)` predicate in
  // `refresh()` so no other-org rows ever rendered, but the channel
  // metadata (timing, fan-out shape, write volume) was leaking. The
  // filter here closes that side channel — and lines this consumer up
  // with the soon-to-land `WsEvent::SapScheduleChanged` migration
  // documented in [[Decisions/Roadmap-Rust-WS-Unlocks]].
  useEffect(() => {
    if (!orgId) return
    const channel = supabase.channel('sap-agent-schedules-tab')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(channel as any).on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'sap_agent_schedules',
        filter: `organization_id=eq.${orgId}`,
      },
      () => {
        void refresh()
      }
    )
    channel.subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [orgId, refresh])

  const openCreate = () => {
    setDraft(EMPTY_DRAFT)
    setEditorOpen(true)
  }

  const openEdit = (row: ScheduleRow) => {
    setDraft({
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      enabled: row.enabled,
      cron_expression: row.cron_expression,
      endpoint: row.endpoint,
      payload_text: JSON.stringify(row.payload ?? {}, null, 2),
      assigned_agent_id: row.assigned_agent_id ?? null,
    })
    setEditorOpen(true)
  }

  const saveDraft = async () => {
    if (!orgId) {
      toast.error('No organization context — cannot save schedule.')
      return
    }
    let payload: Record<string, unknown> = {}
    try {
      const t = draft.payload_text.trim()
      payload = t ? JSON.parse(t) : {}
    } catch (e) {
      toast.error('Payload JSON is invalid', {
        description: e instanceof Error ? e.message : String(e),
      })
      return
    }
    if (!draft.name.trim()) {
      toast.error('Name is required.')
      return
    }
    if (!draft.cron_expression.trim()) {
      toast.error('Cron expression is required.')
      return
    }
    if (!draft.endpoint.trim()) {
      toast.error('Endpoint is required.')
      return
    }
    setSaving(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = supabase as any
      if (draft.id) {
        const { error } = await client
          .from('sap_agent_schedules')
          .update({
            name: draft.name.trim(),
            description: draft.description.trim() || null,
            enabled: draft.enabled,
            cron_expression: draft.cron_expression.trim(),
            endpoint: draft.endpoint.trim(),
            payload,
            assigned_agent_id: draft.assigned_agent_id || null,
          })
          .eq('id', draft.id)
        if (error) {
          toast.error('Update failed', { description: error.message })
          return
        }
        toast.success('Schedule updated')
      } else {
        const { error } = await client.from('sap_agent_schedules').insert({
          organization_id: orgId,
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          enabled: draft.enabled,
          cron_expression: draft.cron_expression.trim(),
          endpoint: draft.endpoint.trim(),
          payload,
          assigned_agent_id: draft.assigned_agent_id || null,
          created_by: userId,
        })
        if (error) {
          toast.error('Create failed', { description: error.message })
          return
        }
        toast.success('Schedule created')
      }
      setEditorOpen(false)
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (row: ScheduleRow) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = supabase as any
    const { error } = await client
      .from('sap_agent_schedules')
      .update({ enabled: !row.enabled })
      .eq('id', row.id)
    if (error) {
      toast.error('Toggle failed', { description: error.message })
      return
    }
    void refresh()
  }

  const deleteRow = async (row: ScheduleRow) => {
    if (!confirm(`Delete schedule "${row.name}"? This cannot be undone.`))
      return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = supabase as any
    const { error } = await client
      .from('sap_agent_schedules')
      .delete()
      .eq('id', row.id)
    if (error) {
      toast.error('Delete failed', { description: error.message })
      return
    }
    toast.success('Schedule deleted')
    void refresh()
  }

  const runNow = async (row: ScheduleRow) => {
    // "Run now" inserts a one-off sap_agent_jobs row using the schedule's
    // endpoint + payload + (optional) pin. We don't fiddle with
    // next_run_at — the next pg_cron tick (or polling fallback) will
    // still fire on time.
    if (!orgId) return
    setRunNowBusy(row.id)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = supabase as any
      const { error } = await client.from('sap_agent_jobs').insert({
        organization_id: orgId,
        requested_by: userId,
        endpoint: row.endpoint,
        payload: row.payload,
        priority: row.priority,
        max_attempts: row.max_attempts,
        assigned_agent_id: row.assigned_agent_id,
        idempotency_key: `manual:${row.id}:${Date.now()}`,
        status: 'queued',
      })
      if (error) {
        toast.error('Run-now failed', { description: error.message })
        return
      }
      toast.success(`Queued one-off run of "${row.name}"`)
    } finally {
      setRunNowBusy(null)
    }
  }

  const exportCsv = () => {
    if (rows.length === 0) {
      toast.warning('No schedules to export.')
      return
    }
    const header = [
      'name',
      'enabled',
      'cron_expression',
      'endpoint',
      'assigned_agent_id',
      'last_run_at',
      'next_run_at',
      'last_error',
    ]
    const lines = [header.join(',')]
    for (const r of rows) {
      const cells = [
        JSON.stringify(r.name),
        r.enabled ? 'true' : 'false',
        JSON.stringify(r.cron_expression),
        JSON.stringify(r.endpoint),
        JSON.stringify(r.assigned_agent_id ?? ''),
        JSON.stringify(r.last_run_at ?? ''),
        JSON.stringify(r.next_run_at ?? ''),
        JSON.stringify(r.last_error ?? ''),
      ]
      lines.push(cells.join(','))
    }
    const blob = new Blob([lines.join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `sap-agent-schedules-${Date.now()}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const stats = useMemo(() => {
    const enabled = rows.filter((r) => r.enabled).length
    const errored = rows.filter((r) => r.last_error).length
    const dueSoon = rows.filter((r) => {
      const t = Date.parse(r.next_run_at)
      return r.enabled && t && t - Date.now() < 60_000
    }).length
    return { enabled, errored, dueSoon }
  }, [rows])

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <div>
            <CardTitle className='flex items-center gap-2'>
              <CalendarClock className='h-5 w-5 text-blue-500' />
              Scheduled Jobs
              <Badge variant='outline' className='text-[10px]'>
                {stats.enabled} enabled / {rows.length} total
              </Badge>
              {stats.errored > 0 && (
                <Badge
                  variant='outline'
                  className='border-red-500/40 text-[10px] text-red-600 dark:text-red-400'
                >
                  <AlertTriangle className='mr-1 h-2.5 w-2.5' />
                  {stats.errored} with errors
                </Badge>
              )}
              {stats.dueSoon > 0 && (
                <Badge
                  variant='outline'
                  className='border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400'
                >
                  {stats.dueSoon} due in &lt;1 min
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Recurring SAP automations enqueued by Postgres on a cron schedule.
              The on-prem agent claims and runs them just like any other queued
              job — no agent code changes required.
            </CardDescription>
          </div>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={exportCsv}
              disabled={loading || rows.length === 0}
            >
              <Download className='mr-1 h-3 w-3' />
              CSV
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw
                className={cn('mr-1 h-3 w-3', loading && 'animate-spin')}
              />
              Refresh
            </Button>
            <Button size='sm' onClick={openCreate}>
              <Plus className='mr-1 h-3 w-3' />
              New schedule
            </Button>
          </div>
        </CardHeader>
        <CardContent className='space-y-3'>
          {rows.length === 0 ? (
            <div className='text-muted-foreground rounded-md border border-dashed py-8 text-center text-sm'>
              No scheduled jobs yet. Click <strong>New schedule</strong> to
              automate a recurring SAP operation (nightly putaway sweep, hourly
              master-data sync, etc.).
            </div>
          ) : (
            <div className='rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-[24%]'>Name</TableHead>
                    <TableHead>Cron</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Pinned to</TableHead>
                    <TableHead>Last run</TableHead>
                    <TableHead>Next run</TableHead>
                    <TableHead className='w-[1%]'>Enabled</TableHead>
                    <TableHead className='w-[1%]'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className={cn(!row.enabled && 'opacity-60')}
                    >
                      <TableCell>
                        <div className='flex flex-col'>
                          <span className='font-medium'>{row.name}</span>
                          {row.description && (
                            <span className='text-muted-foreground truncate text-xs'>
                              {row.description}
                            </span>
                          )}
                          {row.last_error && (
                            <span
                              className='mt-0.5 truncate text-[10px] text-red-600 dark:text-red-400'
                              title={row.last_error}
                            >
                              <AlertTriangle className='mr-0.5 inline h-2.5 w-2.5' />
                              {row.last_error}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className='flex flex-col'>
                          <code className='font-mono text-xs'>
                            {row.cron_expression}
                          </code>
                          <span className='text-muted-foreground text-[10px]'>
                            {describeCron(row.cron_expression)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className='font-mono text-xs'>
                          {row.endpoint}
                        </code>
                      </TableCell>
                      <TableCell>
                        {row.assigned_agent_id ? (
                          <Badge
                            variant='outline'
                            className='border-purple-500/40 text-[10px] text-purple-700 dark:text-purple-300'
                          >
                            <Pin className='mr-1 h-2.5 w-2.5' />
                            {row.assigned_agent_id}
                          </Badge>
                        ) : (
                          <span className='text-muted-foreground text-xs'>
                            any
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className='flex flex-col text-xs'>
                          <span>{relTime(row.last_run_at)}</span>
                          {row.last_run_at && (
                            <span className='text-muted-foreground text-[10px]'>
                              {new Date(row.last_run_at).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className='flex flex-col text-xs'>
                          <span>{relTime(row.next_run_at)}</span>
                          <span className='text-muted-foreground text-[10px]'>
                            {new Date(row.next_run_at).toLocaleString()}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={row.enabled}
                          onCheckedChange={() => void toggleEnabled(row)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className='flex items-center gap-1'>
                          <Button
                            size='icon'
                            variant='ghost'
                            className='h-7 w-7'
                            title='Run now (queues a one-off job using this schedule)'
                            disabled={runNowBusy === row.id}
                            onClick={() => void runNow(row)}
                          >
                            {runNowBusy === row.id ? (
                              <Loader2 className='h-3.5 w-3.5 animate-spin' />
                            ) : (
                              <PlayCircle className='h-3.5 w-3.5' />
                            )}
                          </Button>
                          <Button
                            size='icon'
                            variant='ghost'
                            className='h-7 w-7'
                            title='Edit'
                            onClick={() => openEdit(row)}
                          >
                            <Pencil className='h-3.5 w-3.5' />
                          </Button>
                          <Button
                            size='icon'
                            variant='ghost'
                            className='h-7 w-7 text-red-600 hover:text-red-700 dark:text-red-400'
                            title='Delete'
                            onClick={() => void deleteRow(row)}
                          >
                            <Trash2 className='h-3.5 w-3.5' />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className='text-muted-foreground flex items-center gap-3 text-[11px]'>
            <Clock className='h-3 w-3' />
            <span>
              Schedules are evaluated by Postgres (pg_cron when available) every
              minute. Times are stored / displayed in your browser's local
              timezone but the cron parser interprets HH:MM in UTC.
            </span>
          </div>
        </CardContent>
      </Card>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className='max-w-2xl'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <AlarmClock className='h-4 w-4' />
              {draft.id ? 'Edit schedule' : 'New schedule'}
            </DialogTitle>
            <DialogDescription>
              Recurring runs of an agent endpoint. The Postgres
              `enqueue_due_schedules()` function promotes due rows into
              `sap_agent_jobs`; the on-prem agent claims them like any
              user-submitted batch.
            </DialogDescription>
          </DialogHeader>

          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1 sm:col-span-2'>
              <Label htmlFor='sched-name'>Name *</Label>
              <Input
                id='sched-name'
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                placeholder='e.g. Nightly putaway sweep (LT12)'
              />
            </div>
            <div className='space-y-1 sm:col-span-2'>
              <Label htmlFor='sched-desc'>Description</Label>
              <Input
                id='sched-desc'
                value={draft.description}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value }))
                }
                placeholder='What this schedule does and why it exists'
              />
            </div>

            <div className='space-y-1 sm:col-span-2'>
              <Label>Cron expression *</Label>
              <div className='flex flex-wrap gap-1'>
                {CRON_PRESETS.map((p) => (
                  <Button
                    key={p.expr}
                    variant={
                      draft.cron_expression === p.expr ? 'default' : 'outline'
                    }
                    size='sm'
                    type='button'
                    className='h-6 text-[11px]'
                    onClick={() =>
                      setDraft((d) => ({ ...d, cron_expression: p.expr }))
                    }
                    title={p.help}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <Input
                value={draft.cron_expression}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, cron_expression: e.target.value }))
                }
                placeholder='*/15 * * * *'
                className='font-mono'
              />
              <p className='text-muted-foreground text-[11px]'>
                Supported forms (Postgres-side parser): <code>*/N * * * *</code>{' '}
                · <code>0 */N * * *</code> · <code>0 H * * *</code> ·{' '}
                <code>0 H * * D</code> (D=0–6, Sun–Sat). Anything else falls
                back to "+1 hour" with a last_error stamped.
              </p>
            </div>

            <div className='space-y-1'>
              <Label>Endpoint *</Label>
              <select
                className='border-input bg-background h-9 w-full rounded-md border px-2 font-mono text-xs'
                value={
                  ENDPOINT_PRESETS.some((p) => p.value === draft.endpoint)
                    ? draft.endpoint
                    : '__custom__'
                }
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '__custom__') return
                  setDraft((d) => ({ ...d, endpoint: v }))
                }}
              >
                {ENDPOINT_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
                <option value='__custom__'>Custom…</option>
              </select>
              <Input
                value={draft.endpoint}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, endpoint: e.target.value }))
                }
                placeholder='/sap/...'
                className='font-mono text-xs'
              />
            </div>

            <div className='space-y-1'>
              <Label>Pin to agent</Label>
              <select
                className='border-input bg-background h-9 w-full rounded-md border px-2 text-sm'
                value={draft.assigned_agent_id ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    assigned_agent_id: e.target.value || null,
                  }))
                }
              >
                <option value=''>Any online agent</option>
                {onlineAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.hostname || agent.id}
                    {agent.citrix_session ? ` (${agent.citrix_session})` : ''}
                  </option>
                ))}
              </select>
              <p className='text-muted-foreground text-[11px]'>
                When set, only that agent can claim the job. Useful when the
                schedule must run on a specific warehouse's Citrix session.
              </p>
            </div>

            <div className='space-y-1 sm:col-span-2'>
              <Label htmlFor='sched-payload'>Payload (JSON)</Label>
              <Textarea
                id='sched-payload'
                value={draft.payload_text}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, payload_text: e.target.value }))
                }
                rows={6}
                className='font-mono text-xs'
              />
              <p className='text-muted-foreground text-[11px]'>
                Sent verbatim as the job's payload. Schema must match the
                endpoint's expected request body (see Inventory Management form
                fields for guidance).
              </p>
            </div>

            <div className='flex items-center gap-2 sm:col-span-2'>
              <Switch
                checked={draft.enabled}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
              />
              <Label>
                {draft.enabled ? (
                  <span className='inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400'>
                    <CheckCircle2 className='h-3.5 w-3.5' />
                    Enabled — will fire on next due time
                  </span>
                ) : (
                  <span className='text-muted-foreground inline-flex items-center gap-1'>
                    <XCircle className='h-3.5 w-3.5' />
                    Disabled — will not fire until re-enabled
                  </span>
                )}
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setEditorOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={() => void saveDraft()} disabled={saving}>
              {saving ? (
                <Loader2 className='mr-2 h-3 w-3 animate-spin' />
              ) : (
                <Power className='mr-2 h-3 w-3' />
              )}
              {draft.id ? 'Save changes' : 'Create schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Created and developed by Jai Singh
