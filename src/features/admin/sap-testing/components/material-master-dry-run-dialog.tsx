// Created and developed by Jai Singh
/**
 * Phase D #11 — Material Master dry-run / preview dialog.
 *
 * Modal that takes the rows the user is about to commit (either the
 * single-row form values or every CSV row in BatchModePanel), reads
 * the current SAP value via the read-only MM03 endpoints, and renders
 * a side-by-side diff so the user can confirm before MM02 writes.
 *
 * Concurrency:
 *   - Up to MAX_CONCURRENCY parallel reads against the agent. MM03 is
 *     slow (~3-5s per row), so 4 in-flight keeps SAP responsive while
 *     trimming wall-clock time on big batches.
 *
 * Endpoint shape mapping is encoded in `DRY_RUN_FIELD_MAP` keyed on the
 * agent endpoint path (`query.dryRunEndpoint`) so the same component
 * supports both `material-master-read-bin` and
 * `material-master-read-storage-types` without a discriminator field.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { agentFetch } from '../lib/agent-fetch'

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

/** A row payload as emitted by `parseBatchCsv` in inventory-management-tab.
 *  We only need the `values` (input-name → string) part. */
export interface DryRunInputRow {
  values: Record<string, string>
}

/** The `QueryDefinition` shape we touch — kept narrow to avoid a circular
 *  import with inventory-management-tab. */
export interface DryRunQueryShape {
  id: string
  name: string
  transaction: string
  mutationEndpoint?: string
  /** New (Phase D #11) — read-only MM03 endpoint to call per row. */
  dryRunEndpoint: string
  /** New (Phase D #11) — capability gate; assumed already-checked by
   *  the caller, included here only for the "agent too old" copy. */
  dryRunCapability?: string
}

/** Per-endpoint diff column mapping. */
interface DiffField {
  /** Friendly column header. */
  label: string
  /** Key on the read-endpoint's response body. */
  currentKey: string
  /** Key on the input row whose value would be written. */
  proposedKey: string
}

/** Internal status of a single row's preview lifecycle. */
type RowStatus = 'pending' | 'running' | 'done' | 'error'

interface RowState {
  row: DryRunInputRow
  status: RowStatus
  /** Read endpoint payload — keys are endpoint-specific (current_bin, …). */
  current: Record<string, string | null>
  /** Optional warning the read endpoint may include (e.g. WM view missing). */
  warning?: string
  /** Read-side error (network or SAP) — distinct from a value diff. */
  error?: string
}

// ──────────────────────────────────────────────────────────────────────
// Per-endpoint configuration
// ──────────────────────────────────────────────────────────────────────

const DRY_RUN_FIELD_MAP: Record<string, DiffField[]> = {
  '/sap/material-master-read-bin': [
    {
      label: 'Storage Bin',
      currentKey: 'current_bin',
      proposedKey: 'storage_bin',
    },
  ],
  '/sap/material-master-read-storage-types': [
    {
      label: 'Removal (LTKZA)',
      currentKey: 'current_removal',
      proposedKey: 'removal_storage_type',
    },
    {
      label: 'Placement (LTKZE)',
      currentKey: 'current_placement',
      proposedKey: 'placement_storage_type',
    },
  ],
}

/** SAP returns trailing/leading whitespace on most fields and SAP "blank"
 *  is rendered as empty string. Normalise so we don't flag whitespace as
 *  a diff. */
function normaliseValue(v: string | null | undefined): string {
  return (v ?? '').trim()
}

/** True when current and proposed differ once normalised. */
function valuesDiffer(
  current: string | null | undefined,
  proposed: string | null | undefined
): boolean {
  return normaliseValue(current) !== normaliseValue(proposed)
}

const MAX_CONCURRENCY = 4

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────

interface MaterialMasterDryRunDialogProps {
  open: boolean
  onClose: () => void
  query: DryRunQueryShape
  rows: DryRunInputRow[]
  /** Emitted on confirm — receives the (possibly filtered) row list to
   *  pass to the existing `runBatch` / `runMutation` flow. */
  onConfirm: (rows: DryRunInputRow[]) => void
  /** Optional per-row label resolver (defaults to `values.material`). */
  rowLabel?: (row: DryRunInputRow, index: number) => string
}

export function MaterialMasterDryRunDialog({
  open,
  onClose,
  query,
  rows,
  onConfirm,
  rowLabel,
}: MaterialMasterDryRunDialogProps) {
  const fields = useMemo<DiffField[]>(
    () => DRY_RUN_FIELD_MAP[query.dryRunEndpoint] ?? [],
    [query.dryRunEndpoint]
  )

  const [skipNoOps, setSkipNoOps] = useState(true)
  const [rowStates, setRowStates] = useState<RowState[]>([])
  const [running, setRunning] = useState(false)
  // Mutating ref so the worker pool can observe a cancel without a
  // stale-closure rerender.
  const cancelledRef = useRef(false)

  const labelFor = useCallback(
    (row: DryRunInputRow, idx: number): string => {
      if (rowLabel) return rowLabel(row, idx)
      const m = (row.values.material ?? '').trim()
      return m || `Row ${idx + 1}`
    },
    [rowLabel]
  )

  // ── Reset on (re)open or row-set change. ──────────────────────────
  useEffect(() => {
    if (!open) return
    cancelledRef.current = false
    const initial: RowState[] = rows.map((row) => ({
      row,
      status: 'pending',
      current: {},
    }))
    setRowStates(initial)
    setRunning(false)
  }, [open, rows])

  // ── Worker pool: kick off MAX_CONCURRENCY parallel reads. ─────────
  const runPreview = useCallback(async () => {
    if (rowStates.length === 0) return
    cancelledRef.current = false
    setRunning(true)

    // Build a queue of indices we still need to fetch. We snapshot on
    // entry so re-renders don't loop us back through completed rows.
    const indices: number[] = []
    rowStates.forEach((r, i) => {
      if (r.status === 'pending' || r.status === 'error') indices.push(i)
    })

    let cursor = 0
    const next = (): number | null => {
      if (cancelledRef.current) return null
      if (cursor >= indices.length) return null
      return indices[cursor++]
    }

    const worker = async () => {
      while (true) {
        const i = next()
        if (i === null) return
        // Mark running.
        setRowStates((prev) => {
          const out = prev.slice()
          out[i] = { ...out[i], status: 'running', error: undefined }
          return out
        })
        const row = rowStates[i].row
        try {
          const res = await agentFetch(query.dryRunEndpoint, {
            method: 'POST',
            body: JSON.stringify(row.values),
          })
          const data = (await res.json()) as Record<string, unknown>
          if (cancelledRef.current) return
          if (data.ok) {
            const current: Record<string, string | null> = {}
            for (const f of fields) {
              const v = data[f.currentKey]
              current[f.currentKey] =
                typeof v === 'string' ? v : v == null ? null : String(v)
            }
            setRowStates((prev) => {
              const out = prev.slice()
              out[i] = {
                ...out[i],
                status: 'done',
                current,
                warning:
                  typeof data.warning === 'string' ? data.warning : undefined,
                error: undefined,
              }
              return out
            })
          } else {
            const errMsg =
              typeof data.error === 'string' ? data.error : 'Read failed'
            setRowStates((prev) => {
              const out = prev.slice()
              out[i] = {
                ...out[i],
                status: 'error',
                error: errMsg,
                current: {},
              }
              return out
            })
          }
        } catch (e) {
          if (cancelledRef.current) return
          const msg = e instanceof Error ? e.message : 'Network error'
          setRowStates((prev) => {
            const out = prev.slice()
            out[i] = { ...out[i], status: 'error', error: msg, current: {} }
            return out
          })
        }
      }
    }

    const concurrency = Math.min(MAX_CONCURRENCY, indices.length || 1)
    await Promise.all(Array.from({ length: concurrency }, () => worker()))
    setRunning(false)
  }, [rowStates, fields, query.dryRunEndpoint])

  // Auto-start the read pool the first time the dialog opens with rows.
  // Subsequent re-opens get the same auto-start; "Re-read" button below
  // covers the manual-refresh case.
  const autoStartRef = useRef(false)
  useEffect(() => {
    if (!open) {
      autoStartRef.current = false
      return
    }
    if (autoStartRef.current) return
    if (rowStates.length === 0) return
    autoStartRef.current = true
    void runPreview()
    // We intentionally do NOT depend on runPreview here — it changes
    // identity every render. autoStartRef + the open guard keep this
    // single-shot per open. Re-runs go through the Re-read button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rowStates.length])

  // ── Derived stats ─────────────────────────────────────────────────
  const computedStats = useMemo(() => {
    let changes = 0
    let noOps = 0
    let errors = 0
    let pending = 0
    for (const rs of rowStates) {
      if (rs.status === 'error') {
        errors++
        continue
      }
      if (rs.status !== 'done') {
        pending++
        continue
      }
      // Done — does any field actually differ?
      const anyDiff = fields.some((f) =>
        valuesDiffer(rs.current[f.currentKey], rs.row.values[f.proposedKey])
      )
      if (anyDiff) changes++
      else noOps++
    }
    return { changes, noOps, errors, pending }
  }, [rowStates, fields])

  const allDone =
    !running && computedStats.pending === 0 && rowStates.length > 0
  const completedCount = rowStates.length - computedStats.pending
  const progressPct = rowStates.length
    ? Math.round((completedCount / rowStates.length) * 100)
    : 0

  // ── Confirm handler — apply skip-no-op filter if toggled ──────────
  const handleConfirm = () => {
    if (running) {
      toast.warning('Wait for the preview to finish before confirming.')
      return
    }
    let toSubmit: DryRunInputRow[]
    if (skipNoOps) {
      toSubmit = []
      let skipped = 0
      rowStates.forEach((rs) => {
        // Pass through error rows so the user still sees them in the
        // batch run (and can debug / fix). Skip only confirmed no-ops.
        if (rs.status === 'done') {
          const anyDiff = fields.some((f) =>
            valuesDiffer(rs.current[f.currentKey], rs.row.values[f.proposedKey])
          )
          if (anyDiff) toSubmit.push(rs.row)
          else skipped++
        } else {
          toSubmit.push(rs.row)
        }
      })
      if (skipped > 0) {
        // Console line is owned by the caller — just emit a toast here
        // so the user knows we trimmed the batch.
        toast.success(`Skipped ${skipped} no-op row${skipped !== 1 ? 's' : ''}`)
      }
    } else {
      toSubmit = rowStates.map((rs) => rs.row)
    }
    if (toSubmit.length === 0) {
      toast.warning(
        'Nothing to commit — every row is already at its target value.'
      )
      onClose()
      return
    }
    onConfirm(toSubmit)
  }

  const handleCancel = () => {
    cancelledRef.current = true
    onClose()
  }

  const confirmLabel = useMemo(() => {
    if (running) return 'Reading SAP…'
    if (skipNoOps)
      return `Confirm ${computedStats.changes} change${computedStats.changes !== 1 ? 's' : ''}`
    return `Confirm ${rowStates.length} row${rowStates.length !== 1 ? 's' : ''}`
  }, [running, skipNoOps, computedStats.changes, rowStates.length])

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleCancel()
      }}
    >
      <DialogContent className='flex max-h-[85vh] max-w-4xl flex-col overflow-hidden p-0 sm:max-w-5xl'>
        <DialogHeader className='px-6 pt-6'>
          <DialogTitle className='flex items-center gap-2'>
            <Eye className='h-5 w-5 text-blue-500' />
            Preview: {query.name}
          </DialogTitle>
          <DialogDescription>
            {query.transaction} dry-run — reads each material's current
            warehouse-level value from MM03 (display mode, no SAP changes) so
            you can confirm the diff before committing the MM02 batch.
          </DialogDescription>
        </DialogHeader>

        {/* Summary + controls bar */}
        <div className='border-b px-6 py-3'>
          <div className='flex flex-wrap items-center gap-3'>
            <Badge
              variant='outline'
              className='border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            >
              <Sparkles className='mr-1 h-3 w-3' />
              {computedStats.changes} change
              {computedStats.changes !== 1 ? 's' : ''}
            </Badge>
            <Badge variant='outline' className='text-muted-foreground'>
              {computedStats.noOps} no-op{computedStats.noOps !== 1 ? 's' : ''}
            </Badge>
            {computedStats.errors > 0 && (
              <Badge
                variant='outline'
                className='border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400'
              >
                <AlertCircle className='mr-1 h-3 w-3' />
                {computedStats.errors} error
                {computedStats.errors !== 1 ? 's' : ''}
              </Badge>
            )}
            {computedStats.pending > 0 && (
              <Badge variant='outline' className='text-muted-foreground'>
                <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                {computedStats.pending} pending
              </Badge>
            )}
            <span className='text-muted-foreground ml-auto text-xs'>
              {completedCount} / {rowStates.length} rows · {progressPct}%
            </span>
          </div>
          <div className='bg-muted mt-2 h-1 overflow-hidden rounded-full'>
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-300',
                running
                  ? 'bg-blue-500'
                  : computedStats.errors > 0
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className='mt-3 flex flex-wrap items-center gap-3'>
            <label className='flex items-center gap-2 text-xs'>
              <input
                type='checkbox'
                className='h-3.5 w-3.5'
                checked={skipNoOps}
                onChange={(e) => setSkipNoOps(e.target.checked)}
              />
              Skip rows with no change
              <span className='text-muted-foreground'>
                ({computedStats.noOps} would be skipped)
              </span>
            </label>
            <Button
              variant='ghost'
              size='sm'
              className='ml-auto h-7 px-2 text-xs'
              onClick={() => {
                autoStartRef.current = false
                // Reset to pending and re-read.
                setRowStates((prev) =>
                  prev.map((rs) => ({
                    ...rs,
                    status: 'pending',
                    current: {},
                    warning: undefined,
                    error: undefined,
                  }))
                )
                setTimeout(() => {
                  autoStartRef.current = true
                  void runPreview()
                }, 0)
              }}
              disabled={running || rowStates.length === 0}
              title='Re-read every row from SAP'
            >
              <RefreshCw className='mr-1 h-3 w-3' />
              Re-read
            </Button>
          </div>
        </div>

        {/* Diff table — scrollable so big batches don't push the footer
            off-screen. */}
        <div className='min-h-0 flex-1 overflow-auto px-6 py-3'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-10 text-xs'>#</TableHead>
                <TableHead className='text-xs'>Material</TableHead>
                {fields.map((f) => (
                  <TableHead key={f.label} className='text-xs'>
                    {f.label}: Current
                  </TableHead>
                ))}
                {fields.map((f) => (
                  <TableHead key={`${f.label}-prop`} className='text-xs'>
                    {f.label}: Proposed
                  </TableHead>
                ))}
                <TableHead className='w-24 text-xs'>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rowStates.map((rs, idx) => {
                const label = labelFor(rs.row, idx)
                const isError = rs.status === 'error'
                const isRunning = rs.status === 'running'
                const isPending = rs.status === 'pending'
                const isDone = rs.status === 'done'

                // Determine per-row diff classification.
                const fieldDiffs = fields.map((f) => {
                  const current = rs.current[f.currentKey] ?? null
                  const proposed = rs.row.values[f.proposedKey] ?? ''
                  return {
                    field: f,
                    current,
                    proposed,
                    differs: isDone && valuesDiffer(current, proposed),
                  }
                })
                const anyDiff = fieldDiffs.some((d) => d.differs)
                return (
                  <TableRow
                    key={idx}
                    className={cn(
                      isError && 'bg-red-500/5',
                      isDone && anyDiff && 'bg-emerald-500/5',
                      isDone && !anyDiff && 'opacity-70'
                    )}
                  >
                    <TableCell className='text-muted-foreground font-mono text-xs'>
                      {idx + 1}
                    </TableCell>
                    <TableCell className='font-mono text-xs'>{label}</TableCell>
                    {fieldDiffs.map((d, i) => (
                      <TableCell
                        key={`${idx}-cur-${i}`}
                        className={cn(
                          'font-mono text-xs',
                          d.differs &&
                            'text-red-600 line-through dark:text-red-400'
                        )}
                      >
                        {isPending || isRunning ? (
                          <span className='text-muted-foreground'>—</span>
                        ) : isError ? (
                          <span className='text-muted-foreground'>?</span>
                        ) : normaliseValue(d.current) === '' ? (
                          <span className='text-muted-foreground italic'>
                            (empty)
                          </span>
                        ) : (
                          d.current
                        )}
                      </TableCell>
                    ))}
                    {fieldDiffs.map((d, i) => (
                      <TableCell
                        key={`${idx}-prop-${i}`}
                        className={cn(
                          'font-mono text-xs',
                          d.differs &&
                            'font-semibold text-emerald-600 dark:text-emerald-400',
                          isDone && !d.differs && 'text-muted-foreground'
                        )}
                      >
                        <span className='inline-flex items-center gap-1'>
                          {d.differs && (
                            <ArrowRight className='h-3 w-3 shrink-0' />
                          )}
                          {normaliseValue(d.proposed) === '' ? (
                            <span className='italic'>(clear)</span>
                          ) : (
                            d.proposed
                          )}
                        </span>
                      </TableCell>
                    ))}
                    <TableCell>
                      {isPending && (
                        <span className='text-muted-foreground text-[11px]'>
                          queued
                        </span>
                      )}
                      {isRunning && (
                        <span className='inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400'>
                          <Loader2 className='h-3 w-3 animate-spin' />
                          reading
                        </span>
                      )}
                      {isDone && anyDiff && (
                        <span className='inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400'>
                          <CheckCircle2 className='h-3 w-3' />
                          will change
                        </span>
                      )}
                      {isDone && !anyDiff && (
                        <span className='text-muted-foreground text-[11px]'>
                          no change
                        </span>
                      )}
                      {isError && (
                        <span
                          className='inline-flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400'
                          title={rs.error}
                        >
                          <ShieldAlert className='h-3 w-3' />
                          error
                        </span>
                      )}
                      {isDone && rs.warning && (
                        <div
                          className='text-[10px] text-amber-600 dark:text-amber-400'
                          title={rs.warning}
                        >
                          ⚠{' '}
                          {rs.warning.length > 28
                            ? `${rs.warning.slice(0, 28)}…`
                            : rs.warning}
                        </div>
                      )}
                      {isError && rs.error && (
                        <div
                          className='text-muted-foreground mt-0.5 max-w-56 truncate text-[10px]'
                          title={rs.error}
                        >
                          {rs.error}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {rowStates.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={3 + fields.length * 2}
                    className='text-muted-foreground text-center text-sm'
                  >
                    No rows to preview.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className='border-t px-6 py-3'>
          <div className='text-muted-foreground mr-auto self-center text-xs'>
            {allDone
              ? skipNoOps
                ? `Will commit ${computedStats.changes} of ${rowStates.length} rows.`
                : `Will commit all ${rowStates.length} rows.`
              : 'Reading SAP — wait for the preview to finish before confirming.'}
          </div>
          <Button variant='outline' onClick={handleCancel}>
            <X className='mr-2 h-4 w-4' />
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={running}>
            <CheckCircle2 className='mr-2 h-4 w-4' />
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
