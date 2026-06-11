// Created and developed by Jai Singh
/**
 * useScanFeedback (Phase 5.5).
 *
 * Returns three callbacks: `success()`, `error()`, `scan()`. Combines short
 * generated WAV blips with `navigator.vibrate`. All wrapped to no-op when
 * the user has not interacted yet (browsers gate audio behind a user
 * gesture) or has `prefers-reduced-motion` (we still beep but skip the
 * vibrate burst).
 */
import { useCallback, useEffect, useRef } from 'react'

type Tone = 'success' | 'error' | 'scan'

const TONE_FREQ_HZ: Record<Tone, number> = {
  success: 880,
  error: 220,
  scan: 660,
}

const TONE_DURATION_MS: Record<Tone, number> = {
  success: 110,
  error: 220,
  scan: 60,
}

const VIBRATE_PATTERN: Record<Tone, number | number[]> = {
  success: 30,
  error: [60, 40, 60],
  scan: 20,
}

export function useScanFeedback() {
  const ctxRef = useRef<AudioContext | null>(null)
  const reducedMotionRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotionRef.current = mq.matches
    const onChange = () => {
      reducedMotionRef.current = mq.matches
    }
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])

  const play = useCallback((tone: Tone) => {
    try {
      if (typeof window === 'undefined') return
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!Ctor) return
      if (!ctxRef.current) ctxRef.current = new Ctor()
      const ctx = ctxRef.current
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = TONE_FREQ_HZ[tone]
      gain.gain.value = 0.06
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + TONE_DURATION_MS[tone] / 1000)
    } catch {
      /* audio unavailable — silent feedback only */
    }
    if (
      !reducedMotionRef.current &&
      typeof navigator !== 'undefined' &&
      navigator.vibrate
    ) {
      try {
        navigator.vibrate(VIBRATE_PATTERN[tone])
      } catch {
        /* ignore */
      }
    }
  }, [])

  return {
    success: useCallback(() => play('success'), [play]),
    error: useCallback(() => play('error'), [play]),
    scan: useCallback(() => play('scan'), [play]),
  }
}

// Created and developed by Jai Singh
