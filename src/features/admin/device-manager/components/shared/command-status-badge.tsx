import { cn } from '@/lib/utils'
import type { CommandStatus } from '../../types/device-manager.types'

interface CommandStatusBadgeProps {
  status: CommandStatus
}

const STATUS_STYLES: Record<CommandStatus, string> = {
  Queued: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  PendingApproval:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  Approved: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400',
  Sent: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  Acknowledged:
    'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  NotNow:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  Completed:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  Failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  Cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  Expired:
    'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  DeadLetter: 'bg-red-200 text-red-900 dark:bg-red-900/40 dark:text-red-300',
}

export function CommandStatusBadge({ status }: CommandStatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        STATUS_STYLES[status] || STATUS_STYLES.Queued
      )}
    >
      {status}
    </span>
  )
}
