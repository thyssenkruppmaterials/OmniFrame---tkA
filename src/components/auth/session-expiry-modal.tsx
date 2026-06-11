// Created and developed by Jai Singh
import { useEffect, useMemo } from 'react'
import { Shield } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface SessionExpiryModalProps {
  /** Whether the modal is visible */
  open: boolean
  /** Seconds remaining before auto-logout */
  timeRemaining: number
  /** Called when user clicks "Extend Session" */
  onExtend: () => void
  /** Called when user clicks "Log Out" or countdown reaches 0 */
  onLogout: () => void
}

/**
 * Full-screen session expiry modal with animated countdown ring.
 *
 * Displays a prominent warning when the user's session is about to expire,
 * giving them a clear option to extend or log out. Automatically triggers
 * logout when the countdown reaches 0.
 */
export function SessionExpiryModal({
  open,
  timeRemaining,
  onExtend,
  onLogout,
}: SessionExpiryModalProps) {
  // Auto-logout when countdown reaches 0
  useEffect(() => {
    if (open && timeRemaining <= 0) {
      onLogout()
    }
  }, [open, timeRemaining, onLogout])

  // Format time as MM:SS
  const formattedTime = useMemo(() => {
    const clamped = Math.max(0, timeRemaining)
    const minutes = Math.floor(clamped / 60)
    const seconds = clamped % 60
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }, [timeRemaining])

  // Progress percentage (assuming a 5-minute / 300-second warning window)
  const WARNING_DURATION_SECONDS = 300
  const progress = useMemo(() => {
    return Math.max(0, Math.min(1, timeRemaining / WARNING_DURATION_SECONDS))
  }, [timeRemaining])

  // SVG ring calculations
  const RING_RADIUS = 70
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
  const strokeDashoffset = RING_CIRCUMFERENCE * (1 - progress)

  // Urgency color based on remaining time
  const urgencyColor = useMemo(() => {
    if (timeRemaining <= 30) return 'text-red-500'
    if (timeRemaining <= 60) return 'text-orange-400'
    return 'text-amber-400'
  }, [timeRemaining])

  const ringStrokeColor = useMemo(() => {
    if (timeRemaining <= 30) return 'stroke-red-500'
    if (timeRemaining <= 60) return 'stroke-orange-400'
    return 'stroke-amber-400'
  }, [timeRemaining])

  if (!open) return null

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center',
        'bg-black/60 backdrop-blur-sm',
        'animate-in fade-in duration-300'
      )}
      role='alertdialog'
      aria-modal='true'
      aria-label='Session expiring soon'
    >
      <div
        className={cn(
          'relative flex flex-col items-center gap-6 rounded-2xl border p-10',
          'bg-background/95 shadow-2xl backdrop-blur-md',
          'mx-4 w-full max-w-md',
          'animate-in zoom-in-95 slide-in-from-bottom-4 duration-300'
        )}
      >
        {/* Shield icon */}
        <div
          className={cn(
            'flex items-center justify-center rounded-full p-3',
            'bg-amber-500/10 ring-1 ring-amber-500/20'
          )}
        >
          <Shield className='size-8 text-amber-500' />
        </div>

        {/* Title */}
        <div className='space-y-1 text-center'>
          <h2 className='text-xl font-semibold tracking-tight'>
            Session Expiring Soon
          </h2>
          <p className='text-muted-foreground text-sm'>
            Your session will end due to inactivity
          </p>
        </div>

        {/* Countdown ring */}
        <div className='relative flex items-center justify-center'>
          <svg
            width='180'
            height='180'
            viewBox='0 0 180 180'
            className='-rotate-90'
          >
            {/* Background ring */}
            <circle
              cx='90'
              cy='90'
              r={RING_RADIUS}
              fill='none'
              strokeWidth='6'
              className='stroke-muted/30'
            />
            {/* Progress ring */}
            <circle
              cx='90'
              cy='90'
              r={RING_RADIUS}
              fill='none'
              strokeWidth='6'
              strokeLinecap='round'
              className={cn(
                ringStrokeColor,
                'transition-all duration-1000 ease-linear'
              )}
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={strokeDashoffset}
            />
          </svg>

          {/* Countdown text overlay */}
          <div className='absolute inset-0 flex flex-col items-center justify-center'>
            <span
              className={cn(
                'font-mono text-4xl font-bold tracking-wider tabular-nums',
                urgencyColor,
                'transition-colors duration-500'
              )}
            >
              {formattedTime}
            </span>
            <span className='text-muted-foreground mt-1 text-xs'>
              remaining
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className='flex w-full flex-col gap-3'>
          <Button
            size='lg'
            className='h-12 w-full text-base font-semibold'
            onClick={onExtend}
            autoFocus
          >
            Extend Session
          </Button>
          <Button
            variant='ghost'
            size='lg'
            className='text-muted-foreground w-full'
            onClick={onLogout}
          >
            Log Out
          </Button>
        </div>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
