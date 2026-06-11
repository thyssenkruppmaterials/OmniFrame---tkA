// Created and developed by Jai Singh
/**
 * Classic card variant — editorial summary card with vertical accent stripe.
 *
 * v2 aesthetic overhaul (2026-05-17):
 *   - Vertical gradient accent stripe replaces the solid 1 px bar.
 *   - Editorial cascade: eyebrow → headline → body → meta row.
 *   - Hover lift + accent glow (from the cardShell base recipe).
 *   - Optional cover image now lazy-loads with a Ken Burns crawl when
 *     the card itself is hovered (idle = still).
 *   - Tighter, more generous padding; subtitle line under the headline
 *     when the post has author + working area.
 */
import { IconExternalLink, IconMail } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { JobPostingRow } from '../../../boards/jobs/hooks/use-job-postings'
import type { PostRow } from '../../../hooks/use-board-posts'
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

export function ClassicCard(props: SharedCardProps) {
  const accent = accentColorOf(props)
  const severity = severityOf(props)

  const post = isPostKind(props) ? (props.post as PostRow) : null
  const job = isJobKind(props) ? (props.post as JobPostingRow) : null

  const imageUrl = post
    ? firstImageUrlOf(post.attachments, post.imageUrl)
    : job
      ? firstImageUrlOf(job.attachments, null)
      : null

  const body = post?.body ?? job?.description ?? null

  const kindLabel =
    post?.scope === 'announcement'
      ? 'Announcement'
      : post?.scope === 'hr_news'
        ? 'HR news'
        : post?.scope === 'safety_alert'
          ? 'Safety alert'
          : job
            ? job.isInternal
              ? 'Internal opening'
              : 'External opening'
            : ''

  return (
    <article
      className={cn(cardShell({ isTv: props.isTv }))}
      data-card-variant='classic'
    >
      {/* Vertical accent stripe — kind-gradient (top→bottom). */}
      <div
        aria-hidden
        className='absolute inset-y-0 left-0 w-[3px]'
        style={{
          background: `linear-gradient(180deg, ${accent}00 0%, ${accent} 30%, ${accent} 70%, ${accent}00 100%)`,
        }}
      />

      {/* Faint corner accent glow — fades in on hover only. */}
      <span
        aria-hidden
        className='pointer-events-none absolute -top-12 right-0 h-32 w-32 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100'
        style={{
          background: `radial-gradient(circle, ${accent}, transparent 65%)`,
        }}
      />

      {imageUrl && (
        <div
          className={cn(
            'border-border/60 relative overflow-hidden border-b',
            props.isTv ? 'h-44' : 'h-28'
          )}
        >
          <img
            src={imageUrl}
            alt=''
            loading='lazy'
            className='h-full w-full object-cover transition-transform duration-[6s] ease-out group-hover:scale-[1.03]'
          />
          {/* Soft top-to-bottom scrim so the next row reads. */}
          <div
            aria-hidden
            className='from-card/80 absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t to-transparent'
          />
        </div>
      )}

      <div
        className={cn(
          'relative flex flex-1 flex-col gap-2.5 pl-6',
          props.isTv ? 'p-6' : 'p-4'
        )}
      >
        <div className='flex items-start justify-between gap-2'>
          <div className='flex min-w-0 flex-wrap items-center gap-1.5'>
            <PinnedBadge pinned={!!post?.isPinned} />
            {post && <SeverityBadge severity={severity} />}
          </div>
          <EditPencil
            show={props.showEditAffordances && !props.disableInteractions}
            onEdit={props.onEdit}
            ariaLabel={`Edit ${props.post.title}`}
          />
        </div>

        {/* Editorial cascade — eyebrow → headline → support → meta. */}
        {kindLabel && (
          <Eyebrow color={accent} isTv={props.isTv}>
            {kindLabel}
          </Eyebrow>
        )}

        <h3
          className={cn(
            '[font-family:var(--font-geist),Inter,system-ui] leading-[1.12] font-semibold tracking-[-0.018em]',
            props.isTv
              ? 'text-[clamp(1.5rem,1.8vw,2rem)]'
              : 'text-[15px] md:text-base'
          )}
        >
          {props.post.title}
        </h3>

        {body && (
          <p
            className={cn(
              'text-foreground/85 leading-[1.55] tracking-[-0.005em] whitespace-pre-wrap',
              props.isTv
                ? 'line-clamp-5 text-base'
                : 'line-clamp-3 text-[13.5px]'
            )}
          >
            {body}
          </p>
        )}

        {/* Soft scope chips — render only when present, so we don't pad an empty row. */}
        {(workingAreaNameOf(props) ||
          branchNameOf(props) ||
          post?.scope === 'hr_news') && (
          <div className='flex flex-wrap items-center gap-1.5'>
            {workingAreaNameOf(props) && (
              <span className='border-border/50 bg-muted/30 text-muted-foreground inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-[0.04em]'>
                {workingAreaNameOf(props)}
              </span>
            )}
            {branchNameOf(props) && (
              <span className='border-border/50 bg-muted/30 text-muted-foreground inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-[0.04em]'>
                {branchNameOf(props)}
              </span>
            )}
            {post?.scope === 'hr_news' && !post.branchId && (
              <span className='border-border/50 bg-muted/30 text-muted-foreground inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-[0.04em]'>
                Company-wide
              </span>
            )}
          </div>
        )}

        {job && (job.applyUrl || job.applyEmail) && (
          <div className='mt-1 flex flex-wrap items-center gap-2'>
            {job.applyUrl && (
              <Button
                asChild
                size='sm'
                variant='outline'
                className='gap-1.5 rounded-full text-xs'
              >
                <a
                  href={job.applyUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  Apply <IconExternalLink className='h-3 w-3' aria-hidden />
                </a>
              </Button>
            )}
            {job.applyEmail && (
              <Button
                asChild
                size='sm'
                variant='outline'
                className='gap-1.5 rounded-full text-xs'
              >
                <a href={`mailto:${job.applyEmail}`}>
                  <IconMail className='h-3 w-3' aria-hidden /> {job.applyEmail}
                </a>
              </Button>
            )}
          </div>
        )}

        {/* Meta row — author + date on the left, ack on the right. */}
        <div
          className={cn(
            'text-muted-foreground mt-auto flex flex-wrap items-center justify-between gap-2 pt-1',
            props.isTv ? 'text-[13px]' : 'text-[11px]'
          )}
        >
          <span className='tabular-nums'>
            {postedByNameOf(props) ? `${postedByNameOf(props)} · ` : ''}
            {formatPublished(publishedAtOf(props))}
          </span>
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
    </article>
  )
}

// Created and developed by Jai Singh
