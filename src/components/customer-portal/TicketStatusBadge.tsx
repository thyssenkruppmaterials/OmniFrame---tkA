// Created and developed by Jai Singh
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  AlertTriangle,
  RotateCcw,
  Ban,
  ThumbsDown,
  Circle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { TicketPriority, TicketStatus } from '@/features/customer-portal'

interface TicketStatusBadgeProps {
  status: TicketStatus | string
  className?: string
}

/**
 * TicketStatusBadge
 *
 * Displays a badge for all Smartsheet ticket statuses:
 *
 * Open Group (Blue tones):
 * - Blank/Empty: Circle icon, light blue
 * - Not Started: AlertCircle icon, blue
 * - Reopened: RotateCcw icon, cyan
 *
 * Active Group (Purple/Yellow tones):
 * - In Progress: Loader2 icon (animated), purple
 * - Escalated: AlertTriangle icon, orange
 *
 * Resolved Group (Green/Gray tones):
 * - Closed: CheckCircle icon, green
 * - Cancelled: Ban icon, gray
 * - Rejected: ThumbsDown icon, red-gray
 *
 * Legacy (backward compatibility):
 * - Open: AlertCircle icon, blue
 * - Waiting: Clock icon, yellow
 * - Resolved: CheckCircle icon, green
 */
export function TicketStatusBadge({
  status,
  className,
}: TicketStatusBadgeProps) {
  const getStatusConfig = (status: TicketStatus | string) => {
    switch (status) {
      // === OPEN GROUP ===
      case TicketStatus.BLANK:
      case '':
        return {
          variant: 'outline' as const,
          icon: <Circle className='h-3 w-3' />,
          label: 'No Status',
          className:
            'bg-blue-100 text-blue-700 border-blue-300 hover:bg-blue-200',
        }
      case TicketStatus.NOT_STARTED:
      case 'Not Started':
        return {
          variant: 'default' as const,
          icon: <AlertCircle className='h-3 w-3' />,
          label: 'Not Started',
          className: 'bg-blue-500 hover:bg-blue-600',
        }
      case TicketStatus.REOPENED:
      case 'Reopened':
        return {
          variant: 'default' as const,
          icon: <RotateCcw className='h-3 w-3' />,
          label: 'Reopened',
          className: 'bg-cyan-500 hover:bg-cyan-600',
        }

      // === ACTIVE GROUP ===
      case TicketStatus.IN_PROGRESS:
      case 'In Progress':
        return {
          variant: 'default' as const,
          icon: <Loader2 className='h-3 w-3 animate-spin' />,
          label: 'In Progress',
          className: 'bg-purple-500 hover:bg-purple-600',
        }
      case TicketStatus.ESCALATED:
      case 'Escalated':
        return {
          variant: 'default' as const,
          icon: <AlertTriangle className='h-3 w-3' />,
          label: 'Escalated',
          className: 'bg-orange-500 hover:bg-orange-600',
        }

      // === RESOLVED GROUP ===
      case TicketStatus.CLOSED:
      case 'Closed':
        return {
          variant: 'default' as const,
          icon: <CheckCircle className='h-3 w-3' />,
          label: 'Closed',
          className: 'bg-green-500 hover:bg-green-600',
        }
      case TicketStatus.CANCELLED:
      case 'Cancelled':
        return {
          variant: 'secondary' as const,
          icon: <Ban className='h-3 w-3' />,
          label: 'Cancelled',
          className: 'bg-gray-500 hover:bg-gray-600',
        }
      case TicketStatus.REJECTED:
      case 'Rejected':
        return {
          variant: 'secondary' as const,
          icon: <ThumbsDown className='h-3 w-3' />,
          label: 'Rejected',
          className: 'bg-red-400 hover:bg-red-500',
        }

      // === LEGACY (backward compatibility) ===
      case TicketStatus.OPEN:
      case 'Open':
        return {
          variant: 'default' as const,
          icon: <AlertCircle className='h-3 w-3' />,
          label: 'Open',
          className: 'bg-blue-500 hover:bg-blue-600',
        }
      case TicketStatus.WAITING:
      case 'Waiting':
        return {
          variant: 'secondary' as const,
          icon: <Clock className='h-3 w-3' />,
          label: 'Waiting',
          className: 'bg-yellow-500 hover:bg-yellow-600',
        }
      case TicketStatus.RESOLVED:
      case 'Resolved':
        return {
          variant: 'default' as const,
          icon: <CheckCircle className='h-3 w-3' />,
          label: 'Resolved',
          className: 'bg-green-500 hover:bg-green-600',
        }

      // === UNKNOWN/DEFAULT ===
      default:
        return {
          variant: 'outline' as const,
          icon: null,
          label: status || 'Unknown',
          className: '',
        }
    }
  }

  const config = getStatusConfig(status)

  return (
    <Badge
      variant={config.variant}
      className={`${config.className} ${className || ''}`}
    >
      <span className='flex items-center gap-1'>
        {config.icon}
        {config.label}
      </span>
    </Badge>
  )
}

interface TicketPriorityBadgeProps {
  priority: TicketPriority
  className?: string
}

export function TicketPriorityBadge({
  priority,
  className,
}: TicketPriorityBadgeProps) {
  const getPriorityConfig = (priority: TicketPriority) => {
    switch (priority) {
      case TicketPriority.CRITICAL:
        return {
          variant: 'destructive' as const,
          label: 'Critical',
          className: 'bg-red-600 hover:bg-red-700 animate-pulse',
        }
      case TicketPriority.HIGH:
        return {
          variant: 'destructive' as const,
          label: 'High',
          className: 'bg-orange-500 hover:bg-orange-600',
        }
      case TicketPriority.MEDIUM:
        return {
          variant: 'default' as const,
          label: 'Medium',
          className: 'bg-yellow-500 hover:bg-yellow-600',
        }
      case TicketPriority.LOW:
        return {
          variant: 'secondary' as const,
          label: 'Low',
          className: 'bg-gray-400 hover:bg-gray-500',
        }
      default:
        return {
          variant: 'outline' as const,
          label: priority,
          className: '',
        }
    }
  }

  const config = getPriorityConfig(priority)

  return (
    <Badge
      variant={config.variant}
      className={`${config.className} ${className || ''}`}
    >
      {config.label}
    </Badge>
  )
}

// Created and developed by Jai Singh
