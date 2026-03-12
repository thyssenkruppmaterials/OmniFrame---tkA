/**
 * Ticket Detail Panel Component
 *
 * Right panel showing selected ticket details with status controls,
 * metadata, and the chat/comment thread.
 * Uses Rust Core Smartsheet service for data.
 */
import { useCallback, useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  IconArrowsExchange,
  IconCalendar,
  IconLoader2,
  IconMail,
  IconMessageCircle,
  IconPaperclip,
  IconPlus,
  IconPrinter,
  IconRefresh,
  IconTag,
  IconUser,
  IconX,
} from '@tabler/icons-react'
import { toast } from 'sonner'
// Removed TicketStatusBadge and TicketPriorityBadge imports - no longer used in header
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  TicketStatus,
  useTicketDetails,
  useTickets,
  useUpdateCheckboxField,
  useUpdateILCDepartment,
  useUpdateTicketField,
  useUpdateTicketStatus,
  type TicketTextField,
} from '../hooks/useTickets'
import { TicketAttachmentsPanel } from './TicketAttachmentsPanel'
import { TicketChatThread } from './TicketChatThread'

/**
 * Formats an update with the user's name and timestamp.
 * Similar to comment formatting in TicketChatThread.tsx
 */
function formatUpdateWithUserInfo(
  content: string,
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string | undefined
): string {
  // Build the user display name
  const hasName = firstName || lastName
  const fullName = hasName
    ? [firstName, lastName].filter(Boolean).join(' ')
    : email || 'Unknown User'

  // Format the timestamp
  const timestamp = format(new Date(), 'MMM d, yyyy h:mm a')

  // Return content with user signature
  return `${content}\n— ${fullName}, ${timestamp}`
}

interface TicketDetailPanelProps {
  ticketId: number | null
  onClose: () => void
  isTicketUpdated?: boolean // whether this ticket was recently updated externally
  onAcknowledgeUpdate?: () => void // callback to clear the update indicator
  onSuppressNotification?: (rowId: number) => void // suppress notification for own edits
}

export function TicketDetailPanel({
  ticketId,
  onClose,
  isTicketUpdated,
  onAcknowledgeUpdate,
  onSuppressNotification,
}: TicketDetailPanelProps) {
  const { ticket, isLoading, error, refetch, refetchTickets } =
    useTicketDetails(ticketId)
  const { updateStatus, isPending: isUpdatingStatus } = useUpdateTicketStatus()
  const { updateField, isPending: isUpdatingField } = useUpdateTicketField()
  const { updateILCDepartment, isPending: isUpdatingDepartment } =
    useUpdateILCDepartment()
  const { updateCheckbox, isPending: isUpdatingCheckbox } =
    useUpdateCheckboxField()
  const { allTickets } = useTickets()
  const { authState } = useUnifiedAuth()

  // State for inline update forms
  const [editingField, setEditingField] = useState<TicketTextField | null>(null)
  const [updateContent, setUpdateContent] = useState('')

  // State for department reassignment confirmation
  const [pendingDepartment, setPendingDepartment] = useState<string | null>(
    null
  )
  const [showReassignConfirm, setShowReassignConfirm] = useState(false)

  // State for refresh button loading
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Get unique ILC departments from all tickets
  const ilcDepartments = useMemo(() => {
    const depts = new Set<string>()
    allTickets.forEach((t) => {
      if (t.ilc_department) depts.add(t.ilc_department)
    })
    return Array.from(depts).sort()
  }, [allTickets])

  // Memoize user info for update formatting
  const userInfo = useMemo(
    () => ({
      firstName: authState.profile?.first_name,
      lastName: authState.profile?.last_name,
      email: authState.user?.email,
    }),
    [
      authState.profile?.first_name,
      authState.profile?.last_name,
      authState.user?.email,
    ]
  )

  // Handler for refresh button with loading state
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await refetch()
    } finally {
      setIsRefreshing(false)
    }
  }, [refetch])

  const handleStartEdit = (field: TicketTextField) => {
    setEditingField(field)
    setUpdateContent('')
  }

  const handleCancelEdit = () => {
    setEditingField(null)
    setUpdateContent('')
  }

  const handleSaveUpdate = async (field: TicketTextField) => {
    if (!ticketId || !updateContent.trim()) return

    // Suppress notification for this row so the user's own edit
    // doesn't trigger a false-positive update indicator.
    onSuppressNotification?.(ticketId)

    try {
      // Format the update with user info and timestamp
      const formattedUpdate = formatUpdateWithUserInfo(
        updateContent.trim(),
        userInfo.firstName,
        userInfo.lastName,
        userInfo.email
      )

      const existingContent =
        field === 'tka_updates' ? ticket?.tka_updates : ticket?.resolution

      await updateField(ticketId, field, formattedUpdate, existingContent)

      // Note: Toast is shown by the underlying useUpdateCells hook
      setEditingField(null)
      setUpdateContent('')
      refetch()
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save update'
      )
    }
  }

  const handleStatusChange = async (newStatus: TicketStatus) => {
    if (!ticketId) return
    onSuppressNotification?.(ticketId)

    try {
      await updateStatus(ticketId, newStatus)
      // Note: Toast is shown by the underlying useUpdateCells hook
      refetch()
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update status'
      )
    }
  }

  // Handler to show confirmation dialog when department is selected
  const handleDepartmentSelect = (newDepartment: string) => {
    // Only show confirmation if department is actually changing
    if (newDepartment !== ticket?.ilc_department) {
      setPendingDepartment(newDepartment)
      setShowReassignConfirm(true)
    }
  }

  // Handler to actually perform the department reassignment after confirmation
  const handleConfirmReassign = async () => {
    if (!ticketId || !pendingDepartment) return
    onSuppressNotification?.(ticketId)

    try {
      await updateILCDepartment(ticketId, pendingDepartment)
      toast.success(`Ticket reassigned to ${pendingDepartment}`)
      refetch()
      refetchTickets()
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to reassign ticket'
      )
    } finally {
      setShowReassignConfirm(false)
      setPendingDepartment(null)
    }
  }

  // Handler to cancel the reassignment
  const handleCancelReassign = () => {
    setShowReassignConfirm(false)
    setPendingDepartment(null)
  }

  // Print ticket handler - opens a clean printable view in a new window
  const handlePrintTicket = useCallback(() => {
    if (!ticket) return

    const createdDate = ticket.created_at
      ? format(new Date(ticket.created_at), "MMM d, yyyy 'at' h:mm a")
      : 'N/A'

    // Build metadata rows from ticket fields
    const metaRows: { label: string; value: string }[] = [
      { label: 'Requestor Name', value: ticket.requestor_name || '-' },
      { label: 'Requestor E-mail', value: ticket.requestor_email || '-' },
    ]
    if (ticket.plant) metaRows.push({ label: 'Plant', value: ticket.plant })
    if (ticket.material_number)
      metaRows.push({ label: 'Material Number', value: ticket.material_number })
    if (ticket.quantity)
      metaRows.push({ label: 'Quantity', value: ticket.quantity })
    if (ticket.delivery_number)
      metaRows.push({ label: 'Delivery Number', value: ticket.delivery_number })
    if (ticket.po_number)
      metaRows.push({ label: 'PO Number', value: ticket.po_number })
    if (ticket.rma_number)
      metaRows.push({ label: 'RMA Number', value: ticket.rma_number })
    if (ticket.qn_number)
      metaRows.push({ label: 'QN Number', value: ticket.qn_number })

    const metaTableRows = metaRows
      .map(
        (r) =>
          `<tr><td style="padding:6px 12px;font-weight:600;color:#64748b;white-space:nowrap;border-bottom:1px solid #e2e8f0;">${r.label}</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;">${r.value}</td></tr>`
      )
      .join('')

    // Helper to render a section only if it has content
    const renderSection = (
      title: string,
      content: string | undefined,
      placeholder: string
    ) => {
      const text =
        content ||
        `<span style="color:#94a3b8;font-style:italic;">${placeholder}</span>`
      return `
        <div style="margin-bottom:20px;">
          <h3 style="font-size:14px;font-weight:700;margin:0 0 8px 0;color:#1e293b;border-bottom:2px solid #3b82f6;padding-bottom:4px;">${title}</h3>
          <div style="font-size:13px;line-height:1.6;white-space:pre-wrap;color:#334155;">${text}</div>
        </div>
      `
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Ticket ${ticket.ticket_id}</title>
  <style>
    @media print {
      body { margin: 0; padding: 16px; }
      .no-print { display: none !important; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #1e293b;
      background: #fff;
      max-width: 800px;
      margin: 0 auto;
      padding: 24px;
    }
  </style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
    <div>
      <h1 style="font-size:22px;font-weight:800;margin:0;color:#1e40af;">${ticket.ticket_id}</h1>
      ${ticket.subject ? `<h2 style="font-size:16px;font-weight:600;margin:4px 0 0 0;color:#334155;">${ticket.subject}</h2>` : ''}
    </div>
    <div style="text-align:right;">
      <div style="font-size:12px;color:#64748b;">Created ${createdDate}</div>
      <div style="font-size:12px;margin-top:2px;"><strong>Status:</strong> ${ticket.status || 'N/A'}</div>
      ${ticket.ilc_department ? `<div style="font-size:12px;margin-top:2px;"><strong>Department:</strong> ${ticket.ilc_department}</div>` : ''}
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
    ${metaTableRows}
  </table>

  ${renderSection('Description', ticket.description, 'No description')}
  ${renderSection('TKA Updates', ticket.tka_updates, 'No TKA updates')}
  ${renderSection('RR Updates', ticket.rolls_royce_updates, 'No Rolls Royce updates')}
  ${renderSection('Resolution', ticket.resolution, 'No resolution')}

  <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">
    Printed on ${format(new Date(), "MMM d, yyyy 'at' h:mm a")} &mdash; OmniFrame
  </div>

  <script>window.onload=function(){window.print();setTimeout(function(){window.close();},100);}</script>
</body>
</html>`

    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(html)
      printWindow.document.close()
    }
  }, [ticket])

  // Empty state when no ticket selected
  if (!ticketId) {
    return (
      <Card className='flex h-full items-center justify-center'>
        <CardContent className='py-16 text-center'>
          <IconMessageCircle className='text-muted-foreground/40 mx-auto mb-4 h-16 w-16' />
          <h3 className='mb-2 text-lg font-semibold'>No Ticket Selected</h3>
          <p className='text-muted-foreground text-sm'>
            Select a ticket from the list to view details and respond
          </p>
        </CardContent>
      </Card>
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <Card className='h-full'>
        <CardHeader className='flex flex-row items-start justify-between'>
          <div className='space-y-2'>
            <Skeleton className='h-6 w-24' />
            <Skeleton className='h-8 w-64' />
          </div>
          <Skeleton className='h-9 w-9' />
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex gap-2'>
            <Skeleton className='h-6 w-20' />
            <Skeleton className='h-6 w-16' />
            <Skeleton className='h-6 w-24' />
          </div>
          <Skeleton className='h-24 w-full' />
          <Separator />
          <div className='space-y-4'>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className='h-20 w-full' />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  // Error state
  if (error || !ticket) {
    return (
      <Card className='flex h-full items-center justify-center'>
        <CardContent className='py-16 text-center'>
          <IconX className='text-destructive/40 mx-auto mb-4 h-16 w-16' />
          <h3 className='text-destructive mb-2 text-lg font-semibold'>
            Error Loading Ticket
          </h3>
          <p className='text-muted-foreground mb-4 text-sm'>
            {error?.message || 'Ticket not found'}
          </p>
          <Button variant='outline' onClick={() => refetch()}>
            <IconRefresh className='mr-2 h-4 w-4' />
            Try Again
          </Button>
        </CardContent>
      </Card>
    )
  }

  const commentCount =
    ticket.discussions?.reduce(
      (acc, d) => acc + (d.comments?.length || 0),
      0
    ) || 0

  return (
    <Card className='flex h-full flex-col'>
      {/* Header */}
      <CardHeader className='flex flex-row items-start justify-between space-y-0 pb-4'>
        <div className='min-w-0 flex-1 space-y-1'>
          {/* Ticket ID - prominent display */}
          <span className='text-primary font-mono text-xl font-bold'>
            {ticket.ticket_id}
          </span>

          {/* Subject */}
          <h2 className='text-xl leading-tight font-bold'>{ticket.subject}</h2>

          {/* Created Date with Timestamp + Reassign Button */}
          <div className='text-muted-foreground flex items-center gap-4 text-sm'>
            {ticket.created_at && (
              <span className='flex items-center gap-1'>
                <IconCalendar className='h-3 w-3' />
                Created{' '}
                {format(new Date(ticket.created_at), "MMM d, yyyy 'at' h:mm a")}
              </span>
            )}

            {/* Reassign Department Dropdown */}
            <div className='flex items-center gap-2'>
              <Select
                value={ticket.ilc_department || ''}
                onValueChange={handleDepartmentSelect}
                disabled={isUpdatingDepartment}
              >
                <SelectTrigger className='h-7 w-[180px] text-xs'>
                  <IconArrowsExchange className='mr-1 h-3 w-3' />
                  <SelectValue placeholder='Reassign Department' />
                </SelectTrigger>
                <SelectContent>
                  {ilcDepartments.map((dept) => (
                    <SelectItem key={dept} value={dept}>
                      {dept}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Reassign Department Confirmation Dialog */}
            <ConfirmDialog
              open={showReassignConfirm}
              onOpenChange={(open) => {
                if (!open) handleCancelReassign()
              }}
              title='Reassign Ticket'
              desc={
                <div className='space-y-2'>
                  <p>Are you sure you want to reassign this ticket?</p>
                  <div className='bg-muted space-y-1 rounded-md p-3 text-sm'>
                    <div className='flex justify-between'>
                      <span className='text-muted-foreground'>
                        Current Department:
                      </span>
                      <span className='font-medium'>
                        {ticket.ilc_department || 'None'}
                      </span>
                    </div>
                    <div className='flex justify-between'>
                      <span className='text-muted-foreground'>
                        New Department:
                      </span>
                      <span className='text-primary font-medium'>
                        {pendingDepartment}
                      </span>
                    </div>
                  </div>
                </div>
              }
              confirmText='Confirm'
              cancelBtnText='Cancel'
              handleConfirm={handleConfirmReassign}
              isLoading={isUpdatingDepartment}
            />
          </div>
        </div>

        {/* Actions */}
        <div className='ml-4 flex items-center gap-1'>
          <Button
            variant='ghost'
            size='icon'
            className='h-8 w-8'
            onClick={handlePrintTicket}
            title='Print Ticket'
          >
            <IconPrinter className='h-4 w-4' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='h-8 w-8'
            onClick={onClose}
          >
            <IconX className='h-4 w-4' />
          </Button>
        </div>
      </CardHeader>

      <CardContent className='flex flex-1 flex-col overflow-hidden pt-0'>
        {/* External Update Notification Banner */}
        {isTicketUpdated && (
          <div className='animate-in fade-in slide-in-from-top-1 mb-3 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 duration-300 dark:border-blue-800 dark:bg-blue-950/30'>
            <div className='flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300'>
              <IconRefresh className='h-4 w-4' />
              <span>This ticket has been updated</span>
            </div>
            <Button
              variant='outline'
              size='sm'
              className='h-7 border-blue-300 text-xs hover:bg-blue-100 dark:border-blue-700 dark:hover:bg-blue-900'
              onClick={() => {
                handleRefresh()
                onAcknowledgeUpdate?.()
              }}
            >
              Refresh to see changes
            </Button>
          </div>
        )}

        {/* Status Change Control */}
        <div className='mb-3 flex items-center justify-between border-b pb-3'>
          <div className='flex items-center gap-2'>
            <span className='text-sm font-medium'>Status:</span>
            <Select
              value={ticket.status}
              onValueChange={(value) =>
                handleStatusChange(value as TicketStatus)
              }
              disabled={isUpdatingStatus}
            >
              <SelectTrigger className='h-8 w-[160px]'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* Valid Smartsheet picklist values only */}
                <SelectItem value={TicketStatus.NOT_STARTED}>
                  Not Started
                </SelectItem>
                <SelectItem value={TicketStatus.IN_PROGRESS}>
                  In Progress
                </SelectItem>
                <SelectItem value={TicketStatus.ESCALATED}>
                  Escalated
                </SelectItem>
                <SelectItem value={TicketStatus.REOPENED}>Reopened</SelectItem>
                <SelectItem value={TicketStatus.CLOSED}>Closed</SelectItem>
                <SelectItem value={TicketStatus.CANCELLED}>
                  Cancelled
                </SelectItem>
                <SelectItem value={TicketStatus.REJECTED}>Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant={isRefreshing ? 'default' : 'outline'}
            size={isRefreshing ? 'sm' : 'icon'}
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={cn(
              'overflow-hidden transition-all duration-300 ease-in-out',
              isRefreshing &&
                'bg-primary/90 hover:bg-primary/90 text-primary-foreground min-w-[100px]'
            )}
          >
            <IconRefresh
              className={cn(
                'h-4 w-4 transition-transform',
                isRefreshing && 'animate-spin'
              )}
            />
            {isRefreshing && (
              <span className='ml-2 animate-pulse text-sm font-medium'>
                Syncing...
              </span>
            )}
          </Button>
        </div>

        {/* Customer Info Card */}
        <div className='bg-muted/30 mb-3 grid grid-cols-2 gap-3 rounded-lg p-3'>
          <div className='space-y-1'>
            <p className='text-muted-foreground flex items-center gap-1 text-xs'>
              <IconUser className='h-3 w-3' />
              Requestor Name
            </p>
            <p className='text-sm font-medium'>
              {ticket.requestor_name || '-'}
            </p>
          </div>
          <div className='space-y-1'>
            <p className='text-muted-foreground flex items-center gap-1 text-xs'>
              <IconMail className='h-3 w-3' />
              Requestor E-mail
            </p>
            <p className='text-sm font-medium'>
              {ticket.requestor_email || '-'}
            </p>
          </div>
          {ticket.plant && (
            <div className='space-y-1'>
              <p className='text-muted-foreground text-xs'>Plant</p>
              <p className='text-sm font-medium'>{ticket.plant}</p>
            </div>
          )}
          {ticket.material_number && (
            <div className='space-y-1'>
              <p className='text-muted-foreground text-xs'>Material Number</p>
              <p className='text-sm font-medium'>{ticket.material_number}</p>
            </div>
          )}
          {ticket.quantity && (
            <div className='space-y-1'>
              <p className='text-muted-foreground text-xs'>Quantity</p>
              <p className='text-sm font-medium'>{ticket.quantity}</p>
            </div>
          )}
          {ticket.delivery_number && (
            <div className='space-y-1'>
              <p className='text-muted-foreground text-xs'>Delivery Number</p>
              <p className='text-sm font-medium'>{ticket.delivery_number}</p>
            </div>
          )}
          {ticket.po_number && (
            <div className='space-y-1'>
              <p className='text-muted-foreground text-xs'>PO Number</p>
              <p className='text-sm font-medium'>{ticket.po_number}</p>
            </div>
          )}
          {ticket.rma_number && (
            <div className='space-y-1'>
              <p className='text-muted-foreground text-xs'>RMA Number</p>
              <p className='text-sm font-medium'>{ticket.rma_number}</p>
            </div>
          )}
          {ticket.qn_number && (
            <div className='space-y-1'>
              <p className='text-muted-foreground text-xs'>QN Number</p>
              <p className='text-sm font-medium'>{ticket.qn_number}</p>
            </div>
          )}

          {/* Containment Department Fields */}
          {ticket.ilc_department?.toLowerCase() === 'containment' && (
            <>
              <div className='space-y-1'>
                <p className='text-muted-foreground text-xs'>Containment</p>
                <div className='flex items-center gap-2'>
                  <Checkbox
                    checked={ticket.containment ?? false}
                    onCheckedChange={async (checked) => {
                      if (!ticketId) return
                      onSuppressNotification?.(ticketId)
                      try {
                        await updateCheckbox(
                          ticketId,
                          'containment',
                          checked === true
                        )
                        toast.success(
                          checked
                            ? 'Containment marked'
                            : 'Containment unmarked'
                        )
                        refetch()
                      } catch (error: unknown) {
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : 'Failed to update containment'
                        )
                      }
                    }}
                    disabled={isUpdatingCheckbox}
                  />
                  <span className='text-sm font-medium'>
                    {ticket.containment ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
              {ticket.containment_date && (
                <div className='space-y-1'>
                  <p className='text-muted-foreground text-xs'>
                    Containment Date
                  </p>
                  <p className='text-sm font-medium'>
                    {ticket.containment_date}
                  </p>
                </div>
              )}
            </>
          )}

          {/* Quality Department Fields */}
          {ticket.ilc_department?.toLowerCase() === 'quality' && (
            <>
              <div className='space-y-1'>
                <p className='text-muted-foreground text-xs'>RTV</p>
                <div className='flex items-center gap-2'>
                  <Checkbox
                    checked={ticket.rtv ?? false}
                    onCheckedChange={async (checked) => {
                      if (!ticketId) return
                      onSuppressNotification?.(ticketId)
                      try {
                        await updateCheckbox(ticketId, 'rtv', checked === true)
                        toast.success(checked ? 'RTV marked' : 'RTV unmarked')
                        refetch()
                      } catch (error: unknown) {
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : 'Failed to update RTV'
                        )
                      }
                    }}
                    disabled={isUpdatingCheckbox}
                  />
                  <span className='text-sm font-medium'>
                    {ticket.rtv ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
              {ticket.rtv_critical && (
                <div className='space-y-1'>
                  <p className='text-muted-foreground text-xs'>RTV Critical</p>
                  <p className='text-sm font-medium'>{ticket.rtv_critical}</p>
                </div>
              )}
              {ticket.rtv_date && (
                <div className='space-y-1'>
                  <p className='text-muted-foreground text-xs'>RTV Date</p>
                  <p className='text-sm font-medium'>{ticket.rtv_date}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Ticket Details Tabs */}
        <div className='mb-3'>
          <div className='mb-1.5 flex items-center gap-1'>
            <IconTag className='h-4 w-4' />
            <span className='text-sm font-semibold'>Details</span>
          </div>
          <Tabs defaultValue='description' className='w-full'>
            <TabsList className='h-8 w-full p-0.5'>
              <TabsTrigger value='description' className='h-7 flex-1 text-xs'>
                Description
              </TabsTrigger>
              <TabsTrigger value='tka_updates' className='h-7 flex-1 text-xs'>
                TKA Updates
              </TabsTrigger>
              <TabsTrigger
                value='rolls_royce_updates'
                className='h-7 flex-1 text-xs'
              >
                RR Updates
              </TabsTrigger>
              <TabsTrigger value='resolution' className='h-7 flex-1 text-xs'>
                Resolution
              </TabsTrigger>
            </TabsList>
            <TabsContent value='description' className='mt-2'>
              <div className='text-muted-foreground bg-muted/30 min-h-[60px] rounded-lg p-2.5 text-sm whitespace-pre-wrap'>
                {ticket.description || (
                  <span className='text-muted-foreground/60 italic'>
                    No description
                  </span>
                )}
              </div>
            </TabsContent>
            <TabsContent value='tka_updates' className='mt-2'>
              <div className='text-muted-foreground bg-muted/30 min-h-[60px] rounded-lg p-2.5 text-sm whitespace-pre-wrap'>
                {ticket.tka_updates || (
                  <span className='text-muted-foreground/60 italic'>
                    No TKA updates
                  </span>
                )}
              </div>

              {/* Inline Update Form */}
              {editingField === 'tka_updates' ? (
                <div className='mt-2 space-y-2'>
                  <Textarea
                    value={updateContent}
                    onChange={(e) => setUpdateContent(e.target.value)}
                    placeholder='Enter your update...'
                    className='min-h-[80px] text-sm'
                    disabled={isUpdatingField}
                  />
                  <div className='flex items-center justify-end gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={handleCancelEdit}
                      disabled={isUpdatingField}
                    >
                      Cancel
                    </Button>
                    <Button
                      size='sm'
                      onClick={() => handleSaveUpdate('tka_updates')}
                      disabled={!updateContent.trim() || isUpdatingField}
                    >
                      {isUpdatingField ? (
                        <>
                          <IconLoader2 className='mr-1 h-3 w-3 animate-spin' />
                          Saving...
                        </>
                      ) : (
                        'Save'
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className='relative mt-2 inline-block'>
                  {/* Outer container for the rotating gradient - sized larger than button */}
                  <div className='absolute -inset-[1px] overflow-hidden rounded-md'>
                    {/* Spinning gradient layer - creates the glowing light beam effect */}
                    <div
                      className='absolute top-1/2 left-1/2 h-[200%] w-[200%] -translate-x-1/2 -translate-y-1/2 animate-[spin_3s_linear_infinite]'
                      style={{
                        background:
                          'conic-gradient(from 0deg, transparent 0deg, transparent 80deg, rgba(59, 130, 246, 0.15) 85deg, rgba(59, 130, 246, 0.4) 88deg, rgba(37, 99, 235, 0.7) 90deg, rgba(59, 130, 246, 0.4) 92deg, rgba(59, 130, 246, 0.15) 95deg, transparent 100deg, transparent 360deg)',
                      }}
                    />
                  </div>
                  {/* Inner solid background that masks the center */}
                  <div className='bg-background absolute inset-[1px] rounded-[5px]' />
                  <Button
                    variant='ghost'
                    size='sm'
                    className='relative h-7 border-transparent bg-transparent text-xs'
                    onClick={() => handleStartEdit('tka_updates')}
                  >
                    <IconPlus className='mr-1 h-3 w-3' />
                    Add Update
                  </Button>
                </div>
              )}
            </TabsContent>
            <TabsContent value='rolls_royce_updates' className='mt-2'>
              <div className='text-muted-foreground bg-muted/30 min-h-[60px] rounded-lg p-2.5 text-sm whitespace-pre-wrap'>
                {ticket.rolls_royce_updates || (
                  <span className='text-muted-foreground/60 italic'>
                    No Rolls Royce updates
                  </span>
                )}
              </div>
            </TabsContent>
            <TabsContent value='resolution' className='mt-2'>
              <div className='text-muted-foreground bg-muted/30 min-h-[60px] rounded-lg p-2.5 text-sm whitespace-pre-wrap'>
                {ticket.resolution || (
                  <span className='text-muted-foreground/60 italic'>
                    No resolution
                  </span>
                )}
              </div>

              {/* Inline Update Form */}
              {editingField === 'resolution' ? (
                <div className='mt-2 space-y-2'>
                  <Textarea
                    value={updateContent}
                    onChange={(e) => setUpdateContent(e.target.value)}
                    placeholder='Enter resolution details...'
                    className='min-h-[80px] text-sm'
                    disabled={isUpdatingField}
                  />
                  <div className='flex items-center justify-end gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={handleCancelEdit}
                      disabled={isUpdatingField}
                    >
                      Cancel
                    </Button>
                    <Button
                      size='sm'
                      onClick={() => handleSaveUpdate('resolution')}
                      disabled={!updateContent.trim() || isUpdatingField}
                    >
                      {isUpdatingField ? (
                        <>
                          <IconLoader2 className='mr-1 h-3 w-3 animate-spin' />
                          Saving...
                        </>
                      ) : (
                        'Save'
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className='relative mt-2 inline-block'>
                  {/* Outer container for the rotating gradient - sized larger than button */}
                  <div className='absolute -inset-[1px] overflow-hidden rounded-md'>
                    {/* Spinning gradient layer - creates the glowing light beam effect */}
                    <div
                      className='absolute top-1/2 left-1/2 h-[200%] w-[200%] -translate-x-1/2 -translate-y-1/2 animate-[spin_3s_linear_infinite]'
                      style={{
                        background:
                          'conic-gradient(from 0deg, transparent 0deg, transparent 80deg, rgba(59, 130, 246, 0.15) 85deg, rgba(59, 130, 246, 0.4) 88deg, rgba(37, 99, 235, 0.7) 90deg, rgba(59, 130, 246, 0.4) 92deg, rgba(59, 130, 246, 0.15) 95deg, transparent 100deg, transparent 360deg)',
                      }}
                    />
                  </div>
                  {/* Inner solid background that masks the center */}
                  <div className='bg-background absolute inset-[1px] rounded-[5px]' />
                  <Button
                    variant='ghost'
                    size='sm'
                    className='relative h-7 border-transparent bg-transparent text-xs'
                    onClick={() => handleStartEdit('resolution')}
                  >
                    <IconPlus className='mr-1 h-3 w-3' />
                    Add Update
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* Internal Notes */}
        {ticket.notes && (
          <div className='mb-3'>
            <h4 className='mb-1.5 text-sm font-semibold'>Internal Notes</h4>
            <p className='rounded-lg border border-yellow-200 bg-yellow-50 p-2.5 text-sm dark:border-yellow-800 dark:bg-yellow-950/20'>
              {ticket.notes}
            </p>
          </div>
        )}

        {/* Tabs for Comments and Attachments */}
        <Tabs defaultValue='comments' className='flex min-h-0 flex-1 flex-col'>
          <TabsList className='w-full justify-start'>
            <TabsTrigger value='comments' className='flex items-center gap-1'>
              <IconMessageCircle className='h-4 w-4' />
              Comments
              {commentCount > 0 && (
                <Badge variant='secondary' className='ml-1 px-1.5 py-0 text-xs'>
                  {commentCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value='attachments'
              className='flex items-center gap-1'
            >
              <IconPaperclip className='h-4 w-4' />
              Attachments
              {ticket.attachments && ticket.attachments.length > 0 && (
                <Badge variant='secondary' className='ml-1 px-1.5 py-0 text-xs'>
                  {ticket.attachments.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value='comments' className='mt-3 flex-1 overflow-hidden'>
            <TicketChatThread
              ticketId={ticketId}
              discussions={ticket.discussions || []}
              onCommentAdded={refetch}
            />
          </TabsContent>

          <TabsContent
            value='attachments'
            className='mt-3 flex-1 overflow-auto'
          >
            <TicketAttachmentsPanel
              ticketId={ticketId}
              attachments={ticket.attachments || []}
              onAttachmentAdded={refetch}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
