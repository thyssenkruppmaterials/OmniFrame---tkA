// Created and developed by Jai Singh
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
  IconMessageCircle,
  IconPaperclip,
  IconPlus,
  IconPrinter,
  IconRefresh,
  IconUser,
  IconX,
} from '@tabler/icons-react'
import { toast } from 'sonner'
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

  if (!ticketId) {
    return (
      <Card className='flex h-full items-center justify-center border-dashed'>
        <CardContent className='py-20 text-center'>
          <div className='bg-muted/40 mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl'>
            <IconMessageCircle className='text-muted-foreground/50 h-8 w-8' />
          </div>
          <h3 className='text-foreground mb-1.5 text-base font-semibold'>
            No Ticket Selected
          </h3>
          <p className='text-muted-foreground mx-auto max-w-[220px] text-sm leading-relaxed'>
            Select a ticket from the list to view details and respond
          </p>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <Card className='h-full'>
        <CardHeader className='space-y-3 pb-4'>
          <div className='flex items-start justify-between'>
            <div className='space-y-2'>
              <Skeleton className='h-5 w-28' />
              <Skeleton className='h-6 w-72' />
              <Skeleton className='h-4 w-48' />
            </div>
            <div className='flex gap-1'>
              <Skeleton className='h-8 w-8 rounded-md' />
              <Skeleton className='h-8 w-8 rounded-md' />
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-4 pt-0'>
          <div className='flex items-center gap-3'>
            <Skeleton className='h-8 w-32' />
            <Skeleton className='h-8 w-8' />
          </div>
          <Separator />
          <div className='grid grid-cols-2 gap-3'>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className='space-y-1.5'>
                <Skeleton className='h-3 w-20' />
                <Skeleton className='h-4 w-32' />
              </div>
            ))}
          </div>
          <Separator />
          <Skeleton className='h-28 w-full rounded-lg' />
        </CardContent>
      </Card>
    )
  }

  if (error || !ticket) {
    return (
      <Card className='flex h-full items-center justify-center border-dashed'>
        <CardContent className='py-20 text-center'>
          <div className='bg-destructive/10 mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl'>
            <IconX className='text-destructive h-8 w-8' />
          </div>
          <h3 className='text-foreground mb-1.5 text-base font-semibold'>
            Failed to Load Ticket
          </h3>
          <p className='text-muted-foreground mx-auto mb-5 max-w-[240px] text-sm leading-relaxed'>
            {error?.message || 'This ticket could not be found'}
          </p>
          <Button variant='outline' size='sm' onClick={() => refetch()}>
            <IconRefresh className='mr-1.5 h-3.5 w-3.5' />
            Retry
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
    <Card className='flex h-full flex-col overflow-hidden'>
      {/* Header */}
      <CardHeader className='space-y-0 border-b px-5 pt-4 pb-4'>
        <div className='flex items-start justify-between'>
          <div className='min-w-0 flex-1 space-y-1'>
            <div className='flex items-center gap-2'>
              <span className='text-primary text-sm font-semibold tracking-tight'>
                {ticket.ticket_id}
              </span>
              {ticket.ilc_department && (
                <Badge variant='outline' className='text-[10px] font-normal'>
                  {ticket.ilc_department}
                </Badge>
              )}
            </div>
            <h2 className='text-lg leading-tight font-semibold tracking-tight'>
              {ticket.subject}
            </h2>
            {ticket.created_at && (
              <p className='text-muted-foreground flex items-center gap-1 text-xs'>
                <IconCalendar className='h-3 w-3' />
                {format(new Date(ticket.created_at), "MMM d, yyyy 'at' h:mm a")}
              </p>
            )}
          </div>

          <div className='ml-3 flex items-center gap-0.5'>
            <Button
              variant='ghost'
              size='icon'
              className='h-7 w-7'
              onClick={handlePrintTicket}
              title='Print'
            >
              <IconPrinter className='h-3.5 w-3.5' />
            </Button>
            <Button
              variant='ghost'
              size='icon'
              className='h-7 w-7'
              onClick={handleRefresh}
              disabled={isRefreshing}
              title='Refresh'
            >
              <IconRefresh
                className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')}
              />
            </Button>
            <Button
              variant='ghost'
              size='icon'
              className='h-7 w-7'
              onClick={onClose}
              title='Close'
            >
              <IconX className='h-3.5 w-3.5' />
            </Button>
          </div>
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
                  <span className='text-muted-foreground'>New Department:</span>
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
      </CardHeader>

      <CardContent className='flex flex-1 flex-col overflow-hidden px-5 pt-4'>
        {/* External Update Banner */}
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
              Refresh
            </Button>
          </div>
        )}

        {/* Status + Department Controls */}
        <div className='mb-4 flex flex-wrap items-center gap-3'>
          <div className='flex items-center gap-1.5'>
            <span className='text-muted-foreground text-xs font-medium'>
              Status
            </span>
            <Select
              value={ticket.status}
              onValueChange={(value) =>
                handleStatusChange(value as TicketStatus)
              }
              disabled={isUpdatingStatus}
            >
              <SelectTrigger className='h-7 w-[140px] text-xs'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
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
          <Separator orientation='vertical' className='h-5' />
          <div className='flex items-center gap-1.5'>
            <span className='text-muted-foreground text-xs font-medium'>
              Dept
            </span>
            <Select
              value={ticket.ilc_department || ''}
              onValueChange={handleDepartmentSelect}
              disabled={isUpdatingDepartment}
            >
              <SelectTrigger className='h-7 w-[150px] text-xs'>
                <IconArrowsExchange className='mr-1 h-3 w-3' />
                <SelectValue placeholder='Reassign' />
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
        </div>

        {/* Customer Info */}
        <div className='bg-muted/30 mb-4 rounded-lg border p-3'>
          <div className='mb-2 flex items-center gap-1.5'>
            <IconUser className='text-muted-foreground h-3.5 w-3.5' />
            <span className='text-xs font-semibold'>Customer Details</span>
          </div>
          <div className='grid grid-cols-2 gap-x-6 gap-y-2'>
            <MetaField label='Requestor' value={ticket.requestor_name} />
            <MetaField label='Email' value={ticket.requestor_email} />
            {ticket.plant && <MetaField label='Plant' value={ticket.plant} />}
            {ticket.material_number && (
              <MetaField label='Material #' value={ticket.material_number} />
            )}
            {ticket.quantity && (
              <MetaField label='Quantity' value={ticket.quantity} />
            )}
            {ticket.delivery_number && (
              <MetaField label='Delivery #' value={ticket.delivery_number} />
            )}
            {ticket.po_number && (
              <MetaField label='PO #' value={ticket.po_number} />
            )}
            {ticket.rma_number && (
              <MetaField label='RMA #' value={ticket.rma_number} />
            )}
            {ticket.qn_number && (
              <MetaField label='QN #' value={ticket.qn_number} />
            )}

            {ticket.ilc_department?.toLowerCase() === 'containment' && (
              <>
                <div className='space-y-0.5'>
                  <p className='text-muted-foreground text-[11px]'>
                    Containment
                  </p>
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
                    <span className='text-xs font-medium'>
                      {ticket.containment ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>
                {ticket.containment_date && (
                  <MetaField
                    label='Containment Date'
                    value={ticket.containment_date}
                  />
                )}
              </>
            )}

            {ticket.ilc_department?.toLowerCase() === 'quality' && (
              <>
                <div className='space-y-0.5'>
                  <p className='text-muted-foreground text-[11px]'>RTV</p>
                  <div className='flex items-center gap-2'>
                    <Checkbox
                      checked={ticket.rtv ?? false}
                      onCheckedChange={async (checked) => {
                        if (!ticketId) return
                        onSuppressNotification?.(ticketId)
                        try {
                          await updateCheckbox(
                            ticketId,
                            'rtv',
                            checked === true
                          )
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
                    <span className='text-xs font-medium'>
                      {ticket.rtv ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>
                {ticket.rtv_critical && (
                  <MetaField label='RTV Critical' value={ticket.rtv_critical} />
                )}
                {ticket.rtv_date && (
                  <MetaField label='RTV Date' value={ticket.rtv_date} />
                )}
              </>
            )}
          </div>
        </div>

        {/* Ticket Details Tabs */}
        <div className='mb-4'>
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
              <div className='text-muted-foreground bg-muted/30 min-h-[48px] rounded-lg border border-transparent p-3 text-sm leading-relaxed whitespace-pre-wrap'>
                {ticket.description || (
                  <span className='text-muted-foreground/50 italic'>
                    No description provided
                  </span>
                )}
              </div>
            </TabsContent>
            <TabsContent value='tka_updates' className='mt-2'>
              <div className='text-muted-foreground bg-muted/30 min-h-[48px] rounded-lg border border-transparent p-3 text-sm leading-relaxed whitespace-pre-wrap'>
                {ticket.tka_updates || (
                  <span className='text-muted-foreground/50 italic'>
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
                  <div className='absolute -inset-px overflow-hidden rounded-md'>
                    <div
                      className='absolute top-1/2 left-1/2 h-[200%] w-[200%] -translate-x-1/2 -translate-y-1/2 animate-[spin_3s_linear_infinite]'
                      style={{
                        background:
                          'conic-gradient(from 0deg, transparent 0deg, transparent 80deg, rgba(59, 130, 246, 0.15) 85deg, rgba(59, 130, 246, 0.4) 88deg, rgba(37, 99, 235, 0.7) 90deg, rgba(59, 130, 246, 0.4) 92deg, rgba(59, 130, 246, 0.15) 95deg, transparent 100deg, transparent 360deg)',
                      }}
                    />
                  </div>
                  <div className='bg-background absolute inset-px rounded-[5px]' />
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
              <div className='text-muted-foreground bg-muted/30 min-h-[48px] rounded-lg border border-transparent p-3 text-sm leading-relaxed whitespace-pre-wrap'>
                {ticket.rolls_royce_updates || (
                  <span className='text-muted-foreground/50 italic'>
                    No Rolls Royce updates
                  </span>
                )}
              </div>
            </TabsContent>
            <TabsContent value='resolution' className='mt-2'>
              <div className='text-muted-foreground bg-muted/30 min-h-[48px] rounded-lg border border-transparent p-3 text-sm leading-relaxed whitespace-pre-wrap'>
                {ticket.resolution || (
                  <span className='text-muted-foreground/50 italic'>
                    No resolution yet
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
                  <div className='absolute -inset-px overflow-hidden rounded-md'>
                    <div
                      className='absolute top-1/2 left-1/2 h-[200%] w-[200%] -translate-x-1/2 -translate-y-1/2 animate-[spin_3s_linear_infinite]'
                      style={{
                        background:
                          'conic-gradient(from 0deg, transparent 0deg, transparent 80deg, rgba(59, 130, 246, 0.15) 85deg, rgba(59, 130, 246, 0.4) 88deg, rgba(37, 99, 235, 0.7) 90deg, rgba(59, 130, 246, 0.4) 92deg, rgba(59, 130, 246, 0.15) 95deg, transparent 100deg, transparent 360deg)',
                      }}
                    />
                  </div>
                  <div className='bg-background absolute inset-px rounded-[5px]' />
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
          <div className='mb-4'>
            <p className='mb-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400'>
              Internal Notes
            </p>
            <div className='rounded-lg border border-amber-200/60 bg-amber-50/50 p-3 text-sm leading-relaxed whitespace-pre-wrap dark:border-amber-800/40 dark:bg-amber-950/20'>
              {ticket.notes}
            </div>
          </div>
        )}

        {/* Comments & Attachments */}
        <Tabs defaultValue='comments' className='flex min-h-0 flex-1 flex-col'>
          <TabsList className='h-9 w-full justify-start rounded-lg'>
            <TabsTrigger
              value='comments'
              className='flex items-center gap-1.5 text-xs'
            >
              <IconMessageCircle className='h-3.5 w-3.5' />
              Comments
              {commentCount > 0 && (
                <span className='bg-muted text-muted-foreground rounded-full px-1.5 py-0 text-[10px] font-medium tabular-nums'>
                  {commentCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value='attachments'
              className='flex items-center gap-1.5 text-xs'
            >
              <IconPaperclip className='h-3.5 w-3.5' />
              Attachments
              {ticket.attachments && ticket.attachments.length > 0 && (
                <span className='bg-muted text-muted-foreground rounded-full px-1.5 py-0 text-[10px] font-medium tabular-nums'>
                  {ticket.attachments.length}
                </span>
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

function MetaField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className='space-y-0.5'>
      <p className='text-muted-foreground text-[11px]'>{label}</p>
      <p className='text-foreground text-xs font-medium'>{value || '-'}</p>
    </div>
  )
}

// Created and developed by Jai Singh
