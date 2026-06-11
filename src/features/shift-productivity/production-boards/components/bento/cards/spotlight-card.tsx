// Created and developed by Jai Singh
/**
 * Spotlight card variant — Apple-style featured tile.
 *
 * v2 aesthetic overhaul (2026-05-17):
 *   - Huge icon bubble (80px / 56px) with kind-gradient + halo behind.
 *   - Severity gets a prominent pill (was: a tiny shadcn badge).
 *   - Single large display headline + one CTA — laser-focused composition.
 *   - Safety-alert variant promotes severity to a hero element with a
 *     glow ring around the icon bubble.
 *   - Top accent band replaced with a soft radial bleed from the icon's
 *     halo so the whole composition is held together by the same colour.
 *
 * Default footprint: 6×3 cells.
 */
import {
  IconAlertTriangle,
  IconBriefcase,
  IconExternalLink,
  IconSpeakerphone,
  IconUsersGroup,
  type Icon as TablerIcon,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { JobPostingRow } from '../../../boards/jobs/hooks/use-job-postings'
import type { PostRow } from '../../../hooks/use-board-posts'
import type {
  AnnouncementKindData,
  SafetyAlertKindData,
} from '../../composer/composer-types'
import {
  AckPill,
  EditPencil,
  Eyebrow,
  IconBubble,
  PinnedBadge,
  SeverityBadge,
} from './card-shared'
import {
  accentColorOf,
  cardShell,
  formatPublished,
  isJobKind,
  isPostKind,
  postedByNameOf,
  publishedAtOf,
  severityOf,
  workingAreaNameOf,
  type SharedCardProps,
} from './card-shared-utils'

const SCOPE_ICON: Record<string, TablerIcon> = {
  announcement: IconSpeakerphone,
  hr_news: IconUsersGroup,
  safety_alert: IconAlertTriangle,
  job: IconBriefcase,
}

const SCOPE_LABEL: Record<string, string> = {
  announcement: 'Announcement',
  hr_news: 'HR news',
  safety_alert: 'Safety alert',
  job: 'Job posting',
}

function iconFor(scopeOrKind: string): TablerIcon {
  return SCOPE_ICON[scopeOrKind] ?? IconAlertTriangle
}

export function SpotlightCard(props: SharedCardProps) {
  const accent = accentColorOf(props)
  const severity = severityOf(props)
  const post = isPostKind(props) ? (props.post as PostRow) : null
  const job = isJobKind(props) ? (props.post as JobPostingRow) : null

  const scopeKey =
    post?.scope === 'announcement'
      ? 'announcement'
      : post?.scope === 'hr_news'
        ? 'hr_news'
        : post?.scope === 'safety_alert'
          ? 'safety_alert'
          : job
            ? 'job'
            : 'announcement'

  const ScopeIcon = iconFor(scopeKey)
  const scopeLabel = SCOPE_LABEL[scopeKey] ?? scopeKey.replace('_', ' ')
  const isSafety = scopeKey === 'safety_alert'

  const corrective =
    post?.scope === 'safety_alert'
      ? (post.kindData as SafetyAlertKindData | undefined)?.corrective_action
      : undefined

  const ctaUrl =
    post?.scope === 'announcement'
      ? (post.kindData as AnnouncementKindData | undefined)?.cta_url
      : undefined
  const ctaLabel =
    post?.scope === 'announcement'
      ? (post.kindData as AnnouncementKindData | undefined)?.cta_label
      : undefined

  return (
    <article
      className={cn(
        cardShell({ isTv: props.isTv }),
        // Kind-tinted ambient shadow on hover.
        'motion-safe:hover:[box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.08),0_2px_4px_0_rgba(0,0,0,0.08),0_28px_56px_-20px_var(--accent-glow),0_36px_72px_-20px_rgba(0,0,0,0.5)]'
      )}
      style={{ ['--accent-glow' as string]: `${accent}66` }}
      data-card-variant='spotlight'
    >
      {/* Soft radial bleed from the icon corner — holds the composition together. */}
      <span
        aria-hidden
        className='pointer-events-none absolute -top-16 -right-16 h-56 w-56 rounded-full opacity-50 blur-3xl'
        style={{
          background: `radial-gradient(circle, ${accent}66, transparent 65%)`,
        }}
      />

      <div
        className={cn(
          'relative z-10 flex flex-1 flex-col gap-4',
          props.isTv ? 'p-7' : 'p-5'
        )}
      >
        {/* Top row — icon bubble + eyebrow stack + edit pencil. */}
        <div className='flex items-start justify-between gap-3'>
          <div className='flex items-start gap-3'>
            <div className='relative'>
              {/* Safety alerts get an extra glow ring around the bubble. */}
              {isSafety && severity === 'danger' && (
                <span
                  aria-hidden
                  className='absolute inset-0 -m-2 rounded-3xl motion-safe:animate-pulse'
                  style={{
                    background: `radial-gradient(circle, ${accent}55, transparent 70%)`,
                  }}
                />
              )}
              <IconBubble
                Icon={ScopeIcon}
                color={accent}
                isTv={props.isTv}
                className={cn(
                  'relative',
                  props.isTv ? 'h-16 w-16' : 'h-12 w-12'
                )}
              />
            </div>
            <div className='flex min-w-0 flex-col gap-1'>
              <Eyebrow color={accent} isTv={props.isTv}>
                {scopeLabel}
              </Eyebrow>
              <div className='flex flex-wrap items-center gap-1.5'>
                <PinnedBadge pinned={!!post?.isPinned} />
                {post && (
                  <SeverityBadge severity={severity} prominent={isSafety} />
                )}
                {workingAreaNameOf(props) && (
                  <span className='border-border/50 bg-muted/30 text-muted-foreground inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-[0.04em]'>
                    {workingAreaNameOf(props)}
                  </span>
                )}
                {job && (
                  <span className='border-border/50 bg-muted/30 text-muted-foreground inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-[0.04em]'>
                    {job.isInternal ? 'Internal' : 'External'}
                  </span>
                )}
              </div>
            </div>
          </div>
          <EditPencil
            show={props.showEditAffordances && !props.disableInteractions}
            onEdit={props.onEdit}
            ariaLabel={`Edit ${props.post.title}`}
          />
        </div>

        {/* Display headline — the spotlight is one big number / line. */}
        <h3
          className={cn(
            'font-display [font-family:var(--font-geist),Inter,system-ui] leading-[1.04] font-bold tracking-[-0.028em]',
            props.isTv
              ? 'text-[clamp(2rem,3.5vw,3.5rem)]'
              : 'text-[clamp(1.25rem,2.2vw,2rem)]'
          )}
        >
          {props.post.title}
        </h3>

        {(post?.body || job?.description) && (
          <p
            className={cn(
              'text-foreground/85 leading-[1.55] tracking-[-0.005em] whitespace-pre-wrap',
              props.isTv ? 'line-clamp-4 text-lg' : 'line-clamp-3 text-[13.5px]'
            )}
          >
            {post?.body ?? job?.description}
          </p>
        )}

        {corrective && (
          <div
            className={cn(
              'rounded-xl border p-3.5',
              'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200',
              'shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
            )}
          >
            <Eyebrow
              color='currentColor'
              className='text-amber-700 dark:text-amber-300'
            >
              Corrective action
            </Eyebrow>
            <p
              className={cn(
                'mt-1 leading-[1.5]',
                props.isTv ? 'text-base' : 'text-sm'
              )}
            >
              {corrective}
            </p>
          </div>
        )}

        {/* Meta row. */}
        <div
          className={cn(
            'text-muted-foreground mt-auto flex flex-wrap items-center justify-between gap-2',
            props.isTv ? 'text-[13px]' : 'text-[11px]'
          )}
        >
          <span className='tabular-nums'>
            {postedByNameOf(props) ? `${postedByNameOf(props)} · ` : ''}
            {formatPublished(publishedAtOf(props))}
          </span>
          <div className='flex items-center gap-2'>
            {ctaUrl && ctaLabel && (
              <Button
                asChild
                size='sm'
                className={cn(
                  'gap-1.5 rounded-full font-semibold text-white shadow-md',
                  'motion-safe:transition-transform motion-safe:hover:-translate-y-0.5'
                )}
                style={{
                  background: `linear-gradient(135deg, ${accent}, ${accent}d0)`,
                  boxShadow: `0 8px 22px -8px ${accent}88`,
                }}
              >
                <a href={ctaUrl} target='_blank' rel='noopener noreferrer'>
                  {ctaLabel}
                  <IconExternalLink className='h-3.5 w-3.5' aria-hidden />
                </a>
              </Button>
            )}
            {post?.acknowledgedRequired && (
              <AckPill
                ackedByMe={post.acknowledgedByCurrentUser}
                ackCount={post.ackCount}
                onAck={props.onAcknowledge}
                isTv={props.isTv}
              />
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

// Created and developed by Jai Singh
