// Created and developed by Jai Singh
/**
 * Shared types + defaults for the four-board bento-grid layout system.
 *
 * The bento grid lives on top of `production_board_card_layouts`
 * (migration 307). Every visible post or job on the four secondary
 * boards (Announcements, HR News, Jobs, Safety Alerts) is mapped to a
 * `BoardCard` — either with a persisted layout row, or with the
 * default placement / variant returned by `defaultLayoutFor(post, idx)`.
 *
 * Co-located with the variants because they share the same vocabulary
 * (variant ids, default sizes per variant, breakpoint column counts).
 */
import type { JobPostingRow } from '../../boards/jobs/hooks/use-job-postings'
import type { PostRow } from '../../hooks/use-board-posts'

export type BentoBoardKind = 'announcement' | 'hr_news' | 'job' | 'safety_alert'

export type BentoPostKind = 'post' | 'job'

export type CardVariant =
  | 'classic'
  | 'banner'
  | 'gallery'
  | 'spotlight'
  | 'quote'

export const CARD_VARIANTS: readonly CardVariant[] = [
  'classic',
  'banner',
  'gallery',
  'spotlight',
  'quote',
] as const

export interface BannerVariantConfig {
  cover_position?: 'top' | 'center' | 'bottom'
}

export interface GalleryVariantConfig {
  rotate_interval_seconds?: number
}

export type VariantConfig =
  | BannerVariantConfig
  | GalleryVariantConfig
  | Record<string, never>

/**
 * One row of `production_board_card_layouts` in TypeScript shape.
 * The hook lowercases / snake-cases the wire keys here so consumers
 * speak in one vocabulary.
 */
export interface CardLayoutRow {
  id: string
  organizationId: string
  boardKind: BentoBoardKind
  scope: string
  postId: string
  postKind: BentoPostKind
  gridX: number
  gridY: number
  gridW: number
  gridH: number
  cardVariant: CardVariant
  variantConfig: VariantConfig
  createdAt: string
  updatedAt: string
}

/** A post / job + its (persisted-or-default) layout, ready to render. */
export interface BoardCard {
  layoutId: string | null
  postKind: BentoPostKind
  post: PostRow | JobPostingRow
  gridX: number
  gridY: number
  gridW: number
  gridH: number
  cardVariant: CardVariant
  variantConfig: VariantConfig
  /** True when the row is purely synthetic (no persisted layout row exists yet). */
  isDefaultLayout: boolean
}

/**
 * Default cell footprint per variant. These are the cell sizes a card
 * lands at when (a) a curator picks the variant in the composer and
 * the existing layout row's `grid_w/h` would be too small, OR (b)
 * the post has no persisted layout row yet.
 *
 * Heights are in "cells" — at the canonical 12-col TV viewport with
 * `auto-rows-fr` + `gap-4`, one cell is roughly 70–80 px on a 13"
 * laptop and ~110–130 px on a 1080p TV.
 */
export const VARIANT_DEFAULT_SIZE: Record<
  CardVariant,
  { w: number; h: number }
> = {
  classic: { w: 3, h: 2 },
  banner: { w: 12, h: 3 },
  gallery: { w: 6, h: 4 },
  spotlight: { w: 6, h: 3 },
  quote: { w: 6, h: 2 },
} as const

export const VARIANT_LABEL: Record<CardVariant, string> = {
  classic: 'Classic',
  banner: 'Banner',
  gallery: 'Gallery',
  spotlight: 'Spotlight',
  quote: 'Quote',
}

export const VARIANT_DESCRIPTION: Record<CardVariant, string> = {
  classic: 'Compact summary card with accent stripe. Best for most posts.',
  banner: 'Full-width hero with optional cover image. Loud and unmissable.',
  gallery: 'Rotates through 2+ attachments. Great for photo updates.',
  spotlight: 'Single-attribute hero — severity + ack badge or pull-stat.',
  quote: 'Large pull-quote card. Reads from across the room.',
}

/**
 * Breakpoint → column count for the bento grid. Mirrors Tailwind's
 * stock `sm` / `md` / `lg` breakpoints (640 / 768 / 1024 px) plus the
 * 1280 px `xl` cutoff at which we go to the full 12-column layout.
 *
 * The grid uses `auto-rows-[minmax(72px,auto)]` so cell heights match
 * `gridH * 72 + gap*((gridH-1))` roughly — see `<BentoGrid>`.
 */
export const BENTO_BREAKPOINTS = {
  base: { cols: 1, label: 'mobile' },
  sm: { cols: 2, label: 'tablet' },
  md: { cols: 6, label: 'desktop' },
  lg: { cols: 12, label: 'wide' },
} as const

export type BentoBreakpoint = keyof typeof BENTO_BREAKPOINTS

/** Maximum cell-width for a given variant. Banners + galleries can */
/** occupy the entire row; classic / quote / spotlight cap shorter to */
/** discourage curators from creating accidental full-width "banners". */
export const VARIANT_MAX_W: Record<CardVariant, number> = {
  classic: 6,
  banner: 12,
  gallery: 12,
  spotlight: 12,
  quote: 12,
}

export const VARIANT_MIN_W: Record<CardVariant, number> = {
  classic: 2,
  banner: 6,
  gallery: 3,
  spotlight: 3,
  quote: 3,
}

export const VARIANT_MIN_H: Record<CardVariant, number> = {
  classic: 2,
  banner: 2,
  gallery: 3,
  spotlight: 2,
  quote: 2,
}

export const VARIANT_MAX_H: Record<CardVariant, number> = {
  classic: 6,
  banner: 6,
  gallery: 8,
  spotlight: 6,
  quote: 6,
}

/** Allowable seconds-per-slide range for the gallery variant. */
export const GALLERY_MIN_INTERVAL_S = 3
export const GALLERY_MAX_INTERVAL_S = 30
export const GALLERY_DEFAULT_INTERVAL_S = 6

export function parseVariantConfig(
  variant: CardVariant,
  raw: unknown
): VariantConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const r = raw as Record<string, unknown>
  if (variant === 'banner') {
    const out: BannerVariantConfig = {}
    if (
      r.cover_position === 'top' ||
      r.cover_position === 'center' ||
      r.cover_position === 'bottom'
    ) {
      out.cover_position = r.cover_position
    }
    return out
  }
  if (variant === 'gallery') {
    const out: GalleryVariantConfig = {}
    const n = r.rotate_interval_seconds
    if (
      typeof n === 'number' &&
      Number.isFinite(n) &&
      n >= GALLERY_MIN_INTERVAL_S &&
      n <= GALLERY_MAX_INTERVAL_S
    ) {
      out.rotate_interval_seconds = Math.round(n)
    }
    return out
  }
  return {}
}

export function parseCardVariant(raw: unknown): CardVariant {
  if (
    raw === 'classic' ||
    raw === 'banner' ||
    raw === 'gallery' ||
    raw === 'spotlight' ||
    raw === 'quote'
  ) {
    return raw
  }
  return 'classic'
}

/** Clamp w/h to per-variant bounds. */
export function clampSizeForVariant(
  variant: CardVariant,
  w: number,
  h: number,
  totalCols: number
): { w: number; h: number } {
  const maxW = Math.min(VARIANT_MAX_W[variant], Math.max(1, totalCols))
  const minW = Math.min(VARIANT_MIN_W[variant], maxW)
  const cw = Math.max(minW, Math.min(maxW, Math.round(w) || minW))
  const ch = Math.max(
    VARIANT_MIN_H[variant],
    Math.min(VARIANT_MAX_H[variant], Math.round(h) || VARIANT_MIN_H[variant])
  )
  return { w: cw, h: ch }
}

// Created and developed by Jai Singh
