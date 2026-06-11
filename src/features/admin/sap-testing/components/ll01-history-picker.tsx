// Created and developed by Jai Singh
/**
 * LL01HistoryPicker — date picker for reloading a saved Warehouse Activity
 * Monitor run (2026-05-31). Renders next to "Run Query".
 *
 * A calendar popover where only days that actually have a saved run are
 * enabled. Picking a day with one run loads it immediately; a day with
 * several runs reveals a time list so the user can pick the exact run. A
 * "Current run (live)" item clears the historical selection and returns the
 * view to whatever the user last executed.
 *
 * The component is purely presentational over the `runs` index — fetching +
 * payload loading live in `useLL01History`.
 */
import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { CalendarDays, Clock, Radio } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { LL01RunIndexEntry } from './warehouse-activity-monitor-types'

interface LL01HistoryPickerProps {
  runs: LL01RunIndexEntry[]
  /** snapshot_run_id of the run being viewed, or null when viewing live. */
  selectedRunId: string | null
  onSelectRun: (snapshotRunId: string | null) => void
  loading?: boolean
  disabled?: boolean
}

/** Local-time `YYYY-MM-DD` key so calendar days line up with the user's tz. */
function dayKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function LL01HistoryPicker({
  runs,
  selectedRunId,
  onSelectRun,
  loading = false,
  disabled = false,
}: LL01HistoryPickerProps) {
  const [open, setOpen] = useState(false)
  const [pickedDate, setPickedDate] = useState<Date | undefined>(undefined)

  const runsByDay = useMemo(() => {
    const map = new Map<string, LL01RunIndexEntry[]>()
    for (const run of runs) {
      const key = dayKey(parseISO(run.ran_at))
      const list = map.get(key) ?? []
      list.push(run)
      map.set(key, list)
    }
    return map
  }, [runs])

  const datesWithRuns = useMemo(() => new Set(runsByDay.keys()), [runsByDay])

  const selectedRun = useMemo(
    () => runs.find((r) => r.snapshot_run_id === selectedRunId) ?? null,
    [runs, selectedRunId]
  )

  const selectedDate = selectedRun ? parseISO(selectedRun.ran_at) : undefined
  const activeDate = pickedDate ?? selectedDate
  const activeDayRuns = activeDate
    ? (runsByDay.get(dayKey(activeDate)) ?? [])
    : []

  const defaultMonth =
    selectedDate ?? (runs[0] ? parseISO(runs[0].ran_at) : undefined)

  const selectRun = (run: LL01RunIndexEntry) => {
    onSelectRun(run.snapshot_run_id)
    setPickedDate(undefined)
    setOpen(false)
  }

  const goLive = () => {
    onSelectRun(null)
    setPickedDate(undefined)
    setOpen(false)
  }

  const hasRuns = runs.length > 0
  const triggerLabel = selectedRun
    ? format(parseISO(selectedRun.ran_at), 'MMM d, h:mm a')
    : 'History'

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setPickedDate(undefined)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant={selectedRun ? 'secondary' : 'outline'}
          disabled={disabled || (!hasRuns && !loading)}
          title={
            hasRuns
              ? 'View a saved run'
              : 'No saved runs yet — run the query to start history'
          }
        >
          <CalendarDays className='mr-2 h-4 w-4' />
          {loading && !hasRuns ? 'Loading…' : triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-auto p-0' align='start'>
        <div className='flex items-center justify-between gap-2 border-b p-2'>
          <span className='text-muted-foreground px-1 text-xs font-medium'>
            Saved runs
          </span>
          <Button
            size='sm'
            variant={selectedRun ? 'ghost' : 'secondary'}
            className='h-7'
            onClick={goLive}
          >
            <Radio className='mr-1.5 h-3.5 w-3.5' />
            Current run
          </Button>
        </div>
        <Calendar
          mode='single'
          selected={activeDate}
          defaultMonth={defaultMonth}
          disabled={(date) => !datesWithRuns.has(dayKey(date))}
          onSelect={(date) => {
            if (!date) return
            setPickedDate(date)
            const dayRuns = runsByDay.get(dayKey(date)) ?? []
            if (dayRuns.length === 1) selectRun(dayRuns[0])
          }}
        />
        {activeDayRuns.length > 1 && (
          <div className='max-h-48 space-y-1 overflow-y-auto border-t p-2'>
            <p className='text-muted-foreground px-1 pb-1 text-xs'>
              {format(activeDate as Date, 'MMM d, yyyy')} —{' '}
              {activeDayRuns.length} runs
            </p>
            {activeDayRuns.map((run) => (
              <button
                key={run.snapshot_run_id}
                type='button'
                onClick={() => selectRun(run)}
                className={cn(
                  'hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                  run.snapshot_run_id === selectedRunId && 'bg-accent'
                )}
              >
                <Clock className='text-muted-foreground h-3.5 w-3.5' />
                <span className='font-mono text-xs'>
                  {format(parseISO(run.ran_at), 'h:mm:ss a')}
                </span>
                {!run.ok && (
                  <span className='text-destructive ml-auto text-xs'>
                    failed
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

// Created and developed by Jai Singh
