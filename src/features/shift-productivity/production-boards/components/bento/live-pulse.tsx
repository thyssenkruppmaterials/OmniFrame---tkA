// Created and developed by Jai Singh
/**
 * LivePulse — universal "live" indicator dot used wherever the board
 * wants to signal real-time / freshly-published state.
 *
 * Same cadence everywhere on the platform for muscle memory. Two
 * stacked dots: a static inner circle + a slowly-pulsing outer ring
 * at 60% opacity. The ring uses the standard 2s sinusoidal pulse —
 * gentle enough that a 50-card board never feels like a Christmas
 * tree, but visible across a warehouse at 1080p TV distance.
 *
 * Animated via `motion-safe:animate-ping` (Tailwind's stock ping
 * keyframe). Reduced-motion users see only the static inner dot.
 */
import { cn } from '@/lib/utils'
import { accentFor } from './board-kind-accent'
import type { BentoBoardKind } from './card-variant'

export interface LivePulseProps {
  /** Board kind drives the colour. */
  boardKind: BentoBoardKind
  /** Size token — `sm` (1.5 × 1.5) for inline meta, `md` (2 × 2) for headlines. */
  size?: 'sm' | 'md' | 'lg'
  /** Optional `aria-label` — leave undefined when paired with a visible label. */
  label?: string
  className?: string
}

const SIZE: Record<NonNullable<LivePulseProps['size']>, string> = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
  lg: 'h-2.5 w-2.5',
}

export function LivePulse({
  boardKind,
  size = 'sm',
  label,
  className,
}: LivePulseProps) {
  const accent = accentFor(boardKind)
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center',
        SIZE[size],
        className
      )}
      data-live-pulse={boardKind}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inline-flex h-full w-full rounded-full opacity-50 motion-safe:animate-ping',
          accent.pulseClass
        )}
      />
      <span
        aria-hidden
        className={cn(
          'relative inline-flex rounded-full',
          SIZE[size],
          accent.pulseClass
        )}
      />
    </span>
  )
}

// Created and developed by Jai Singh
