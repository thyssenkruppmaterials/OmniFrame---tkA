import { useState, useCallback, useEffect } from 'react'
import { format } from 'date-fns'
import {
  IconClockPlus,
  IconAdjustmentsHorizontal,
  IconLogin,
  IconLogout,
  IconFingerprint,
} from '@tabler/icons-react'
import { motion } from 'framer-motion'
import { ThemeSwitch } from '@/components/theme-switch'
import BadgeInput from './components/badge-input'
import CameraCapture from './components/camera-capture'
import ClockConfirmation from './components/clock-confirmation'
import KioskOvertimeSignup from './components/kiosk-overtime-signup'
import KioskSplashScreen from './components/kiosk-splash-screen'
import KioskTimeAdjustment from './components/kiosk-time-adjustment'
import {
  lookupEmployeeByBadge,
  getActiveClockEntry,
  getRecentEntries,
  uploadClockPhoto,
  clockIn,
  clockOut,
  type EmployeeLookupResult,
  type ClockEntry,
  type ClockResult,
} from './services/time-clock.service'

type KioskState =
  | 'badge_entry'
  | 'employee_confirm'
  | 'camera_capture'
  | 'processing'
  | 'confirmation'
  | 'overtime_signup'
  | 'time_adjustment'

export default function TimeClockKiosk() {
  const [splashDone, setSplashDone] = useState(false)
  const [state, setState] = useState<KioskState>('badge_entry')
  const [currentTime, setCurrentTime] = useState(new Date())
  const [employee, setEmployee] = useState<EmployeeLookupResult | null>(null)
  const [activeEntry, setActiveEntry] = useState<ClockEntry | null>(null)
  const [recentEntries, setRecentEntries] = useState<ClockEntry[]>([])
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)
  const [clockResult, setClockResult] = useState<ClockResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Real-time clock
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const resetToHome = useCallback(() => {
    setState('badge_entry')
    setEmployee(null)
    setActiveEntry(null)
    setRecentEntries([])
    setPhotoBlob(null)
    setClockResult(null)
    setError(null)
    setIsLoading(false)
  }, [])

  const handleBadgeSubmit = useCallback(async (badgeNumber: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const emp = await lookupEmployeeByBadge(badgeNumber)
      if (!emp) {
        setError('Badge number not found. Please try again.')
        setIsLoading(false)
        return
      }

      setEmployee(emp)
      const active = await getActiveClockEntry(emp.user_id)
      setActiveEntry(active)
      const recent = await getRecentEntries(emp.user_id)
      setRecentEntries(recent)

      setState('employee_confirm')
      setIsLoading(false)
    } catch {
      setError('An error occurred. Please try again.')
      setIsLoading(false)
    }
  }, [])

  const handleClockAction = useCallback(() => {
    setState('camera_capture')
  }, [])

  const handlePhotoCapture = useCallback((blob: Blob) => {
    setPhotoBlob(blob)
  }, [])

  const handleSubmitClock = useCallback(async () => {
    if (!employee) return
    setState('processing')

    try {
      let photoPath: string | null = null
      if (photoBlob) {
        const type = activeEntry ? 'clock_out' : 'clock_in'
        photoPath = await uploadClockPhoto(photoBlob, employee.user_id, type)
      }

      let result: ClockResult
      if (activeEntry) {
        result = await clockOut(activeEntry.id, photoPath)
      } else {
        result = await clockIn(employee, photoPath)
      }

      if (result.success) {
        setClockResult(result)
        setState('confirmation')
      } else {
        setError(result.error || 'Failed to record time. Please try again.')
        setState('employee_confirm')
      }
    } catch {
      setError('An error occurred while recording time.')
      setState('employee_confirm')
    }
  }, [employee, activeEntry, photoBlob])

  return (
    <div className='bg-background flex h-dvh flex-col overflow-hidden pt-[env(safe-area-inset-top)]'>
      {/* Splash Screen */}
      {!splashDone && (
        <KioskSplashScreen onComplete={() => setSplashDone(true)} />
      )}

      {/* Main kiosk UI — revealed after splash */}
      <motion.div
        className='flex min-h-0 flex-1 flex-col'
        initial={{ opacity: 0 }}
        animate={splashDone ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      >
        {/* Header */}
        <header className='border-border bg-card flex shrink-0 items-center justify-between border-b px-6 py-3'>
          <div className='flex items-center gap-4'>
            <img
              src='/images/favicon.svg'
              alt='OmniFrame Logo'
              className='h-9 w-9 shrink-0 object-contain'
              style={{ animation: 'spin 8s linear infinite' }}
            />
            <div>
              <h1 className='text-foreground text-base font-bold tracking-tight'>
                OmniFrame
              </h1>
              <p className='text-muted-foreground text-[11px]'>
                Employee Time Clock
              </p>
            </div>
          </div>

          {/* Overtime Signup */}
          <button
            onClick={() => {
              if (state === 'overtime_signup') resetToHome()
              else setState('overtime_signup')
            }}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition active:scale-[0.97] ${
              state === 'overtime_signup'
                ? 'bg-orange-600 text-white hover:bg-orange-700'
                : 'border-border bg-card hover:bg-accent text-foreground border'
            }`}
          >
            <IconClockPlus
              className={`h-4.5 w-4.5 ${state === 'overtime_signup' ? 'text-white' : 'text-orange-500'}`}
            />
            Overtime Sign Up
          </button>

          {/* Time Adjustment */}
          <button
            onClick={() => {
              if (state === 'time_adjustment') resetToHome()
              else setState('time_adjustment')
            }}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition active:scale-[0.97] ${
              state === 'time_adjustment'
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'border-border bg-card hover:bg-accent text-foreground border'
            }`}
          >
            <IconAdjustmentsHorizontal
              className={`h-4.5 w-4.5 ${state === 'time_adjustment' ? 'text-white' : 'text-blue-500'}`}
            />
            Time Adjustment
          </button>

          {/* Live Clock */}
          <div className='text-right'>
            <p className='text-foreground font-mono text-2xl font-bold tracking-tight'>
              {format(currentTime, 'h:mm:ss a')}
            </p>
            <p className='text-muted-foreground text-[11px]'>
              {format(currentTime, 'EEEE, MMMM d, yyyy')}
            </p>
          </div>
        </header>

        {/* Main Content */}
        <main className='min-h-0 flex-1 overflow-y-auto p-6'>
          <div className='mx-auto w-full max-w-md py-4'>
            {/* ── Badge Entry ──────────────────────── */}
            {state === 'badge_entry' && (
              <div className='flex flex-col items-center gap-6'>
                {/* Hero */}
                <div className='flex flex-col items-center gap-3'>
                  <div className='bg-primary/10 flex h-14 w-14 items-center justify-center rounded-2xl'>
                    <IconFingerprint className='text-primary h-7 w-7' />
                  </div>
                  <div className='text-center'>
                    <h2 className='text-foreground text-xl font-bold tracking-tight'>
                      Welcome
                    </h2>
                    <p className='text-muted-foreground mt-0.5 text-sm'>
                      Enter your badge number to clock in or out.
                    </p>
                  </div>
                </div>

                <BadgeInput
                  onSubmit={handleBadgeSubmit}
                  isLoading={isLoading}
                  error={error}
                />
              </div>
            )}

            {/* ── Employee Confirm ──────────────────── */}
            {state === 'employee_confirm' && employee && (
              <div className='flex flex-col items-center gap-4'>
                {/* Avatar + Name */}
                <div className='flex flex-col items-center gap-2'>
                  <div className='bg-primary/10 border-primary/30 flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2'>
                    {employee.avatar_url ? (
                      <img
                        src={employee.avatar_url}
                        alt={employee.full_name}
                        className='h-full w-full object-cover'
                      />
                    ) : (
                      <span className='text-primary text-xl font-bold'>
                        {employee.first_name[0]}
                        {employee.last_name[0]}
                      </span>
                    )}
                  </div>
                  <div className='text-center'>
                    <h2 className='text-foreground text-xl font-bold tracking-tight'>
                      {employee.full_name}
                    </h2>
                    {employee.position_name && (
                      <p className='text-muted-foreground text-sm'>
                        {employee.position_name}
                      </p>
                    )}
                    <p className='text-muted-foreground/60 mt-1 font-mono text-xs'>
                      Badge: {employee.badge_number}
                    </p>
                  </div>
                </div>

                {/* Status Card */}
                <div
                  className={`w-full max-w-xs rounded-xl border px-5 py-3.5 text-center ${
                    activeEntry
                      ? 'border-green-500/20 bg-green-500/5 dark:bg-green-500/10'
                      : 'bg-muted/50 border-border'
                  }`}
                >
                  {activeEntry ? (
                    <div>
                      <p className='text-sm font-semibold text-green-600 dark:text-green-400'>
                        Currently Clocked In
                      </p>
                      <p className='text-muted-foreground mt-1 text-xs'>
                        Since {format(new Date(activeEntry.clock_in), 'h:mm a')}
                      </p>
                    </div>
                  ) : (
                    <p className='text-muted-foreground text-sm'>
                      Not currently clocked in
                    </p>
                  )}
                </div>

                {/* Error */}
                {error && (
                  <div className='text-destructive bg-destructive/10 border-destructive/20 w-full max-w-xs rounded-lg border px-4 py-2.5 text-center text-sm'>
                    {error}
                  </div>
                )}

                {/* Clock Action */}
                <button
                  onClick={handleClockAction}
                  className={`flex w-full max-w-xs items-center justify-center gap-3 rounded-xl py-4 text-lg font-bold shadow-sm transition-all active:scale-[0.98] ${
                    activeEntry
                      ? 'bg-orange-600 text-white hover:bg-orange-700'
                      : 'bg-green-600 text-white hover:bg-green-700'
                  }`}
                >
                  {activeEntry ? (
                    <>
                      <IconLogout className='h-5 w-5' />
                      Clock Out
                    </>
                  ) : (
                    <>
                      <IconLogin className='h-5 w-5' />
                      Clock In
                    </>
                  )}
                </button>

                {/* Recent Entries */}
                {recentEntries.length > 0 && (
                  <div className='mt-1 w-full max-w-xs'>
                    <p className='text-muted-foreground mb-2 text-[11px] font-medium tracking-wider uppercase'>
                      Recent Punches
                    </p>
                    <div className='border-border divide-border divide-y overflow-hidden rounded-xl border'>
                      {recentEntries.map((entry) => (
                        <div
                          key={entry.id}
                          className='bg-card flex items-center justify-between px-4 py-2.5 text-xs'
                        >
                          <span className='text-muted-foreground'>
                            {format(new Date(entry.clock_in), 'MMM d')}
                          </span>
                          <span className='text-foreground font-mono'>
                            {format(new Date(entry.clock_in), 'h:mm a')}
                          </span>
                          <span className='text-foreground font-mono'>
                            {entry.clock_out
                              ? format(new Date(entry.clock_out), 'h:mm a')
                              : '---'}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${
                              entry.status === 'active'
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : entry.status === 'completed'
                                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                  : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                            }`}
                          >
                            {entry.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Back */}
                <button
                  onClick={resetToHome}
                  className='text-muted-foreground hover:text-foreground mt-1 text-sm transition'
                >
                  Cancel
                </button>
              </div>
            )}

            {/* ── Camera Capture ──────────────────── */}
            {state === 'camera_capture' && employee && (
              <div className='flex flex-col items-center gap-6'>
                <div className='text-center'>
                  <h2 className='text-foreground mb-1 text-xl font-bold tracking-tight'>
                    {activeEntry ? 'Clock Out Photo' : 'Clock In Photo'}
                  </h2>
                  <p className='text-muted-foreground text-sm'>
                    Please look at the camera and capture your photo.
                  </p>
                </div>

                <CameraCapture onCapture={handlePhotoCapture} isActive={true} />

                <div className='flex w-full max-w-xs gap-3'>
                  <button
                    onClick={() => setState('employee_confirm')}
                    className='bg-secondary hover:bg-secondary/80 text-secondary-foreground border-border flex-1 rounded-xl border py-3 text-sm font-medium transition'
                  >
                    Back
                  </button>
                  <button
                    onClick={handleSubmitClock}
                    disabled={!photoBlob}
                    className={`flex-1 rounded-xl py-3 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
                      activeEntry
                        ? 'bg-orange-600 text-white hover:bg-orange-700'
                        : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                  >
                    {activeEntry ? 'Confirm Clock Out' : 'Confirm Clock In'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Overtime Signup ──────────────── */}
            {state === 'overtime_signup' && (
              <KioskOvertimeSignup onBack={resetToHome} />
            )}

            {/* ── Time Adjustment ──────────────── */}
            {state === 'time_adjustment' && (
              <KioskTimeAdjustment onBack={resetToHome} />
            )}

            {/* ── Processing ──────────────────── */}
            {state === 'processing' && (
              <div className='flex flex-col items-center gap-5'>
                <div className='border-muted border-t-primary h-14 w-14 animate-spin rounded-full border-[3px]' />
                <p className='text-muted-foreground text-lg'>
                  Recording your time...
                </p>
              </div>
            )}

            {/* ── Confirmation ──────────────────── */}
            {state === 'confirmation' && clockResult && employee && (
              <ClockConfirmation
                result={clockResult}
                employee={employee}
                onDone={resetToHome}
              />
            )}
          </div>
        </main>

        {/* Footer */}
        <footer className='border-border bg-card flex shrink-0 items-center justify-between border-t px-6 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]'>
          <ThemeSwitch />
          <p className='text-muted-foreground/50 text-xs'>
            OmniFrame Time Clock System
          </p>
          <div className='w-9' />
        </footer>
      </motion.div>
    </div>
  )
}
