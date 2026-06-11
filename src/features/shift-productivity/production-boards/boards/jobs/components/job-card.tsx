// Created and developed by Jai Singh
import {
  IconBriefcase,
  IconExternalLink,
  IconMail,
  IconPencil,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useBoardEditMode } from '../../../hooks/use-board-edit-mode'
import { useCanEditBoards } from '../../../hooks/use-can-edit-boards'
import type { JobPostingRow } from '../hooks/use-job-postings'

interface JobCardProps {
  job: JobPostingRow
  onEdit?: (job: JobPostingRow) => void
}

const SHADOW = [
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_1px_2px_0_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(15,23,42,0.18)]',
  'dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_2px_4px_0_rgba(0,0,0,0.5),0_24px_48px_-12px_rgba(0,0,0,0.55)]',
].join(' ')

function closingChip(closesAt: string | null): {
  label: string
  tone: 'sky' | 'amber' | 'red' | 'muted'
} | null {
  if (!closesAt) return null
  const d = new Date(closesAt)
  if (Number.isNaN(d.getTime())) return null
  const days = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (days < 0) return { label: 'Closed', tone: 'muted' }
  if (days === 0) return { label: 'Closes today', tone: 'red' }
  if (days <= 7) return { label: `Closes in ${days}d`, tone: 'amber' }
  return { label: `Closes in ${days}d`, tone: 'sky' }
}

const TONE_CLASS: Record<'sky' | 'amber' | 'red' | 'muted', string> = {
  sky: 'border-sky-500/25 bg-sky-500/15 text-sky-700 dark:text-sky-400',
  amber:
    'border-amber-500/25 bg-amber-500/15 text-amber-700 dark:text-amber-400',
  red: 'border-red-500/25 bg-red-500/15 text-red-700 dark:text-red-400',
  muted: 'border-border/50 bg-muted text-muted-foreground',
}

export function JobCard({ job, onEdit }: JobCardProps) {
  const { canEdit } = useCanEditBoards()
  const [editMode] = useBoardEditMode()
  const showEditAffordances = canEdit && editMode

  const accent = job.colorHex ?? '#0ea5e9'
  const closing = closingChip(job.closesAt)

  return (
    <article
      className={cn(
        'group border-border/60 bg-card relative isolate flex flex-col gap-3 overflow-hidden rounded-2xl border p-5',
        'bg-linear-to-b from-white/4 via-transparent to-transparent',
        SHADOW,
        'transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'motion-safe:hover:-translate-y-0.5'
      )}
    >
      <div
        aria-hidden
        className='absolute inset-x-0 top-0 h-1'
        style={{ backgroundColor: accent }}
      />

      <div className='flex items-start justify-between gap-2 pt-2'>
        <div className='flex items-center gap-2'>
          <IconBriefcase
            className='h-4 w-4'
            style={{ color: accent }}
            aria-hidden
          />
          <span
            className='text-xs font-semibold tracking-wider uppercase'
            style={{ color: accent }}
          >
            {job.department ?? 'Open Role'}
          </span>
        </div>
        {showEditAffordances && (
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100'
            onClick={() => onEdit?.(job)}
            aria-label={`Edit ${job.title}`}
          >
            <IconPencil className='h-4 w-4' aria-hidden />
          </Button>
        )}
      </div>

      <h3 className='text-lg leading-tight font-semibold tracking-tight'>
        {job.title}
      </h3>

      <div className='flex flex-wrap gap-1.5'>
        {job.workingAreaName && (
          <Badge variant='outline' className='border-border/50 text-xs'>
            {job.workingAreaName}
          </Badge>
        )}
        {job.branchName && (
          <Badge variant='outline' className='border-border/50 text-xs'>
            {job.branchName}
          </Badge>
        )}
        <Badge variant='outline' className='border-border/50 text-xs'>
          {job.isInternal ? 'Internal' : 'External'}
        </Badge>
        {closing && (
          <Badge
            variant='outline'
            className={cn('text-xs', TONE_CLASS[closing.tone])}
          >
            {closing.label}
          </Badge>
        )}
      </div>

      {job.description && (
        <p className='text-foreground/90 line-clamp-3 text-sm whitespace-pre-wrap'>
          {job.description}
        </p>
      )}

      <div className='mt-auto flex flex-wrap items-center gap-2 pt-2'>
        {job.applyUrl && (
          <Button
            type='button'
            asChild
            size='sm'
            variant='outline'
            className='gap-1 text-xs'
          >
            <a href={job.applyUrl} target='_blank' rel='noopener noreferrer'>
              Apply <IconExternalLink className='h-3 w-3' aria-hidden />
            </a>
          </Button>
        )}
        {job.applyEmail && (
          <Button
            type='button'
            asChild
            size='sm'
            variant='outline'
            className='gap-1 text-xs'
          >
            <a href={`mailto:${job.applyEmail}`}>
              <IconMail className='h-3 w-3' aria-hidden /> {job.applyEmail}
            </a>
          </Button>
        )}
      </div>
    </article>
  )
}

// Created and developed by Jai Singh
