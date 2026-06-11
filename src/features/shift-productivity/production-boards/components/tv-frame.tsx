// Created and developed by Jai Singh
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { IconRotate, IconX } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useScreenWakeLock } from '../hooks/use-screen-wake-lock'
import { TvClock } from './tv-clock'

interface TvFrameProps {
  title: string
  subtitle?: string
  /**
   * Prominent area badge rendered next to the title. Used to identify
   * which working-area slice is on screen during auto-rotation.
   */
  areaName?: string
  /** Optional eyebrow above the area name (e.g. area_code). */
  areaCode?: string
  /** Visible chips on the centre of the header — usually active filters. */
  centerChips?: string[]
  /**
   * Optional KPI strip rendered above the children body — typically the
   * scaled-up `<BoardMetrics density='tv' />` for the active tab.
   */
  kpiStrip?: ReactNode
  /** Tiny indicator + label rendered in the footer when rotation is active. */
  rotationActive?: boolean
  rotationLabel?: string
  /**
   * Optional footer-centre slot (e.g. the hourly board's <BoardLegend>).
   * Each board owns its own legend since each one has different state
   * vocabularies; the TvFrame is generic chrome.
   */
  footerLegend?: ReactNode
  timezone: string
  lastUpdatedAt: Date | null
  onExit: () => void
  children: ReactNode
}

const CURSOR_IDLE_MS = 3_000

function formatLastUpdated(at: Date | null, timezone: string): string {
  if (!at) return '—'
  return at.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: timezone,
  })
}

export function TvFrame({
  title,
  subtitle,
  areaName,
  areaCode,
  centerChips = [],
  kpiStrip,
  rotationActive = false,
  rotationLabel,
  footerLegend,
  timezone,
  lastUpdatedAt,
  onExit,
  children,
}: TvFrameProps) {
  useScreenWakeLock(true)

  const [cursorHidden, setCursorHidden] = useState(false)
  const idleTimerRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Best-effort fullscreen on mount.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const req = (
      el as HTMLElement & {
        requestFullscreen?: () => Promise<void>
        webkitRequestFullscreen?: () => void
      }
    ).requestFullscreen
    if (req) {
      Promise.resolve(req.call(el)).catch(() => {
        // Browser blocked it (no user gesture, etc) — fine, we'll still
        // overlay z-50.
      })
    }
    return () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {})
      }
    }
  }, [])

  // Lock body scroll while overlay is mounted.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // ESC to exit.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onExit()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onExit])

  // Idle cursor hide.
  const armIdleTimer = useCallback((): void => {
    if (idleTimerRef.current != null) {
      window.clearTimeout(idleTimerRef.current)
    }
    setCursorHidden(false)
    idleTimerRef.current = window.setTimeout(() => {
      setCursorHidden(true)
    }, CURSOR_IDLE_MS)
  }, [])

  useEffect(() => {
    armIdleTimer()
    const onMove = (): void => armIdleTimer()
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      if (idleTimerRef.current != null) {
        window.clearTimeout(idleTimerRef.current)
      }
    }
  }, [armIdleTimer])

  return (
    <div
      ref={containerRef}
      className={cn(
        'bg-background fixed inset-0 z-50 flex flex-col',
        cursorHidden && 'cursor-none'
      )}
      style={cursorHidden ? { cursor: 'none' } : undefined}
      data-component='production-boards-tv-frame'
    >
      <header className='border-border/50 flex h-20 items-center justify-between border-b px-10'>
        <div className='flex items-center gap-6'>
          <div className='flex flex-col leading-tight'>
            <h1 className='text-3xl font-semibold tracking-tight'>{title}</h1>
            {subtitle && (
              <p className='text-muted-foreground text-sm'>{subtitle}</p>
            )}
          </div>
          {areaName && (
            <div className='border-border/50 bg-card/50 hidden items-center gap-3 rounded-xl border px-4 py-2 backdrop-blur-sm md:flex'>
              {areaCode && (
                <span className='text-muted-foreground/70 font-mono text-xs tracking-widest uppercase tabular-nums'>
                  {areaCode}
                </span>
              )}
              <span className='text-foreground text-2xl font-semibold tracking-tight'>
                {areaName}
              </span>
            </div>
          )}
        </div>
        <div className='hidden flex-1 flex-wrap items-center justify-center gap-2 px-6 lg:flex'>
          {!areaName && centerChips.length === 0 ? (
            <span className='text-muted-foreground text-sm'>All areas</span>
          ) : (
            centerChips.map((chip) => (
              <span
                key={chip}
                className='border-border/50 bg-card/50 text-foreground rounded-full border px-3 py-1 text-sm font-medium backdrop-blur-sm'
              >
                {chip}
              </span>
            ))
          )}
        </div>
        <TvClock timezone={timezone} />
      </header>

      <main className='flex-1 overflow-auto p-10'>
        {kpiStrip && <div className='mb-8'>{kpiStrip}</div>}
        {children}
      </main>

      <footer className='border-border/50 text-muted-foreground flex h-12 items-center justify-between border-t px-10 text-xs'>
        <div className='flex items-center gap-2'>
          <span className='inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500' />
          <span className='font-mono'>
            Last updated · {formatLastUpdated(lastUpdatedAt, timezone)}
          </span>
          {rotationActive && (
            <span className='text-muted-foreground/80 ml-3 inline-flex items-center gap-1.5 font-mono'>
              <IconRotate className='h-3 w-3 animate-pulse' aria-hidden />
              {rotationLabel ?? 'Rotating areas every 30s'}
            </span>
          )}
        </div>
        {footerLegend && <div className='hidden lg:flex'>{footerLegend}</div>}
        <div className='flex items-center gap-3'>
          <span>Press ESC to exit · Auto-refresh 60s</span>
          <Button
            variant='ghost'
            size='sm'
            onClick={onExit}
            className='text-muted-foreground hover:text-foreground'
          >
            <IconX className='mr-1 h-4 w-4' /> Exit
          </Button>
        </div>
      </footer>
    </div>
  )
}

// Created and developed by Jai Singh
