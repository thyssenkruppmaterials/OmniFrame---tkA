// Created and developed by Jai Singh
import { IconAlertTriangle } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'

interface ApprovalBannerProps {
  pendingCount: number
  onReview: () => void
}

export function ApprovalBanner({
  pendingCount,
  onReview,
}: ApprovalBannerProps) {
  if (pendingCount === 0) return null

  return (
    <div className='flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/50'>
      <IconAlertTriangle className='h-5 w-5 text-amber-600 dark:text-amber-400' />
      <div className='flex-1'>
        <p className='text-sm font-medium text-amber-800 dark:text-amber-200'>
          {pendingCount} command{pendingCount > 1 ? 's' : ''} pending approval
        </p>
        <p className='text-xs text-amber-600 dark:text-amber-400'>
          Destructive actions require admin review before execution
        </p>
      </div>
      <Button
        variant='outline'
        size='sm'
        onClick={onReview}
        className='border-amber-300 dark:border-amber-700'
      >
        Review
      </Button>
    </div>
  )
}

// Created and developed by Jai Singh
