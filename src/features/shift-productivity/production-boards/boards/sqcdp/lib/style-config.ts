// Created and developed by Jai Singh
/**
 * Per-field font / size / weight / transform / align / letter-spacing /
 * color overrides for the SQCDP card. Also carries a top-level `header`
 * sub-config controlling the colored category band (height, alignment,
 * whether the icon renders).
 *
 * The v12 editor lets curators pick a typography profile per text field
 * (Title / Subtitle / Primary value). The merged values (defaults +
 * per-field override) are translated into a fixed set of Tailwind utility
 * classes via the static maps below.
 *
 * v14 (2026-05-17) — added the "fine-grained controls" pass:
 *   - Per-field `align` (left / center / right) + `letterSpacing`
 *     (tight / normal / wide).
 *   - Per-field `color` — a free-form hex string applied via inline
 *     `style={{ color }}` (NOT a Tailwind class). Curator-controlled text
 *     color doesn't lend itself to a fixed enum like size does, so we
 *     skip the static-class-map treatment for this one dimension and
 *     fall back to inline style. The Card renderer threads `color` out
 *     of `fieldClasses` and passes it through `style` separately.
 *   - Top-level `header` sub-config: `{ height: 'compact'|'normal'|'tall',
 *     align: 'left'|'center', showIcon: boolean }`. Default preserves the
 *     v11.3 colored-header recipe unchanged.
 *
 * Why static maps and not dynamic strings? Tailwind v4 JIT scans source
 * files for class literals; a `text-${size}` template wouldn't be picked
 * up by the build. Listing every utility in `SIZE_CLASS` / `WEIGHT_CLASS`
 * / etc keeps them all visible to the JIT and keeps the generated CSS
 * deterministic.
 *
 * Storage stays JSON in `sqcdp_metrics.style_config` (migration 300).
 * `parseStyleConfig` defensively strips unknown keys so a forward-compat
 * payload from a newer client doesn't crash an older render.
 *
 * Pure functions — exercised by `style-config.test.ts`.
 */
import { cn } from '@/lib/utils'

export type FontFamily = 'sans' | 'serif' | 'mono'
export type FontSize =
  | 'xs'
  | 'sm'
  | 'base'
  | 'lg'
  | 'xl'
  | '2xl'
  | '3xl'
  | '4xl'
  | '5xl'
  | '6xl'
  | '7xl'
  | '8xl'
  | '9xl'
export type FontWeight = 'normal' | 'medium' | 'semibold' | 'bold' | 'black'
export type TextTransform = 'none' | 'uppercase' | 'capitalize' | 'lowercase'
export type TextAlign = 'left' | 'center' | 'right'
export type LetterSpacing = 'tight' | 'normal' | 'wide'

export interface FieldStyle {
  font?: FontFamily
  size?: FontSize
  weight?: FontWeight
  transform?: TextTransform
  align?: TextAlign
  letterSpacing?: LetterSpacing
  /**
   * Free-form hex color string (e.g. `#22C55E`). Applied via inline
   * `style={{ color }}` rather than a Tailwind class — see file header.
   * The renderer reads this via `fieldColor(style, defaults)` and threads
   * it onto the rendered span's `style` prop.
   */
  color?: string
  /**
   * v16 — precise font size in points. When set, this wins over `size`
   * (the Tailwind tier enum) and is applied via inline `font-size: Npt`.
   * Storage is a plain number; the renderer clamps to [4, 300] pt at
   * paint time so a bad value can't break the card surface.
   *
   * Why points and not pixels? Curators speak Office/Figma units. Points
   * also stay consistent across DPRs (1 pt = 1.333 px on a standard
   * display, but the browser handles the unit conversion natively).
   *
   * The TV measured-fit hook gates on `style.size || style.sizePt` —
   * pinning either disables the uniform-scale pass for that card.
   */
  sizePt?: number
  /**
   * v16 — line-height multiplier (e.g. 1.0 = leading-none, 1.5 = 1.5x).
   * Applied inline so it composes with custom sizes correctly. Optional;
   * defaults to the density token's leading.
   */
  lineHeight?: number
  /** v16 — italic toggle, applied inline. */
  italic?: boolean
  /** v16 — underline toggle, applied inline. */
  underline?: boolean
}

export type HeaderHeight = 'compact' | 'normal' | 'tall'
export type HeaderAlign = 'left' | 'center'

export interface HeaderConfig {
  height?: HeaderHeight
  align?: HeaderAlign
  showIcon?: boolean
}

export interface StyleConfig {
  title?: FieldStyle
  subtitle?: FieldStyle
  primary?: FieldStyle
  /** v14 — top-level header band sub-config. */
  header?: HeaderConfig
}

/**
 * Default per-field typography. Matches the v11.3 colored-header recipe:
 *  - Title  → 2xl bold uppercase white (the colored header strip)
 *  - Subtitle → small muted body line under the big number
 *  - Primary value → 7xl black tabular-nums tracking-tight
 *
 * `color: undefined` everywhere — the card renderer falls back to its
 * density-token color (white for title in the colored band, accent for
 * primary value, muted-foreground for subtitle) when no override is
 * present.
 */
export const DEFAULT_STYLES: Required<Omit<StyleConfig, 'header'>> &
  Record<'title' | 'subtitle' | 'primary', Required<FieldStyle>> = {
  title: {
    font: 'sans',
    size: '2xl',
    weight: 'bold',
    transform: 'uppercase',
    align: 'left',
    letterSpacing: 'tight',
    color: '',
    sizePt: 0,
    lineHeight: 0,
    italic: false,
    underline: false,
  },
  subtitle: {
    font: 'sans',
    size: 'sm',
    weight: 'normal',
    transform: 'none',
    align: 'left',
    letterSpacing: 'normal',
    color: '',
    sizePt: 0,
    lineHeight: 0,
    italic: false,
    underline: false,
  },
  primary: {
    font: 'sans',
    size: '7xl',
    weight: 'black',
    transform: 'none',
    align: 'left',
    letterSpacing: 'tight',
    color: '',
    sizePt: 0,
    lineHeight: 0,
    italic: false,
    underline: false,
  },
}

export const DEFAULT_HEADER: Required<HeaderConfig> = {
  height: 'normal',
  align: 'left',
  showIcon: true,
}

export const FONT_FAMILY_CLASS: Record<FontFamily, string> = {
  sans: 'font-sans',
  serif: 'font-serif',
  mono: 'font-mono',
}

export const SIZE_CLASS: Record<FontSize, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl',
  '3xl': 'text-3xl',
  '4xl': 'text-4xl',
  '5xl': 'text-5xl',
  '6xl': 'text-6xl',
  '7xl': 'text-7xl',
  '8xl': 'text-8xl',
  '9xl': 'text-9xl',
}

/**
 * Curator-facing display labels for the size picker. Tailwind's tier names
 * (`xs` / `2xl` / `9xl`) are abstract — Office, Photoshop, Figma all speak
 * points, so the editor renders concrete point values (e.g. "12 pt") and
 * the user keeps thinking in the units they already know.
 *
 * Mapping comes from Tailwind v4's default `text-*` utilities (px) divided
 * by 1.333 (1 pt = 1.333 px), rounded to whole points for cleanliness.
 * Storage stays the enum string — only the picker label changes.
 */
export const SIZE_POINTS: Record<FontSize, number> = {
  xs: 9,
  sm: 11,
  base: 12,
  lg: 14,
  xl: 15,
  '2xl': 18,
  '3xl': 23,
  '4xl': 27,
  '5xl': 36,
  '6xl': 45,
  '7xl': 54,
  '8xl': 72,
  '9xl': 96,
}

export function formatSizePoints(size: FontSize): string {
  return `${SIZE_POINTS[size]} pt`
}

export const WEIGHT_CLASS: Record<FontWeight, string> = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
  black: 'font-black',
}

export const TRANSFORM_CLASS: Record<TextTransform, string> = {
  none: '',
  uppercase: 'uppercase',
  capitalize: 'capitalize',
  lowercase: 'lowercase',
}

export const ALIGN_CLASS: Record<TextAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

export const LETTER_SPACING_CLASS: Record<LetterSpacing, string> = {
  tight: 'tracking-tight',
  normal: 'tracking-normal',
  wide: 'tracking-wide',
}

/**
 * Per-density padding/justify recipes for the colored category header
 * band. Both densities follow the same `compact / normal / tall` ladder
 * — TV adds proportionally more vertical breathing room so the band
 * still reads as substantial at 4K resolutions.
 *
 * Kept as four-cell records (density × height) so each combination is a
 * literal class string the JIT can see.
 */
export const HEADER_HEIGHT_CLASS: Record<
  'normal' | 'tv',
  Record<HeaderHeight, string>
> = {
  normal: {
    compact: 'py-2',
    normal: 'py-3.5',
    tall: 'py-5',
  },
  tv: {
    compact: 'py-3',
    normal: 'py-5',
    tall: 'py-7',
  },
}

export const HEADER_ALIGN_CLASS: Record<HeaderAlign, string> = {
  left: 'justify-between',
  center: 'justify-center',
}

/**
 * Per-field size whitelists for the editor's Size <Select>. Keeps the
 * picker scoped to sensible options for each field role — Title doesn't
 * need `text-9xl`, Primary doesn't need `text-xs`.
 */
export const SIZE_OPTIONS: Record<
  'title' | 'subtitle' | 'primary',
  FontSize[]
> = {
  title: ['xl', '2xl', '3xl'],
  subtitle: ['xs', 'sm', 'base', 'lg'],
  primary: ['5xl', '6xl', '7xl', '8xl', '9xl'],
}

const HEX_COLOR_REGEX = /^#[0-9A-F]{6}$/i

/**
 * Render the merged classes for a configurable text field. Defaults always
 * win when an override key is missing — callers should pass the matching
 * `DEFAULT_STYLES.<field>` so the merge is deterministic.
 *
 * The `color`, `sizePt`, `lineHeight`, `italic`, and `underline` dimensions
 * are NOT included here — they're rendered as inline CSS via
 * `fieldInlineStyle(style, defaults)`. The Tailwind SIZE_CLASS is omitted
 * when `sizePt` is set so the inline `font-size: Npt` is the single source
 * of truth (avoids a `text-5xl` class fighting the inline override).
 *
 * Empty `transform: 'none'` resolves to the empty string (no class added),
 * which is the same behavior as omitting the prop.
 */
export function fieldClasses(
  style: FieldStyle | undefined,
  defaults: Required<FieldStyle>
): string {
  const sizePt = clampPt(style?.sizePt)
  const merged = {
    font: style?.font ?? defaults.font,
    size: style?.size ?? defaults.size,
    weight: style?.weight ?? defaults.weight,
    transform: style?.transform ?? defaults.transform,
    align: style?.align ?? defaults.align,
    letterSpacing: style?.letterSpacing ?? defaults.letterSpacing,
  }
  return cn(
    FONT_FAMILY_CLASS[merged.font],
    // Custom pt wins over the tier enum — skip the Tailwind class so the
    // inline style isn't competing with a `text-7xl` declaration.
    sizePt == null ? SIZE_CLASS[merged.size] : undefined,
    WEIGHT_CLASS[merged.weight],
    TRANSFORM_CLASS[merged.transform] || undefined,
    ALIGN_CLASS[merged.align],
    LETTER_SPACING_CLASS[merged.letterSpacing]
  )
}

/**
 * Resolve the per-field text color (a 6-digit uppercase hex string) or
 * `undefined` to inherit. Invalid / empty / partial hex values fall back
 * to `undefined` so a half-typed override doesn't paint the field with a
 * bogus color while the curator is mid-type.
 */
export function fieldColor(
  style: FieldStyle | undefined,
  defaults: Required<FieldStyle>
): string | undefined {
  const raw = style?.color ?? defaults.color
  if (!raw) return undefined
  return HEX_COLOR_REGEX.test(raw) ? raw : undefined
}

/**
 * Minimum / maximum allowed point size for the curator's pt override.
 * 4 pt is below body-copy legibility; 300 pt is large enough for any
 * worst-case TV hero. The bounds keep the inline `font-size` value safe
 * for the renderer and bound the editor's slider range.
 */
export const SIZE_PT_MIN = 4
export const SIZE_PT_MAX = 300

/**
 * Coerce an arbitrary `sizePt` input into the canonical "set or unset"
 * representation. Zero, NaN, negatives, and out-of-bounds values all
 * collapse to `null` so the renderer falls back to the tier enum. Whole
 * points only — fractional pt input is rounded to keep the editor's
 * stored values readable.
 */
export function clampPt(input: number | null | undefined): number | null {
  if (input === null || input === undefined) return null
  if (!Number.isFinite(input)) return null
  const rounded = Math.round(input)
  if (rounded < SIZE_PT_MIN) return null
  if (rounded > SIZE_PT_MAX) return SIZE_PT_MAX
  return rounded
}

/**
 * Inline CSS overrides for a configurable text field. Carries the
 * dimensions that can't be expressed cleanly as static Tailwind utilities:
 * pt-precise font size, line-height multiplier, italic / underline, and
 * color. The renderer merges this on top of (or sets in place of) the
 * density-token style so curator-controlled overrides win.
 *
 * The `color` dimension is also surfaced via `fieldColor()` for callers
 * that need it standalone (e.g. composing with a category accent fallback).
 * `fieldInlineStyle()` always includes the color so callers can spread the
 * result directly onto the rendered element's `style` prop without an
 * extra `fieldColor` step.
 *
 * `lineHeight` is emitted as a unitless multiplier — Tailwind's `leading-*`
 * utilities are all unitless multipliers too, so this stays consistent.
 */
export function fieldInlineStyle(
  style: FieldStyle | undefined,
  defaults: Required<FieldStyle>
): import('react').CSSProperties {
  const out: import('react').CSSProperties = {}
  const sizePt = clampPt(style?.sizePt)
  if (sizePt !== null) out.fontSize = `${sizePt}pt`
  const lineHeight = style?.lineHeight
  if (typeof lineHeight === 'number' && Number.isFinite(lineHeight)) {
    const rounded = Math.round(lineHeight * 100) / 100
    if (rounded >= 0.5 && rounded <= 3) out.lineHeight = rounded
  }
  if (style?.italic) out.fontStyle = 'italic'
  if (style?.underline) out.textDecoration = 'underline'
  const color = fieldColor(style, defaults)
  if (color) out.color = color
  return out
}

/**
 * Convenience predicate — returns true when the curator has pinned EITHER
 * the tier enum OR a precise pt size. The TV measured-fit hook uses this
 * to decide whether to opt the card out of uniform scaling.
 */
export function isSizePinned(style: FieldStyle | undefined): boolean {
  if (!style) return false
  return !!style.size || clampPt(style.sizePt) !== null
}

/**
 * Header band padding class for a given density + resolved header
 * config. Justify alignment is handled separately by the card renderer
 * because center-alignment has to coexist with the right-anchored
 * "edit" pencil affordance — left alignment uses `justify-between` and
 * center alignment lifts the title group into a `flex-1 justify-center`
 * pane while the pencil stays in the right slot.
 *
 * Falls back to defaults silently when any sub-key is missing.
 */
export function headerClasses(
  config: HeaderConfig | undefined,
  density: 'normal' | 'tv'
): string {
  const height = config?.height ?? DEFAULT_HEADER.height
  return HEADER_HEIGHT_CLASS[density][height]
}

/**
 * Justify-utility for the OUTER header flex row given the curator's
 * alignment choice. The edit pencil always lives in the right slot, so
 * left alignment uses `justify-between` (icon+title left, pencil right)
 * and center alignment also uses `justify-between` — the inner title
 * group then expands to `flex-1` + `justify-center` via
 * `headerGroupClasses` below, which centers the content while leaving
 * the pencil unaffected.
 */
export function headerOuterClasses(_config: HeaderConfig | undefined): string {
  return 'justify-between'
}

/**
 * Inner title-group classes — when `align: 'center'` the title group
 * grows to fill the remaining row and centers its own contents, so the
 * icon + title visually land in the middle of the band even while the
 * pencil affordance stays anchored to the right slot.
 */
export function headerGroupClasses(config: HeaderConfig | undefined): string {
  const align = config?.align ?? DEFAULT_HEADER.align
  return align === 'center' ? 'flex-1 justify-center text-center' : ''
}

/**
 * Type-narrow + sanitize an arbitrary JSON value into a StyleConfig.
 * Used by `mapRow` so a malformed payload from the DB doesn't crash the
 * card renderer; unrecognized field keys / enum values are dropped.
 */
export function parseStyleConfig(raw: unknown): StyleConfig {
  if (!raw || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  const result: StyleConfig = {}
  for (const key of ['title', 'subtitle', 'primary'] as const) {
    const v = obj[key]
    if (!v || typeof v !== 'object') continue
    const f = v as Record<string, unknown>
    const field: FieldStyle = {}
    if (typeof f.font === 'string' && f.font in FONT_FAMILY_CLASS) {
      field.font = f.font as FontFamily
    }
    if (typeof f.size === 'string' && f.size in SIZE_CLASS) {
      field.size = f.size as FontSize
    }
    if (typeof f.weight === 'string' && f.weight in WEIGHT_CLASS) {
      field.weight = f.weight as FontWeight
    }
    if (typeof f.transform === 'string' && f.transform in TRANSFORM_CLASS) {
      field.transform = f.transform as TextTransform
    }
    if (typeof f.align === 'string' && f.align in ALIGN_CLASS) {
      field.align = f.align as TextAlign
    }
    if (
      typeof f.letterSpacing === 'string' &&
      f.letterSpacing in LETTER_SPACING_CLASS
    ) {
      field.letterSpacing = f.letterSpacing as LetterSpacing
    }
    if (typeof f.color === 'string' && HEX_COLOR_REGEX.test(f.color)) {
      field.color = f.color.toUpperCase()
    }
    if (typeof f.sizePt === 'number') {
      const clamped = clampPt(f.sizePt)
      if (clamped !== null) field.sizePt = clamped
    }
    if (
      typeof f.lineHeight === 'number' &&
      Number.isFinite(f.lineHeight) &&
      f.lineHeight >= 0.5 &&
      f.lineHeight <= 3
    ) {
      field.lineHeight = Math.round(f.lineHeight * 100) / 100
    }
    if (typeof f.italic === 'boolean') field.italic = f.italic
    if (typeof f.underline === 'boolean') field.underline = f.underline
    if (Object.keys(field).length > 0) result[key] = field
  }
  if (obj.header && typeof obj.header === 'object') {
    const h = obj.header as Record<string, unknown>
    const header: HeaderConfig = {}
    if (
      typeof h.height === 'string' &&
      h.height in HEADER_HEIGHT_CLASS.normal
    ) {
      header.height = h.height as HeaderHeight
    }
    if (typeof h.align === 'string' && h.align in HEADER_ALIGN_CLASS) {
      header.align = h.align as HeaderAlign
    }
    if (typeof h.showIcon === 'boolean') header.showIcon = h.showIcon
    if (Object.keys(header).length > 0) result.header = header
  }
  return result
}

// Created and developed by Jai Singh
