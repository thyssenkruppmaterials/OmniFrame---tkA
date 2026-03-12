import {
  AlertCircle,
  Calendar,
  Loader2,
  RefreshCw,
  Tag,
  User,
} from 'lucide-react'
import { toast } from 'sonner'
import { useTicketUpdateIndicator } from '@/lib/smartsheet/realtime'
import {
  TicketStatus,
  useTicket,
  useUpdateTicketStatus,
} from '@/lib/smartsheet/ticket-api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TicketPriorityBadge, TicketStatusBadge } from './TicketStatusBadge'

interface TicketDetailViewProps {
  ticketId: string
}

export function TicketDetailView({ ticketId }: TicketDetailViewProps) {
  const rowId = parseInt(ticketId, 10)
  const { data: ticket, isLoading, error, refetch } = useTicket(rowId)
  const updateStatus = useUpdateTicketStatus()
  const { hasUpdates, updateCount, clearUpdates } =
    useTicketUpdateIndicator(rowId)

  const handleStatusChange = async (newStatus: TicketStatus) => {
    try {
      await updateStatus.mutateAsync({ rowId, status: newStatus })
      toast.success(`Ticket status updated to ${newStatus}`)
      clearUpdates()
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update status'
      )
    }
  }

  const handleRefresh = () => {
    refetch()
    clearUpdates()
    toast.success('Ticket refreshed')
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className='py-12'>
          <div className='flex flex-col items-center justify-center space-y-2'>
            <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
            <p className='text-muted-foreground text-sm'>
              Loading ticket details...
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className='border-destructive'>
        <CardContent className='py-12'>
          <div className='flex flex-col items-center justify-center space-y-2'>
            <AlertCircle className='text-destructive h-8 w-8' />
            <p className='text-destructive font-semibold'>
              Failed to load ticket
            </p>
            <p className='text-muted-foreground text-sm'>{error.message}</p>
            <Button onClick={() => refetch()} variant='outline' size='sm'>
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!ticket) {
    return (
      <Card>
        <CardContent className='py-12'>
          <p className='text-muted-foreground text-center'>Ticket not found</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-start justify-between'>
          <div className='space-y-1'>
            <CardTitle className='text-2xl'>{ticket.subject}</CardTitle>
            <p className='text-muted-foreground text-sm'>
              Ticket ID: {ticket.ticket_id}
            </p>
          </div>
          <div className='flex items-center gap-2'>
            {hasUpdates && (
              <div className='animate-pulse rounded-full bg-blue-500 px-2 py-1 text-xs text-white'>
                {updateCount} new {updateCount === 1 ? 'update' : 'updates'}
              </div>
            )}
            <Button
              variant='outline'
              size='sm'
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw
                className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
              />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className='space-y-4'>
        {/* Status and Priority */}
        <div className='flex flex-wrap items-center gap-4'>
          <div className='space-y-1'>
            <p className='text-muted-foreground text-xs'>Status</p>
            <div className='flex items-center gap-2'>
              <TicketStatusBadge status={ticket.status} />
              <Select
                value={ticket.status}
                onValueChange={(value) =>
                  handleStatusChange(value as TicketStatus)
                }
                disabled={updateStatus.isPending}
              >
                <SelectTrigger className='h-8 w-[180px]'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TicketStatus.OPEN}>Open</SelectItem>
                  <SelectItem value={TicketStatus.IN_PROGRESS}>
                    In Progress
                  </SelectItem>
                  <SelectItem value={TicketStatus.WAITING}>Waiting</SelectItem>
                  <SelectItem value={TicketStatus.RESOLVED}>
                    Resolved
                  </SelectItem>
                  <SelectItem value={TicketStatus.CLOSED}>Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='space-y-1'>
            <p className='text-muted-foreground text-xs'>Priority</p>
            <TicketPriorityBadge priority={ticket.priority} />
          </div>

          {ticket.category && (
            <div className='space-y-1'>
              <p className='text-muted-foreground text-xs'>Category</p>
              <div className='flex items-center gap-1 text-sm'>
                <Tag className='text-muted-foreground h-4 w-4' />
                {ticket.category}
              </div>
            </div>
          )}
        </div>

        {/* Description */}
        <div className='space-y-2'>
          <h4 className='font-semibold'>Description</h4>
          <p className='bg-muted/30 rounded-lg border p-4 text-sm whitespace-pre-wrap'>
            {ticket.description}
          </p>
        </div>

        {/* Customer Information */}
        <div className='bg-muted/30 grid grid-cols-1 gap-4 rounded-lg p-4 md:grid-cols-2'>
          <div className='space-y-1'>
            <p className='text-muted-foreground flex items-center gap-1 text-xs'>
              <User className='h-3 w-3' />
              Customer ID
            </p>
            <p className='text-sm font-medium'>{ticket.customer_id}</p>
          </div>

          <div className='space-y-1'>
            <p className='text-muted-foreground text-xs'>Email</p>
            <p className='text-sm font-medium'>{ticket.email}</p>
          </div>

          {ticket.assigned_to && (
            <div className='space-y-1'>
              <p className='text-muted-foreground text-xs'>Assigned To</p>
              <p className='text-sm font-medium'>{ticket.assigned_to}</p>
            </div>
          )}

          {ticket.created_at && (
            <div className='space-y-1'>
              <p className='text-muted-foreground flex items-center gap-1 text-xs'>
                <Calendar className='h-3 w-3' />
                Created
              </p>
              <p className='text-sm font-medium'>
                {new Date(ticket.created_at).toLocaleString()}
              </p>
            </div>
          )}
        </div>

        {/* Notes (if any) */}
        {ticket.notes && (
          <div className='space-y-2'>
            <h4 className='text-sm font-semibold'>Internal Notes</h4>
            <p className='text-muted-foreground rounded-lg border bg-yellow-50 p-3 text-sm dark:bg-yellow-950/20'>
              {ticket.notes}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
