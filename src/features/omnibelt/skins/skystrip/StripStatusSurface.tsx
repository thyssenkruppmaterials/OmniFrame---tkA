// Created and developed by Jai Singh
/**
 * OmniBelt — Sky Strip status surface (P7)
 *
 * Small status display rendered inside the collapsed `<OmniBeltSkyStrip>`
 * pill when there's an active background job. Mockup #3 shows the
 * strip as "Importing LX03 — 67%"; this component mirrors that
 * compact summary.
 *
 * Source: `useOmnibeltStore(s => s.activeJobs)`. The job feed is
 * populated in P5 by `useOmnibeltJobs` (not yet shipped). Until
 * that lands, the array is always empty and the surface renders
 * nothing — by design, so the strip stays at its resting size.
 *
 * Visual contract:
 * - Picks the most-recent job (last in array) so the strip
 *   doesn't oscillate between multiple jobs every render.
 * - Truncates the label aggressively (`max-w-32`, `truncate`) so
 *   the strip width stays at STRIP_WIDTH (200 px) regardless of
 *   job-label length.
 * - Renders a thin progress bar under the label so the user gets
 *   completion-at-a-glance without reading the percent.
 */
import { useOmnibeltStore } from '../../store/omnibeltStore'

export function StripStatusSurface() {
  const activeJobs = useOmnibeltStore((s) => s.activeJobs)
  // Most-recent job wins so the strip doesn't flicker between
  // simultaneous jobs on every render.
  const job = activeJobs.length > 0 ? activeJobs[activeJobs.length - 1] : null

  if (!job) return null

  const percent = Math.max(0, Math.min(100, Math.round(job.progress * 100)))

  return (
    <span
      data-testid='omnibelt-skystrip-status'
      className='flex min-w-0 items-center gap-2'
    >
      <span className='max-w-32 truncate'>
        {job.label} — {percent}%
      </span>
      <span
        aria-hidden='true'
        className='inline-block h-1 w-10 overflow-hidden rounded-full bg-neutral-800'
      >
        <span
          className='block h-full rounded-full bg-teal-400 transition-[width] duration-300'
          style={{ width: `${percent}%` }}
        />
      </span>
    </span>
  )
}

// Created and developed by Jai Singh
