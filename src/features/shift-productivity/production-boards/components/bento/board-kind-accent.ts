// Created and developed by Jai Singh
/**
 * Per-board-kind accent vocabulary.
 *
 * Each of the four secondary boards (Announcements, HR News, Jobs,
 * Safety Alerts) gets its own signature accent gradient. The same
 * gradient is the source of the card's accent glow, eyebrow pill,
 * ambient backdrop tint, header chrome under the active tab, and the
 * board's empty-state illustration.
 *
 * One source of truth — same logic the area-color helper in
 * `boards/hourly/lib/area-color.ts` uses for per-area accents, just
 * keyed by board kind instead of working area code.
 *
 * Why HEX + RGBA pairs and not just Tailwind classes: the mesh
 * gradient + radial glows on the atmosphere layer need raw colour
 * values in inline `style` so the Tailwind v4 JIT doesn't have to
 * statically prove every gradient variant — and several of the
 * primitives (ambient shadow on banner / spotlight, glow on hover)
 * derive their colour from these at runtime.
 */
import type { BentoBoardKind } from './card-variant'

export interface BoardKindAccent {
  /** Sentence-case label used on the board header eyebrow. */
  readonly label: string
  /** Tailwind palette-500 hex for the first gradient stop. */
  readonly fromHex: string
  /** Tailwind palette-500 hex for the second gradient stop. */
  readonly toHex: string
  /** Mid-stop for three-stop gradients (header tab underline, mesh). */
  readonly midHex: string
  /** rgba string with `0.16` alpha — soft enough for atmospheric tint. */
  readonly glowSoft: string
  /** rgba string with `0.28` alpha — used for hover glow + banner ambient shadow. */
  readonly glowStrong: string
  /** Tailwind class pair for the eyebrow pill (kept opacity-token-shaped). */
  readonly eyebrowClass: string
  /** Tailwind class pair for the live-pulse colour. */
  readonly pulseClass: string
  /** Tailwind class string for the segmented tab's active underline glow. */
  readonly tabUnderlineClass: string
}

const palette: Record<BentoBoardKind, BoardKindAccent> = {
  announcement: {
    label: 'Announcements',
    fromHex: '#0EA5E9',
    midHex: '#6366F1',
    toHex: '#8B5CF6',
    glowSoft: 'rgba(99,102,241,0.16)',
    glowStrong: 'rgba(99,102,241,0.28)',
    eyebrowClass:
      'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300',
    pulseClass: 'bg-sky-500 dark:bg-sky-400',
    tabUnderlineClass:
      'from-sky-500/0 via-indigo-500/80 to-violet-500/0 dark:via-indigo-400/80',
  },
  hr_news: {
    label: 'HR News',
    fromHex: '#10B981',
    midHex: '#14B8A6',
    toHex: '#0EA5E9',
    glowSoft: 'rgba(20,184,166,0.16)',
    glowStrong: 'rgba(20,184,166,0.28)',
    eyebrowClass:
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300',
    pulseClass: 'bg-emerald-500 dark:bg-emerald-400',
    tabUnderlineClass:
      'from-emerald-500/0 via-teal-500/80 to-sky-500/0 dark:via-teal-400/80',
  },
  job: {
    label: 'Jobs',
    fromHex: '#F59E0B',
    midHex: '#FB923C',
    toHex: '#EC4899',
    glowSoft: 'rgba(251,146,60,0.16)',
    glowStrong: 'rgba(251,146,60,0.28)',
    eyebrowClass:
      'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300',
    pulseClass: 'bg-amber-500 dark:bg-amber-400',
    tabUnderlineClass:
      'from-amber-500/0 via-orange-500/80 to-pink-500/0 dark:via-orange-400/80',
  },
  safety_alert: {
    label: 'Safety Alerts',
    fromHex: '#F43F5E',
    midHex: '#EF4444',
    toHex: '#F97316',
    glowSoft: 'rgba(244,63,94,0.16)',
    glowStrong: 'rgba(244,63,94,0.32)',
    eyebrowClass:
      'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-300',
    pulseClass: 'bg-rose-500 dark:bg-rose-400',
    tabUnderlineClass:
      'from-rose-500/0 via-red-500/80 to-orange-500/0 dark:via-red-400/80',
  },
}

/**
 * Look up the accent vocabulary for a board kind. Returns the
 * Announcements palette as a defensive fallback if the kind is unknown
 * (e.g. a future board kind landing in the table before the palette
 * is extended).
 */
export function accentFor(kind: BentoBoardKind): BoardKindAccent {
  return palette[kind] ?? palette.announcement
}

/**
 * Returns a CSS `linear-gradient(...)` string for the kind's signature
 * gradient — used by the empty-state illustration, the banner ambient
 * glow, and the active-tab underline.
 */
export function gradientCss(kind: BentoBoardKind, angle: number = 135): string {
  const a = accentFor(kind)
  return `linear-gradient(${angle}deg, ${a.fromHex} 0%, ${a.midHex} 50%, ${a.toHex} 100%)`
}

/**
 * Returns a CSS conic-gradient (`from` / `at` shorthand) for the kind's
 * mesh atmosphere backdrop. Wider angle than the linear gradient so
 * the conic edges feel atmospheric rather than directional.
 */
export function meshConicCss(kind: BentoBoardKind): string {
  const a = accentFor(kind)
  return `conic-gradient(from 220deg at 70% 30%, ${a.fromHex} 0deg, ${a.midHex} 90deg, ${a.toHex} 180deg, ${a.fromHex} 270deg, ${a.midHex} 360deg)`
}

// Created and developed by Jai Singh
