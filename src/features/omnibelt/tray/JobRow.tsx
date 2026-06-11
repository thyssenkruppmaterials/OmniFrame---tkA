// Created and developed by Jai Singh
/**
 * OmniBelt — JobRow (P5)
 *
 * Single row inside the `<OmniBeltStatusTray>`. Renders:
 *
 *   - a colored type pill (matches the halo ring colour)
 *   - the job's label (truncates with ellipsis on overflow)
 *   - an inline progress bar at the same hue
 *   - a percent label
 *   - an optional cancel button when `job.cancelable === true`
 *   - a small ETA hint when we have enough info to derive one
 *
 * Pure presentational — receives the cancel handler from the
 * parent so the tray can centralize error handling / toasts.
 */
import { IconX } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import type { ActiveJob, ActiveJobType } from '../store/omnibeltStore'

export type JobRowProps = {
  job: ActiveJob
  /** Optional cancel callback; only rendered when `job.cancelable`. */
  onCancel?: (id: string) => void
}

const TYPE_LABEL: Record<ActiveJobType, string> = {
  sap_import: 'SAP import',
  sap_export: 'SAP export',
  agent_job: 'Agent job',
  report: 'Report',
  scheduled: 'Scheduled',
  other: 'Job',
}

const COLOR_VAR_BY_TYPE: Record<ActiveJobType, string> = {
  sap_import: 'var(--omnibelt-job-sap_import)',
  sap_export: 'var(--omnibelt-job-sap_export)',
  agent_job: 'var(--omnibelt-job-agent_job)',
  report: 'var(--omnibelt-job-report)',
  scheduled: 'var(--omnibelt-job-scheduled)',
  other: 'var(--omnibelt-job-other)',
}

/** Linear-ETA estimator: assume constant progress slope from the
 *  first observed datum. Returns `null` when we don't have enough
 *  signal (progress hasn't moved off the queued floor, or we're
 *  past 99%). Cheap by design — this is a hint, not a forecast. */
function deriveEta(job: ActiveJob, now: number): string | null {
  const elapsed = now - job.startedAt
  if (elapsed < 1500) return null
  if (job.progress <= 0.05 || job.progress >= 0.99) return null
  const totalEstimateMs = elapsed / job.progress
  const remainingMs = Math.max(0, totalEstimateMs - elapsed)
  if (remainingMs < 1000) return '<1s'
  if (remainingMs < 60_000) return `~${Math.round(remainingMs / 1000)}s`
  if (remainingMs < 3_600_000) return `~${Math.round(remainingMs / 60_000)}m`
  return `~${Math.round(remainingMs / 3_600_000)}h`
}

export function JobRow({ job, onCancel }: JobRowProps) {
  const clamped = Math.max(0, Math.min(1, job.progress))
  const percent = Math.round(clamped * 100)
  const color = COLOR_VAR_BY_TYPE[job.type]
  const eta = deriveEta(job, Date.now())

  return (
    <div
      data-testid={`omnibelt-job-row-${job.id}`}
      data-job-type={job.type}
      className='flex items-center gap-2 rounded-md px-2 py-1.5'
    >
      <span
        aria-hidden
        className='inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-white uppercase shadow-sm'
        style={{ backgroundColor: color }}
      >
        {TYPE_LABEL[job.type]}
      </span>

      <div className='min-w-0 flex-1'>
        <div className='flex items-baseline justify-between gap-2'>
          <span className='text-foreground truncate text-xs font-medium'>
            {job.label}
          </span>
          <span className='text-muted-foreground inline-flex shrink-0 items-baseline gap-1 text-[11px] tabular-nums'>
            {eta && <span aria-label='estimated time remaining'>{eta}</span>}
            <span data-testid={`omnibelt-job-percent-${job.id}`}>
              {percent}%
            </span>
          </span>
        </div>
        <div
          role='progressbar'
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${job.label} progress`}
          className='bg-muted/60 mt-1 h-1 overflow-hidden rounded-full'
        >
          <div
            data-testid={`omnibelt-job-bar-${job.id}`}
            className='h-full rounded-full transition-[width] duration-300 ease-out'
            style={{ width: `${percent}%`, backgroundColor: color }}
          />
        </div>
      </div>

      {job.cancelable && onCancel && (
        <button
          type='button'
          data-testid={`omnibelt-job-cancel-${job.id}`}
          onClick={() => onCancel(job.id)}
          aria-label={`Cancel ${job.label}`}
          className={cn(
            'text-muted-foreground hover:text-foreground hover:bg-accent/40 inline-flex size-5 shrink-0 items-center justify-center rounded-sm transition-colors',
            'focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:outline-none'
          )}
        >
          <IconX className='size-3' />
        </button>
      )}
    </div>
  )
}

export default JobRow

// Created and developed by Jai Singh
