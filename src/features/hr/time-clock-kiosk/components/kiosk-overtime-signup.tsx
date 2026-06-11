// Created and developed by Jai Singh
import { useState, useCallback, useEffect } from 'react'
import { format, addDays, startOfDay, endOfDay } from 'date-fns'
import {
  IconArrowLeft,
  IconCalendar,
  IconClock,
  IconMapPin,
  IconLoader2,
  IconCheck,
  IconBriefcase,
} from '@tabler/icons-react'
import { supabase } from '@/lib/supabase/client'
import {
  createOvertimeSignup,
  type OvertimeRequestWithDetails,
} from '@/lib/supabase/overtime.service'
import { logger } from '@/lib/utils/logger'
import { QWERTYKeyboard } from '@/components/ui/qwerty-keyboard'
import {
  lookupEmployeeByBadge,
  type EmployeeLookupResult,
} from '../services/time-clock.service'

interface OvertimeQueryRow {
  assigned_user_ids: string[] | null
  working_area: { area_name: string; area_code: string } | null
  [key: string]: unknown
}

interface KioskProfileResult {
  id: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  avatar_url: string | null
  organization_id: string | null
}

type SignupState = 'browse' | 'badge_scan' | 'confirming' | 'success' | 'error'

interface KioskOvertimeSignupProps {
  onBack: () => void
}

export default function KioskOvertimeSignup({
  onBack,
}: KioskOvertimeSignupProps) {
  const [state, setState] = useState<SignupState>('browse')
  const [positions, setPositions] = useState<OvertimeRequestWithDetails[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedPosition, setSelectedPosition] =
    useState<OvertimeRequestWithDetails | null>(null)
  const [badgeValue, setBadgeValue] = useState('')
  const [employee, setEmployee] = useState<EmployeeLookupResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const loadPositions = useCallback(async () => {
    setIsLoading(true)
    try {
      // Get all organizations to find available positions
      // Since this is a kiosk, we query broadly for approved open positions
      const now = new Date()
      const { data } = await supabase
        .from('overtime_requests')
        .select(
          `
          *,
          working_area:working_areas(area_name, area_code)
        `
        )
        .eq('status', 'approved')
        .gte('request_date', format(startOfDay(now), 'yyyy-MM-dd'))
        .lte('request_date', format(endOfDay(addDays(now, 13)), 'yyyy-MM-dd'))
        .order('request_date', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(50)

      if (data) {
        const rows = data as unknown as OvertimeQueryRow[]
        const open = rows.filter(
          (r) => !r.assigned_user_ids || r.assigned_user_ids.length === 0
        )
        setPositions(
          open.map((r) => ({
            ...r,
            working_area_name: r.working_area?.area_name,
          })) as OvertimeRequestWithDetails[]
        )
      }
    } catch (err) {
      logger.error('Error loading overtime positions for kiosk:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPositions()
  }, [loadPositions])

  const parsePositionFromNotes = (notes?: string) => {
    const match = notes?.match(/Position: (.+?)(?:\s*\(|$)/)
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

  const handleSelectPosition = (pos: OvertimeRequestWithDetails) => {
    setSelectedPosition(pos)
    setBadgeValue('')
    setEmployee(null)
    setError(null)
    setState('badge_scan')
  }

  const handleBadgeSubmit = useCallback(async () => {
    if (!badgeValue.trim() || !selectedPosition) return
    setIsSubmitting(true)
    setError(null)

    try {
      // Try badge number lookup first
      let emp = await lookupEmployeeByBadge(badgeValue.trim())

      // If not found by badge, try email lookup
      if (!emp) {
        const emailValue = badgeValue.trim().toLowerCase()
        const { data: profile } = await supabase
          .from('user_profiles')
          .select(
            'id, first_name, last_name, full_name, avatar_url, email, organization_id'
          )
          .eq('email', emailValue)
          .limit(1)
          .single()

        if (profile) {
          const p = profile as unknown as KioskProfileResult
          emp = {
            user_id: p.id,
            first_name: p.first_name || '',
            last_name: p.last_name || '',
            full_name:
              p.full_name ||
              `${p.first_name || ''} ${p.last_name || ''}`.trim(),
            avatar_url: p.avatar_url,
            badge_number: emailValue,
            shift_assignment_id: '',
            position_name: null,
            organization_id: p.organization_id || '',
          }
        }
      }

      if (!emp) {
        setError('Badge / email not found. Please try again.')
        setIsSubmitting(false)
        return
      }

      setEmployee(emp)
      setState('confirming')

      // Create the signup
      await createOvertimeSignup(
        emp.organization_id,
        emp.user_id,
        selectedPosition.request_date,
        selectedPosition.id
      )

      setState('success')
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to sign up. Please try again.'
      setError(msg)
      setState('badge_scan')
    } finally {
      setIsSubmitting(false)
    }
  }, [badgeValue, selectedPosition])

  const resetToPositions = () => {
    setSelectedPosition(null)
    setBadgeValue('')
    setEmployee(null)
    setError(null)
    setState('browse')
    loadPositions()
  }

  // ── Browse Available Positions ──
  if (state === 'browse') {
    return (
      <div className='flex flex-col items-center gap-6'>
        <div className='flex w-full max-w-lg items-center gap-3'>
          <button
            onClick={onBack}
            className='text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm transition'
          >
            <IconArrowLeft className='h-4 w-4' />
            Back
          </button>
          <div className='flex-1 text-center'>
            <h2 className='text-foreground text-xl font-bold tracking-tight'>
              Available Overtime
            </h2>
            <p className='text-muted-foreground text-xs'>
              Select a position to sign up
            </p>
          </div>
          <div className='w-14' />
        </div>

        {isLoading ? (
          <div className='flex flex-col items-center gap-3 py-12'>
            <IconLoader2 className='text-muted-foreground h-8 w-8 animate-spin' />
            <p className='text-muted-foreground text-sm'>
              Loading positions...
            </p>
          </div>
        ) : positions.length === 0 ? (
          <div className='flex flex-col items-center gap-3 py-12'>
            <IconClock className='text-muted-foreground h-12 w-12 opacity-50' />
            <p className='text-foreground text-lg font-medium'>
              No Overtime Available
            </p>
            <p className='text-muted-foreground text-sm'>
              Check back later for new positions.
            </p>
          </div>
        ) : (
          <div className='w-full max-w-lg space-y-3'>
            {positions.map((pos) => {
              const posTitle =
                parsePositionFromNotes(pos.notes) || 'Open Position'
              const durHours = parseDurationFromNotes(pos.notes)
              const dateObj = new Date(pos.request_date + 'T12:00:00')

              return (
                <button
                  key={pos.id}
                  onClick={() => handleSelectPosition(pos)}
                  className='border-border bg-card hover:border-primary/40 hover:bg-accent/50 w-full rounded-xl border p-4 text-left transition active:scale-[0.99]'
                >
                  <div className='flex items-start gap-3'>
                    <div className='bg-primary/10 mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg'>
                      <IconBriefcase className='text-primary h-5 w-5' />
                    </div>
                    <div className='min-w-0 flex-1'>
                      <p className='text-foreground truncate font-semibold'>
                        {posTitle}
                      </p>
                      <div className='text-muted-foreground mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs'>
                        <span className='flex items-center gap-1'>
                          <IconCalendar className='h-3 w-3' />
                          {format(dateObj, 'EEE, MMM d')}
                        </span>
                        <span className='flex items-center gap-1'>
                          <IconClock className='h-3 w-3' />
                          {formatTime12h(pos.original_shift_end)} &ndash;{' '}
                          {formatTime12h(pos.extended_shift_end)}
                        </span>
                        {pos.working_area_name && (
                          <span className='flex items-center gap-1'>
                            <IconMapPin className='h-3 w-3' />
                            {pos.working_area_name}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className='flex-shrink-0'>
                      {durHours && (
                        <span className='inline-flex items-center rounded-lg bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'>
                          {durHours}h
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── Badge Scan ──
  if (state === 'badge_scan') {
    const posTitle =
      parsePositionFromNotes(selectedPosition?.notes) || 'Open Position'
    const durHours = parseDurationFromNotes(selectedPosition?.notes)

    return (
      <div className='flex flex-col items-center gap-6'>
        {/* Selected position summary */}
        <div className='border-primary/20 bg-primary/5 w-full max-w-sm rounded-xl border p-4 text-center'>
          <p className='text-foreground font-semibold'>{posTitle}</p>
          <p className='text-muted-foreground text-xs'>
            {selectedPosition &&
              format(
                new Date(selectedPosition.request_date + 'T12:00:00'),
                'EEE, MMM d'
              )}{' '}
            &middot; {formatTime12h(selectedPosition?.original_shift_end)}{' '}
            &ndash; {formatTime12h(selectedPosition?.extended_shift_end)}
            {durHours && ` (${durHours}h)`}
          </p>
        </div>

        {/* Badge input */}
        <div className='flex flex-col items-center gap-4'>
          <div className='text-center'>
            <h2 className='text-foreground text-xl font-bold tracking-tight'>
              Scan Your Badge
            </h2>
            <p className='text-muted-foreground mt-1 text-sm'>
              Enter your badge number or email to sign up
            </p>
          </div>

          <div className='w-full max-w-sm'>
            <QWERTYKeyboard
              value={badgeValue}
              onChange={setBadgeValue}
              placeholder='Badge number or email...'
            />
          </div>

          {error && (
            <div className='text-destructive bg-destructive/10 border-destructive/20 w-full max-w-sm rounded-lg border px-4 py-2.5 text-center text-sm'>
              {error}
            </div>
          )}

          <button
            onClick={handleBadgeSubmit}
            disabled={!badgeValue.trim() || isSubmitting}
            className='bg-primary hover:bg-primary/90 text-primary-foreground flex w-full max-w-sm items-center justify-center gap-2 rounded-xl py-4 text-base font-semibold shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40'
          >
            {isSubmitting ? (
              <IconLoader2 className='h-5 w-5 animate-spin' />
            ) : (
              'Sign Up'
            )}
          </button>

          <button
            onClick={resetToPositions}
            disabled={isSubmitting}
            className='text-muted-foreground hover:text-foreground text-sm transition'
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // ── Confirming (processing) ──
  if (state === 'confirming') {
    return (
      <div className='flex flex-col items-center gap-5 py-12'>
        <div className='border-muted border-t-primary h-14 w-14 animate-spin rounded-full border-[3px]' />
        <p className='text-muted-foreground text-lg'>Signing you up...</p>
      </div>
    )
  }

  // ── Success ──
  if (state === 'success') {
    const posTitle =
      parsePositionFromNotes(selectedPosition?.notes) || 'Open Position'

    return (
      <div className='flex flex-col items-center gap-6 py-8'>
        <div className='flex h-20 w-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30'>
          <IconCheck className='h-10 w-10 text-green-600 dark:text-green-400' />
        </div>
        <div className='text-center'>
          <h2 className='text-foreground text-2xl font-bold'>Signed Up!</h2>
          <p className='text-muted-foreground mt-2 text-sm'>
            {employee?.full_name || 'You'} signed up for
          </p>
          <p className='text-foreground mt-1 font-semibold'>{posTitle}</p>
          <p className='text-muted-foreground text-xs'>
            {selectedPosition &&
              format(
                new Date(selectedPosition.request_date + 'T12:00:00'),
                'EEEE, MMMM d, yyyy'
              )}{' '}
            &middot; {formatTime12h(selectedPosition?.original_shift_end)}{' '}
            &ndash; {formatTime12h(selectedPosition?.extended_shift_end)}
          </p>
        </div>

        <button
          onClick={resetToPositions}
          className='bg-primary hover:bg-primary/90 text-primary-foreground w-full max-w-xs rounded-xl py-4 text-base font-semibold shadow-sm transition active:scale-[0.98]'
        >
          Done
        </button>
      </div>
    )
  }

  // ── Error fallback ──
  return (
    <div className='flex flex-col items-center gap-6 py-8'>
      <div className='text-center'>
        <h2 className='text-foreground text-xl font-bold'>
          Something went wrong
        </h2>
        {error && <p className='text-destructive mt-2 text-sm'>{error}</p>}
      </div>
      <button
        onClick={resetToPositions}
        className='bg-primary hover:bg-primary/90 text-primary-foreground w-full max-w-xs rounded-xl py-4 text-base font-semibold transition'
      >
        Try Again
      </button>
    </div>
  )
}

// Created and developed by Jai Singh
