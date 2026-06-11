// Created and developed by Jai Singh
/**
 * OmniBelt — HaloRings (P5)
 *
 * Renders one concentric SVG arc per active background job around
 * the host (orb / pill). Each arc:
 *
 *   - stroke colour comes from `--omnibelt-job-<type>` (defined in
 *     `src/index.css` and light/dark-mode aware)
 *   - `pathLength={progress * 100}` encodes 0..100% progress on a
 *     normalized 100-unit path so SVG `stroke-dasharray` math is
 *     simple and stable
 *   - rotated -90° at the SVG level so 0% sits at 12 o'clock
 *   - animated via framer-motion's `motion.circle` with the house
 *     spring, so progress catches up smoothly without re-rendering
 *     the parent
 *   - has a `<title>` element for accessibility ("Importing LX03 — 42%")
 *
 * Multiple jobs stack outward with a 2 px gap between rings.
 * Renders nothing when `activeJobs` is empty so the parent isn't
 * forced to conditionally mount us.
 *
 * Sized by the consumer via `width` / `height` / `padding`. The
 * Pill skin renders us inside a `pointer-events: none` overlay so
 * we never steal drag events; the click-to-toggle behaviour is
 * the consumer's responsibility (see `OmniBeltPill`).
 */
import { motion } from 'framer-motion'
import { HOUSE_SPRING } from '../lib/motion'
import type { ActiveJob, ActiveJobType } from '../store/omnibeltStore'

export type HaloRingsProps = {
  activeJobs: ActiveJob[]
  /** Outer SVG width (px). Should match the host's bounding box. */
  width: number
  /** Outer SVG height (px). */
  height: number
  /** Inner padding between the largest ring and the SVG edge. The
   *  outermost ring is drawn at (min(width,height)/2 - padding -
   *  strokeWidth/2). Default = 2 px. */
  padding?: number
  /** Stroke width per ring (px). Default = 2.5 px. */
  strokeWidth?: number
  /** Gap between concentric rings (px). Default = 2 px. */
  ringGap?: number
  /** Disable the spring animation entirely (e.g. for the user's
   *  reduced-motion preference). The consumer should also pass
   *  this through from `useOmnibeltPosition().reducedMotion` so
   *  the halo follows the same motion contract as the pill. */
  reducedMotion?: boolean
  /** Optional className applied to the wrapping `<svg>` so the
   *  parent can tune positioning (e.g. `absolute inset-0`). */
  className?: string
  /** When provided, clicks on the painted ring strokes invoke this
   *  handler. The empty interior of the SVG (which overlays the
   *  host body) stays click-through via `pointer-events: stroke`,
   *  so the host's drag / chevron / pin affordances aren't shadowed.
   *  Without `onClick`, the entire SVG is `pointer-events: none`. */
  onClick?: (e: React.MouseEvent<SVGSVGElement>) => void
}

const STROKE_VAR_BY_TYPE: Record<ActiveJobType, string> = {
  sap_import: 'var(--omnibelt-job-sap_import)',
  sap_export: 'var(--omnibelt-job-sap_export)',
  agent_job: 'var(--omnibelt-job-agent_job)',
  report: 'var(--omnibelt-job-report)',
  scheduled: 'var(--omnibelt-job-scheduled)',
  other: 'var(--omnibelt-job-other)',
}

export function HaloRings({
  activeJobs,
  width,
  height,
  padding = 2,
  strokeWidth = 2.5,
  ringGap = 2,
  reducedMotion = false,
  className,
  onClick,
}: HaloRingsProps) {
  if (!activeJobs.length) return null
  if (width <= 0 || height <= 0) return null

  const cx = width / 2
  const cy = height / 2
  const outerRadius = Math.min(width, height) / 2 - padding - strokeWidth / 2

  // Stack rings inward — first job gets the outermost ring.
  const rings = activeJobs.map((job, i) => {
    const r = outerRadius - i * (strokeWidth + ringGap)
    return { job, r, idx: i }
  })

  // Skip rings that have collapsed to a non-positive radius (too
  // many jobs for the host size) — the tray surfaces them
  // textually anyway.
  const visible = rings.filter((entry) => entry.r > strokeWidth)

  // `pointer-events: stroke` on the circle elements means only the
  // painted ring stroke receives clicks — the interior (where the
  // host's drag handle / pin / chevron live) stays click-through.
  // Without `onClick`, the entire SVG is fully transparent to
  // pointer events.
  const interactive = Boolean(onClick)

  return (
    <svg
      data-testid='omnibelt-halo'
      data-interactive={interactive ? 'true' : 'false'}
      role={interactive ? 'button' : 'presentation'}
      aria-label={interactive ? 'Toggle background jobs tray' : undefined}
      aria-hidden={interactive ? undefined : 'false'}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      onClick={onClick}
      style={{
        // -90° rotation so 0% sits at 12 o'clock. SVG transform is
        // applied at the element level so the arc keyframes stay
        // simple — no extra transform multiplication on the circle.
        transform: 'rotate(-90deg)',
        pointerEvents: interactive ? 'auto' : 'none',
        cursor: interactive ? 'pointer' : 'default',
      }}
    >
      {visible.map(({ job, r }) => {
        const clamped = Math.max(0, Math.min(1, job.progress))
        // We use `pathLength={100}` (a virtual normalised path
        // length) so `strokeDasharray` math is independent of
        // actual circumference. Consumers / tests assert against
        // pathLength, not against the rendered dasharray length.
        const pathLength = 100
        // Render an open arc by tracing only `clamped*100` of the
        // 100-unit path. The trailing 0% segment is drawn as
        // transparent via the dasharray.
        const dashArray = `${clamped * 100} 100`
        return (
          <motion.circle
            key={job.id}
            data-testid={`omnibelt-halo-ring-${job.id}`}
            data-job-type={job.type}
            cx={cx}
            cy={cy}
            r={r}
            fill='none'
            stroke={STROKE_VAR_BY_TYPE[job.type]}
            strokeWidth={strokeWidth}
            strokeLinecap='round'
            pathLength={pathLength}
            strokeDasharray={dashArray}
            // Animate the dasharray's filled portion as a string
            // — framer interpolates the leading number while the
            // trailing 100 stays constant.
            animate={{ strokeDasharray: dashArray }}
            initial={{ strokeDasharray: dashArray }}
            transition={reducedMotion ? { duration: 0 } : HOUSE_SPRING}
            // Stroke-only hit-testing keeps the empty interior
            // click-through even when the SVG is interactive.
            style={interactive ? { pointerEvents: 'stroke' } : undefined}
          >
            <title>{`${job.label} — ${Math.round(clamped * 100)}%`}</title>
          </motion.circle>
        )
      })}
    </svg>
  )
}

export default HaloRings

// Created and developed by Jai Singh
