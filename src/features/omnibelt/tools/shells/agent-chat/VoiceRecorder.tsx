// Created and developed by Jai Singh
/**
 * OmniBelt — Agent Chat: voice recorder (v1 visual stub)
 *
 * Renders a row of 32 pulsing bars (random heights, framer-motion
 * driven) plus a mm:ss timer while recording. v1 does NOT capture
 * audio — there's no MediaRecorder wiring yet — so the parent's
 * `onStop` receives only the elapsed duration. The visual layer
 * matches the production design so v1.5 can drop in real audio
 * capture without changing the props contract.
 *
 * v1.5 follow-ups (documented in the Implement-OmniBelt-MVP log):
 *   1. Replace the `setInterval` timer with `MediaRecorder` +
 *      analyser-node FFT data to drive `bars` for real.
 *   2. Persist the recorded blob and pass it to `onStop` so the
 *      composer can include it as a chat attachment.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

export type VoiceRecorderProps = {
  /** Drives whether the recorder is actively capturing. The parent
   *  owns this so the send-button morph state stays consistent. */
  isRecording: boolean
  /** Fired every second tick while recording so the parent can
   *  surface the timer outside the recorder if desired. */
  onTick?: (elapsedMs: number) => void
  /** Optional className passthrough so the parent can size / theme
   *  the wrapper. */
  className?: string
}

const BAR_COUNT = 32
const TICK_MS = 80

function formatDuration(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Pre-seeded per-bar offsets so the pulse phases don't all line up.
 * Computed once at module load — every recorder instance reuses the
 * same wave shape, which is what we want visually.
 */
const BAR_OFFSETS: readonly number[] = Array.from(
  { length: BAR_COUNT },
  (_, i) => (i / BAR_COUNT) * Math.PI * 2
)

export function VoiceRecorder({
  isRecording,
  onTick,
  className,
}: VoiceRecorderProps) {
  const [elapsedMs, setElapsedMs] = useState(0)
  const startedAtRef = useRef<number | null>(null)
  // Hold the latest onTick in a ref so the interval effect doesn't
  // tear down + rebuild every time the parent re-renders with a new
  // callback identity.
  const onTickRef = useRef(onTick)
  useEffect(() => {
    onTickRef.current = onTick
  }, [onTick])

  useEffect(() => {
    if (!isRecording) {
      startedAtRef.current = null
      setElapsedMs(0)
      return
    }
    startedAtRef.current = Date.now()
    const id = window.setInterval(() => {
      if (startedAtRef.current === null) return
      const next = Date.now() - startedAtRef.current
      setElapsedMs(next)
      onTickRef.current?.(next)
    }, TICK_MS)
    return () => {
      window.clearInterval(id)
    }
  }, [isRecording])

  // Per-bar pulse heights — recomputed every render so the animation
  // keeps moving without a separate RAF loop. Using `elapsedMs / 200`
  // gives ~5 Hz visual pulse which reads as "active mic" without
  // distracting motion.
  const barScales = useMemo(() => {
    const phase = elapsedMs / 200
    return BAR_OFFSETS.map((offset) => {
      // Three superimposed sinusoids = a "natural" waveform shape.
      const v =
        0.4 +
        0.3 * Math.abs(Math.sin(phase + offset)) +
        0.2 * Math.abs(Math.sin(phase * 1.7 + offset * 0.5)) +
        0.1 * Math.abs(Math.sin(phase * 0.6 + offset * 2.1))
      return Math.min(1, v)
    })
  }, [elapsedMs])

  if (!isRecording) return null

  return (
    <div
      data-testid='omnibelt-voice-recorder'
      role='status'
      aria-live='polite'
      aria-label={`Recording, ${formatDuration(elapsedMs)} elapsed`}
      className={cn(
        'flex h-10 w-full items-center gap-3 px-3 text-xs text-white',
        className
      )}
    >
      <span
        aria-hidden='true'
        className='size-2 shrink-0 animate-pulse rounded-full bg-[#F97316]'
      />
      <div className='flex h-full flex-1 items-center justify-between gap-[2px]'>
        {barScales.map((scale, i) => (
          <motion.span
            key={i}
            aria-hidden='true'
            className='inline-block w-[2px] rounded-full bg-white/70'
            style={{ height: `${Math.round(scale * 28)}px` }}
            animate={{ opacity: 0.5 + scale * 0.5 }}
            transition={{ duration: TICK_MS / 1000, ease: 'linear' }}
          />
        ))}
      </div>
      <span className='font-mono text-white/80 tabular-nums'>
        {formatDuration(elapsedMs)}
      </span>
    </div>
  )
}

// Created and developed by Jai Singh
