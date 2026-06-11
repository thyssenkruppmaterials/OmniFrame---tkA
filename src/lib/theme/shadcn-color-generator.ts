// Created and developed by Jai Singh
/**
 * shadcn/ui Theme Color Generator
 *
 * Generates complete theme color palettes from a single base color,
 * following shadcn/ui's methodology. This creates harmonious color schemes
 * with proper lightness and chroma values for light and dark modes.
 *
 * Based on: https://ui.shadcn.com/themes
 *
 * @see https://ui.shadcn.com/themes - shadcn/ui Theme Gallery
 * @see https://ui.shadcn.com/colors - Color System Documentation
 */
import {
  formatCss,
  formatHex,
  oklch,
  parse,
  parseHex,
  type Oklch,
} from 'culori'
import {
  normalizePresetToThemeTokens,
  type ThemeTokens,
} from '@/lib/theme/appearance-preferences'
import { logger } from '@/lib/utils/logger'

export type ShadcnBaseColor =
  | 'slate'
  | 'gray'
  | 'zinc'
  | 'neutral'
  | 'stone'
  | 'red'
  | 'rose'
  | 'orange'
  | 'green'
  | 'blue'
  | 'yellow'
  | 'violet'

export interface ShadcnTheme {
  name: string
  baseColor: ShadcnBaseColor
  colors: {
    light: {
      background: string
      foreground: string
      card: string
      cardForeground: string
      popover: string
      popoverForeground: string
      primary: string
      primaryForeground: string
      secondary: string
      secondaryForeground: string
      muted: string
      mutedForeground: string
      accent: string
      accentForeground: string
      destructive: string
      destructiveForeground: string
      border: string
      input: string
      ring: string
    }
    dark: {
      background: string
      foreground: string
      card: string
      cardForeground: string
      popover: string
      popoverForeground: string
      primary: string
      primaryForeground: string
      secondary: string
      secondaryForeground: string
      muted: string
      mutedForeground: string
      accent: string
      accentForeground: string
      destructive: string
      destructiveForeground: string
      border: string
      input: string
      ring: string
    }
  }
}

/**
 * shadcn/ui Base Color Palettes
 * These are the official base colors from shadcn/ui themes
 */
export const SHADCN_BASE_COLORS: Record<
  ShadcnBaseColor,
  { hex: string; name: string; description: string }
> = {
  slate: {
    hex: '#64748b',
    name: 'Slate',
    description: 'Cool gray with subtle blue undertones',
  },
  gray: {
    hex: '#6b7280',
    name: 'Gray',
    description: 'Pure neutral gray, balanced and versatile',
  },
  zinc: {
    hex: '#71717a',
    name: 'Zinc',
    description: 'Modern gray with slight warmth',
  },
  neutral: {
    hex: '#737373',
    name: 'Neutral',
    description: 'True neutral, minimal color bias',
  },
  stone: {
    hex: '#78716c',
    name: 'Stone',
    description: 'Warm gray with earthy tones',
  },
  red: {
    hex: '#ef4444',
    name: 'Red',
    description: 'Bold and energetic, great for CTAs',
  },
  rose: {
    hex: '#f43f5e',
    name: 'Rose',
    description: 'Pink-red blend, modern and vibrant',
  },
  orange: {
    hex: '#f97316',
    name: 'Orange',
    description: 'Warm and inviting, high energy',
  },
  green: {
    hex: '#22c55e',
    name: 'Green',
    description: 'Fresh and natural, positive vibes',
  },
  blue: {
    hex: '#3b82f6',
    name: 'Blue',
    description: 'Professional and trustworthy',
  },
  yellow: {
    hex: '#eab308',
    name: 'Yellow',
    description: 'Bright and optimistic, attention-grabbing',
  },
  violet: {
    hex: '#8b5cf6',
    name: 'Violet',
    description: 'Creative and sophisticated',
  },
}

/**
 * Generate a complete theme from a single base color
 * following shadcn/ui's methodology
 */
export function generateShadcnTheme(baseColor: ShadcnBaseColor): ShadcnTheme {
  const base = SHADCN_BASE_COLORS[baseColor]

  return {
    name: base.name,
    baseColor,
    colors: {
      light: generateLightModeColors(base.hex),
      dark: generateDarkModeColors(base.hex),
    },
  }
}

/**
 * Generate light mode color palette from base color
 */
function generateLightModeColors(baseHex: string) {
  const baseColor = parseHex(baseHex)
  const baseOklch = oklch(baseColor) as Oklch

  // Extract hue from base color
  const hue = baseOklch.h || 0

  return {
    // Backgrounds - very light
    background: formatCss(oklch({ mode: 'oklch', l: 1, c: 0, h: hue })),
    foreground: formatCss(oklch({ mode: 'oklch', l: 0.129, c: 0.042, h: hue })),

    // Cards - same as background for consistency
    card: formatCss(oklch({ mode: 'oklch', l: 1, c: 0, h: hue })),
    cardForeground: formatCss(
      oklch({ mode: 'oklch', l: 0.129, c: 0.042, h: hue })
    ),

    // Popover - same as background
    popover: formatCss(oklch({ mode: 'oklch', l: 1, c: 0, h: hue })),
    popoverForeground: formatCss(
      oklch({ mode: 'oklch', l: 0.129, c: 0.042, h: hue })
    ),

    // Primary - use base color with adjustments
    primary: formatCss(
      oklch({ mode: 'oklch', l: baseOklch.l * 0.85, c: baseOklch.c, h: hue })
    ),
    primaryForeground: formatCss(
      oklch({ mode: 'oklch', l: 0.984, c: 0.003, h: hue })
    ),

    // Secondary - very light, subtle
    secondary: formatCss(oklch({ mode: 'oklch', l: 0.968, c: 0.007, h: hue })),
    secondaryForeground: formatCss(
      oklch({ mode: 'oklch', l: 0.208, c: 0.042, h: hue })
    ),

    // Muted - same as secondary
    muted: formatCss(oklch({ mode: 'oklch', l: 0.968, c: 0.007, h: hue })),
    mutedForeground: formatCss(
      oklch({ mode: 'oklch', l: 0.554, c: 0.046, h: hue })
    ),

    // Accent - same as secondary
    accent: formatCss(oklch({ mode: 'oklch', l: 0.968, c: 0.007, h: hue })),
    accentForeground: formatCss(
      oklch({ mode: 'oklch', l: 0.208, c: 0.042, h: hue })
    ),

    // Destructive - always red for consistency
    destructive: formatCss(
      oklch({ mode: 'oklch', l: 0.577, c: 0.245, h: 27.325 })
    ),
    destructiveForeground: formatCss(
      oklch({ mode: 'oklch', l: 0.984, c: 0.003, h: hue })
    ),

    // Borders and inputs
    border: formatCss(oklch({ mode: 'oklch', l: 0.929, c: 0.013, h: hue })),
    input: formatCss(oklch({ mode: 'oklch', l: 0.929, c: 0.013, h: hue })),

    // Ring - focus indicator
    ring: formatCss(
      oklch({
        mode: 'oklch',
        l: baseOklch.l * 1.1,
        c: baseOklch.c * 0.6,
        h: hue,
      })
    ),
  }
}

/**
 * Generate dark mode color palette from base color
 */
function generateDarkModeColors(baseHex: string) {
  const baseColor = parseHex(baseHex)
  const baseOklch = oklch(baseColor) as Oklch

  // Extract hue from base color
  const hue = baseOklch.h || 0

  return {
    // Backgrounds - very dark
    background: formatCss(oklch({ mode: 'oklch', l: 0.205, c: 0, h: hue })),
    foreground: formatCss(oklch({ mode: 'oklch', l: 0.985, c: 0, h: hue })),

    // Cards - same as background
    card: formatCss(oklch({ mode: 'oklch', l: 0.205, c: 0, h: hue })),
    cardForeground: formatCss(oklch({ mode: 'oklch', l: 0.985, c: 0, h: hue })),

    // Popover - same as background
    popover: formatCss(oklch({ mode: 'oklch', l: 0.205, c: 0, h: hue })),
    popoverForeground: formatCss(
      oklch({ mode: 'oklch', l: 0.985, c: 0, h: hue })
    ),

    // Primary - light for contrast on dark background
    primary: formatCss(oklch({ mode: 'oklch', l: 0.985, c: 0, h: hue })),
    primaryForeground: formatCss(
      oklch({ mode: 'oklch', l: 0.205, c: 0, h: hue })
    ),

    // Secondary - slightly lighter than background
    secondary: formatCss(oklch({ mode: 'oklch', l: 0.269, c: 0, h: hue })),
    secondaryForeground: formatCss(
      oklch({ mode: 'oklch', l: 0.985, c: 0, h: hue })
    ),

    // Muted - same as secondary
    muted: formatCss(oklch({ mode: 'oklch', l: 0.269, c: 0, h: hue })),
    mutedForeground: formatCss(oklch({ mode: 'oklch', l: 0.78, c: 0, h: hue })),

    // Accent - same as secondary
    accent: formatCss(oklch({ mode: 'oklch', l: 0.269, c: 0, h: hue })),
    accentForeground: formatCss(
      oklch({ mode: 'oklch', l: 0.985, c: 0, h: hue })
    ),

    // Destructive - red adjusted for dark mode
    destructive: formatCss(
      oklch({ mode: 'oklch', l: 0.704, c: 0.191, h: 22.216 })
    ),
    destructiveForeground: formatCss(
      oklch({ mode: 'oklch', l: 0.984, c: 0.003, h: hue })
    ),

    // Borders and inputs - lighter for visibility
    border: formatCss(oklch({ mode: 'oklch', l: 0.371, c: 0, h: hue })),
    input: formatCss(oklch({ mode: 'oklch', l: 0.371, c: 0, h: hue })),

    // Ring - focus indicator
    ring: formatCss(oklch({ mode: 'oklch', l: 0.708, c: 0, h: hue })),
  }
}

/**
 * Convert shadcn theme to custom theme colors format
 * for compatibility with existing theme system
 * Returns hex colors (not OKLCH) for compatibility with color inputs
 */
export function shadcnThemeToCustomColors(
  theme: ShadcnTheme,
  mode: 'light' | 'dark' = 'light'
) {
  const base = SHADCN_BASE_COLORS[theme.baseColor]

  if (mode === 'light') {
    return {
      primary: base.hex,
      background: '#ffffff',
      foreground: '#0f172a',
      secondary: '#f1f5f9',
      accent: '#f1f5f9',
      border: '#e2e8f0',
      destructive: '#ef4444',
    }
  } else {
    return {
      primary: base.hex,
      background: '#0a0a0a',
      foreground: '#fafafa',
      secondary: '#27272a',
      accent: '#27272a',
      border: '#3f3f46',
      destructive: '#dc2626',
    }
  }
}

/**
 * Convert shadcn theme to dual ThemeTokens (V2 format).
 * Returns full 15-token palettes for both light and dark modes.
 */
export function shadcnThemeToDualTokens(theme: ShadcnTheme): {
  light: ThemeTokens
  dark: ThemeTokens
} {
  const lightColors = {
    background: oklchCssToHex(theme.colors.light.background),
    foreground: oklchCssToHex(theme.colors.light.foreground),
    card: oklchCssToHex(theme.colors.light.card),
    primary: oklchCssToHex(theme.colors.light.primary),
    secondary: oklchCssToHex(theme.colors.light.secondary),
    accent: oklchCssToHex(theme.colors.light.accent),
    muted: oklchCssToHex(theme.colors.light.muted),
    border: oklchCssToHex(theme.colors.light.border),
    ring: oklchCssToHex(theme.colors.light.ring),
    destructive: oklchCssToHex(theme.colors.light.destructive),
  }
  const darkColors = {
    background: oklchCssToHex(theme.colors.dark.background),
    foreground: oklchCssToHex(theme.colors.dark.foreground),
    card: oklchCssToHex(theme.colors.dark.card),
    primary: oklchCssToHex(theme.colors.dark.primary),
    secondary: oklchCssToHex(theme.colors.dark.secondary),
    accent: oklchCssToHex(theme.colors.dark.accent),
    muted: oklchCssToHex(theme.colors.dark.muted),
    border: oklchCssToHex(theme.colors.dark.border),
    ring: oklchCssToHex(theme.colors.dark.ring),
    destructive: oklchCssToHex(theme.colors.dark.destructive),
  }

  return {
    light: normalizePresetToThemeTokens(lightColors, 'light'),
    dark: normalizePresetToThemeTokens(darkColors, 'dark'),
  }
}

function oklchCssToHex(value: string): string {
  const parsed = parse(value)
  return parsed ? formatHex(parsed) : '#000000'
}

/**
 * Get all shadcn/ui base color options
 */
export function getShadcnBaseColors(): Array<{
  value: ShadcnBaseColor
  label: string
  hex: string
  description: string
}> {
  return Object.entries(SHADCN_BASE_COLORS).map(([value, data]) => ({
    value: value as ShadcnBaseColor,
    label: data.name,
    hex: data.hex,
    description: data.description,
  }))
}

/**
 * Apply a shadcn/ui base color theme to the document
 * This generates both light and dark mode CSS variables
 */
export function applyShadcnBaseColorTheme(baseColor: ShadcnBaseColor) {
  const theme = generateShadcnTheme(baseColor)
  const root = document.documentElement

  // Apply light mode variables to :root
  const lightColors = theme.colors.light
  root.style.setProperty('--light-background', lightColors.background)
  root.style.setProperty('--light-foreground', lightColors.foreground)
  root.style.setProperty('--light-primary', lightColors.primary)
  root.style.setProperty('--light-secondary', lightColors.secondary)
  root.style.setProperty('--light-accent', lightColors.accent)
  root.style.setProperty('--light-border', lightColors.border)
  root.style.setProperty('--light-ring', lightColors.ring)

  // Apply dark mode variables
  const darkColors = theme.colors.dark
  root.style.setProperty('--dark-background', darkColors.background)
  root.style.setProperty('--dark-foreground', darkColors.foreground)
  root.style.setProperty('--dark-primary', darkColors.primary)
  root.style.setProperty('--dark-secondary', darkColors.secondary)
  root.style.setProperty('--dark-accent', darkColors.accent)
  root.style.setProperty('--dark-border', darkColors.border)
  root.style.setProperty('--dark-ring', darkColors.ring)

  logger.log(`✅ shadcn/ui ${theme.name} theme generated:`, {
    baseColor,
    lightSample: lightColors.primary,
    darkSample: darkColors.primary,
  })

  return theme
}

// Created and developed by Jai Singh
