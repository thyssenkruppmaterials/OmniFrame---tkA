// Created and developed by Jai Singh
/**
 * Live preview pane for the post composer. Renders a simplified card-shape
 * resembling the production board's PostCard / JobCard so the curator can
 * see roughly how the post will look before publishing.
 *
 * This is intentionally NOT a wrapper around the real PostCard / JobCard
 * because the preview pane needs to:
 *   - render without `useCanEditBoards` / `useBoardEditMode` (they pull
 *     auth context that's already inside the composer)
 *   - omit the per-card pencil
 *   - render attachments from `supabase.storage.getPublicUrl(path)` (the
 *     real cards consume a flat `imageUrl` column)
 *
 * If a future slice promotes the real PostCard to take a `previewMode`
 * prop that hides edit chrome, we can swap this out — but today the
 * preview-card duplication is the lighter call.
 */
import {
  IconBriefcase,
  IconCheck,
  IconFileText,
  IconLink,
  IconMail,
  IconPin,
  IconShieldExclamation,
  IconSpeakerphone,
  IconUsersGroup,
} from '@tabler/icons-react'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  KIND_LABEL,
  describeActiveWindow,
  deriveStatus,
  type Attachment,
  type ComposerValues,
  type HrNewsKindData,
  type JobKindData,
  type SafetyAlertKindData,
} from './composer-types'

const SEVERITY_ACCENT: Record<string, string> = {
  info: '#0ea5e9',
  success: '#16a34a',
  warning: '#f59e0b',
  danger: '#dc2626',
}

const SEVERITY_BADGE: Record<string, string> = {
  info: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/25',
  success:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
  warning:
    'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25',
  danger: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/25',
}

const KIND_ICON = {
  announcement: IconSpeakerphone,
  hr_news: IconUsersGroup,
  job: IconBriefcase,
  safety_alert: IconShieldExclamation,
}

interface ComposerPreviewProps {
  values: ComposerValues
}

function publicUrlFor(attachment: Attachment): string {
  return supabase.storage
    .from('production-board-images')
    .getPublicUrl(attachment.storage_path).data.publicUrl
}

function formatPayRange(kindData: JobKindData): string | null {
  const { pay_min, pay_max, pay_currency, pay_period } = kindData
  if (pay_min === undefined && pay_max === undefined) return null
  const fmt = (n: number): string =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: pay_currency || 'USD',
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    }).format(n)
  const min = pay_min !== undefined ? fmt(pay_min) : null
  const max = pay_max !== undefined ? fmt(pay_max) : null
  const range = min && max ? `${min}–${max}` : (min ?? max ?? '')
  const periodLabel = pay_period
    ? { hour: '/hr', week: '/wk', month: '/mo', year: '/yr' }[pay_period]
    : ''
  return `${range}${periodLabel}`
}

export function ComposerPreview({ values }: ComposerPreviewProps) {
  const Icon = KIND_ICON[values.kind]
  const accent =
    values.accentHex || SEVERITY_ACCENT[values.severity] || SEVERITY_ACCENT.info
  const status = deriveStatus(values)
  const window = describeActiveWindow(values)

  const images = values.attachments.filter((a) =>
    a.mime_type.startsWith('image/')
  )
  const docs = values.attachments.filter(
    (a) => !a.mime_type.startsWith('image/')
  )

  return (
    <article
      className='border-border/60 bg-card relative isolate flex flex-col overflow-hidden rounded-2xl border'
      data-testid='composer-preview-card'
    >
      <div
        aria-hidden
        className='absolute inset-y-0 left-0 w-1'
        style={{ backgroundColor: accent }}
      />
      {images.length > 0 && (
        <div className='border-border/60 border-b'>
          <img
            src={publicUrlFor(images[0])}
            alt={images[0].caption || images[0].file_name}
            className='h-36 w-full object-cover'
          />
        </div>
      )}

      <div className='flex flex-col gap-3 p-4 pl-5'>
        <div className='flex flex-wrap items-center gap-1.5'>
          <Badge
            variant='outline'
            className={cn(
              'gap-1 text-xs capitalize',
              SEVERITY_BADGE[values.severity] ?? SEVERITY_BADGE.info
            )}
          >
            <Icon className='h-3 w-3' aria-hidden />
            {KIND_LABEL[values.kind].singular}
          </Badge>
          <Badge variant='outline' className={cn('text-xs', status.badgeClass)}>
            {status.label}
          </Badge>
          {values.priority === 'pinned' && (
            <Badge
              variant='outline'
              className='gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
            >
              <IconPin className='h-3 w-3' aria-hidden /> Pinned
            </Badge>
          )}
          {values.priority === 'high' && (
            <Badge
              variant='outline'
              className='border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400'
            >
              High priority
            </Badge>
          )}
        </div>

        <h3 className='text-lg leading-tight font-semibold tracking-tight'>
          {values.title || 'Untitled post'}
        </h3>

        {values.kind === 'hr_news' && (
          <HrNewsByline kindData={values.kindData as HrNewsKindData} />
        )}

        {values.body && (
          <p className='text-foreground/90 line-clamp-4 text-sm whitespace-pre-wrap'>
            {values.body}
          </p>
        )}

        {values.kind === 'job' && (
          <JobMeta values={values} kindData={values.kindData as JobKindData} />
        )}

        {values.kind === 'safety_alert' && (
          <SafetyMeta kindData={values.kindData as SafetyAlertKindData} />
        )}

        {docs.length > 0 && (
          <ul className='flex flex-col gap-1 text-xs'>
            {docs.map((d) => (
              <li
                key={d.id}
                className='border-border/40 bg-muted/30 flex items-center gap-2 rounded-md border px-2 py-1'
              >
                <IconFileText
                  className='text-muted-foreground h-3.5 w-3.5'
                  aria-hidden
                />
                <span className='truncate'>{d.caption || d.file_name}</span>
              </li>
            ))}
          </ul>
        )}

        <div className='text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs'>
          <span>{window}</span>
          {values.acknowledgmentRequired && (
            <span className='inline-flex items-center gap-1'>
              <IconCheck className='h-3 w-3' aria-hidden /> Ack required
              {values.repromptIntervalMinutes
                ? ` · reprompt ${values.repromptIntervalMinutes}m`
                : ''}
            </span>
          )}
        </div>
      </div>
    </article>
  )
}

function HrNewsByline({ kindData }: { kindData: HrNewsKindData }) {
  if (!kindData.author_name && !kindData.category) return null
  return (
    <div className='flex flex-wrap items-center gap-2 text-xs'>
      {kindData.author_name && (
        <span className='text-muted-foreground'>
          By <span className='text-foreground/90'>{kindData.author_name}</span>
        </span>
      )}
      {kindData.category && (
        <Badge variant='outline' className='text-xs capitalize'>
          {kindData.category}
        </Badge>
      )}
    </div>
  )
}

function JobMeta({
  values,
  kindData,
}: {
  values: ComposerValues
  kindData: JobKindData
}) {
  const pay = formatPayRange(kindData)
  return (
    <div className='flex flex-col gap-1.5 text-xs'>
      <div className='flex flex-wrap gap-1.5'>
        {values.jobDepartment && (
          <Badge variant='outline' className='text-xs'>
            {values.jobDepartment}
          </Badge>
        )}
        {kindData.employment_type && (
          <Badge variant='outline' className='text-xs capitalize'>
            {kindData.employment_type.replace('_', ' ')}
          </Badge>
        )}
        <Badge variant='outline' className='text-xs'>
          {values.jobIsInternal ? 'Internal' : 'External'}
        </Badge>
        {pay && (
          <Badge
            variant='outline'
            className='border-emerald-500/25 bg-emerald-500/10 text-xs text-emerald-700 dark:text-emerald-400'
          >
            {pay}
          </Badge>
        )}
      </div>
      <div className='flex flex-wrap gap-2'>
        {values.jobApplyUrl && (
          <span className='text-muted-foreground inline-flex items-center gap-1'>
            <IconLink className='h-3 w-3' aria-hidden /> Apply link set
          </span>
        )}
        {values.jobApplyEmail && (
          <span className='text-muted-foreground inline-flex items-center gap-1'>
            <IconMail className='h-3 w-3' aria-hidden /> {values.jobApplyEmail}
          </span>
        )}
      </div>
    </div>
  )
}

function SafetyMeta({ kindData }: { kindData: SafetyAlertKindData }) {
  if (
    !kindData.hazard_type &&
    !kindData.corrective_action &&
    !(kindData.affected_area_ids && kindData.affected_area_ids.length)
  ) {
    return null
  }
  return (
    <div className='flex flex-col gap-1 text-xs'>
      {kindData.hazard_type && (
        <Badge
          variant='outline'
          className='self-start border-red-500/25 bg-red-500/10 text-xs text-red-700 capitalize dark:text-red-400'
        >
          {kindData.hazard_type.replace('_', ' ')}
        </Badge>
      )}
      {kindData.corrective_action && (
        <p className='text-muted-foreground line-clamp-2'>
          <span className='text-foreground/90 font-medium'>Action:</span>{' '}
          {kindData.corrective_action}
        </p>
      )}
      {kindData.affected_area_ids && kindData.affected_area_ids.length > 0 && (
        <p className='text-muted-foreground'>
          Affects {kindData.affected_area_ids.length} area
          {kindData.affected_area_ids.length === 1 ? '' : 's'}
        </p>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
