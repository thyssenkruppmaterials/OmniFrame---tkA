// Created and developed by Jai Singh
/**
 * Cinematic "chapter title" overlay shown for ~1.45s when the per-area
 * auto-rotation in TV mode swaps from one area to the next.
 *
 * Layer 2 of the four-layer transition recipe (see v8 implementation
 * notes in the vault — `Implement-Production-Boards-Hourly-Grid` and the
 * pattern at `Patterns/Cinematic-Tab-Rotation`):
 *
 *   1. Outgoing content fades / scales / blurs out
 *   2. THIS overlay mounts, holds, then dismisses (fade + slow zoom)
 *   3. Incoming content fades / scales / blurs in
 *   4. Optional progress bar drains + refills at the bottom
 *
 * The visual is a soft accent-coloured radial gradient backdrop with a
 * stacked headline (eyebrow + area_code + area_name + sub-line). Each
 * line cascades in 80–160ms behind the previous so the title block
 * builds rather than slamming on screen.
 *
 * All animation is `motion-safe`: the parent `<MotionConfig
 * reducedMotion='user'>` short-circuits the inner timeline to a plain
 * fade for users with `prefers-reduced-motion: reduce`.
 */
import type { CSSProperties } from 'react'
import { motion } from 'framer-motion'

interface AreaChapterOverlayProps {
  /**
   * Area code displayed as the large monospace badge at centre. Pass
   * the shorthand (e.g. `OUTBOUND`) — uppercased by the styling.
   */
  areaCode: string
  /** Human-readable area name shown below the code. */
  areaName: string
  /** Hex string from `accentHexFor(areaCode)`. */
  accentHex: string
  /** Roster size for the new area, displayed in the sub-line. */
  associateCount: number
}

const EASE = [0.22, 1, 0.36, 1] as const

const containerVariants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: {
      duration: 0.25,
      ease: EASE,
      when: 'beforeChildren',
      staggerChildren: 0.08,
    },
  },
  exit: {
    opacity: 0,
    scale: 1.04,
    transition: { duration: 0.5, ease: EASE },
  },
}

const eyebrowVariants = {
  initial: { opacity: 0, y: 6 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: EASE },
  },
}

const codeVariants = {
  initial: { opacity: 0, scale: 0.92, y: 10 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: 0.55,
      ease: EASE,
      // Subtle spring overshoot via type='spring' would be nicer, but
      // springs can ignore stagger timing — we keep the cubic-bezier
      // pipeline cohesive across all four layers so the timing reads
      // as one orchestrated event.
    },
  },
}

const nameVariants = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: EASE, delay: 0.08 },
  },
}

const subVariants = {
  initial: { opacity: 0, y: 6 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: EASE, delay: 0.16 },
  },
}

export function AreaChapterOverlay({
  areaCode,
  areaName,
  accentHex,
  associateCount,
}: AreaChapterOverlayProps) {
  const glowLightVar = hexToRgba(accentHex, 0.18)
  const glowDarkVar = hexToRgba(accentHex, 0.25)

  // Two CSS vars — the radial gradient backdrop swaps between them via
  // a `dark:` utility on the wrapper so light/dark mode get distinct
  // glow strengths without re-running the animation.
  const overlayStyle: CSSProperties = {
    // The default (light) glow lives on `--accent-glow` directly; dark
    // mode reads `--accent-glow-dark` via `dark:[--accent-glow:var(...)]`.
    ['--accent-glow' as keyof CSSProperties as string]: glowLightVar,
    ['--accent-glow-dark' as keyof CSSProperties as string]: glowDarkVar,
    ['--accent-color' as keyof CSSProperties as string]: accentHex,
  }

  return (
    <motion.div
      variants={containerVariants}
      initial='initial'
      animate='animate'
      exit='exit'
      role='presentation'
      aria-hidden
      data-component='area-chapter-overlay'
      className='pointer-events-none absolute inset-0 flex items-center justify-center dark:[--accent-glow:var(--accent-glow-dark)]'
      style={overlayStyle}
    >
      {/* Backdrop — soft accent-coloured radial gradient. Rendered as a
          dedicated absolute span so the centred content lives above it
          without colour bleed. */}
      <span
        aria-hidden
        className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,var(--accent-glow)_0%,transparent_60%)]'
      />

      <div className='relative flex flex-col items-center gap-3 px-8 text-center'>
        <motion.div
          variants={eyebrowVariants}
          className='text-muted-foreground text-xs font-medium tracking-[0.4em] uppercase'
        >
          Now Showing
        </motion.div>

        <motion.div
          variants={codeVariants}
          className='font-mono text-7xl leading-none font-bold tracking-tight tabular-nums'
          style={{ color: accentHex }}
        >
          {areaCode}
        </motion.div>

        <motion.div
          variants={nameVariants}
          className='text-foreground/90 text-3xl font-semibold tracking-tight'
        >
          {areaName}
        </motion.div>

        <motion.div
          variants={subVariants}
          className='text-muted-foreground text-sm tabular-nums'
        >
          Hourly Completion · {associateCount}{' '}
          {associateCount === 1 ? 'associate' : 'associates'}
        </motion.div>
      </div>
    </motion.div>
  )
}

/** Local hex→rgba shim — tiny, no dep on the lib helper (and we need
 *  alpha here as raw CSS-var values, not as a string from a function). */
function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.startsWith('#') ? hex.slice(1) : hex
  const r =
    cleaned.length === 3
      ? parseInt(cleaned[0] + cleaned[0], 16)
      : parseInt(cleaned.slice(0, 2), 16)
  const g =
    cleaned.length === 3
      ? parseInt(cleaned[1] + cleaned[1], 16)
      : parseInt(cleaned.slice(2, 4), 16)
  const b =
    cleaned.length === 3
      ? parseInt(cleaned[2] + cleaned[2], 16)
      : parseInt(cleaned.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Created and developed by Jai Singh
