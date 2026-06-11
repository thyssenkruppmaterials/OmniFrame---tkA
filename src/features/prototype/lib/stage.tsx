// Created and developed by Jai Singh
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { clamp, fmtTime } from '@/features/prototype/lib/anim'

/**
 * <Stage> — framerate-independent playhead host.
 *
 * Every child can read `useStageTime()` to get the current second-based
 * playhead. Handles auto-fit scaling to the viewport, keyboard controls
 * (space = play/pause, ←/→ scrub, 0 = home) and renders an optional
 * playback bar beneath the canvas.
 */

type StageCtx = {
  time: number
  duration: number
  playing: boolean
  setPlaying: (v: boolean | ((p: boolean) => boolean)) => void
  setTime: (v: number | ((p: number) => number)) => void
}

const StageContext = createContext<StageCtx>({
  time: 0,
  duration: 30,
  playing: false,
  setPlaying: () => {},
  setTime: () => {},
})

export const useStageTime = () => useContext(StageContext).time
export const useStage = () => useContext(StageContext)

type StageProps = {
  width?: number
  height?: number
  duration?: number
  background?: string
  autoplay?: boolean
  loop?: boolean
  persistKey?: string
  showPlaybackBar?: boolean
  children: ReactNode
}

export function Stage({
  width = 1920,
  height = 1080,
  duration = 30,
  background = '#0a0a0b',
  autoplay = true,
  loop = true,
  persistKey = 'prototype',
  showPlaybackBar = true,
  children,
}: StageProps) {
  const [time, setTime] = useState<number>(() => {
    try {
      const v = parseFloat(localStorage.getItem(persistKey + ':t') ?? '0')
      return Number.isFinite(v) ? clamp(v, 0, duration) : 0
    } catch {
      return 0
    }
  })
  const [playing, setPlaying] = useState(autoplay)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [scale, setScale] = useState(1)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number | null>(null)

  // Persist playhead across reloads — handy for demo iteration.
  useEffect(() => {
    try {
      localStorage.setItem(persistKey + ':t', String(time))
    } catch {
      /* ignore quota errors */
    }
  }, [time, persistKey])

  // Auto-scale the 1920×1080 canvas into whatever viewport we're in.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => {
      const barH = showPlaybackBar ? 60 : 0
      const s = Math.min(
        el.clientWidth / width,
        (el.clientHeight - barH) / height
      )
      setScale(Math.max(0.05, s))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [width, height, showPlaybackBar])

  // RAF loop — advance playhead.
  useEffect(() => {
    if (!playing) {
      lastTsRef.current = null
      return
    }
    const step = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts
      const dt = (ts - lastTsRef.current) / 1000
      lastTsRef.current = ts
      setTime((t) => {
        let next = t + dt
        if (next >= duration) {
          if (loop) next = next % duration
          else {
            next = duration
            setPlaying(false)
          }
        }
        return next
      })
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      lastTsRef.current = null
    }
  }, [playing, duration, loop])

  // Keyboard shortcuts: space/←/→/0.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return
      if (e.code === 'Space') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.code === 'ArrowLeft') {
        setTime((t) => clamp(t - (e.shiftKey ? 1 : 0.1), 0, duration))
      } else if (e.code === 'ArrowRight') {
        setTime((t) => clamp(t + (e.shiftKey ? 1 : 0.1), 0, duration))
      } else if (e.key === '0' || e.code === 'Home') {
        setTime(0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [duration])

  const displayTime = hoverTime ?? time

  const ctxValue = useMemo<StageCtx>(
    () => ({
      time: displayTime,
      duration,
      playing,
      setPlaying,
      setTime,
    }),
    [displayTime, duration, playing]
  )

  return (
    <div
      ref={stageRef}
      className='relative flex h-full w-full flex-col items-center overflow-hidden bg-black'
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      <div className='flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden'>
        <div
          className='relative flex-shrink-0'
          style={{
            width,
            height,
            background,
            transform: `scale(${scale})`,
            transformOrigin: 'center',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            overflow: 'hidden',
          }}
        >
          <StageContext.Provider value={ctxValue}>
            {children}
          </StageContext.Provider>
        </div>
      </div>

      {showPlaybackBar && (
        <PlaybackBar
          time={displayTime}
          duration={duration}
          playing={playing}
          onPlayPause={() => setPlaying((p) => !p)}
          onReset={() => setTime(0)}
          onSeek={(t) => setTime(t)}
          onHover={(t) => setHoverTime(t)}
        />
      )}
    </div>
  )
}

type PlaybackBarProps = {
  time: number
  duration: number
  playing: boolean
  onPlayPause: () => void
  onReset: () => void
  onSeek: (t: number) => void
  onHover: (t: number | null) => void
}

function PlaybackBar({
  time,
  duration,
  playing,
  onPlayPause,
  onReset,
  onSeek,
  onHover,
}: PlaybackBarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)

  const timeFromEvent = useCallback(
    (e: { clientX: number }) => {
      const el = trackRef.current
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      const x = clamp((e.clientX - rect.left) / rect.width, 0, 1)
      return x * duration
    },
    [duration]
  )

  useEffect(() => {
    if (!dragging) return
    const onUp = () => setDragging(false)
    const onMove = (e: MouseEvent) => onSeek(timeFromEvent(e))
    window.addEventListener('mouseup', onUp)
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('mousemove', onMove)
    }
  }, [dragging, onSeek, timeFromEvent])

  const pct = duration > 0 ? (time / duration) * 100 : 0
  const mono =
    '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace'

  return (
    <div
      className='flex w-full max-w-[820px] flex-shrink-0 items-center gap-3 self-center rounded-lg px-4 py-2'
      style={{
        background: 'rgba(20,20,20,0.92)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        color: '#f6f4ef',
        userSelect: 'none',
      }}
    >
      <IconButton onClick={onReset} title='Return to start (0)'>
        <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
          <path
            d='M3 2v10M12 2L5 7l7 5V2z'
            stroke='currentColor'
            strokeWidth='1.5'
            strokeLinejoin='round'
            strokeLinecap='round'
          />
        </svg>
      </IconButton>
      <IconButton onClick={onPlayPause} title='Play/pause (space)'>
        {playing ? (
          <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
            <rect x='3' y='2' width='3' height='10' fill='currentColor' />
            <rect x='8' y='2' width='3' height='10' fill='currentColor' />
          </svg>
        ) : (
          <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
            <path d='M3 2l9 5-9 5V2z' fill='currentColor' />
          </svg>
        )}
      </IconButton>

      <div
        style={{
          fontFamily: mono,
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
          width: 64,
          textAlign: 'right',
          color: '#f6f4ef',
        }}
      >
        {fmtTime(time)}
      </div>

      <div
        ref={trackRef}
        onMouseMove={(e) => {
          if (dragging) onSeek(timeFromEvent(e))
          else onHover(timeFromEvent(e))
        }}
        onMouseLeave={() => {
          if (!dragging) onHover(null)
        }}
        onMouseDown={(e) => {
          setDragging(true)
          onSeek(timeFromEvent(e))
          onHover(null)
        }}
        className='relative flex h-[22px] flex-1 cursor-pointer items-center'
      >
        <div
          className='absolute inset-x-0'
          style={{
            height: 4,
            background: 'rgba(255,255,255,0.12)',
            borderRadius: 2,
          }}
        />
        <div
          className='absolute left-0'
          style={{
            width: `${pct}%`,
            height: 4,
            background: 'oklch(72% 0.12 250)',
            borderRadius: 2,
          }}
        />
        <div
          className='absolute top-1/2'
          style={{
            left: `${pct}%`,
            width: 12,
            height: 12,
            marginLeft: -6,
            marginTop: -6,
            background: '#fff',
            borderRadius: 6,
            boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
          }}
        />
      </div>

      <div
        style={{
          fontFamily: mono,
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
          width: 64,
          textAlign: 'left',
          color: 'rgba(246,244,239,0.55)',
        }}
      >
        {fmtTime(duration)}
      </div>
    </div>
  )
}

function IconButton({
  children,
  onClick,
  title,
}: {
  children: ReactNode
  onClick: () => void
  title: string
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type='button'
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className='flex h-7 w-7 items-center justify-center rounded-md border p-0 transition-colors'
      style={{
        background: hover ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
        borderColor: 'rgba(255,255,255,0.1)',
        color: '#f6f4ef',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

// Created and developed by Jai Singh
