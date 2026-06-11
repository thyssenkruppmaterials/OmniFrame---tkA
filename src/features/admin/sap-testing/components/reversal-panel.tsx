// Created and developed by Jai Singh
/**
 * Phase D #15 — SAP Reversal / Rollback Engine UI.
 *
 * "Time machine" for SAP mutations. The user:
 *   1. Filters the audit log (date, action type, user, status, search).
 *   2. Selects N rows to reverse (or a whole batch by `batch_id`).
 *   3. Hits "Compute Inverse" — the agent computes each inverse payload
 *      and shows a preview. Rows whose action is irreversible (LT12)
 *      or that are missing prev_state are flagged red.
 *   4. Hits "Queue Reversal Batch" — each reversible row becomes a
 *      `sap_agent_jobs` row that hits the SAME mutation endpoint as
 *      the original (just with the inverse payload). Completion is
 *      tracked via the existing `useJobQueue` Realtime subscription.
 *      A new `reversal` audit row is written for each, linked to the
 *      original via `reverses_audit_id`. The original row's
 *      `reversal_status` is bumped to 'reversed' via the
 *      `mark_audit_row_reversed` RPC.
 *
 * Reads `sap_audit_log` directly via the Supabase client (org-scoped
 * RLS does the filtering). Reversal jobs are enqueued through
 * `useJobQueue` — no new agent endpoints needed beyond
 * `/sap/reversal/compute-inverse` (a pure function) which the agent
 * exposes via `omni_agent/reversal_engine.py`.
 *
 * NOTE: this panel does NOT touch the queue scheduling logic
 * (Worker A's territory). It only INSERTs into `sap_agent_jobs` and
 * SELECTs from `sap_audit_log`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Filter,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
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
import { Checkbox } from '@/components/ui/checkbox'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useJobQueue } from '../hooks/use-job-queue'
import { type AgentHealth, agentFetch, hasCapability } from '../lib/agent-fetch'
import { insertReversalAuditRow, markAuditRowReversed } from '../lib/sap-audit'

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

interface SapAuditRow {
  id: string
  organization_id: string
  user_id: string | null
  transaction_code: string
  action: string
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  status: 'success' | 'error' | 'warning'
  step: string | null
  sap_message: string | null
  sap_message_type: string | null
  agent_version: string | null
  duration_ms: number | null
  job_id: string | null
  prev_state: Record<string, unknown> | null
  reversal_status:
    | 'original'
    | 'reversal'
    | 'reversed'
    | 'cannot_reverse'
    | null
  reverses_audit_id: string | null
  created_at: string
}

interface ComputedInverse {
  auditId: string
  /** True if the agent could compute an inverse for this row. */
  reversible: boolean
  /** Agent endpoint that the reversal job should hit (same as the
   *  forward mutation endpoint). */
  endpoint?: string
  /** The inverse payload to enqueue. */
  inversePayload?: Record<string, unknown>
  /** Reason / human-readable explanation when not reversible. */
  reason?: string
  message?: string
  /** Short summary of the original → inverse change for the preview. */
  summary: string
}

interface ReversalRunResult {
  auditId: string
  jobId: string | null
  status: 'queued' | 'completed' | 'failed' | 'canceled' | 'error'
  reversalAuditId: string | null
  error?: string
}

interface ReversalPanelProps {
  agentHealth: AgentHealth | null
  agentConnected: boolean
  agentVersion?: string
}

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'material_master_bin', label: 'MM02 — change storage bin' },
  {
    value: 'material_master_storage_types',
    label: 'MM02 — storage types (LTKZA / LTKZE)',
  },
  { value: 'transfer_inventory', label: 'LT01 — transfer inventory' },
  { value: 'set_bin_blocks', label: 'LS02N — bin blocks (putaway / removal)' },
  {
    value: 'confirm_transfer_order',
    label: 'LT12 — confirm TO (irreversible)',
  },
]

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'success', label: 'success' },
  { value: 'warning', label: 'warning' },
  { value: 'error', label: 'error' },
]

/** Mutation endpoints by action — same as the forward endpoint that
 *  produced the audit row. Falls back to `compute_inverse` response
 *  when present, but we keep this map as a defensive lookup so we can
 *  still queue reversals even if the agent is offline (preview UX). */
const ENDPOINT_FOR_ACTION: Record<string, string> = {
  material_master_bin: '/sap/material-master-bin',
  material_master_storage_types: '/sap/material-master-storage-types',
  transfer_inventory: '/sap/transfer-inventory',
  set_bin_blocks: '/sap/bin-blocks',
}

/** Estimated wall-clock per reversal mutation (Citrix). Used purely
 *  for the "estimated time" hint in the UI. */
const SECONDS_PER_REVERSAL = 2

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function isoStartOfRange(daysBack: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function fmtDateTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      year: '2-digit',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function isStringValue(v: unknown): v is string {
  return typeof v === 'string'
}

/** Pretty one-line summary of an audit row's payload for the table cell. */
function summarisePayload(row: SapAuditRow): string {
  const p = row.payload ?? {}
  const m =
    (p as Record<string, unknown>)['material'] ??
    (p as Record<string, unknown>)['storage_bin'] ??
    (p as Record<string, unknown>)['to_number']
  const target = isStringValue(m) ? m : ''
  switch (row.action) {
    case 'material_master_bin': {
      const bin = (p as Record<string, unknown>)['storage_bin']
      return `${target}: bin → ${isStringValue(bin) && bin ? bin : '(cleared)'}`
    }
    case 'material_master_storage_types': {
      const r = (p as Record<string, unknown>)['removal_storage_type']
      const pl = (p as Record<string, unknown>)['placement_storage_type']
      return `${target}: removal=${isStringValue(r) ? r : ''} placement=${isStringValue(pl) ? pl : ''}`
    }
    case 'transfer_inventory': {
      const sT = (p as Record<string, unknown>)['source_storage_type']
      const sB = (p as Record<string, unknown>)['source_storage_bin']
      const dT = (p as Record<string, unknown>)['dest_storage_type']
      const dB = (p as Record<string, unknown>)['dest_storage_bin']
      return `${target}: ${sT}/${sB} → ${dT}/${dB}`
    }
    case 'set_bin_blocks': {
      const pb = (p as Record<string, unknown>)['putaway_block']
      const sb = (p as Record<string, unknown>)['stock_removal_block']
      return `${target}: putaway=${pb ? '✓' : '✗'} removal=${sb ? '✓' : '✗'}`
    }
    case 'confirm_transfer_order':
      return `TO ${target} confirmed`
    default:
      return row.action
  }
}

/** One-liner "X → Y reverses to Y → X" for the inverse preview pane. */
function summariseInverse(
  row: SapAuditRow,
  inverse: Record<string, unknown>
): string {
  const p = row.payload ?? {}
  const target =
    (p as Record<string, unknown>)['material'] ??
    (p as Record<string, unknown>)['storage_bin'] ??
    (p as Record<string, unknown>)['to_number']
  const targetStr = isStringValue(target) ? target : ''
  switch (row.action) {
    case 'material_master_bin': {
      const before = (row.prev_state ?? {}) as Record<string, unknown>
      const wasBin = isStringValue(before['storage_bin'])
        ? (before['storage_bin'] as string)
        : '(unknown)'
      const newBin = (p as Record<string, unknown>)['storage_bin']
      const newBinStr =
        isStringValue(newBin) && newBin ? (newBin as string) : '(cleared)'
      const invBin = (inverse as Record<string, unknown>)['storage_bin']
      const invStr =
        isStringValue(invBin) && invBin ? (invBin as string) : '(cleared)'
      return `${targetStr}: bin "${wasBin}" → "${newBinStr}"  reverses to  "${newBinStr}" → "${invStr}"`
    }
    case 'transfer_inventory': {
      const sT = (p as Record<string, unknown>)['source_storage_type']
      const sB = (p as Record<string, unknown>)['source_storage_bin']
      const dT = (p as Record<string, unknown>)['dest_storage_type']
      const dB = (p as Record<string, unknown>)['dest_storage_bin']
      return `${targetStr}: ${sT}/${sB} → ${dT}/${dB}  reverses to  ${dT}/${dB} → ${sT}/${sB}`
    }
    case 'set_bin_blocks': {
      const pbBefore = ((row.prev_state ?? {}) as Record<string, unknown>)[
        'putaway_block'
      ]
      const sbBefore = ((row.prev_state ?? {}) as Record<string, unknown>)[
        'stock_removal_block'
      ]
      return `${targetStr}: flip back to putaway=${pbBefore ? '✓' : '✗'} removal=${sbBefore ? '✓' : '✗'}`
    }
    case 'material_master_storage_types': {
      const rBefore = ((row.prev_state ?? {}) as Record<string, unknown>)[
        'removal_storage_type'
      ]
      const pBefore = ((row.prev_state ?? {}) as Record<string, unknown>)[
        'placement_storage_type'
      ]
      return `${targetStr}: removal/placement reset to "${rBefore ?? ''}" / "${pBefore ?? ''}"`
    }
    default:
      return JSON.stringify(inverse)
  }
}

function statusVariant(
  status: SapAuditRow['status']
): 'default' | 'destructive' | 'secondary' | 'outline' {
  if (status === 'success') return 'secondary'
  if (status === 'error') return 'destructive'
  return 'outline'
}

function reversalBadge(rs: SapAuditRow['reversal_status']): {
  label: string
  variant: 'default' | 'destructive' | 'secondary' | 'outline'
} | null {
  if (!rs || rs === 'original') return null
  if (rs === 'reversal') return { label: 'reversal', variant: 'outline' }
  if (rs === 'reversed') return { label: 'reversed', variant: 'secondary' }
  return { label: 'cannot reverse', variant: 'destructive' }
}

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export function ReversalPanel({
  agentHealth,
  agentConnected,
  agentVersion,
}: ReversalPanelProps) {
  const supported = hasCapability(agentHealth, 'reversal-engine')

  // ── Filter state ──
  const [fromIso, setFromIso] = useState<string>(isoStartOfRange(1))
  const [toIso, setToIso] = useState<string>(() => new Date().toISOString())
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('success')
  const [userFilterId, setUserFilterId] = useState<string>('')
  const [searchText, setSearchText] = useState<string>('')

  // ── Loaded data ──
  const [rows, setRows] = useState<SapAuditRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // ── Inverse preview ──
  const [computingInverse, setComputingInverse] = useState(false)
  const [inverseById, setInverseById] = useState<
    Record<string, ComputedInverse>
  >({})
  const [previewOpen, setPreviewOpen] = useState(false)

  // ── Reversal execution ──
  const jobQueue = useJobQueue()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{
    total: number
    completed: number
    succeeded: number
    failed: number
    currentLabel: string
  } | null>(null)
  const [results, setResults] = useState<ReversalRunResult[] | null>(null)

  // ── Load audit rows on filter change ──
  const loadRows = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = supabase as any
      let q = client
        .from('sap_audit_log')
        .select('*')
        .gte('created_at', fromIso)
        .lte('created_at', toIso)
        .order('created_at', { ascending: false })
        .limit(500)
      if (actionFilter !== 'all') q = q.eq('action', actionFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (userFilterId.trim()) q = q.eq('user_id', userFilterId.trim())
      const { data, error } = await q
      if (error) throw new Error(error.message)
      setRows((data as SapAuditRow[]) ?? [])
      setSelectedIds(new Set())
      setInverseById({})
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Unknown error')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [fromIso, toIso, actionFilter, statusFilter, userFilterId])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  // ── Free-text payload search (client-side, simple JSON-stringify
  // contains check). Searching server-side would need a tsvector index
  // that we'd rather defer until user demand. ──
  const visibleRows = useMemo(() => {
    if (!searchText.trim()) return rows
    const needle = searchText.trim().toLowerCase()
    return rows.filter((r) => {
      const haystack = JSON.stringify({
        a: r.action,
        p: r.payload,
        t: r.transaction_code,
        m: r.sap_message,
      }).toLowerCase()
      return haystack.includes(needle)
    })
  }, [rows, searchText])

  // ── Selection helpers ──
  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((r) => selectedIds.has(r.id))
  const toggleSelectAll = useCallback(() => {
    if (allVisibleSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(visibleRows.map((r) => r.id)))
    }
  }, [allVisibleSelected, visibleRows])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectedRows = useMemo(
    () => visibleRows.filter((r) => selectedIds.has(r.id)),
    [visibleRows, selectedIds]
  )

  // ── Compute inverse for each selected row via the agent ──
  const computeInverses = useCallback(async () => {
    if (selectedRows.length === 0) {
      toast.info('Select at least one audit row first.')
      return
    }
    if (!agentConnected) {
      toast.error('SAP Agent not connected')
      return
    }
    if (!supported) {
      toast.error('Agent does not report the reversal-engine capability', {
        description:
          'Update the OmniFrame Agent and try again. The /sap/reversal/compute-inverse endpoint is available in the Phase D #15 build.',
      })
      return
    }
    setComputingInverse(true)
    try {
      const out: Record<string, ComputedInverse> = {}
      // Fire requests in parallel — pure compute on the agent, no SAP calls.
      const pairs = await Promise.all(
        selectedRows.map(async (r) => {
          try {
            const res = await agentFetch('/sap/reversal/compute-inverse', {
              method: 'POST',
              body: JSON.stringify({
                action: r.action,
                payload: r.payload ?? {},
                prev_state: r.prev_state ?? {},
              }),
            })
            const data = (await res.json()) as {
              ok?: boolean
              reversible?: boolean
              inverse_payload?: Record<string, unknown>
              endpoint?: string
              reason?: string
              message?: string
            }
            if (data.reversible && data.inverse_payload) {
              const inv: ComputedInverse = {
                auditId: r.id,
                reversible: true,
                endpoint: data.endpoint ?? ENDPOINT_FOR_ACTION[r.action],
                inversePayload: data.inverse_payload,
                summary: summariseInverse(r, data.inverse_payload),
              }
              return [r.id, inv] as const
            }
            const inv: ComputedInverse = {
              auditId: r.id,
              reversible: false,
              reason: data.reason ?? 'cannot_reverse',
              message:
                data.message ??
                'Cannot reverse — see agent response for details.',
              summary: summarisePayload(r),
            }
            return [r.id, inv] as const
          } catch (e) {
            const inv: ComputedInverse = {
              auditId: r.id,
              reversible: false,
              reason: 'agent_error',
              message: e instanceof Error ? e.message : 'Agent error',
              summary: summarisePayload(r),
            }
            return [r.id, inv] as const
          }
        })
      )
      for (const [id, inv] of pairs) out[id] = inv
      setInverseById(out)
      setPreviewOpen(true)
    } finally {
      setComputingInverse(false)
    }
  }, [selectedRows, agentConnected, supported])

  // ── Queue the reversal batch ──
  const queueReversalBatch = useCallback(async () => {
    const reversible = selectedRows.filter((r) => inverseById[r.id]?.reversible)
    if (reversible.length === 0) {
      toast.error('No reversible rows in the current selection')
      return
    }

    setRunning(true)
    setProgress({
      total: reversible.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      currentLabel: '',
    })
    const acc: ReversalRunResult[] = []
    let succeeded = 0
    let failed = 0
    for (let i = 0; i < reversible.length; i++) {
      const original = reversible[i]
      const inv = inverseById[original.id]
      if (!inv?.reversible || !inv.inversePayload || !inv.endpoint) {
        failed++
        acc.push({
          auditId: original.id,
          jobId: null,
          status: 'error',
          reversalAuditId: null,
          error: 'No inverse computed',
        })
        continue
      }
      const label = summarisePayload(original)
      setProgress({
        total: reversible.length,
        completed: i,
        succeeded,
        failed,
        currentLabel: label,
      })
      const startedAt = Date.now()
      try {
        const finalRow = await jobQueue.submitAndWait({
          endpoint: inv.endpoint,
          payload: inv.inversePayload,
          priority: 50,
        })
        const ok = finalRow.status === 'completed'
        const durationMs = Date.now() - startedAt
        const reversalAuditId = await insertReversalAuditRow({
          transactionCode: original.transaction_code,
          action: original.action,
          payload: inv.inversePayload,
          result: (finalRow.result ?? {}) as Record<string, unknown>,
          status: ok ? 'success' : 'error',
          step: finalRow.step ?? null,
          sapMessage:
            (typeof finalRow.error === 'string' ? finalRow.error : null) ??
            null,
          agentVersion: agentVersion ?? null,
          durationMs,
          jobId: finalRow.id,
          prevState: null,
          reversalStatus: 'reversal',
          reversesAuditId: original.id,
        })
        if (ok && reversalAuditId) {
          await markAuditRowReversed(original.id, reversalAuditId)
          succeeded++
        } else {
          failed++
        }
        acc.push({
          auditId: original.id,
          jobId: finalRow.id,
          status: ok ? 'completed' : 'failed',
          reversalAuditId,
          error: finalRow.error ?? undefined,
        })
      } catch (e) {
        failed++
        acc.push({
          auditId: original.id,
          jobId: null,
          status: 'error',
          reversalAuditId: null,
          error: e instanceof Error ? e.message : 'Unknown error',
        })
      }
      setProgress({
        total: reversible.length,
        completed: i + 1,
        succeeded,
        failed,
        currentLabel: label,
      })
    }
    setResults(acc)
    setRunning(false)
    toast[failed === 0 ? 'success' : 'warning'](
      `Reversal batch complete — ${succeeded}/${reversible.length} succeeded`,
      {
        description:
          failed > 0 ? `${failed} reversal(s) failed — see preview.` : '',
      }
    )
    // Refresh the audit rows so the UI reflects the new
    // 'reversed' / 'reversal' status badges.
    void loadRows()
  }, [selectedRows, inverseById, jobQueue, agentVersion, loadRows])

  // ─────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────

  const reversibleCount = selectedRows.filter(
    (r) => inverseById[r.id]?.reversible
  ).length
  const irreversibleCount = selectedRows.length - reversibleCount

  return (
    <Card className='flex min-h-0 flex-col overflow-hidden'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <RotateCcw className='h-5 w-5' />
          Reversal Engine
          <Badge variant='outline' className='ml-2 font-mono text-xs'>
            AUDIT
          </Badge>
          {!supported && (
            <Badge variant='destructive' className='ml-2'>
              agent v1.5.0+ required
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Browse the SAP audit log and reverse past mutations. Each row's
          inverse is computed from its <code>prev_state</code> snapshot and
          enqueued through the existing job queue. LT12 confirmations are
          irreversible — those rows are flagged and skipped.
        </CardDescription>
      </CardHeader>

      <CardContent className='space-y-4'>
        {/* ── Filters ── */}
        <div className='grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_2fr_auto]'>
          <div className='space-y-1'>
            <Label htmlFor='reversal-from' className='text-xs'>
              From
            </Label>
            <Input
              id='reversal-from'
              type='datetime-local'
              value={
                fromIso ? new Date(fromIso).toISOString().slice(0, 16) : ''
              }
              onChange={(e) =>
                setFromIso(new Date(e.target.value).toISOString())
              }
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='reversal-to' className='text-xs'>
              To
            </Label>
            <Input
              id='reversal-to'
              type='datetime-local'
              value={toIso ? new Date(toIso).toISOString().slice(0, 16) : ''}
              onChange={(e) => setToIso(new Date(e.target.value).toISOString())}
            />
          </div>
          <div className='space-y-1'>
            <Label className='text-xs'>Action</Label>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>all actions</SelectItem>
                {ACTION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label className='text-xs'>Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>all</SelectItem>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='reversal-search' className='text-xs'>
              Search payload
            </Label>
            <Input
              id='reversal-search'
              placeholder='material, bin, etc'
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
          <div className='flex items-end'>
            <Button
              variant='outline'
              onClick={() => void loadRows()}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : (
                <RefreshCw className='mr-2 h-4 w-4' />
              )}
              Refresh
            </Button>
          </div>
        </div>

        <div className='flex items-center gap-2'>
          <Filter className='text-muted-foreground h-3.5 w-3.5' />
          <span className='text-muted-foreground text-xs'>
            Optional user_id filter:
          </span>
          <Input
            value={userFilterId}
            onChange={(e) => setUserFilterId(e.target.value)}
            placeholder='paste a user uuid (leave blank for all users)'
            className='h-8 max-w-[420px] text-xs'
          />
        </div>

        {loadError && (
          <div className='text-destructive bg-destructive/10 border-destructive/30 rounded-md border px-3 py-2 text-xs'>
            <ShieldAlert className='mr-1 inline h-3.5 w-3.5' />
            Could not load audit rows: {loadError}
          </div>
        )}

        {/* ── Selection summary + actions ── */}
        <div className='bg-muted/30 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2'>
          <span className='text-sm font-medium'>
            {selectedRows.length} selected
          </span>
          <Separator orientation='vertical' className='h-4' />
          <span className='text-muted-foreground text-xs'>
            est. ~
            {Math.max(
              1,
              Math.round(selectedRows.length * SECONDS_PER_REVERSAL)
            )}
            s ({SECONDS_PER_REVERSAL}s avg per mutation)
          </span>
          <div className='ml-auto flex flex-wrap items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => void computeInverses()}
              disabled={
                computingInverse || selectedRows.length === 0 || !agentConnected
              }
            >
              {computingInverse ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : (
                <Sparkles className='mr-2 h-4 w-4' />
              )}
              Compute Inverse
            </Button>
            <Button
              size='sm'
              onClick={() => void queueReversalBatch()}
              disabled={
                running ||
                selectedRows.length === 0 ||
                Object.keys(inverseById).length === 0 ||
                reversibleCount === 0
              }
              title={
                Object.keys(inverseById).length === 0
                  ? 'Compute inverses first'
                  : ''
              }
            >
              {running ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : (
                <RotateCcw className='mr-2 h-4 w-4' />
              )}
              Queue Reversal Batch
              {reversibleCount > 0 && (
                <Badge variant='secondary' className='ml-2'>
                  {reversibleCount}
                </Badge>
              )}
            </Button>
          </div>
        </div>

        {progress && (
          <div className='space-y-1 text-xs'>
            <div className='text-muted-foreground'>
              Reversing {progress.completed} / {progress.total} —{' '}
              {progress.currentLabel}
            </div>
            <div className='bg-muted h-1.5 w-full overflow-hidden rounded'>
              <div
                className='h-full bg-emerald-500 transition-all'
                style={{
                  width: `${
                    progress.total
                      ? Math.round((progress.completed / progress.total) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
            <div className='flex gap-3 text-xs'>
              <span className='text-emerald-600 dark:text-emerald-400'>
                <CheckCircle2 className='mr-1 inline h-3 w-3' />
                {progress.succeeded} succeeded
              </span>
              <span className='text-destructive'>
                <XCircle className='mr-1 inline h-3 w-3' />
                {progress.failed} failed
              </span>
            </div>
          </div>
        )}

        {/* ── Audit row table ── */}
        <ScrollArea className='h-[420px] rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-[40px]'>
                  <Checkbox
                    aria-label='Select all'
                    checked={allVisibleSelected}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead className='w-[140px]'>When</TableHead>
                <TableHead className='w-[80px]'>Tx</TableHead>
                <TableHead className='w-[200px]'>Action</TableHead>
                <TableHead>Payload</TableHead>
                <TableHead className='w-[100px]'>Status</TableHead>
                <TableHead className='w-[120px]'>Reversal</TableHead>
                <TableHead className='w-[80px]'>prev_state?</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.length === 0 && !loading ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className='text-muted-foreground py-8 text-center text-sm'
                  >
                    No audit rows match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                visibleRows.map((r) => {
                  const checked = selectedIds.has(r.id)
                  const rb = reversalBadge(r.reversal_status)
                  const inv = inverseById[r.id]
                  const isCannotReverse =
                    r.action === 'confirm_transfer_order' ||
                    r.reversal_status === 'reversed' ||
                    r.reversal_status === 'cannot_reverse' ||
                    (inv ? !inv.reversible : false)
                  return (
                    <TableRow
                      key={r.id}
                      className={cn(
                        checked && 'bg-muted/40',
                        isCannotReverse && checked && 'bg-destructive/5'
                      )}
                    >
                      <TableCell>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleSelect(r.id)}
                          aria-label={`Select row ${r.id}`}
                        />
                      </TableCell>
                      <TableCell className='text-muted-foreground font-mono text-xs'>
                        {fmtDateTime(r.created_at)}
                      </TableCell>
                      <TableCell className='font-mono text-xs'>
                        {r.transaction_code}
                      </TableCell>
                      <TableCell className='text-xs'>{r.action}</TableCell>
                      <TableCell className='text-xs'>
                        <span className='font-mono'>{summarisePayload(r)}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(r.status)}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {rb && <Badge variant={rb.variant}>{rb.label}</Badge>}
                        {!rb && r.action === 'confirm_transfer_order' && (
                          <Badge variant='destructive' className='gap-1'>
                            <AlertTriangle className='h-3 w-3' />
                            irreversible
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.prev_state &&
                        Object.keys(r.prev_state).length > 0 ? (
                          <Badge variant='secondary'>yes</Badge>
                        ) : (
                          <Badge
                            variant='outline'
                            className='text-muted-foreground'
                          >
                            no
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </ScrollArea>

        {selectedRows.length > 0 &&
          irreversibleCount > 0 &&
          Object.keys(inverseById).length > 0 && (
            <div className='border-destructive/40 bg-destructive/10 text-destructive flex items-center gap-2 rounded-md border px-3 py-2 text-xs'>
              <AlertTriangle className='h-4 w-4 shrink-0' />
              <span>
                {irreversibleCount} of {selectedRows.length} selected row(s)
                cannot be reversed (irreversible action or missing
                <code className='mx-1'>prev_state</code>). They will be skipped.
              </span>
            </div>
          )}
      </CardContent>

      {/* ── Inverse preview dialog ── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className='max-w-3xl'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <Sparkles className='h-4 w-4' />
              Reversal preview
            </DialogTitle>
            <DialogDescription>
              {reversibleCount} of {selectedRows.length} selected row(s) can be
              reversed. Review each inverse before queueing.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className='max-h-[440px] pr-3'>
            <div className='space-y-2'>
              {selectedRows.map((r) => {
                const inv = inverseById[r.id]
                if (!inv) return null
                return (
                  <div
                    key={r.id}
                    className={cn(
                      'flex items-start gap-3 rounded-md border px-3 py-2 text-xs',
                      inv.reversible
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : 'border-destructive/40 bg-destructive/5'
                    )}
                  >
                    <ChevronDown className='mt-0.5 h-4 w-4 shrink-0' />
                    <div className='flex-1'>
                      <div className='font-mono'>
                        <span className='text-muted-foreground'>
                          [{r.action}]
                        </span>{' '}
                        {inv.summary}
                      </div>
                      {!inv.reversible && (
                        <div className='text-destructive mt-1'>
                          <ShieldAlert className='mr-1 inline h-3 w-3' />
                          {inv.message ?? inv.reason}
                        </div>
                      )}
                      {inv.reversible && inv.endpoint && (
                        <div className='text-muted-foreground mt-1 flex items-center gap-1 font-mono'>
                          <ArrowRight className='h-3 w-3' />
                          POST {inv.endpoint}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant='outline' onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setPreviewOpen(false)
                void queueReversalBatch()
              }}
              disabled={reversibleCount === 0 || running}
            >
              <RotateCcw className='mr-2 h-4 w-4' />
              Queue {reversibleCount} reversal(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Results summary ── */}
      {results && results.length > 0 && (
        <CardContent>
          <Separator className='mb-3' />
          <div className='space-y-1 text-xs'>
            <div className='font-medium'>Last reversal batch</div>
            {results.map((r) => (
              <div
                key={`${r.auditId}-${r.jobId ?? 'no-job'}`}
                className='flex items-center gap-2 font-mono'
              >
                {r.status === 'completed' ? (
                  <CheckCircle2 className='h-3 w-3 text-emerald-500' />
                ) : (
                  <XCircle className='text-destructive h-3 w-3' />
                )}
                <span className='text-muted-foreground'>
                  {r.auditId.slice(0, 8)}
                </span>
                <span>→</span>
                <span>{r.status}</span>
                {r.error && (
                  <span className='text-destructive ml-2'>{r.error}</span>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  )
}

// Created and developed by Jai Singh
