import { useCallback, useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import {
  CheckCircle2,
  Clock,
  History,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  Search,
  XCircle,
  Eye,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import {
  getTimeAdjustmentRequests,
  approveTimeAdjustmentRequest,
  denyTimeAdjustmentRequest,
  updateTimeAdjustmentNotes,
  getTimeAdjustmentNoteHistory,
  type TimeAdjustmentRequest,
  type TimeAdjustmentNoteHistory,
  type TimeAdjustmentFilters,
} from '@/lib/supabase/time-adjustment.service'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

type StatusFilter = 'pending' | 'approved' | 'denied' | 'all'

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Denied' },
  { value: 'all', label: 'All' },
]

const CLOCK_CODE_LABELS: Record<string, string> = {
  clock_in: 'Clock In',
  clock_out: 'Clock Out',
  meal_in: 'Meal In',
  meal_out: 'Meal Out',
  vacation: 'Vacation',
  floating_holiday: 'Floating Holiday',
  sick: 'Sick',
  other: 'Other',
}

const CORRECTION_TYPE_LABELS: Record<string, string> = {
  add: 'Add',
  delete: 'Delete',
  change: 'Change',
}

const PUNCH_TIME_CODES = new Set([
  'clock_in',
  'clock_out',
  'meal_in',
  'meal_out',
])

function formatRequestedTime(
  hoursRequested: number | null,
  clockCode: string
): string {
  if (hoursRequested == null) return '—'

  if (PUNCH_TIME_CODES.has(clockCode)) {
    const totalMinutes = Math.round(hoursRequested * 60)
    let h24 = Math.floor(totalMinutes / 60)
    const mins = totalMinutes % 60
    const period = h24 >= 12 ? 'PM' : 'AM'
    if (h24 === 0) h24 = 12
    else if (h24 > 12) h24 -= 12
    return `${h24}:${String(mins).padStart(2, '0')} ${period}`
  }

  return `${hoursRequested}h`
}

export function TimeAdjustmentApprovalsDashboard() {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id || ''
  const reviewerUserId = authState.profile?.id || ''
  const reviewerName = authState.profile?.full_name || ''

  const [requests, setRequests] = useState<TimeAdjustmentRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [searchQuery, setSearchQuery] = useState('')
  const hasFetchedOnce = useRef(false)

  const [actionDialogOpen, setActionDialogOpen] = useState(false)
  const [actionType, setActionType] = useState<'approve' | 'deny'>('approve')
  const [actionTarget, setActionTarget] =
    useState<TimeAdjustmentRequest | null>(null)
  const [actionNotes, setActionNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [signatureDialogOpen, setSignatureDialogOpen] = useState(false)
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)

  // Notes editing state
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteValue, setEditingNoteValue] = useState('')
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null)

  // Note history dialog state
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)
  const [historyTarget, setHistoryTarget] =
    useState<TimeAdjustmentRequest | null>(null)
  const [noteHistory, setNoteHistory] = useState<TimeAdjustmentNoteHistory[]>(
    []
  )
  const [historyLoading, setHistoryLoading] = useState(false)

  const loadRequests = useCallback(
    async (silent = false) => {
      if (!organizationId) return
      if (!silent) setIsLoading(true)

      const filters: TimeAdjustmentFilters = {}
      if (statusFilter !== 'all') filters.status = statusFilter
      if (searchQuery.trim()) filters.search = searchQuery.trim()

      const { data, error } = await getTimeAdjustmentRequests(
        organizationId,
        filters
      )
      if (error) {
        toast.error('Failed to load requests', { description: error })
      }
      setRequests(data)
      setIsLoading(false)
      hasFetchedOnce.current = true
    },
    [organizationId, statusFilter, searchQuery]
  )

  useEffect(() => {
    hasFetchedOnce.current = false
    loadRequests()
  }, [loadRequests])

  useEffect(() => {
    const interval = setInterval(() => loadRequests(true), 30_000)
    return () => clearInterval(interval)
  }, [loadRequests])

  const openAction = (
    request: TimeAdjustmentRequest,
    type: 'approve' | 'deny'
  ) => {
    setActionTarget(request)
    setActionType(type)
    setActionNotes('')
    setActionDialogOpen(true)
  }

  const handleAction = async () => {
    if (!actionTarget) return
    setIsSubmitting(true)

    const fn =
      actionType === 'approve'
        ? approveTimeAdjustmentRequest
        : denyTimeAdjustmentRequest
    const { success, error } = await fn(
      actionTarget.id,
      reviewerUserId,
      reviewerName,
      actionNotes || undefined
    )

    if (success) {
      if (actionNotes.trim()) {
        await updateTimeAdjustmentNotes(
          actionTarget.id,
          actionNotes.trim(),
          actionTarget.notes,
          reviewerUserId,
          reviewerName
        )
      }
      toast.success(
        `Request ${actionType === 'approve' ? 'approved' : 'denied'}`
      )
      setActionDialogOpen(false)
      loadRequests()
    } else {
      toast.error(`Failed to ${actionType} request`, {
        description: error || undefined,
      })
    }
    setIsSubmitting(false)
  }

  const openSignature = (dataUrl: string) => {
    setSignatureUrl(dataUrl)
    setSignatureDialogOpen(true)
  }

  // ── Notes editing ──

  const startEditingNote = (req: TimeAdjustmentRequest) => {
    setEditingNoteId(req.id)
    setEditingNoteValue(req.notes || '')
  }

  const cancelEditingNote = () => {
    setEditingNoteId(null)
    setEditingNoteValue('')
  }

  const saveNote = async (req: TimeAdjustmentRequest) => {
    const trimmed = editingNoteValue.trim()
    if (trimmed === (req.notes || '')) {
      cancelEditingNote()
      return
    }

    setSavingNoteId(req.id)
    const { success, error } = await updateTimeAdjustmentNotes(
      req.id,
      trimmed,
      req.notes,
      reviewerUserId,
      reviewerName
    )

    if (success) {
      toast.success('Note saved')
      setRequests((prev) =>
        prev.map((r) => (r.id === req.id ? { ...r, notes: trimmed } : r))
      )
      cancelEditingNote()
    } else {
      toast.error('Failed to save note', { description: error || undefined })
    }
    setSavingNoteId(null)
  }

  // ── Note history ──

  const openHistory = async (req: TimeAdjustmentRequest) => {
    setHistoryTarget(req)
    setHistoryDialogOpen(true)
    setHistoryLoading(true)

    const { data, error } = await getTimeAdjustmentNoteHistory(req.id)
    if (error) {
      toast.error('Failed to load note history', { description: error })
    }
    setNoteHistory(data)
    setHistoryLoading(false)
  }

  const statusBadgeVariant = (status: string) => {
    switch (status) {
      case 'pending':
        return 'outline' as const
      case 'approved':
        return 'default' as const
      case 'denied':
        return 'destructive' as const
      default:
        return 'secondary' as const
    }
  }

  const statusBadgeClass = (status: string) => {
    switch (status) {
      case 'pending':
        return 'border-yellow-500/40 text-yellow-600 dark:text-yellow-400'
      case 'approved':
        return 'bg-green-600 text-white'
      case 'denied':
        return 'bg-red-600 text-white'
      default:
        return ''
    }
  }

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex flex-wrap items-center justify-between gap-4'>
        <div>
          <h3 className='text-lg font-semibold'>Time Adjustment Approvals</h3>
          <p className='text-muted-foreground text-sm'>
            Review and approve or deny associate time correction requests.
          </p>
        </div>
        <Button
          variant='outline'
          size='sm'
          onClick={() => loadRequests()}
          disabled={isLoading}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className='flex flex-wrap items-center gap-3'>
        <div className='flex rounded-lg border'>
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`px-3 py-1.5 text-sm font-medium transition ${
                statusFilter === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              } ${opt.value === 'pending' ? 'rounded-l-lg' : ''} ${opt.value === 'all' ? 'rounded-r-lg' : ''}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className='relative'>
          <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder='Search by name...'
            className='w-[220px] pl-9'
          />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className='flex items-center justify-center py-16'>
          <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
        </div>
      ) : requests.length === 0 ? (
        <div className='flex flex-col items-center gap-3 py-16'>
          <Clock className='text-muted-foreground h-10 w-10 opacity-50' />
          <p className='text-muted-foreground text-sm'>
            {statusFilter === 'pending'
              ? 'No pending time adjustment requests.'
              : 'No requests found matching your filters.'}
          </p>
        </div>
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requester</TableHead>
                <TableHead>Badge</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Supervisor</TableHead>
                <TableHead>Request Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Clock Code</TableHead>
                <TableHead>Requested Time</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reviewed By</TableHead>
                <TableHead className='text-right'>Actions</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((req) => (
                <TableRow key={req.id}>
                  <TableCell className='font-medium'>
                    {req.requester_name}
                  </TableCell>
                  <TableCell className='font-mono text-xs'>
                    {req.requester_badge}
                  </TableCell>
                  <TableCell className='text-sm'>
                    {req.department_area || '—'}
                  </TableCell>
                  <TableCell className='text-sm'>
                    {req.supervisor_name || '—'}
                  </TableCell>
                  <TableCell>
                    {format(
                      new Date(req.request_date + 'T12:00:00'),
                      'MMM d, yyyy'
                    )}
                  </TableCell>
                  <TableCell>
                    <span className='text-sm font-medium'>
                      {CORRECTION_TYPE_LABELS[req.correction_type] ||
                        req.correction_type}
                    </span>
                  </TableCell>
                  <TableCell>
                    {CLOCK_CODE_LABELS[req.clock_code] || req.clock_code}
                  </TableCell>
                  <TableCell>
                    <span className='font-mono text-sm'>
                      {formatRequestedTime(req.hours_requested, req.clock_code)}
                    </span>
                  </TableCell>
                  <TableCell className='max-w-[180px] truncate text-sm'>
                    {req.reason_code === 'other'
                      ? req.reason_other
                      : req.reason_code}
                  </TableCell>

                  <TableCell className='text-muted-foreground text-xs'>
                    {format(new Date(req.created_at), 'MMM d, h:mm a')}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={statusBadgeVariant(req.status)}
                      className={statusBadgeClass(req.status)}
                    >
                      {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                    </Badge>
                  </TableCell>

                  {/* Reviewed By: name + timestamp */}
                  <TableCell className='min-w-[140px]'>
                    {req.reviewer_name ? (
                      <div className='flex flex-col'>
                        <span className='text-sm font-medium'>
                          {req.reviewer_name}
                        </span>
                        {req.reviewed_at && (
                          <span className='text-muted-foreground text-xs'>
                            {format(new Date(req.reviewed_at), 'MMM d, h:mm a')}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className='text-muted-foreground text-sm'>—</span>
                    )}
                  </TableCell>

                  <TableCell className='text-right'>
                    <div className='flex items-center justify-end gap-1'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => openSignature(req.signature_data_url)}
                        title='View signature'
                      >
                        <Eye className='h-4 w-4' />
                      </Button>
                      {req.status === 'pending' && (
                        <>
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={() => openAction(req, 'approve')}
                            className='text-green-600 hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-950/20'
                          >
                            <CheckCircle2 className='mr-1 h-4 w-4' />
                            Approve
                          </Button>
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={() => openAction(req, 'deny')}
                            className='text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/20'
                          >
                            <XCircle className='mr-1 h-4 w-4' />
                            Deny
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>

                  {/* Editable Notes Cell (last column) */}
                  <TableCell className='max-w-[280px] min-w-[200px]'>
                    {editingNoteId === req.id ? (
                      <div className='flex flex-col gap-1.5'>
                        <Textarea
                          value={editingNoteValue}
                          onChange={(e) => setEditingNoteValue(e.target.value)}
                          rows={2}
                          className='text-sm'
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') cancelEditingNote()
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey))
                              saveNote(req)
                          }}
                        />
                        <div className='flex items-center gap-1'>
                          <Button
                            variant='ghost'
                            size='sm'
                            className='h-6 px-2 text-xs'
                            onClick={() => saveNote(req)}
                            disabled={savingNoteId === req.id}
                          >
                            {savingNoteId === req.id ? (
                              <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                            ) : (
                              <Save className='mr-1 h-3 w-3' />
                            )}
                            Save
                          </Button>
                          <Button
                            variant='ghost'
                            size='sm'
                            className='h-6 px-2 text-xs'
                            onClick={cancelEditingNote}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className='group flex items-start gap-1'>
                        <span
                          className='text-muted-foreground cursor-pointer truncate text-sm hover:underline'
                          onClick={() => startEditingNote(req)}
                          title={req.notes || 'Click to add note'}
                        >
                          {req.notes || (
                            <span className='italic opacity-40'>
                              Add note...
                            </span>
                          )}
                        </span>
                        <button
                          onClick={() => openHistory(req)}
                          className='text-muted-foreground hover:text-foreground mt-0.5 shrink-0 opacity-0 transition group-hover:opacity-100'
                          title='View note history'
                        >
                          <History className='h-3.5 w-3.5' />
                        </button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Approve/Deny Dialog */}
      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === 'approve' ? 'Approve' : 'Deny'} Time Adjustment
            </DialogTitle>
            <DialogDescription>
              {actionTarget && (
                <>
                  {actionTarget.requester_name} &mdash;{' '}
                  {CORRECTION_TYPE_LABELS[actionTarget.correction_type]}{' '}
                  {CLOCK_CODE_LABELS[actionTarget.clock_code]} on{' '}
                  {format(
                    new Date(actionTarget.request_date + 'T12:00:00'),
                    'MMM d, yyyy'
                  )}
                  {actionTarget.hours_requested != null &&
                    ` (${formatRequestedTime(actionTarget.hours_requested, actionTarget.clock_code)})`}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-3 py-2'>
            <label className='text-sm font-medium'>Notes (optional)</label>
            <Textarea
              value={actionNotes}
              onChange={(e) => setActionNotes(e.target.value)}
              placeholder='Add any notes for this decision...'
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setActionDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAction}
              disabled={isSubmitting}
              variant={actionType === 'approve' ? 'default' : 'destructive'}
            >
              {isSubmitting ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : actionType === 'approve' ? (
                <CheckCircle2 className='mr-2 h-4 w-4' />
              ) : (
                <XCircle className='mr-2 h-4 w-4' />
              )}
              {actionType === 'approve' ? 'Approve' : 'Deny'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Signature Viewer Dialog */}
      <Dialog open={signatureDialogOpen} onOpenChange={setSignatureDialogOpen}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Signature</DialogTitle>
          </DialogHeader>
          <div className='flex items-center justify-center rounded-lg border bg-white p-4 dark:bg-zinc-900'>
            {signatureUrl && (
              <img
                src={signatureUrl}
                alt='Employee signature'
                className='max-h-[200px] max-w-full'
              />
            )}
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setSignatureDialogOpen(false)}
            >
              <X className='mr-2 h-4 w-4' />
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Note History Dialog */}
      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent className='max-w-lg'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <History className='h-5 w-5' />
              Note History
            </DialogTitle>
            {historyTarget && (
              <DialogDescription>
                {historyTarget.requester_name} &mdash;{' '}
                {format(
                  new Date(historyTarget.request_date + 'T12:00:00'),
                  'MMM d, yyyy'
                )}
              </DialogDescription>
            )}
          </DialogHeader>

          <div className='max-h-[400px] overflow-y-auto'>
            {historyLoading ? (
              <div className='flex items-center justify-center py-8'>
                <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
              </div>
            ) : noteHistory.length === 0 ? (
              <div className='flex flex-col items-center gap-2 py-8'>
                <MessageSquare className='text-muted-foreground h-8 w-8 opacity-40' />
                <p className='text-muted-foreground text-sm'>
                  No note history for this request.
                </p>
              </div>
            ) : (
              <div className='space-y-3'>
                {noteHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className='border-border rounded-lg border p-3'
                  >
                    <div className='mb-1.5 flex items-center justify-between'>
                      <span className='text-sm font-medium'>
                        {entry.edited_by_name}
                      </span>
                      <span className='text-muted-foreground text-xs'>
                        {format(
                          new Date(entry.created_at),
                          'MMM d, yyyy h:mm a'
                        )}
                      </span>
                    </div>

                    <p className='text-foreground text-sm'>
                      {entry.note_content}
                    </p>

                    {entry.previous_content != null && (
                      <div className='bg-muted/50 mt-2 rounded px-2.5 py-1.5'>
                        <p className='text-muted-foreground text-[11px] font-medium tracking-wide uppercase'>
                          Previous
                        </p>
                        <p className='text-muted-foreground mt-0.5 text-xs line-through'>
                          {entry.previous_content || (
                            <span className='italic'>(empty)</span>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setHistoryDialogOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
