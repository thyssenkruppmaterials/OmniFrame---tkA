// Created and developed by Jai Singh
import { useEffect } from 'react'
import { format } from 'date-fns'
import { IconCheck, IconLogout, IconLogin } from '@tabler/icons-react'
import type {
  ClockResult,
  EmployeeLookupResult,
} from '../services/time-clock.service'

interface ClockConfirmationProps {
  result: ClockResult
  employee: EmployeeLookupResult
  onDone: () => void
  autoResetSeconds?: number
}

export default function ClockConfirmation({
  result,
  employee,
  onDone,
  autoResetSeconds = 8,
}: ClockConfirmationProps) {
  useEffect(() => {
    const timer = setTimeout(onDone, autoResetSeconds * 1000)
    return () => clearTimeout(timer)
  }, [onDone, autoResetSeconds])

  const isClockIn = result.action === 'clock_in'
  const timestamp = new Date(result.timestamp)

  return (
    <div className='animate-in fade-in flex flex-col items-center gap-6 text-center duration-500'>
      {/* Success Icon */}
      <div
        className={`flex h-20 w-20 items-center justify-center rounded-2xl ${
          isClockIn
            ? 'bg-green-500/10 text-green-600 ring-2 ring-green-500/20 dark:text-green-400'
            : 'bg-orange-500/10 text-orange-600 ring-2 ring-orange-500/20 dark:text-orange-400'
        }`}
      >
        {isClockIn ? (
          <IconLogin className='h-10 w-10' />
        ) : (
          <IconLogout className='h-10 w-10' />
        )}
      </div>

      {/* Action Label */}
      <div>
        <h2 className='text-foreground text-3xl font-bold tracking-tight'>
          {isClockIn ? 'Clocked In' : 'Clocked Out'}
        </h2>
        <div className='mt-1.5 flex items-center justify-center gap-1.5'>
          <IconCheck className='h-4 w-4 text-green-600 dark:text-green-400' />
          <span className='text-sm font-medium text-green-600 dark:text-green-400'>
            Successfully recorded
          </span>
        </div>
      </div>

      {/* Employee Info Card */}
      <div className='bg-card border-border rounded-xl border px-8 py-5 shadow-sm'>
        <p className='text-foreground text-xl font-semibold'>
          {employee.full_name}
        </p>
        {employee.position_name && (
          <p className='text-muted-foreground mt-0.5 text-sm'>
            {employee.position_name}
          </p>
        )}
        <p className='text-muted-foreground/60 mt-1.5 font-mono text-xs'>
          Badge: {employee.badge_number}
        </p>
      </div>

      {/* Timestamp */}
      <div className='space-y-1'>
        <p className='text-foreground font-mono text-4xl font-bold tracking-tight'>
          {format(timestamp, 'h:mm:ss a')}
        </p>
        <p className='text-muted-foreground text-sm'>
          {format(timestamp, 'EEEE, MMMM d, yyyy')}
        </p>
      </div>

      {/* Auto-reset */}
      <p className='text-muted-foreground/40 mt-2 text-xs'>
        Returning to home screen in {autoResetSeconds} seconds...
      </p>

      {/* Manual done */}
      <button
        onClick={onDone}
        className='bg-secondary hover:bg-secondary/80 text-secondary-foreground border-border rounded-xl border px-8 py-2.5 text-sm font-medium transition'
      >
        Done
      </button>
    </div>
  )
}

// Created and developed by Jai Singh
