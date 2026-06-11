// Created and developed by Jai Singh
/**
 * BoardHeader — polished per-board page header chrome.
 *
 * Lower visual weight than the previous ad-hoc header (smaller, tighter
 * tracking on the title, kind-accented eyebrow + LivePulse), so it
 * doesn't compete with the bento grid below it. Hosts:
 *   - kind eyebrow ("ANNOUNCEMENTS · LIVE")
 *   - title (display weight, tight tracking)
 *   - subtitle (muted body)
 *   - optional filter slot (chip strip)
 *   - actions cluster ("+ New" / "Display on TV" / right-side custom slot)
 *
 * Replaces the per-board duplicated header markup in
 * `boards/{announcements,hr-news,jobs,safety-alerts}/*-board.tsx`.
 */
import type { ReactNode } from 'react'
import { IconDeviceTv, IconPlus } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { accentFor, gradientCss } from './board-kind-accent'
import type { BentoBoardKind } from './card-variant'
import { LivePulse } from './live-pulse'

export interface BoardHeaderProps {
  boardKind: BentoBoardKind
  /** Display-weight title (e.g. "Announcements"). */
  title: string
  /** Optional subtitle below the title — describes scope ("All branches", "Severity-sorted", …). */
  subtitle?: string
  /**
   * Chip strip / filter row. Renders below the eyebrow and to the left
   * of the actions cluster — wraps independently so wide chip strips
   * don't push the CTAs into a second line.
   */
  filters?: ReactNode
  /** Total post count — surfaces in the eyebrow as `· N live`. */
  count?: number
  /**
   * "+ New …" callback. When undefined (e.g. for read-only viewers),
   * the button doesn't render.
   */
  onCompose?: () => void
  /** Compose label, e.g. "New announcement". Required when `onCompose` is set. */
  composeLabel?: string
  /**
   * Whether to render the "Display on TV" button — set false if the
   * board doesn't have a TV-mode hand-off (rare).
   */
  onEnterTv?: () => void
  /** Optional slot for extra header-right actions (e.g. board edit toggle). */
  extraActions?: ReactNode
  className?: string
}

export function BoardHeader({
  boardKind,
  title,
  subtitle,
  filters,
  count,
  onCompose,
  composeLabel,
  onEnterTv,
  extraActions,
  className,
}: BoardHeaderProps) {
  const accent = accentFor(boardKind)
  return (
    <header
      data-board-header={boardKind}
      className={cn(
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 relative flex flex-col gap-4 motion-safe:duration-500',
        className
      )}
    >
      <div className='flex flex-wrap items-start justify-between gap-x-5 gap-y-3'>
        <div className='flex min-w-0 flex-col gap-1.5'>
          {/* Eyebrow — kind label + live pulse + count. */}
          <span
            className={cn(
              'inline-flex w-fit items-center gap-2 rounded-full border px-2.5 py-0.5 font-mono text-[10px] tracking-[0.28em] uppercase',
              accent.eyebrowClass
            )}
          >
            <LivePulse boardKind={boardKind} size='sm' />
            <span>{accent.label}</span>
            {typeof count === 'number' && (
              <>
                <span className='opacity-50'>·</span>
                <span className='tabular-nums'>
                  {count} {count === 1 ? 'live' : 'live'}
                </span>
              </>
            )}
          </span>

          {/* Title + subtitle. */}
          <h2
            className='font-display text-2xl leading-tight font-semibold tracking-[-0.02em] md:text-3xl'
            style={{ fontFamily: 'var(--font-geist), Inter, system-ui' }}
          >
            <span
              className='bg-clip-text text-transparent'
              style={{
                backgroundImage: gradientCss(boardKind, 110),
              }}
            >
              {title}
            </span>
          </h2>
          {subtitle && (
            <p className='text-muted-foreground max-w-2xl text-sm md:text-[15px]'>
              {subtitle}
            </p>
          )}
        </div>

        {/* Actions cluster — right-aligned, wraps cleanly under the title on narrow viewports. */}
        <div className='flex flex-wrap items-center gap-2'>
          {extraActions}
          {onCompose && composeLabel && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={onCompose}
              className='border-border/60 gap-1.5'
            >
              <IconPlus className='h-4 w-4' aria-hidden />
              {composeLabel}
            </Button>
          )}
          {onEnterTv && (
            <Button
              type='button'
              size='sm'
              onClick={onEnterTv}
              className={cn(
                'gap-1.5 border-0 text-white shadow-md',
                'motion-safe:transition-transform motion-safe:hover:-translate-y-0.5'
              )}
              style={{
                background: gradientCss(boardKind, 110),
                boxShadow: `0 8px 22px -8px ${accent.glowStrong}`,
              }}
            >
              <IconDeviceTv className='h-4 w-4' aria-hidden />
              Display on TV
            </Button>
          )}
        </div>
      </div>

      {filters && (
        <div className='flex flex-wrap items-center gap-2'>{filters}</div>
      )}

      {/* Hairline underline — fades through the kind's gradient, sits below the header. */}
      <span
        aria-hidden
        className='h-px w-full bg-gradient-to-r'
        style={{
          backgroundImage: `linear-gradient(90deg, transparent, ${accent.midHex}55, transparent)`,
        }}
      />
    </header>
  )
}

// Created and developed by Jai Singh
