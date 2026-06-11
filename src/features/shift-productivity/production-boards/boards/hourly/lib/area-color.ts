// Created and developed by Jai Singh
/**
 * Hex / rgba helpers for area-derived accent colours.
 *
 * Reuses the deterministic `deriveAreaColor()` hash from `./skills` so the
 * cinematic per-area transition (v8) lights up with the SAME accent that
 * already paints the associate ID-card avatar gradient, primary pill, and
 * active-row outline. One area_code → one colour, everywhere.
 *
 * The Tailwind palette table in `./skills` is class-string based (so the
 * JIT picks up the literals); for inline SVG / `style={{}}` work we need
 * raw hex / rgba. We pin the canonical Tailwind 500-band hex per key
 * here so the chapter overlay's radial-glow `var(--accent-glow)` matches
 * the bg-{color}-500 utility class to the eye.
 */
import { AREA_COLOR_KEYS, deriveAreaColor } from './skills'
import type { AreaColorKey } from './skills'

/**
 * Tailwind v3/v4 palette-500 hex per area-color key.
 * Source: https://tailwindcss.com/docs/customizing-colors (May 2026).
 *
 * If you change a key in `AREA_COLOR_KEYS`, mirror the change here — both
 * tables drive the same 8-bucket palette and must stay in lock-step.
 */
export const AREA_COLOR_HEX: Record<AreaColorKey, string> = {
  emerald: '#10b981',
  sky: '#0ea5e9',
  amber: '#f59e0b',
  violet: '#8b5cf6',
  rose: '#f43f5e',
  cyan: '#06b6d4',
  lime: '#84cc16',
  fuchsia: '#d946ef',
}

/**
 * Neutral fallback hex for empty / undefined / unknown area_codes. Picks
 * Tailwind slate-500 — matches the `bg-muted/...` neutral chrome used
 * for off-shift cells and the All-Areas tab.
 */
export const NEUTRAL_FALLBACK_HEX = '#64748b'

/**
 * Canonical hex for an area_code's accent colour. Deterministic (same
 * input → same output) and stable across renders / sessions.
 *
 * Empty / null / undefined input returns `NEUTRAL_FALLBACK_HEX` so
 * the chapter overlay still has a sensible accent during the All-Areas
 * tick of the rotation.
 */
export function accentHexFor(areaCode: string | null | undefined): string {
  if (!areaCode) return NEUTRAL_FALLBACK_HEX
  const key = deriveAreaColor(areaCode)
  return AREA_COLOR_HEX[key]
}

/**
 * Same accent but as an `rgba(r, g, b, a)` string clamped to `[0, 1]`.
 * Used for the radial-glow CSS variable `--accent-glow` in the chapter
 * overlay so the glow softens with the requested alpha (light-mode 0.18,
 * dark-mode 0.25 per the v8 spec).
 *
 * If `areaCode` is empty/undefined the neutral slate is used.
 */
export function accentRgbaFor(
  areaCode: string | null | undefined,
  alpha: number
): string {
  const hex = accentHexFor(areaCode)
  const a = clamp01(alpha)
  const { r, g, b } = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${formatAlpha(a)})`
}

/**
 * Direct key → hex (for callers that already hold an `AreaColorKey`,
 * e.g. the ID-card row that stores the resolved key on `AssociateRow`).
 */
export function accentHexForKey(key: AreaColorKey): string {
  return AREA_COLOR_HEX[key]
}

/* -------------------------------------------------------------------- */
/* internals                                                            */
/* -------------------------------------------------------------------- */

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  // Accept #rgb / #rrggbb (no alpha — alpha is the runtime arg).
  const cleaned = hex.startsWith('#') ? hex.slice(1) : hex
  if (cleaned.length === 3) {
    const r = parseInt(cleaned[0] + cleaned[0], 16)
    const g = parseInt(cleaned[1] + cleaned[1], 16)
    const b = parseInt(cleaned[2] + cleaned[2], 16)
    return { r, g, b }
  }
  const r = parseInt(cleaned.slice(0, 2), 16)
  const g = parseInt(cleaned.slice(2, 4), 16)
  const b = parseInt(cleaned.slice(4, 6), 16)
  return { r, g, b }
}

function formatAlpha(a: number): string {
  // Trim trailing zeros for readability, but keep at least 1 digit.
  const s = a.toFixed(3)
  return s.replace(/\.?0+$/, '') || '0'
}

/** Re-exported for symmetry — callers can sanity-check the palette. */
export { AREA_COLOR_KEYS }

// Created and developed by Jai Singh
