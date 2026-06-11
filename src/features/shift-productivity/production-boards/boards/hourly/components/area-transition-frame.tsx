// Created and developed by Jai Singh
/**
 * Cinematic transition wrapper around the per-area body of the Hourly
 * Completion Tracker. Drives the four-layer recipe:
 *
 *   1. Outgoing — fade + scale-down + blur + lift up   (600ms)
 *   2. Chapter overlay — accent radial + stacked title (1450ms total)
 *   3. Incoming — fade + scale-down + blur + slide down (700ms)
 *   4. (omitted) Optional rotation progress bar — gated off by the spec's
 *      460 KB chunk-budget guard. Re-enabled when the per-board chunk
 *      headroom permits; the helper lives in git history.
 *
 * Behaviour matrix:
 *   - TV mode + auto-rotation active   → full cinematic transition
 *   - TV mode + manual nav (no rotate) → 250ms crossfade only
 *   - Normal mode                      → 250ms crossfade only
 *   - prefers-reduced-motion           → 250ms crossfade (MotionConfig)
 *
 * No layout shift: outgoing & incoming render at the same dimensions in
 * an `AnimatePresence mode='wait'` swap. The chapter overlay is
 * absolute-positioned over a `relative` container so it never pushes
 * content. Animations run on transform / opacity / filter only — GPU-
 * accelerated. We deliberately don't animate per-row variants in the
 * grid (50 rows × 13 cols would be 650 simultaneous animations); a
 * single body-level motion keeps the cost flat.
 */
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { accentHexFor } from '../lib/area-color'
import { AreaChapterOverlay } from './area-chapter-overlay'

interface AreaTransitionFrameProps {
  /** URL value of the active area tab (e.g. `OUTBOUND`, `all`). */
  activeAreaValue: string
  /** True when ?tv=1 is on. */
  isTv: boolean
  /** True when the per-area auto-rotation is currently looping. */
  isRotating: boolean
  /** Active area's code (`OUTBOUND`) — drives the chapter title accent. */
  areaCode: string
  /** Active area's name (`Outbound`). */
  areaName: string
  /** Roster size for the active area. */
  associateCount: number
  children: ReactNode
}

const EASE = [0.22, 1, 0.36, 1] as const

/** Outgoing/incoming variants for the cinematic (TV-rotation) path. */
const cinematicVariants = {
  initial: {
    opacity: 0,
    y: 12,
    scale: 1.015,
    filter: 'blur(6px)',
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: { duration: 0.7, ease: EASE },
  },
  exit: {
    opacity: 0,
    y: -12,
    scale: 0.985,
    filter: 'blur(6px)',
    transition: { duration: 0.6, ease: EASE },
  },
}

/** Calmer crossfade used in normal mode and for manual TV nav. */
const calmVariants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: 0.25, ease: EASE },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.25, ease: EASE },
  },
}

/** Full lifetime of the chapter overlay including its dismiss animation. */
const CHAPTER_TOTAL_MS = 1450

export function AreaTransitionFrame({
  activeAreaValue,
  isTv,
  isRotating,
  areaCode,
  areaName,
  associateCount,
  children,
}: AreaTransitionFrameProps) {
  const cinematic = isTv && isRotating

  const [chapterKey, setChapterKey] = useState<string | null>(null)
  const previousAreaRef = useRef<string>(activeAreaValue)
  const dismissTimerRef = useRef<number | null>(null)

  // Mount the chapter overlay each time the area value changes while in
  // cinematic mode. The overlay stays up for ~1.45s then dismisses.
  useEffect(() => {
    const prev = previousAreaRef.current
    previousAreaRef.current = activeAreaValue
    if (!cinematic) return
    if (prev === activeAreaValue) return

    setChapterKey(activeAreaValue)
    if (dismissTimerRef.current != null) {
      window.clearTimeout(dismissTimerRef.current)
    }
    dismissTimerRef.current = window.setTimeout(() => {
      setChapterKey(null)
    }, CHAPTER_TOTAL_MS)
    return () => {
      // Cleanup when the parent unmounts mid-transition. We don't clear
      // on every effect run because that would cancel the dismiss.
    }
  }, [activeAreaValue, cinematic])

  // Hard cleanup on unmount.
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current != null) {
        window.clearTimeout(dismissTimerRef.current)
        dismissTimerRef.current = null
      }
    }
  }, [])

  const accentHex = accentHexFor(areaCode)
  const variants = cinematic ? cinematicVariants : calmVariants

  return (
    <MotionConfig reducedMotion='user'>
      <div
        className='relative'
        data-component='area-transition-frame'
        data-cinematic={cinematic ? 'true' : 'false'}
      >
        {/* Layer 1 + 3 — outgoing fades out / incoming fades in. */}
        <AnimatePresence mode='wait' initial={false}>
          <motion.div
            key={activeAreaValue}
            variants={variants}
            initial='initial'
            animate='animate'
            exit='exit'
            // `will-change` hint helps the compositor reserve a layer
            // for the filter+transform animation (cheap on modern Chromium).
            className='will-change-[transform,opacity,filter]'
          >
            {children}
          </motion.div>
        </AnimatePresence>

        {/* Layer 2 — chapter overlay. Only rendered in cinematic mode. */}
        <AnimatePresence>
          {cinematic && chapterKey === activeAreaValue && (
            <AreaChapterOverlay
              key={`chapter-${activeAreaValue}`}
              areaCode={areaCode}
              areaName={areaName}
              accentHex={accentHex}
              associateCount={associateCount}
            />
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}

// Created and developed by Jai Singh
