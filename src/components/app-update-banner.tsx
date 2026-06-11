// Created and developed by Jai Singh
/**
 * AppUpdateBanner - Non-Intrusive Update Notification
 *
 * Fixed-position banner that slides down from the top of the viewport when a
 * new deployment is detected. Uses existing shadcn/Radix patterns for styling.
 *
 * Actions:
 * - "Update Now" → immediate graceful reload
 * - Dismiss "X" → hides banner, but auto-reload still triggers on navigation or idle
 *
 * @module app-update-banner
 */
import { RefreshCw, X, ArrowUpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppUpdater } from '@/hooks/use-app-updater'
import { Button } from '@/components/ui/button'

export function AppUpdateBanner() {
  const { updateAvailable, buildInfo, isReloading, updateNow, dismiss } =
    useAppUpdater()

  if (!updateAvailable) return null

  return (
    <div
      role='alert'
      aria-live='polite'
      className={cn(
        'fixed top-0 right-0 left-0 z-[9999]',
        'animate-in slide-in-from-top duration-300 ease-out',
        'bg-primary text-primary-foreground',
        'shadow-lg'
      )}
    >
      <div className='mx-auto flex max-w-screen-xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6'>
        {/* Left: Icon + Message */}
        <div className='flex min-w-0 items-center gap-3'>
          <ArrowUpCircle className='h-5 w-5 shrink-0' />
          <p className='truncate text-sm font-medium'>
            A new version of OmniFrame is available
            {buildInfo?.version && (
              <span className='text-primary-foreground/80 hidden sm:inline'>
                {' '}
                (v{buildInfo.version})
              </span>
            )}
          </p>
        </div>

        {/* Right: Actions */}
        <div className='flex shrink-0 items-center gap-2'>
          <Button
            size='sm'
            variant='secondary'
            onClick={updateNow}
            disabled={isReloading}
            className='h-7 gap-1.5 text-xs font-semibold'
          >
            {isReloading ? (
              <>
                <RefreshCw className='h-3.5 w-3.5 animate-spin' />
                Updating...
              </>
            ) : (
              <>
                <RefreshCw className='h-3.5 w-3.5' />
                Update Now
              </>
            )}
          </Button>
          <button
            type='button'
            onClick={dismiss}
            className='hover:bg-primary-foreground/10 focus-visible:ring-ring rounded-md p-1 transition-colors focus-visible:ring-2 focus-visible:outline-none'
            aria-label='Dismiss update notification'
          >
            <X className='h-4 w-4' />
          </button>
        </div>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
