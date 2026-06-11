// Created and developed by Jai Singh
import { useCallback, useEffect, useState } from 'react'
import { format, startOfDay, addDays, endOfDay } from 'date-fns'
import {
  Briefcase,
  Calendar as CalendarIcon,
  ChevronDown,
  Clock,
  Filter,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  Timer,
  UserCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type { WorkingArea } from '@/lib/supabase/labor-management.service'
import {
  createOvertimeSignup,
  getAllOvertimeRequests,
  getSignupsForRequests,
  formatOvertimeDuration,
  withdrawOvertimeSignup,
  type OvertimeRequestWithDetails,
  type OvertimeSignupWithDetails,
} from '@/lib/supabase/overtime.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useTeamPerformance } from '@/features/shift-productivity/team-performance/hooks/use-team-performance'

interface AvailableOvertimeViewProps {
  className?: string
}

export function AvailableOvertimeView({
  className,
}: AvailableOvertimeViewProps) {
  const { organizationId, workingAreas: rawWorkingAreas } = useTeamPerformance({
    autoRefresh: false,
  })
  const workingAreas = (rawWorkingAreas || []) as WorkingArea[]

  const { authState } = useUnifiedAuth()
  const currentUserId = authState.user?.id || ''

  const [positions, setPositions] = useState<OvertimeRequestWithDetails[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [areaFilter, setAreaFilter] = useState('__any__')
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date()
    return {
      start: startOfDay(now),
      end: endOfDay(addDays(now, 13)),
    }
  })

  const [signupsByRequest, setSignupsByRequest] = useState<
    Record<string, OvertimeSignupWithDetails[]>
  >({})
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())

  const loadPositions = useCallback(async () => {
    if (!organizationId) return
    setIsLoading(true)
    try {
      const { data } = await getAllOvertimeRequests(organizationId, {
        startDate: format(dateRange.start, 'yyyy-MM-dd'),
        endDate: format(dateRange.end, 'yyyy-MM-dd'),
        status: 'approved',
        workingAreaId: areaFilter !== '__any__' ? areaFilter : undefined,
        limit: 100,
      })

      // Only show positions that have no users assigned (open slots)
      const openPositions = data.filter(
        (r) => !r.assigned_user_ids || r.assigned_user_ids.length === 0
      )

      setPositions(openPositions)

      // Batch-load signups for all visible positions
      if (openPositions.length > 0) {
        try {
          const ids = openPositions.map((p) => p.id)
          const allSignups = await getSignupsForRequests(ids)
          const grouped: Record<string, OvertimeSignupWithDetails[]> = {}
          for (const s of allSignups) {
            const rid = s.overtime_request_id || ''
            if (!grouped[rid]) grouped[rid] = []
            grouped[rid].push(s)
          }
          setSignupsByRequest(grouped)
        } catch {
          // Non-critical - signups are supplementary
        }
      }
    } catch (error) {
      logger.error('Error loading available overtime:', error)
      toast.error('Failed to load available overtime positions')
    } finally {
      setIsLoading(false)
    }
  }, [organizationId, dateRange, areaFilter])

  useEffect(() => {
    loadPositions()
  }, [loadPositions])

  const handleSignup = async (request: OvertimeRequestWithDetails) => {
    if (!currentUserId || !organizationId) return
    setActionLoading(request.id)
    try {
      await createOvertimeSignup(
        organizationId,
        currentUserId,
        request.request_date,
        request.id
      )
      toast.success('Signed up for overtime position')
      await loadPositions()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to sign up')
      await loadPositions()
    } finally {
      setActionLoading(null)
    }
  }

  const handleWithdraw = async (signupId: string, requestId: string) => {
    setActionLoading(requestId)
    try {
      await withdrawOvertimeSignup(signupId)
      toast.success('Withdrawn from overtime position')
      await loadPositions()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to withdraw')
      await loadPositions()
    } finally {
      setActionLoading(null)
    }
  }

  const toggleExpanded = (requestId: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev)
      if (next.has(requestId)) next.delete(requestId)
      else next.add(requestId)
      return next
    })
  }

  const parsePositionFromNotes = (notes?: string) => {
    const match = notes?.match(/Position: (.+?)(?:\s*\(|$)/)
    return match ? match[1].trim() : null
  }

  const parsePositionCodeFromNotes = (notes?: string) => {
    const match = notes?.match(/Position: .+?\(([^)]+)\)/)
    return match ? match[1].trim() : null
  }

  const parseDurationFromNotes = (notes?: string) => {
    const match = notes?.match(/Duration Block: (\d+)h/)
    return match ? parseInt(match[1]) : null
  }

  const formatTime12h = (time24?: string) => {
    if (!time24) return '--:--'
    const t = time24.substring(0, 5)
    const [h, m] = t.split(':').map(Number)
    const period = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 || 12
    return `${h12}:${String(m).padStart(2, '0')} ${period}`
  }

  const priorityOrder: Record<string, number> = {
    urgent: 0,
    high: 1,
    normal: 2,
    low: 3,
  }

  const filteredPositions = positions
    .filter((p) => {
      if (!searchQuery) return true
      const q = searchQuery.toLowerCase()
      const posTitle = parsePositionFromNotes(p.notes) || ''
      return (
        posTitle.toLowerCase().includes(q) ||
        p.working_area_name?.toLowerCase().includes(q) ||
        p.reason?.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 2
      const pb = priorityOrder[b.priority] ?? 2
      if (pa !== pb) return pa - pb
      return (
        new Date(a.request_date).getTime() - new Date(b.request_date).getTime()
      )
    })

  // Group by date
  const groupedByDate = filteredPositions.reduce(
    (acc, pos) => {
      const dateKey = pos.request_date
      if (!acc[dateKey]) acc[dateKey] = []
      acc[dateKey].push(pos)
      return acc
    },
    {} as Record<string, OvertimeRequestWithDetails[]>
  )

  const sortedDates = Object.keys(groupedByDate).sort()

  if (!organizationId) {
    return (
      <div className='flex h-64 items-center justify-center'>
        <p className='text-muted-foreground'>Organization not found</p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div>
        <h3 className='text-lg font-semibold'>Available Overtime</h3>
        <p className='text-muted-foreground text-sm'>
          Browse open overtime positions you can sign up for. Positions are
          created by supervisors and tied to specific roles.
        </p>
      </div>

      {/* Filters */}
      <div className='flex flex-wrap items-center gap-3'>
        <div className='flex items-center gap-2'>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant='outline' className='w-[130px] text-left text-sm'>
                <CalendarIcon className='mr-2 h-4 w-4' />
                {format(dateRange.start, 'MMM d')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-auto p-0' align='start'>
              <Calendar
                mode='single'
                selected={dateRange.start}
                onSelect={(date) =>
                  date && setDateRange((prev) => ({ ...prev, start: date }))
                }
                initialFocus
              />
            </PopoverContent>
          </Popover>
          <span className='text-muted-foreground text-sm'>to</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant='outline' className='w-[130px] text-left text-sm'>
                <CalendarIcon className='mr-2 h-4 w-4' />
                {format(dateRange.end, 'MMM d')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-auto p-0' align='start'>
              <Calendar
                mode='single'
                selected={dateRange.end}
                onSelect={(date) =>
                  date && setDateRange((prev) => ({ ...prev, end: date }))
                }
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className='flex items-center gap-1'>
          <Button
            variant='ghost'
            size='sm'
            className='text-xs'
            onClick={() => {
              const now = new Date()
              setDateRange({
                start: startOfDay(now),
                end: endOfDay(addDays(now, 6)),
              })
            }}
          >
            Next 7 Days
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='text-xs'
            onClick={() => {
              const now = new Date()
              setDateRange({
                start: startOfDay(now),
                end: endOfDay(addDays(now, 13)),
              })
            }}
          >
            Next 14 Days
          </Button>
        </div>

        {workingAreas.length > 0 && (
          <Select value={areaFilter} onValueChange={setAreaFilter}>
            <SelectTrigger className='w-[150px]'>
              <Filter className='mr-2 h-4 w-4' />
              <SelectValue placeholder='All Areas' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='__any__'>All Areas</SelectItem>
              {workingAreas.map((area) => (
                <SelectItem key={area.id} value={area.id}>
                  {area.area_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className='relative min-w-[180px] flex-1'>
          <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Search by position or area...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className='pl-9'
          />
        </div>

        <Button
          variant='outline'
          size='icon'
          onClick={loadPositions}
          disabled={isLoading}
        >
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </Button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className='h-48 rounded-lg' />
          ))}
        </div>
      ) : filteredPositions.length === 0 ? (
        <Card>
          <CardContent className='py-16 text-center'>
            <Clock className='text-muted-foreground mx-auto mb-4 h-12 w-12 opacity-50' />
            <p className='text-lg font-medium'>No Overtime Available</p>
            <p className='text-muted-foreground mt-1 text-sm'>
              {positions.length === 0
                ? 'There are no open overtime positions at this time. Check back later.'
                : 'No positions match your filters. Try adjusting the date range or search.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className='space-y-8'>
          {sortedDates.map((dateKey) => {
            const dayPositions = groupedByDate[dateKey]
            const dateObj = new Date(dateKey + 'T12:00:00')
            return (
              <div key={dateKey}>
                <div className='mb-3 flex items-center gap-2'>
                  <CalendarIcon className='text-muted-foreground h-4 w-4' />
                  <h4 className='text-sm font-semibold'>
                    {format(dateObj, 'EEEE, MMMM d, yyyy')}
                  </h4>
                  <Badge variant='secondary' className='text-xs'>
                    {dayPositions.length} slot
                    {dayPositions.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
                <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
                  {dayPositions.map((pos) => {
                    const posTitle =
                      parsePositionFromNotes(pos.notes) || 'Open Position'
                    const posCode = parsePositionCodeFromNotes(pos.notes)
                    const durHours = parseDurationFromNotes(pos.notes)
                    return (
                      <OvertimeCard
                        key={pos.id}
                        requestId={pos.id}
                        positionTitle={posTitle}
                        positionCode={posCode}
                        startTime={formatTime12h(pos.original_shift_end)}
                        endTime={formatTime12h(pos.extended_shift_end)}
                        durationHours={durHours}
                        durationMinutes={pos.overtime_duration_minutes || 0}
                        areaName={pos.working_area_name}
                        priority={pos.priority}
                        reason={pos.reason}
                        signups={signupsByRequest[pos.id] || []}
                        currentUserId={currentUserId}
                        isCurrentUserSignedUp={(
                          signupsByRequest[pos.id] || []
                        ).some((s) => s.user_id === currentUserId)}
                        currentUserSignupId={
                          (signupsByRequest[pos.id] || []).find(
                            (s) => s.user_id === currentUserId
                          )?.id
                        }
                        signupCutoffTime={pos.signup_cutoff_time}
                        minSignupsRequired={pos.min_signups_required || 1}
                        isLoading={actionLoading === pos.id}
                        onSignup={() => handleSignup(pos)}
                        onWithdraw={(signupId) =>
                          handleWithdraw(signupId, pos.id)
                        }
                        isExpanded={expandedCards.has(pos.id)}
                        onToggleExpand={() => toggleExpanded(pos.id)}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function OvertimeCard({
  positionTitle,
  positionCode,
  startTime,
  endTime,
  durationHours,
  durationMinutes,
  areaName,
  priority,
  reason,
  requestId: _requestId,
  signups,
  currentUserId: _currentUserId,
  isCurrentUserSignedUp,
  currentUserSignupId,
  signupCutoffTime,
  minSignupsRequired,
  isLoading,
  onSignup,
  onWithdraw,
  isExpanded,
  onToggleExpand,
}: {
  positionTitle: string
  positionCode?: string | null
  startTime: string
  endTime: string
  durationHours?: number | null
  durationMinutes: number
  areaName?: string
  priority: string
  reason?: string | null
  requestId: string
  signups: OvertimeSignupWithDetails[]
  currentUserId: string
  isCurrentUserSignedUp: boolean
  currentUserSignupId?: string
  signupCutoffTime?: string | null
  minSignupsRequired: number
  isLoading: boolean
  onSignup: () => void
  onWithdraw: (signupId: string) => void
  isExpanded: boolean
  onToggleExpand: () => void
}) {
  const priorityColors: Record<string, string> = {
    urgent: 'border-l-red-500 bg-red-50/50 dark:bg-red-950/20',
    high: 'border-l-orange-500 bg-orange-50/50 dark:bg-orange-950/20',
    normal: 'border-l-blue-500',
    low: 'border-l-slate-400',
  }

  const priorityBadgeColors: Record<string, string> = {
    urgent: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    normal: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    low: 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400',
  }

  return (
    <Card
      className={cn(
        'border-l-4 transition-shadow hover:shadow-md',
        priorityColors[priority] || priorityColors.normal
      )}
    >
      <CardHeader className='pb-3'>
        <div className='flex items-start justify-between'>
          <div className='flex items-center gap-2'>
            <div className='bg-primary/10 flex h-9 w-9 items-center justify-center rounded-lg'>
              <Briefcase className='text-primary h-4 w-4' />
            </div>
            <div>
              <CardTitle className='text-sm'>{positionTitle}</CardTitle>
              {positionCode && (
                <CardDescription className='text-xs'>
                  {positionCode}
                </CardDescription>
              )}
            </div>
          </div>
          <span
            className={cn(
              'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize',
              priorityBadgeColors[priority] || priorityBadgeColors.normal
            )}
          >
            {priority}
          </span>
        </div>
      </CardHeader>
      <CardContent className='space-y-3 pt-0'>
        {/* Time Block */}
        <div className='bg-muted/50 flex items-center gap-3 rounded-lg p-3'>
          <Timer className='h-5 w-5 text-orange-500' />
          <div>
            <p className='text-sm font-semibold'>
              {durationHours
                ? `${durationHours}-Hour Block`
                : formatOvertimeDuration(durationMinutes)}
            </p>
            <p className='text-muted-foreground text-xs'>
              {startTime} &ndash; {endTime}
            </p>
          </div>
        </div>

        {/* Area */}
        {areaName && (
          <div className='flex items-center gap-2 text-sm'>
            <MapPin className='text-muted-foreground h-3.5 w-3.5' />
            <span className='text-muted-foreground'>{areaName}</span>
          </div>
        )}

        {/* Reason */}
        {reason && (
          <p className='text-muted-foreground line-clamp-2 text-xs'>{reason}</p>
        )}

        {/* Cutoff Indicator */}
        {signupCutoffTime && (
          <div className='flex items-center gap-2 text-xs'>
            <Clock className='text-muted-foreground h-3 w-3' />
            {new Date(signupCutoffTime) > new Date() ? (
              <span className='text-muted-foreground'>
                Signups close{' '}
                {format(new Date(signupCutoffTime), 'MMM d, h:mm a')}
              </span>
            ) : (
              <span className='font-medium text-red-500'>Signups closed</span>
            )}
          </div>
        )}

        {/* Signup Count */}
        <div className='flex items-center gap-2 text-xs'>
          <UserCheck className='text-muted-foreground h-3 w-3' />
          <span className='text-muted-foreground'>
            {signups.length} signed up
            {minSignupsRequired > 1 && ` / ${minSignupsRequired} required`}
          </span>
        </div>

        {/* Action Button */}
        <div className='pt-2'>
          {isCurrentUserSignedUp ? (
            <div className='flex items-center gap-2'>
              <Badge variant='default' className='text-xs'>
                Signed Up
              </Badge>
              <Button
                variant='ghost'
                size='sm'
                className='text-destructive h-7 text-xs'
                onClick={(e) => {
                  e.stopPropagation()
                  if (currentUserSignupId) onWithdraw(currentUserSignupId)
                }}
                disabled={isLoading}
              >
                Withdraw
              </Button>
            </div>
          ) : (
            <Button
              size='sm'
              className='w-full'
              onClick={(e) => {
                e.stopPropagation()
                onSignup()
              }}
              disabled={
                isLoading ||
                (signupCutoffTime
                  ? new Date(signupCutoffTime) <= new Date()
                  : false)
              }
            >
              {isLoading ? (
                <Loader2 className='mr-2 h-3 w-3 animate-spin' />
              ) : null}
              Sign Up
            </Button>
          )}
        </div>

        {/* Signed-up List (expandable) */}
        {signups.length > 0 && (
          <div className='mt-2 border-t pt-2'>
            <button
              type='button'
              className='text-muted-foreground hover:text-foreground flex w-full items-center gap-1 text-xs transition-colors'
              onClick={(e) => {
                e.stopPropagation()
                onToggleExpand()
              }}
            >
              <ChevronDown
                className={cn(
                  'h-3 w-3 transition-transform',
                  isExpanded && 'rotate-180'
                )}
              />
              {isExpanded ? 'Hide' : 'Show'} {signups.length} signed up
            </button>
            {isExpanded && (
              <div className='mt-2 space-y-1.5'>
                {signups.map((s) => (
                  <div key={s.id} className='flex items-center gap-2 text-xs'>
                    <div className='bg-muted flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium'>
                      {s.user?.full_name
                        ?.split(' ')
                        .map((n) => n[0])
                        .join('')
                        .substring(0, 2)
                        .toUpperCase() || '??'}
                    </div>
                    <span>{s.user?.full_name || 'Unknown'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Created and developed by Jai Singh
