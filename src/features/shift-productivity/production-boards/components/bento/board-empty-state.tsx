// Created and developed by Jai Singh
/**
 * BoardEmptyState — premium empty state for the four secondary boards.
 *
 * Renders an SVG artwork (gradient ring + soft halo) keyed to the
 * board kind, with editorial typography (display headline, body
 * support line) and an optional "Compose your first {kind}" CTA. This
 * is the design surface curators see before they post their first
 * item — and the surface every viewer sees on a board that's just
 * been bootstrapped — so the visual budget is generous.
 *
 * Replaces the old `<Card variant='outline'>` + tiny icon tile +
 * one-line copy treatment. That earlier pattern is what made the
 * board feel desolate when sparsely populated.
 *
 * Visual reference: Apple Newsroom's empty-search treatment, Linear's
 * empty-issue-list. Editorial display type + a single artwork at the
 * centre + generous whitespace.
 */
import {
  IconAlertTriangle,
  IconBriefcase,
  IconPlus,
  IconSpeakerphone,
  IconUsersGroup,
  type Icon as TablerIcon,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { accentFor } from './board-kind-accent'
import type { BentoBoardKind } from './card-variant'

const KIND_COPY: Record<
  BentoBoardKind,
  {
    icon: TablerIcon
    headline: string
    support: string
    cta: string
  }
> = {
  announcement: {
    icon: IconSpeakerphone,
    headline: 'Nothing on the wire yet.',
    support:
      'Announcements posted here ripple across every working area. Start with the morning huddle or a shift call-out.',
    cta: 'Compose first announcement',
  },
  hr_news: {
    icon: IconUsersGroup,
    headline: 'Quiet on the HR channel.',
    support:
      "Company-wide news or branch-specific updates — pin a welcome, surface a policy change, share a milestone. The whole org's listening.",
    cta: 'Compose first HR update',
  },
  job: {
    icon: IconBriefcase,
    headline: 'No openings posted.',
    support:
      'Spotlight internal moves and external roles alongside each other. Cross-shift visibility makes the difference on hard-to-fill posts.',
    cta: 'Compose first job',
  },
  safety_alert: {
    icon: IconAlertTriangle,
    headline: 'All clear — no active alerts.',
    support:
      "When something needs the floor's attention, post here. Severity-sort + ack tracking make sure it reaches the right shift.",
    cta: 'Compose first alert',
  },
}

export interface BoardEmptyStateProps {
  boardKind: BentoBoardKind
  /** TV-density variant — generous outer padding + larger artwork. */
  density?: 'normal' | 'tv'
  /** When provided, renders the "Compose first…" CTA. */
  onCompose?: () => void
  className?: string
}

export function BoardEmptyState({
  boardKind,
  density = 'normal',
  onCompose,
  className,
}: BoardEmptyStateProps) {
  const accent = accentFor(boardKind)
  const copy = KIND_COPY[boardKind]
  const Icon = copy.icon
  const isTv = density === 'tv'

  return (
    <section
      role='region'
      aria-label={`${accent.label} — empty`}
      data-board-empty-state={boardKind}
      className={cn(
        'relative isolate flex w-full flex-col items-center justify-center text-center',
        isTv ? 'min-h-[70vh] gap-7 py-20' : 'min-h-[44vh] gap-5 py-14 lg:py-20',
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-700',
        className
      )}
    >
      {/* Centred halo — a soft accent radial behind the artwork. */}
      <span
        aria-hidden
        className='pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full'
        style={{
          width: isTv ? '36rem' : '24rem',
          height: isTv ? '36rem' : '24rem',
          background: `radial-gradient(circle at center, ${accent.glowSoft}, transparent 60%)`,
          filter: 'blur(28px)',
        }}
      />

      {/* Artwork — three concentric rings + an icon in the centre. */}
      <div
        className={cn(
          'relative isolate flex items-center justify-center',
          isTv ? 'h-44 w-44' : 'h-32 w-32'
        )}
      >
        <span
          aria-hidden
          className='absolute inset-0 rounded-full motion-safe:animate-[ping_4s_cubic-bezier(0,0,0.2,1)_infinite]'
          style={{
            background: `radial-gradient(circle at center, ${accent.glowStrong}, transparent 65%)`,
            opacity: 0.55,
          }}
        />
        <span
          aria-hidden
          className='absolute inset-3 rounded-full border'
          style={{ borderColor: `${accent.fromHex}40` }}
        />
        <span
          aria-hidden
          className='absolute inset-6 rounded-full border'
          style={{ borderColor: `${accent.midHex}55` }}
        />
        <span
          aria-hidden
          className='absolute inset-9 rounded-full'
          style={{
            background: `linear-gradient(135deg, ${accent.fromHex} 0%, ${accent.toHex} 100%)`,
            boxShadow: `0 12px 32px -10px ${accent.glowStrong}, inset 0 1px 0 rgba(255,255,255,0.25)`,
          }}
        />
        <Icon
          aria-hidden
          className={cn(
            'relative text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.18)]',
            isTv ? 'h-12 w-12' : 'h-9 w-9'
          )}
        />
      </div>

      {/* Eyebrow — kind label, mono, tracked. */}
      <span
        className={cn(
          'inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono uppercase',
          accent.eyebrowClass,
          isTv
            ? 'text-[11px] tracking-[0.32em]'
            : 'text-[10px] tracking-[0.28em]'
        )}
      >
        {accent.label}
      </span>

      {/* Headline + support — generous whitespace, display weight. */}
      <h3
        className={cn(
          'font-display mx-auto max-w-3xl leading-[1.08] font-semibold tracking-tight',
          isTv
            ? 'text-[clamp(2.5rem,4.5vw,4.5rem)]'
            : 'text-[clamp(1.75rem,3vw,2.75rem)]'
        )}
        style={{ fontFamily: 'var(--font-geist), Inter, system-ui' }}
      >
        {copy.headline}
      </h3>
      <p
        className={cn(
          'text-muted-foreground mx-auto max-w-xl leading-relaxed',
          isTv ? 'text-lg' : 'text-sm md:text-base'
        )}
      >
        {copy.support}
      </p>

      {onCompose && (
        <Button
          type='button'
          size={isTv ? 'lg' : 'default'}
          onClick={onCompose}
          className={cn(
            'mt-2 gap-2 rounded-full px-6 text-white shadow-lg',
            'motion-safe:transition-transform motion-safe:hover:-translate-y-0.5'
          )}
          style={{
            background: `linear-gradient(135deg, ${accent.fromHex}, ${accent.toHex})`,
            boxShadow: `0 12px 28px -8px ${accent.glowStrong}`,
          }}
        >
          <IconPlus className={isTv ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden />
          {copy.cta}
        </Button>
      )}
    </section>
  )
}

// Created and developed by Jai Singh
