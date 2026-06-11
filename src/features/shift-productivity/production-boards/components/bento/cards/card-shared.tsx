// Created and developed by Jai Singh
/**
 * Small reusable React components shared by the five card variants:
 * EditPencil, PinnedBadge, SeverityBadge, AckPill, IconBubble, Eyebrow.
 *
 * Co-located with `card-shared-utils.ts`; we keep this file
 * components-only so `react-refresh/only-export-components` stays
 * happy. Constants + helpers live in the sibling utils file.
 *
 * v2 aesthetic overhaul (2026-05-17):
 * - Promoted from shadcn `<Badge>` to designed pills with kind-accent
 *   glass + tracked uppercase eyebrow type.
 * - EditPencil gained a subtle glass-on-hover backdrop (only when the
 *   card itself is hovered — never appears at rest).
 * - Severity pills tightened (smaller padding, 0.18em tracking, weight 600).
 * - New <Eyebrow> primitive — the small uppercase label that opens every
 *   card variant's editorial cascade.
 */
import { IconCheck, IconPencil, IconPin, type Icon } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { PostSeverity } from '../../../hooks/use-board-posts'
import { SEVERITY_BADGE, TYPE_TOKENS } from './card-shared-utils'

export function EditPencil({
  onEdit,
  ariaLabel,
  show,
}: {
  onEdit: (() => void) | undefined
  ariaLabel: string
  show: boolean
}) {
  if (!show) return null
  return (
    <Button
      type='button'
      variant='ghost'
      size='icon'
      onClick={(e) => {
        e.stopPropagation()
        onEdit?.()
      }}
      className={cn(
        'h-8 w-8 shrink-0 rounded-full opacity-0 backdrop-blur-md transition-all',
        'bg-background/40 ring-border/40 ring-1 ring-inset',
        'group-focus-within:opacity-100 group-hover:opacity-100',
        'hover:bg-background/70 hover:ring-border/70 hover:scale-105'
      )}
      aria-label={ariaLabel}
    >
      <IconPencil className='h-3.5 w-3.5' aria-hidden />
    </Button>
  )
}

export function PinnedBadge({ pinned }: { pinned: boolean }) {
  if (!pinned) return null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.16em] uppercase',
        'border border-amber-500/40 bg-amber-500/12 text-amber-700',
        'dark:border-amber-400/35 dark:bg-amber-400/12 dark:text-amber-300',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
      )}
    >
      <IconPin className='h-2.5 w-2.5 -rotate-12' aria-hidden />
      Pinned
    </span>
  )
}

const SEVERITY_DOT: Record<PostSeverity, string> = {
  info: 'bg-sky-500 dark:bg-sky-400',
  success: 'bg-emerald-500 dark:bg-emerald-400',
  warning: 'bg-amber-500 dark:bg-amber-400',
  danger: 'bg-rose-500 dark:bg-rose-400',
}

export function SeverityBadge({
  severity,
  prominent = false,
}: {
  severity: PostSeverity
  /** Drops the small dot, widens the pill — for the spotlight variant's hero severity callout. */
  prominent?: boolean
}) {
  if (severity === 'info' && !prominent) {
    // Info severity rarely needs visual emphasis — render nothing at
    // small density so the card chrome stays calm. Curators can still
    // see severity in the composer.
    return null
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.16em] capitalize uppercase',
        'border',
        SEVERITY_BADGE[severity],
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
        prominent && 'px-2.5 py-1 text-[11px] tracking-[0.18em]'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block h-1.5 w-1.5 rounded-full',
          SEVERITY_DOT[severity]
        )}
      />
      {severity}
    </span>
  )
}

export function AckPill({
  ackedByMe,
  ackCount,
  onAck,
  isTv,
}: {
  ackedByMe: boolean
  ackCount: number
  onAck?: () => void
  isTv: boolean
}) {
  if (ackedByMe) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold',
          'border border-emerald-500/30 bg-emerald-500/12 text-emerald-700',
          'dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300',
          isTv ? 'text-base' : 'text-xs'
        )}
      >
        <IconCheck className={cn(isTv ? 'h-4 w-4' : 'h-3 w-3')} aria-hidden />
        Acknowledged
      </span>
    )
  }
  return (
    <div className='inline-flex items-center gap-2'>
      <Button
        type='button'
        size='sm'
        variant='default'
        onClick={(e) => {
          e.stopPropagation()
          onAck?.()
        }}
        className={cn(
          'gap-1.5 rounded-full font-semibold shadow-md',
          'motion-safe:transition-transform motion-safe:hover:scale-[1.02]',
          isTv ? 'h-9 px-4 text-sm' : 'h-7 px-3 text-xs'
        )}
      >
        Acknowledge
      </Button>
      {ackCount > 0 && (
        <span
          className={cn(
            'text-muted-foreground tabular-nums',
            isTv ? 'text-sm' : 'text-xs'
          )}
        >
          {ackCount} ack{ackCount === 1 ? '' : 's'}
        </span>
      )}
    </div>
  )
}

/**
 * Eyebrow — the small uppercase tracked label that opens every
 * card's editorial cascade. Accepts a `color` (defaults to current
 * text colour) so curators with `colorHex` set get a kind-accent eyebrow.
 */
export function Eyebrow({
  children,
  color,
  isTv = false,
  className,
}: {
  children: React.ReactNode
  color?: string
  isTv?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        isTv ? TYPE_TOKENS.eyebrowTv : TYPE_TOKENS.eyebrow,
        className
      )}
      style={color ? { color } : undefined}
    >
      {children}
    </span>
  )
}

export function IconBubble({
  Icon,
  color,
  className,
  isTv = false,
}: {
  Icon: Icon
  color: string
  className?: string
  isTv?: boolean
}) {
  // The icon bubble sits at the top of the spotlight card. We layer a
  // soft accent glow BEHIND the bubble + a 1 px inset highlight on the
  // bubble itself so it catches light "from above".
  return (
    <span
      className={cn(
        'relative inline-flex items-center justify-center rounded-2xl',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_24px_-12px_var(--ic-glow)]',
        className
      )}
      style={
        {
          background: `linear-gradient(135deg, ${color}, ${color}cc)`,
          ['--ic-glow']: `${color}55`,
        } as React.CSSProperties
      }
      aria-hidden
    >
      {/* Halo behind. */}
      <span
        aria-hidden
        className='pointer-events-none absolute -inset-3 -z-10 rounded-full blur-2xl'
        style={{
          background: `radial-gradient(circle, ${color}55, transparent 70%)`,
        }}
      />
      <Icon
        className={cn('text-white', isTv ? 'h-7 w-7' : 'h-5 w-5')}
        aria-hidden
      />
    </span>
  )
}

// Created and developed by Jai Singh
