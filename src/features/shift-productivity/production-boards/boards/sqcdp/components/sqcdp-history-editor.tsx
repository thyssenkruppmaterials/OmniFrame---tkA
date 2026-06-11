// Created and developed by Jai Singh
/**
 * SqcdpHistoryEditor — admin-facing CRUD UI for the last-180-day window of
 * `sqcdp_metric_history` rows behind a single metric. Lives inside the
 * editor dialog, below the form + live chart preview.
 *
 * The user reports that the v6/v9 editor offers no path to enter 6 months
 * of historical data — points are only auto-recorded by the `update`
 * mutation when `current_value` actually changes. This component lets
 * curators back-fill past dates, edit mistakes, and (one-click) generate
 * 26 weeks of plausible sample data so the chart strip looks alive on
 * brand-new metrics.
 *
 * Visual recipe:
 *  - Header row: title + "{n} weeks · {m} points recorded" stat + toolbar
 *    (Add data point · Generate sample data).
 *  - Body: shadcn <Table> with Date | Value | Source | Actions columns.
 *    Empty state copy: "No history recorded yet. Add a data point or
 *    generate sample data to populate the chart."
 *  - Each row toggles between display + inline-edit modes via a pencil.
 *  - Per-row Trash with a <ConfirmDialog>.
 *  - Sort: newest first by default; clicking the Date header toggles.
 *  - max-h-[280px] overflow-y-auto on the table wrapper so long lists
 *    scroll inside the dialog.
 *
 * "Generate sample data" is gated on `points.length === 0` so it only
 * appears for empty metrics. It writes 26 weekly points walking around
 * `metric.current_value` (random walk with ±10% step capped at the
 * metric's `target_value` if set), one per Sunday for the past 26 weeks.
 *
 * Keep this component compact — it shares dialog real estate with the
 * 2-column metric form and the live preview. Defer power-user
 * affordances (CSV import, multi-row edit, source filter) to follow-ups.
 */
import { useMemo, useState, type ChangeEvent } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import {
  IconCheck,
  IconPencil,
  IconPlus,
  IconSparkles,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  useSqcdpMetricHistory,
  type SqcdpHistoryPoint,
} from '../hooks/use-sqcdp-metric-history'
import type { SqcdpMetricRow } from '../hooks/use-sqcdp-metrics'

interface SqcdpHistoryEditorProps {
  /** When undefined, the section renders a "save first" placeholder. */
  metric: SqcdpMetricRow | null
}

const NUMBER_OF_SAMPLE_POINTS = 26
const SAMPLE_STEP_PERCENT = 0.1

/**
 * 26-week random walk anchored on the metric's current value, capped at
 * the target if one is set. Each step is ±10% of the anchor with a
 * minimum step magnitude so flat lines don't dominate. Walks Sunday →
 * Sunday backward 26 weeks; today's Sunday is index 25.
 */
function generateSampleSeries(
  current: number | null,
  target: number | null
): { recordedAt: string; value: number; source: string }[] {
  const anchor =
    current !== null && Number.isFinite(current) ? Math.abs(current) || 1 : 10
  const cap = target !== null && Number.isFinite(target) ? target : null
  let value = anchor
  const points: { recordedAt: string; value: number; source: string }[] = []
  const now = new Date()
  const day = now.getUTCDay()
  const sundayUTC = new Date(now)
  sundayUTC.setUTCDate(now.getUTCDate() - day)
  sundayUTC.setUTCHours(12, 0, 0, 0)
  for (let i = NUMBER_OF_SAMPLE_POINTS - 1; i >= 0; i--) {
    const recorded = new Date(sundayUTC)
    recorded.setUTCDate(sundayUTC.getUTCDate() - i * 7)
    const stepMagnitude = anchor * SAMPLE_STEP_PERCENT * (0.5 + Math.random())
    const direction = Math.random() > 0.5 ? 1 : -1
    value = Math.max(0, value + direction * stepMagnitude)
    if (cap !== null) value = Math.min(value, cap * 1.05)
    points.push({
      recordedAt: recorded.toISOString(),
      value: Math.round(value * 100) / 100,
      source: 'sample',
    })
  }
  return points
}

interface RowProps {
  point: SqcdpHistoryPoint
  isEditing: boolean
  onStartEdit: (id: number) => void
  onCancelEdit: () => void
  onSave: (input: { id: number; recordedAt: string; value: number }) => void
  onDeleteRequest: (id: number) => void
  isPending: boolean
}

function HistoryTableRow({
  point,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDeleteRequest,
  isPending,
}: RowProps) {
  const [editDate, setEditDate] = useState<Date | undefined>(
    new Date(point.recordedAt)
  )
  const [editValue, setEditValue] = useState<string>(String(point.value))

  const recorded = new Date(point.recordedAt)
  const relative = Number.isFinite(recorded.getTime())
    ? formatDistanceToNow(recorded, { addSuffix: true })
    : '—'
  const absolute = Number.isFinite(recorded.getTime())
    ? format(recorded, 'PPP')
    : point.recordedAt

  if (isEditing) {
    return (
      <TableRow data-testid={`history-row-${point.id}`} data-mode='edit'>
        <TableCell className='py-1 align-middle'>
          <DatePicker
            date={editDate}
            onSelect={setEditDate}
            placeholder='Pick a date'
            className='h-8 w-full'
          />
        </TableCell>
        <TableCell className='py-1 align-middle'>
          <Input
            type='number'
            inputMode='decimal'
            step='any'
            value={editValue}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setEditValue(e.target.value)
            }
            className='h-8'
          />
        </TableCell>
        <TableCell className='text-muted-foreground py-1 align-middle text-xs'>
          {point.source ?? '—'}
        </TableCell>
        <TableCell className='py-1 text-right align-middle'>
          <div className='inline-flex items-center gap-1'>
            <Button
              type='button'
              size='icon'
              variant='ghost'
              className='h-7 w-7'
              aria-label='Save changes'
              disabled={isPending}
              onClick={() => {
                if (!editDate) return
                const numeric = Number(editValue)
                if (!Number.isFinite(numeric)) return
                onSave({
                  id: point.id,
                  recordedAt: editDate.toISOString(),
                  value: numeric,
                })
              }}
            >
              <IconCheck className='h-4 w-4' aria-hidden />
            </Button>
            <Button
              type='button'
              size='icon'
              variant='ghost'
              className='h-7 w-7'
              aria-label='Cancel edit'
              onClick={onCancelEdit}
            >
              <IconX className='h-4 w-4' aria-hidden />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <TableRow data-testid={`history-row-${point.id}`} data-mode='display'>
      <TableCell className='py-1.5 align-middle'>
        <TooltipProvider delayDuration={250}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className='cursor-default text-sm tabular-nums'>
                {relative}
              </span>
            </TooltipTrigger>
            <TooltipContent>{absolute}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </TableCell>
      <TableCell className='py-1.5 align-middle text-sm tabular-nums'>
        {point.value}
      </TableCell>
      <TableCell className='text-muted-foreground py-1.5 align-middle text-xs'>
        {point.source ?? '—'}
      </TableCell>
      <TableCell className='py-1.5 text-right align-middle'>
        <div className='inline-flex items-center gap-1'>
          <Button
            type='button'
            size='icon'
            variant='ghost'
            className='h-7 w-7'
            aria-label={`Edit data point on ${absolute}`}
            onClick={() => onStartEdit(point.id)}
          >
            <IconPencil className='h-3.5 w-3.5' aria-hidden />
          </Button>
          <Button
            type='button'
            size='icon'
            variant='ghost'
            className='text-destructive hover:text-destructive h-7 w-7'
            aria-label={`Delete data point on ${absolute}`}
            onClick={() => onDeleteRequest(point.id)}
          >
            <IconTrash className='h-3.5 w-3.5' aria-hidden />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

export function SqcdpHistoryEditor({ metric }: SqcdpHistoryEditorProps) {
  const metricId = metric?.id ?? null
  const {
    points,
    isLoading,
    createPoint,
    updatePoint,
    deletePoint,
    bulkInsertPoints,
  } = useSqcdpMetricHistory(metricId)

  const [sortDescending, setSortDescending] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [newDate, setNewDate] = useState<Date | undefined>(new Date())
  const [newValue, setNewValue] = useState<string>('')
  const [pendingDelete, setPendingDelete] = useState<number | null>(null)
  const [confirmGenerate, setConfirmGenerate] = useState(false)

  const sortedPoints = useMemo(() => {
    const copy = [...points]
    copy.sort((a, b) =>
      sortDescending
        ? a.recordedAt < b.recordedAt
          ? 1
          : -1
        : a.recordedAt < b.recordedAt
          ? -1
          : 1
    )
    return copy
  }, [points, sortDescending])

  if (!metric) {
    return (
      <div className='border-border/50 bg-muted/20 flex flex-col gap-1 rounded-md border border-dashed p-4 text-center'>
        <p className='text-sm font-medium'>Historical data points</p>
        <p className='text-muted-foreground text-xs'>
          Save the metric first to start recording history.
        </p>
      </div>
    )
  }

  const stat = `${NUMBER_OF_SAMPLE_POINTS} weeks · ${points.length} points recorded`
  const showSampleButton = points.length === 0 && !adding

  const onGenerateSample = (): void => {
    const inserts = generateSampleSeries(
      metric.currentValue,
      metric.targetValue
    )
    void bulkInsertPoints.mutateAsync({ inserts })
    setConfirmGenerate(false)
  }

  const onAddSubmit = (): void => {
    if (!newDate) return
    const numeric = Number(newValue)
    if (!Number.isFinite(numeric)) return
    void createPoint
      .mutateAsync({
        recordedAt: newDate.toISOString(),
        value: numeric,
        source: 'manual',
      })
      .then(() => {
        setNewValue('')
        setAdding(false)
      })
      .catch(() => {
        /* toast already surfaced inside the mutation */
      })
  }

  return (
    <div className='border-border/60 bg-card overflow-hidden rounded-lg border shadow-xs'>
      <div className='border-border/40 bg-muted/15 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3'>
        <div className='flex flex-col'>
          <p className='text-foreground text-sm font-semibold'>
            Historical data points
          </p>
          <p className='text-muted-foreground text-[11px] tabular-nums'>
            {stat}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          {showSampleButton && (
            <Button
              type='button'
              size='sm'
              variant='outline'
              className='gap-1.5'
              onClick={() => setConfirmGenerate(true)}
              disabled={bulkInsertPoints.isPending}
            >
              <IconSparkles className='h-3.5 w-3.5' aria-hidden />
              Generate sample data
            </Button>
          )}
          <Button
            type='button'
            size='sm'
            variant={adding ? 'outline' : 'default'}
            className='gap-1.5'
            onClick={() => setAdding((v) => !v)}
            disabled={createPoint.isPending}
          >
            <IconPlus className='h-3.5 w-3.5' aria-hidden />
            {adding ? 'Cancel new entry' : 'Add data point'}
          </Button>
        </div>
      </div>

      <div className='max-h-[320px] overflow-y-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className='h-9 cursor-pointer select-none'
                onClick={() => setSortDescending((v) => !v)}
                aria-sort={sortDescending ? 'descending' : 'ascending'}
              >
                Date {sortDescending ? '↓' : '↑'}
              </TableHead>
              <TableHead className='h-9'>Value</TableHead>
              <TableHead className='h-9'>Source</TableHead>
              <TableHead className='h-9 text-right'>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {adding && (
              <TableRow data-testid='history-row-new' data-mode='create'>
                <TableCell className='py-1 align-middle'>
                  <DatePicker
                    date={newDate}
                    onSelect={setNewDate}
                    placeholder='Pick a date'
                    className='h-8 w-full'
                  />
                </TableCell>
                <TableCell className='py-1 align-middle'>
                  <Input
                    type='number'
                    inputMode='decimal'
                    step='any'
                    value={newValue}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setNewValue(e.target.value)
                    }
                    placeholder='0'
                    className='h-8'
                  />
                </TableCell>
                <TableCell className='text-muted-foreground py-1 align-middle text-xs'>
                  manual
                </TableCell>
                <TableCell className='py-1 text-right align-middle'>
                  <div className='inline-flex items-center gap-1'>
                    <Button
                      type='button'
                      size='icon'
                      variant='ghost'
                      className='h-7 w-7'
                      aria-label='Save data point'
                      disabled={createPoint.isPending || !newDate || !newValue}
                      onClick={onAddSubmit}
                    >
                      <IconCheck className='h-4 w-4' aria-hidden />
                    </Button>
                    <Button
                      type='button'
                      size='icon'
                      variant='ghost'
                      className='h-7 w-7'
                      aria-label='Cancel add'
                      onClick={() => {
                        setAdding(false)
                        setNewValue('')
                      }}
                    >
                      <IconX className='h-4 w-4' aria-hidden />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {sortedPoints.length === 0 && !adding && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className={cn(
                    'text-muted-foreground py-6 text-center text-xs italic',
                    isLoading && 'opacity-60'
                  )}
                >
                  {isLoading
                    ? 'Loading history…'
                    : 'No history recorded yet. Add a data point or generate sample data to populate the chart.'}
                </TableCell>
              </TableRow>
            )}
            {sortedPoints.map((point) => (
              <HistoryTableRow
                key={point.id}
                point={point}
                isEditing={editingId === point.id}
                onStartEdit={(id) => setEditingId(id)}
                onCancelEdit={() => setEditingId(null)}
                onSave={({ id, recordedAt, value }) => {
                  void updatePoint
                    .mutateAsync({ id, recordedAt, value })
                    .then(() => setEditingId(null))
                    .catch(() => {
                      /* toast already surfaced */
                    })
                }}
                onDeleteRequest={(id) => setPendingDelete(id)}
                isPending={updatePoint.isPending}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title='Delete data point?'
        message='This permanently removes the data point. The chart will recompute without it.'
        variant='danger'
        confirmText='Delete'
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete !== null) {
            void deletePoint
              .mutateAsync(pendingDelete)
              .finally(() => setPendingDelete(null))
          }
        }}
        isProcessing={deletePoint.isPending}
      />

      <ConfirmDialog
        isOpen={confirmGenerate}
        title='Generate sample data?'
        message={`Generate ${NUMBER_OF_SAMPLE_POINTS} sample data points for visualisation? You can delete or edit them later.`}
        variant='info'
        confirmText='Generate'
        onCancel={() => setConfirmGenerate(false)}
        onConfirm={onGenerateSample}
        isProcessing={bulkInsertPoints.isPending}
      />
    </div>
  )
}

// Created and developed by Jai Singh
