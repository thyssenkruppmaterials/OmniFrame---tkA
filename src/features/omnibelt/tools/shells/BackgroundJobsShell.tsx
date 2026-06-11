// Created and developed by Jai Singh
/**
 * OmniBelt — Background Jobs shell (P4 stub)
 *
 * The live job list (with progress halos, cancel buttons, and the
 * `useOmnibeltJobs` WS subscription) lands in P5 alongside the
 * Mach 3 status tray. P4 ships a stub that surfaces the link to
 * the existing admin Work Queue dashboard so the tile isn't an
 * empty hole when users open it.
 *
 * Documented as a P4 deviation in the implementation log; full
 * integration is the canonical P5 deliverable.
 */
import { useNavigate } from '@tanstack/react-router'
import { IconExternalLink, IconListTree, IconX } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import type { ToolShellProps } from '../registry'

export default function BackgroundJobsShell({ onClose }: ToolShellProps) {
  const navigate = useNavigate()

  return (
    <div className='flex flex-col gap-3 text-sm'>
      <header className='flex items-center justify-between'>
        <h2 className='flex items-center gap-2 text-base font-semibold'>
          <IconListTree className='size-4' />
          Background Jobs
        </h2>
        <Button
          variant='ghost'
          size='icon'
          aria-label='Close Background Jobs'
          onClick={onClose}
        >
          <IconX className='size-4' />
        </Button>
      </header>

      <p className='text-muted-foreground text-xs'>
        Background-job status will be live here.
      </p>
      <p className='text-muted-foreground text-xs'>
        Mach 3 status integration (progress halo + cancel) lands in Phase 5.
      </p>

      <Button
        variant='outline'
        size='sm'
        className='justify-between'
        onClick={() => {
          navigate({ to: '/admin/work-queue' })
          onClose()
        }}
      >
        <span>Open Work Queue</span>
        <IconExternalLink className='size-3.5' aria-hidden='true' />
      </Button>
    </div>
  )
}

// Created and developed by Jai Singh
