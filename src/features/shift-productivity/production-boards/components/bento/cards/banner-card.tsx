// Created and developed by Jai Singh
/**
 * Banner card variant — cinematic full-width hero.
 *
 * v2 aesthetic overhaul (2026-05-17):
 *   - Editorial type cascade: eyebrow → display headline → support → meta.
 *   - Cover image gets a slow Ken Burns drift (scale 1 → 1.04 over 18s).
 *   - Headline gradient bleeds through translucent legibility scrim.
 *   - Accent ambient shadow (kind-coloured) at the corners, glow on hover.
 *   - Marquee with edge-fade mask + smooth `linear` cadence, pause on hover.
 *
 * Default footprint: 12×3 cells on the lg breakpoint.
 */
import { IconExternalLink } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { JobPostingRow } from '../../../boards/jobs/hooks/use-job-postings'
import type { PostRow } from '../../../hooks/use-board-posts'
import type { AnnouncementKindData } from '../../composer/composer-types'
import type { BannerVariantConfig } from '../card-variant'
import {
  AckPill,
  EditPencil,
  Eyebrow,
  PinnedBadge,
  SeverityBadge,
} from './card-shared'
import {
  accentColorOf,
  branchNameOf,
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
import { firstImageUrlOf } from './storage-helpers'

interface BannerCardProps extends SharedCardProps {
  config: BannerVariantConfig
}

export function BannerCard(props: BannerCardProps) {
  const accent = accentColorOf(props)
  const severity = severityOf(props)
  const post = isPostKind(props) ? (props.post as PostRow) : null
  const job = isJobKind(props) ? (props.post as JobPostingRow) : null

  const imageUrl = post
    ? firstImageUrlOf(post.attachments, post.imageUrl)
    : job
      ? firstImageUrlOf(job.attachments, null)
      : null

  const marquee =
    post?.scope === 'announcement' &&
    (post.kindData as AnnouncementKindData | undefined)?.marquee === true

  const ctaUrl =
    post?.scope === 'announcement'
      ? (post.kindData as AnnouncementKindData | undefined)?.cta_url
      : undefined
  const ctaLabel =
    post?.scope === 'announcement'
      ? (post.kindData as AnnouncementKindData | undefined)?.cta_label
      : undefined

  const coverPos = props.config.cover_position ?? 'center'
  const coverObjectPosition =
    coverPos === 'top' ? 'top' : coverPos === 'bottom' ? 'bottom' : 'center'

  const kindLabel =
    post?.scope === 'announcement'
      ? 'Announcement'
      : post?.scope === 'hr_news'
        ? 'HR news'
        : post?.scope === 'safety_alert'
          ? 'Safety alert'
          : job
            ? 'Job posting'
            : ''

  return (
    <article
      className={cn(
        cardShell({ isTv: props.isTv }),
        'min-h-0',
        // Kind-tinted ambient shadow — 4th stop on top of the base stack.
        'motion-safe:hover:[box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.08),0_2px_4px_0_rgba(0,0,0,0.08),0_28px_64px_-20px_var(--accent-glow),0_36px_80px_-20px_rgba(0,0,0,0.5)]'
      )}
      style={{ ['--accent-glow' as string]: `${accent}55` }}
      data-card-variant='banner'
    >
      {/* Cover image — Ken Burns slow drift via CSS keyframe (no JS). */}
      {imageUrl && (
        <div className='absolute inset-0 overflow-hidden'>
          <img
            src={imageUrl}
            alt=''
            loading='lazy'
            className='h-full w-full object-cover motion-safe:animate-[banner-kenburns_18s_ease-in-out_infinite_alternate]'
            style={{ objectPosition: coverObjectPosition }}
          />
          <style>{`
@keyframes banner-kenburns {
  from { transform: scale(1) translate3d(0, 0, 0); }
  to   { transform: scale(1.05) translate3d(0.5%, -1%, 0); }
}
          `}</style>
        </div>
      )}

      {/* Layered legibility scrim. Strongest at the bottom where the */}
      {/* headline sits; lifts off at the top so the badges read against */}
      {/* the image directly. */}
      <div
        aria-hidden
        className={cn(
          'absolute inset-0',
          imageUrl
            ? 'bg-linear-to-t from-black/85 via-black/45 to-black/5'
            : 'from-card to-card/30 bg-linear-to-br'
        )}
      />

      {/* Accent radial bleed BEHIND the headline so the kind colour */}
      {/* whispers through the type. */}
      <div
        aria-hidden
        className='pointer-events-none absolute bottom-0 -left-1/4 h-2/3 w-2/3 rounded-full opacity-50 blur-[100px]'
        style={{
          background: `radial-gradient(circle, ${accent}, transparent 60%)`,
        }}
      />

      {/* Left accent stripe — vertical kind-coloured gradient. */}
      <div
        aria-hidden
        className='absolute inset-y-0 left-0 w-1'
        style={{
          background: `linear-gradient(180deg, ${accent}00 0%, ${accent} 50%, ${accent}00 100%)`,
        }}
      />

      <div
        className={cn(
          'relative z-10 flex h-full flex-col justify-between gap-3 pl-7',
          props.isTv ? 'p-8' : 'p-5',
          imageUrl && 'text-white'
        )}
      >
        {/* Top row — badges + edit pencil. */}
        <div className='flex items-start justify-between gap-2'>
          <div className='flex flex-wrap items-center gap-1.5'>
            <PinnedBadge pinned={!!post?.isPinned} />
            {post && <SeverityBadge severity={severity} />}
            {workingAreaNameOf(props) && (
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-[0.16em] uppercase',
                  imageUrl
                    ? 'border-white/35 bg-white/15 text-white backdrop-blur-md'
                    : 'border-border/60 bg-card/60 text-foreground/70'
                )}
              >
                {workingAreaNameOf(props)}
              </span>
            )}
            {branchNameOf(props) && (
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-[0.16em] uppercase',
                  imageUrl
                    ? 'border-white/35 bg-white/15 text-white backdrop-blur-md'
                    : 'border-border/60 bg-card/60 text-foreground/70'
                )}
              >
                {branchNameOf(props)}
              </span>
            )}
          </div>
          <EditPencil
            show={props.showEditAffordances && !props.disableInteractions}
            onEdit={props.onEdit}
            ariaLabel={`Edit ${props.post.title}`}
          />
        </div>

        {/* Editorial cascade. */}
        <div className='flex flex-col gap-2'>
          {kindLabel && (
            <Eyebrow
              color={imageUrl ? undefined : accent}
              isTv={props.isTv}
              className={imageUrl ? 'text-white/80' : undefined}
            >
              {kindLabel}
            </Eyebrow>
          )}
          {marquee && props.isTv ? (
            <div
              className='overflow-hidden'
              style={{
                maskImage:
                  'linear-gradient(90deg, transparent 0%, #000 6%, #000 94%, transparent 100%)',
              }}
            >
              <div className='font-display animate-[bento-marquee_28s_linear_infinite] [font-family:var(--font-geist),Inter,system-ui] text-[clamp(2rem,5vw,4.5rem)] leading-none font-bold tracking-[-0.028em] whitespace-nowrap'>
                {props.post.title} &nbsp;·&nbsp; {props.post.title}{' '}
                &nbsp;·&nbsp; {props.post.title} &nbsp;·&nbsp;{' '}
                {props.post.title}
              </div>
            </div>
          ) : (
            <h3
              className={cn(
                'font-display max-w-4xl [font-family:var(--font-geist),Inter,system-ui] leading-[1.02] font-bold tracking-[-0.028em]',
                props.isTv
                  ? 'text-[clamp(2.5rem,5vw,5rem)]'
                  : 'text-[clamp(1.5rem,3vw,2.5rem)]'
              )}
            >
              {props.post.title}
            </h3>
          )}

          {(post?.body || job?.description) && (
            <p
              className={cn(
                'max-w-3xl leading-[1.55] tracking-[-0.005em] whitespace-pre-wrap opacity-90',
                props.isTv
                  ? 'line-clamp-3 text-lg md:text-xl'
                  : 'line-clamp-2 text-sm'
              )}
            >
              {post?.body ?? job?.description}
            </p>
          )}
        </div>

        {/* Meta row — author / date / CTA / ack. */}
        <div
          className={cn(
            'mt-1 flex flex-wrap items-center justify-between gap-3',
            imageUrl ? 'text-white/80' : 'text-muted-foreground',
            props.isTv ? 'text-sm' : 'text-[11px]'
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
                variant='default'
                className={cn(
                  'gap-1.5 rounded-full font-semibold shadow-md',
                  'motion-safe:transition-transform motion-safe:hover:-translate-y-0.5',
                  imageUrl && 'bg-white/95 text-black hover:bg-white'
                )}
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
