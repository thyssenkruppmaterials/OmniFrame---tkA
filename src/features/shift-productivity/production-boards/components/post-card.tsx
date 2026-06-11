// Created and developed by Jai Singh
/**
 * Shared post card used by Announcements, HR News, and Safety Alerts.
 *
 * Severity drives the left border colour (4 px solid) on safety alerts;
 * for other scopes the border is purely cosmetic. Acknowledged-required
 * posts render an "Acknowledge" button until the current user has acked,
 * then collapse to a green confirmation chip.
 */
import { IconCheck, IconPencil, IconPin } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useBoardEditMode } from '../hooks/use-board-edit-mode'
import type { PostRow, PostSeverity } from '../hooks/use-board-posts'
import { useCanEditBoards } from '../hooks/use-can-edit-boards'

interface PostCardProps {
  post: PostRow
  onEdit?: (post: PostRow) => void
  onAcknowledge?: (post: PostRow) => void
}

const SEVERITY_BORDER: Record<PostSeverity, string> = {
  info: '#0ea5e9',
  success: '#16a34a',
  warning: '#f59e0b',
  danger: '#dc2626',
}

const SEVERITY_BADGE: Record<PostSeverity, string> = {
  info: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/25',
  success:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
  warning:
    'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25',
  danger: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/25',
}

const SHADOW = [
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_1px_2px_0_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(15,23,42,0.18)]',
  'dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_2px_4px_0_rgba(0,0,0,0.5),0_24px_48px_-12px_rgba(0,0,0,0.55)]',
].join(' ')

function formatPublished(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function PostCard({ post, onEdit, onAcknowledge }: PostCardProps) {
  const { canEdit } = useCanEditBoards()
  const [editMode] = useBoardEditMode()
  const showEditAffordances = canEdit && editMode

  const accentColor = post.colorHex ?? SEVERITY_BORDER[post.severity]

  return (
    <article
      className={cn(
        'group border-border/60 bg-card relative isolate flex flex-col overflow-hidden rounded-2xl border',
        'bg-linear-to-b from-white/4 via-transparent to-transparent',
        SHADOW,
        'transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'motion-safe:hover:-translate-y-0.5'
      )}
    >
      {/* Left severity border. Solid 4px, full height. */}
      <div
        aria-hidden
        className='absolute inset-y-0 left-0 w-1'
        style={{ backgroundColor: accentColor }}
      />
      {post.imageUrl && (
        <img
          src={post.imageUrl}
          alt=''
          className='border-border/60 h-32 w-full border-b object-cover'
        />
      )}

      <div className='flex flex-1 flex-col gap-3 p-5 pl-6'>
        <div className='flex items-start justify-between gap-2'>
          <div className='flex flex-wrap items-center gap-2'>
            {post.isPinned && (
              <Badge
                variant='outline'
                className='gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
              >
                <IconPin className='h-3 w-3' aria-hidden />
                Pinned
              </Badge>
            )}
            <Badge
              variant='outline'
              className={cn(
                'text-xs capitalize',
                SEVERITY_BADGE[post.severity]
              )}
            >
              {post.severity}
            </Badge>
            {post.workingAreaName && (
              <Badge variant='outline' className='border-border/50 text-xs'>
                {post.workingAreaName}
              </Badge>
            )}
            {post.branchName && (
              <Badge variant='outline' className='border-border/50 text-xs'>
                {post.branchName}
              </Badge>
            )}
            {post.scope === 'hr_news' && !post.branchId && (
              <Badge variant='outline' className='border-border/50 text-xs'>
                Company-wide
              </Badge>
            )}
          </div>
          {showEditAffordances && (
            <Button
              type='button'
              variant='ghost'
              size='icon'
              onClick={() => onEdit?.(post)}
              className='h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100'
              aria-label={`Edit ${post.title}`}
            >
              <IconPencil className='h-4 w-4' aria-hidden />
            </Button>
          )}
        </div>

        <h3 className='text-lg leading-tight font-semibold tracking-tight'>
          {post.title}
        </h3>

        {post.body && (
          <div className='prose prose-sm dark:prose-invert text-foreground/90 max-w-none whitespace-pre-wrap'>
            {post.body}
          </div>
        )}

        <div className='text-muted-foreground mt-auto flex flex-wrap items-center justify-between gap-2 text-xs'>
          <span>
            {post.postedByName ? `${post.postedByName} · ` : ''}
            {formatPublished(post.publishedAt)}
          </span>
          {post.acknowledgedRequired && (
            <div>
              {post.acknowledgedByCurrentUser ? (
                <span className='inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400'>
                  <IconCheck className='h-3 w-3' aria-hidden />
                  Acknowledged
                </span>
              ) : (
                <Button
                  type='button'
                  size='sm'
                  variant='default'
                  onClick={() => onAcknowledge?.(post)}
                  className='h-7 px-2 text-xs'
                >
                  Acknowledge
                </Button>
              )}
              {post.scope === 'safety_alert' && post.ackCount > 0 && (
                <span className='ml-2 tabular-nums'>
                  {post.ackCount} ack{post.ackCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

// Created and developed by Jai Singh
