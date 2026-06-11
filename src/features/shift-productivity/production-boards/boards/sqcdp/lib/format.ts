// Created and developed by Jai Singh
/**
 * Pure value-format renderers for SQCDP cards. Each takes a numeric value
 * (or string for `text`) plus an optional unit / locale and produces a
 * compact display string suitable for the big primary number on a card.
 */

export type ValueFormat =
  | 'number'
  | 'percent'
  | 'currency'
  | 'duration'
  | 'text'

const NUMBER_LOCALE = 'en-US'
const CURRENCY_LOCALE = 'en-US'

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${new Intl.NumberFormat(NUMBER_LOCALE, {
    maximumFractionDigits: 1,
  }).format(value)}%`
}

export function formatCurrency(
  value: number | null | undefined,
  currency = 'USD'
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat(CURRENCY_LOCALE, {
    style: 'currency',
    currency,
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value)
}

/**
 * Human-readable duration. Inputs are minutes (the canonical unit for the
 * spec's `duration` value-format). Examples:
 *   45 → "45m"
 *   90 → "1h 30m"
 *   1440 → "24h"
 *   90.5 → "1h 31m"  (rounded)
 */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) {
    return '—'
  }
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return `${total}m`
  const hrs = Math.floor(total / 60)
  const mins = total % 60
  if (mins === 0) return `${hrs}h`
  return `${hrs}h ${mins}m`
}

export function formatText(value: string | null | undefined): string {
  if (!value) return '—'
  return value
}

/**
 * Single dispatch helper used by the card renderer.
 */
export function formatValue(
  format: ValueFormat,
  value: number | string | null | undefined,
  unit?: string | null
): string {
  switch (format) {
    case 'number': {
      const out = formatNumber(typeof value === 'number' ? value : null)
      return unit && out !== '—' ? `${out} ${unit}` : out
    }
    case 'percent':
      return formatPercent(typeof value === 'number' ? value : null)
    case 'currency':
      return formatCurrency(
        typeof value === 'number' ? value : null,
        unit ?? 'USD'
      )
    case 'duration':
      return formatDuration(typeof value === 'number' ? value : null)
    case 'text':
      return formatText(typeof value === 'string' ? value : null)
  }
}

/**
 * v12 format options supported by the editor:
 *  - `prefix`         — `$` / `~` / `>` etc, prepended to the formatted value
 *  - `suffix`         — ` ppm` / ` units` / ` k`, appended after the value
 *  - `decimal_places` — explicit override of the formatter's max/min fraction
 *                       digits when the value is numeric. Range 0–4. Null =
 *                       use each format's default (1 frac for number /
 *                       percent, 0 / 2 for currency depending on magnitude,
 *                       etc.).
 *
 * Returns the same em-dash sentinel as `formatValue` when the value is
 * null / undefined / NaN — prefix and suffix are NOT applied to em-dashes
 * so empty cards don't read as `$—`.
 */
export interface FormatOptions {
  prefix?: string | null
  suffix?: string | null
  decimal_places?: number | null
}

export function formatValueWithOptions(
  format: ValueFormat,
  value: number | string | null | undefined,
  unit?: string | null,
  options?: FormatOptions
): string {
  const { prefix, suffix, decimal_places } = options ?? {}
  // Decimal-places override only makes sense for numeric formats — drop
  // through to the default `formatValue` for `text`, and let the dispatch
  // handle `duration` / `currency` natively (overriding fraction digits
  // there would muddy hours-minutes / locale-dependent currency rendering).
  if (
    decimal_places != null &&
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (format === 'number' || format === 'percent')
  ) {
    const formatted = new Intl.NumberFormat('en-US', {
      maximumFractionDigits: decimal_places,
      minimumFractionDigits: decimal_places,
    }).format(value)
    const withSuffix = format === 'percent' ? `${formatted}%` : formatted
    const withUnit =
      format === 'number' && unit ? `${withSuffix} ${unit}` : withSuffix
    return `${prefix ?? ''}${withUnit}${suffix ?? ''}`
  }

  const formatted = formatValue(format, value, unit)
  if (formatted === '—') return formatted
  if (!prefix && !suffix) return formatted
  return `${prefix ?? ''}${formatted}${suffix ?? ''}`
}

// Created and developed by Jai Singh
