/**
 * Color Conversion Utilities
 *
 * Provides functions to convert between color formats while maintaining
 * perceptual uniformity through the OKLCH color space.
 *
 * OKLCH (Oklab with Lightness, Chroma, Hue) provides perceptually uniform colors,
 * meaning equal numeric changes result in equal perceived color differences.
 *
 * @see https://oklch.com/ - OKLCH Color Space Documentation
 * @see https://culorjs.org/ - Culori Color Library
 */
import { formatCss, oklch, parseHex, type Oklch } from 'culori'
import { logger } from '@/lib/utils/logger'

/**
 * Converts a hex color string to OKLCH format suitable for CSS variables.
 *
 * @param hex - Hex color string (with or without #)
 * @returns OKLCH color string in CSS format: "oklch(l c h)"
 *
 * @example
 * hexToOklch('#3b82f6') // Returns: "oklch(0.6269 0.1707 254.604)"
 * hexToOklch('ffffff')  // Returns: "oklch(1 0 0)"
 */
export function hexToOklch(hex: string): string {
  try {
    // Normalize hex input (remove # if present)
    const normalizedHex = hex.startsWith('#') ? hex : `#${hex}`

    // Validate hex format
    if (
      !/^#[0-9A-Fa-f]{6}$/.test(normalizedHex) &&
      !/^#[0-9A-Fa-f]{3}$/.test(normalizedHex)
    ) {
      logger.warn(`Invalid hex color: ${hex}, using fallback black`)
      return 'oklch(0 0 0)' // Fallback to black in OKLCH
    }

    // Parse hex to color object
    const parsedColor = parseHex(normalizedHex)

    if (!parsedColor) {
      logger.warn(`Failed to parse hex color: ${hex}, using fallback black`)
      return 'oklch(0 0 0)'
    }

    // Convert to OKLCH
    const oklchColor = oklch(parsedColor) as Oklch

    if (!oklchColor) {
      logger.warn(`Failed to convert ${hex} to OKLCH, using fallback black`)
      return 'oklch(0 0 0)'
    }

    // Format for CSS (culori handles the oklch() syntax)
    const cssString = formatCss(oklchColor)

    return cssString
  } catch (error) {
    logger.error(`Error converting hex to OKLCH: ${hex}`, error)
    return 'oklch(0 0 0)' // Fallback to black
  }
}

/**
 * Validates and normalizes a hex color string.
 *
 * @param hex - Hex color string to validate
 * @returns Normalized hex string with # prefix, or null if invalid
 *
 * @example
 * validateHex('#3b82f6')  // Returns: "#3b82f6"
 * validateHex('3b82f6')   // Returns: "#3b82f6"
 * validateHex('invalid')  // Returns: null
 */
export function validateHex(hex: string): string | null {
  // Remove # if present
  const normalized = hex.replace('#', '')

  // Check for valid 3 or 6 character hex
  if (/^[0-9A-Fa-f]{3}$/.test(normalized)) {
    // Expand 3-char hex to 6-char
    const expanded = normalized
      .split('')
      .map((char) => char + char)
      .join('')
    return `#${expanded.toLowerCase()}`
  }

  if (/^[0-9A-Fa-f]{6}$/.test(normalized)) {
    return `#${normalized.toLowerCase()}`
  }

  return null
}

/**
 * Converts multiple hex colors to OKLCH format.
 *
 * @param colors - Object with color keys and hex values
 * @returns Object with same keys and OKLCH values
 *
 * @example
 * hexColorsToOklch({
 *   primary: '#3b82f6',
 *   background: '#ffffff'
 * })
 * // Returns:
 * // {
 * //   primary: "oklch(0.6269 0.1707 254.604)",
 * //   background: "oklch(1 0 0)"
 * // }
 */
export function hexColorsToOklch<T extends Record<string, string>>(
  colors: T
): Record<keyof T, string> {
  const result = {} as Record<keyof T, string>

  for (const [key, value] of Object.entries(colors)) {
    result[key as keyof T] = hexToOklch(value)
  }

  return result
}

/**
 * Gets the perceived lightness of a hex color (0-1 scale).
 * Useful for determining if text should be light or dark.
 *
 * @param hex - Hex color string
 * @returns Lightness value from 0 (black) to 1 (white)
 *
 * @example
 * getPerceivedLightness('#ffffff') // Returns: 1
 * getPerceivedLightness('#000000') // Returns: 0
 * getPerceivedLightness('#3b82f6') // Returns: ~0.627
 */
export function getPerceivedLightness(hex: string): number {
  try {
    const normalizedHex = hex.startsWith('#') ? hex : `#${hex}`
    const parsedColor = parseHex(normalizedHex)

    if (!parsedColor) {
      return 0.5 // Return middle value for invalid colors
    }

    const oklchColor = oklch(parsedColor) as Oklch

    return oklchColor.l ?? 0.5
  } catch (error) {
    logger.error(`Error getting lightness for ${hex}:`, error)
    return 0.5
  }
}

/**
 * Determines if a color should use light or dark text for accessibility.
 *
 * @param hex - Background hex color
 * @param threshold - Lightness threshold (default: 0.5)
 * @returns 'light' if light text should be used, 'dark' otherwise
 *
 * @example
 * shouldUseLightText('#000000') // Returns: 'light'
 * shouldUseLightText('#ffffff') // Returns: 'dark'
 */
export function shouldUseLightText(
  hex: string,
  threshold: number = 0.5
): 'light' | 'dark' {
  const lightness = getPerceivedLightness(hex)
  return lightness < threshold ? 'light' : 'dark'
}

/**
 * Computes the WCAG 2.1 contrast ratio between two hex colors.
 * Uses sRGB relative luminance per the W3C algorithm.
 *
 * @returns Contrast ratio from 1 (no contrast) to 21 (max contrast)
 */
export function getWCAGContrastRatio(hex1: string, hex2: string): number {
  const l1 = getRelativeLuminance(hex1)
  const l2 = getRelativeLuminance(hex2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Checks if a color pair meets WCAG AA or AAA standards.
 *
 * AA normal text: >= 4.5:1
 * AA large text: >= 3:1
 * AAA normal text: >= 7:1
 */
export function getWCAGLevel(
  hex1: string,
  hex2: string
): 'AAA' | 'AA' | 'AA-large' | 'fail' {
  const ratio = getWCAGContrastRatio(hex1, hex2)
  if (ratio >= 7) return 'AAA'
  if (ratio >= 4.5) return 'AA'
  if (ratio >= 3) return 'AA-large'
  return 'fail'
}

function getRelativeLuminance(hex: string): number {
  const normalized = hex.startsWith('#') ? hex : `#${hex}`
  const match = normalized.match(
    /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
  )
  if (!match) return 0

  const [r, g, b] = [match[1], match[2], match[3]].map((c) => {
    const srgb = parseInt(c, 16) / 255
    return srgb <= 0.04045
      ? srgb / 12.92
      : Math.pow((srgb + 0.055) / 1.055, 2.4)
  })

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
