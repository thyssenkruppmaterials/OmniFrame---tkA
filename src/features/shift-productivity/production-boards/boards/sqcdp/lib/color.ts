// Created and developed by Jai Singh
/**
 * Color helpers scoped to the SQCDP board.
 *
 * `hexToRgba(hex, alpha)` is the public surface — used by `<SqcdpChart>` for
 * the area-fill linear gradient stops and the target-reference-line opacity.
 * Invalid input falls back to opaque black `rgba(0, 0, 0, alpha)` rather than
 * throwing, because the only callers thread untrusted `metric.color_hex`
 * values from the DB through this helper and a transient bad write
 * shouldn't crash the whole card.
 *
 * The Hourly board has a richer rgba helper in `boards/hourly/lib/area-color.ts`
 * scoped to its 8-key palette; this one is the lightweight version that
 * accepts arbitrary user-provided hex strings.
 */

export function hexToRgba(hex: string, alpha: number): string {
  const a = clamp01(alpha)
  const parsed = parseHex(hex)
  const { r, g, b } = parsed ?? { r: 0, g: 0, b: 0 }
  return `rgba(${r}, ${g}, ${b}, ${formatAlpha(a)})`
}

function parseHex(input: string): { r: number; g: number; b: number } | null {
  if (typeof input !== 'string') return null
  const cleaned = (input.startsWith('#') ? input.slice(1) : input).trim()
  if (cleaned.length === 3) {
    const r = parseInt(cleaned[0] + cleaned[0], 16)
    const g = parseInt(cleaned[1] + cleaned[1], 16)
    const b = parseInt(cleaned[2] + cleaned[2], 16)
    if ([r, g, b].some((n) => Number.isNaN(n))) return null
    return { r, g, b }
  }
  if (cleaned.length === 6) {
    const r = parseInt(cleaned.slice(0, 2), 16)
    const g = parseInt(cleaned.slice(2, 4), 16)
    const b = parseInt(cleaned.slice(4, 6), 16)
    if ([r, g, b].some((n) => Number.isNaN(n))) return null
    return { r, g, b }
  }
  return null
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function formatAlpha(a: number): string {
  const s = a.toFixed(3)
  return s.replace(/\.?0+$/, '') || '0'
}

// Created and developed by Jai Singh
