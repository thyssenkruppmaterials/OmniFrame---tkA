// Created and developed by Jai Singh
/**
 * Pure helpers + tokens shared across the five card variants.
 *
 * Split from `card-shared.tsx` so the components file can stay free
 * of non-component exports (silences `react-refresh/only-export-components`).
 */
import { cn } from '@/lib/utils'
import type { JobPostingRow } from '../../../boards/jobs/hooks/use-job-postings'
import type { PostRow, PostSeverity } from '../../../hooks/use-board-posts'
import type { BentoPostKind } from '../card-variant'

export interface SharedCardProps {
  postKind: BentoPostKind
  post: PostRow | JobPostingRow
  isTv: boolean
  /** Curator edit affordances (pencil hover, drag handles in parent). */
  showEditAffordances: boolean
  onEdit?: () => void
  onAcknowledge?: () => void
  /** True for cards rendered as drag overlays / previews — disables pencils. */
  disableInteractions?: boolean
}

export const SEVERITY_BORDER: Record<PostSeverity, string> = {
  info: '#0ea5e9',
  success: '#16a34a',
  warning: '#f59e0b',
  danger: '#dc2626',
}

export const SEVERITY_BADGE: Record<PostSeverity, string> = {
  info: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/25',
  success:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
  warning:
    'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25',
  danger: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/25',
}

/**
 * Three-stop shadow recipe from [[Patterns/Elevated-KPI-Stat-Cards]]:
 * inset top-edge highlight + tight 1–2 px ambient + wide soft drop.
 *
 * The bento cards extend the recipe with a 4th *kind-tinted* ambient
 * shadow when the variant is `banner` or `spotlight` (see `cardShellWithGlow`).
 */
export const CARD_SHADOW = [
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_1px_2px_0_rgba(0,0,0,0.06),0_12px_32px_-12px_rgba(15,23,42,0.18)]',
  'dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_2px_4px_0_rgba(0,0,0,0.5),0_24px_56px_-16px_rgba(0,0,0,0.6)]',
].join(' ')

/** Hover-state shadow — slightly deeper than resting. */
export const CARD_SHADOW_HOVER = [
  'motion-safe:hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_2px_4px_0_rgba(0,0,0,0.08),0_24px_56px_-16px_rgba(15,23,42,0.28)]',
  'motion-safe:dark:hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_4px_8px_0_rgba(0,0,0,0.6),0_36px_80px_-20px_rgba(0,0,0,0.7)]',
].join(' ')

/**
 * Tracking + leading tokens for the editorial typographic system.
 * Reused by every variant so the rhythm reads as a single voice.
 */
export const TYPE_TOKENS = {
  eyebrow:
    'font-mono text-[10px] uppercase tracking-[0.24em] font-semibold leading-tight',
  eyebrowTv:
    'font-mono text-xs uppercase tracking-[0.32em] font-semibold leading-tight',
  headline: 'font-semibold leading-[1.08] tracking-[-0.022em]',
  display:
    'font-semibold leading-[1.02] tracking-[-0.028em] [font-family:var(--font-geist),Inter,system-ui]',
  bodyTight: 'leading-[1.55] tracking-[-0.005em]',
  meta: 'text-[11px] leading-tight tabular-nums',
  metaTv: 'text-sm leading-tight tabular-nums',
} as const

export function formatPublished(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function publishedAtOf(card: SharedCardProps): string {
  return card.postKind === 'job'
    ? (card.post as JobPostingRow).postedAt
    : (card.post as PostRow).publishedAt
}

export function severityOf(card: SharedCardProps): PostSeverity {
  if (card.postKind === 'job') return 'info'
  return (card.post as PostRow).severity
}

export function accentColorOf(card: SharedCardProps): string {
  return (
    (card.post as PostRow | JobPostingRow).colorHex ??
    SEVERITY_BORDER[severityOf(card)]
  )
}

export function postedByNameOf(card: SharedCardProps): string | null {
  return card.post.postedByName ?? null
}

export function workingAreaNameOf(card: SharedCardProps): string | null {
  return (card.post as PostRow | JobPostingRow).workingAreaName ?? null
}

export function branchNameOf(card: SharedCardProps): string | null {
  return (card.post as PostRow | JobPostingRow).branchName ?? null
}

export function isPostKind(card: SharedCardProps): card is SharedCardProps & {
  post: PostRow
} {
  return card.postKind === 'post'
}

export function isJobKind(card: SharedCardProps): card is SharedCardProps & {
  post: JobPostingRow
} {
  return card.postKind === 'job'
}

/**
 * Canonical card shell — every variant builds on top.
 *
 * Layered visual stack (bottom→top, in CSS painter order):
 *   1. Border + `bg-card` surface, rounded-2xl with `overflow-hidden isolate`.
 *   2. Top-light gradient — `bg-linear-to-b from-white/4 via-transparent to-transparent`.
 *   3. Inset 1 px highlight via `CARD_SHADOW` (catches light "from above").
 *   4. Three-stop shadow stack (rests subtle, deepens on hover).
 *   5. Hover lift `-translate-y-0.5` + accent glow span (per-variant).
 *
 * Mount-in animation: every card stages in via fade + slide-up + scale-
 * from-0.985. The stagger is owned by the BentoGrid (it sets the
 * `animationDelay` per tile so the cascade looks intentional).
 */
export function cardShell({
  isTv,
  className,
}: {
  isTv: boolean
  className?: string
}): string {
  return cn(
    'group border-border/60 bg-card relative isolate flex h-full w-full flex-col overflow-hidden rounded-2xl border',
    'bg-linear-to-b from-white/[0.05] via-transparent to-transparent',
    'transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
    'motion-safe:hover:-translate-y-0.5',
    CARD_SHADOW,
    CARD_SHADOW_HOVER,
    'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:zoom-in-[0.985] motion-safe:duration-500 motion-safe:fill-mode-backwards',
    isTv ? 'text-base' : 'text-sm',
    className
  )
}

// Created and developed by Jai Singh
