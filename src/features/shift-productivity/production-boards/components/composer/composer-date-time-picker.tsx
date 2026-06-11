// Created and developed by Jai Singh
/**
 * Composite date + time picker used by the post composer's scheduling
 * controls (publish_at, expires_at, application deadline, etc.).
 *
 * Builds on the existing shadcn `<Calendar>` primitive (popover-based)
 * and pairs it with a native `<input type="time">` so the curator can
 * pick both halves in one cell without dragging a separate widget. The
 * value is serialised as an ISO string in the caller's tz; passing
 * `null` clears both halves and shows the placeholder.
 *
 * Why a thin local primitive rather than a global `components/ui/`
 * promotion? Today's only consumer is the composer; if a second consumer
 * lands (e.g. the cycle-count scheduler) the recipe is ready to lift
 * out. Until then keeping it next to the composer keeps the design
 * pressure local.
 */
import { useMemo, useState } from 'react'
import { IconCalendar, IconX } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface ComposerDateTimePickerProps {
  value: string | null
  onChange: (next: string | null) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Hide the clear-X affordance. */
  required?: boolean
  /** Optional minimum selectable date (e.g. "now" for scheduled posts). */
  minDate?: Date
}

function splitIso(iso: string | null): { date: Date | null; time: string } {
  if (!iso) return { date: null, time: '' }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: null, time: '' }
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return { date: d, time: `${hh}:${mm}` }
}

function combine(date: Date, time: string): string {
  const [h, m] = time.split(':').map(Number)
  const out = new Date(date)
  out.setHours(Number.isFinite(h) ? h : 0)
  out.setMinutes(Number.isFinite(m) ? m : 0)
  out.setSeconds(0)
  out.setMilliseconds(0)
  return out.toISOString()
}

function formatDisplay(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function ComposerDateTimePicker({
  value,
  onChange,
  placeholder = 'Pick date & time',
  className,
  disabled,
  required,
  minDate,
}: ComposerDateTimePickerProps) {
  const [open, setOpen] = useState(false)
  const { date, time } = useMemo(() => splitIso(value), [value])
  const display = formatDisplay(value)

  const setDate = (next: Date | undefined): void => {
    if (!next) {
      onChange(null)
      return
    }
    const t = time || '09:00'
    onChange(combine(next, t))
  }

  const setTime = (next: string): void => {
    const base = date ?? new Date()
    onChange(combine(base, next))
  }

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type='button'
            variant='outline'
            disabled={disabled}
            className={cn(
              'flex-1 justify-start font-normal',
              !value && 'text-muted-foreground'
            )}
          >
            <IconCalendar className='mr-2 h-4 w-4 opacity-70' aria-hidden />
            {display ?? placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-auto space-y-2 p-2' align='start'>
          <Calendar
            mode='single'
            selected={date ?? undefined}
            onSelect={setDate}
            captionLayout='dropdown'
            disabled={minDate ? { before: minDate } : undefined}
            initialFocus
          />
          <div className='flex items-center gap-2 border-t pt-2'>
            <label className='text-muted-foreground text-xs'>Time</label>
            <input
              type='time'
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className='border-input bg-background focus-visible:ring-ring flex h-8 flex-1 rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none'
              aria-label='Time'
            />
            <Button
              type='button'
              size='sm'
              variant='secondary'
              className='h-8 px-2 text-xs'
              onClick={() => setOpen(false)}
            >
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {!required && value && !disabled && (
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='text-muted-foreground hover:text-foreground h-9 w-9'
          onClick={() => onChange(null)}
          aria-label='Clear date and time'
        >
          <IconX className='h-4 w-4' aria-hidden />
        </Button>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
