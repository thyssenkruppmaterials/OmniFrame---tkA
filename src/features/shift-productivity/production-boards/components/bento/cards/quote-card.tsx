// Created and developed by Jai Singh
/**
 * Quote card variant — refined pull-quote presentation.
 *
 * v2 aesthetic overhaul (2026-05-17):
 *   - Body rendered as a true pull-quote (display weight italic) up to
 *     `text-5xl` on TV — was `text-3xl`.
 *   - Quote glyph in the corner at 18-22% opacity (was 7%) using the
 *     kind's accent — feels editorial, not whisper-faint.
 *   - Attribution row: bold author + light italic source, separated by
 *     a horizontal hairline drawn via the accent gradient.
 *   - Subtle ambient backdrop tint via the accent hex.
 *
 * Default footprint: 6×2 cells.
 */
import { IconQuote } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import type { JobPostingRow } from '../../../boards/jobs/hooks/use-job-postings'
import type { PostRow } from '../../../hooks/use-board-posts'
import type { HrNewsKindData } from '../../composer/composer-types'
import { EditPencil, Eyebrow, PinnedBadge } from './card-shared'
import {
  accentColorOf,
  cardShell,
  formatPublished,
  isPostKind,
  postedByNameOf,
  publishedAtOf,
  type SharedCardProps,
} from './card-shared-utils'

export function QuoteCard(props: SharedCardProps) {
  const accent = accentColorOf(props)
  const post = isPostKind(props) ? (props.post as PostRow) : null
  const job = !post ? (props.post as JobPostingRow) : null

  const text = post?.body ?? job?.description ?? props.post.title

  const author =
    post?.scope === 'hr_news'
      ? (post.kindData as HrNewsKindData | undefined)?.author_name
      : undefined

  const sourceName = author ?? postedByNameOf(props) ?? null

  return (
    <article
      className={cn(cardShell({ isTv: props.isTv }))}
      data-card-variant='quote'
    >
      {/* Soft kind-accent gradient backdrop. */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 opacity-[0.04] dark:opacity-[0.06]'
        style={{
          background: `linear-gradient(135deg, ${accent}, transparent 70%)`,
        }}
      />
      {/* Left accent stripe — kind gradient. */}
      <div
        aria-hidden
        className='absolute inset-y-0 left-0 w-[3px]'
        style={{
          background: `linear-gradient(180deg, ${accent}00 0%, ${accent} 30%, ${accent} 70%, ${accent}00 100%)`,
        }}
      />

      {/* Editorial quote glyph in the corner — bigger + more visible. */}
      <IconQuote
        aria-hidden
        className={cn(
          'absolute opacity-[0.18] dark:opacity-[0.22]',
          props.isTv ? 'top-4 right-6 h-52 w-52' : 'top-1 right-3 h-32 w-32'
        )}
        style={{ color: accent }}
      />

      <div
        className={cn(
          'relative z-10 flex h-full flex-col justify-between gap-4 pl-7',
          props.isTv ? 'p-7' : 'p-5'
        )}
      >
        <div className='flex items-start justify-between gap-2'>
          <Eyebrow color={accent} isTv={props.isTv}>
            {post?.scope === 'hr_news' ? 'HR voice' : 'Quote'}
          </Eyebrow>
          <div className='flex items-center gap-2'>
            <PinnedBadge pinned={!!post?.isPinned} />
            <EditPencil
              show={props.showEditAffordances && !props.disableInteractions}
              onEdit={props.onEdit}
              ariaLabel={`Edit ${props.post.title}`}
            />
          </div>
        </div>

        <blockquote
          className={cn(
            'font-display max-w-3xl [font-family:var(--font-geist),Inter,system-ui] leading-[1.12] font-light tracking-[-0.022em] italic',
            props.isTv
              ? 'text-[clamp(2rem,3.5vw,3.5rem)]'
              : 'text-[clamp(1.25rem,2.4vw,2rem)]'
          )}
        >
          <span
            aria-hidden
            className='font-display mr-1 font-semibold'
            style={{ color: accent }}
          >
            "
          </span>
          {text}
          <span
            aria-hidden
            className='font-display ml-1 font-semibold'
            style={{ color: accent }}
          >
            "
          </span>
        </blockquote>

        {/* Attribution row — gradient hairline + bold name + date. */}
        <footer className='flex flex-col gap-1.5'>
          <span
            aria-hidden
            className='h-px w-12'
            style={{
              background: `linear-gradient(90deg, ${accent}, transparent)`,
            }}
          />
          <div
            className={cn(
              'flex flex-wrap items-center justify-between gap-2',
              props.isTv ? 'text-base' : 'text-xs'
            )}
          >
            <span className='font-semibold tracking-[-0.005em]'>
              {sourceName ?? props.post.title}
            </span>
            <span
              className={cn(
                'text-muted-foreground tabular-nums',
                props.isTv ? 'text-sm' : 'text-[11px]'
              )}
            >
              {formatPublished(publishedAtOf(props))}
            </span>
          </div>
        </footer>
      </div>
    </article>
  )
}

// Created and developed by Jai Singh
