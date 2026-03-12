import { fonts } from '@/config/fonts'
import {
  getPerceivedLightness,
  getWCAGContrastRatio,
  validateHex,
} from '@/lib/utils/color-conversion'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThemeTokens {
  background: string
  foreground: string
  card: string
  primary: string
  secondary: string
  accent: string
  muted: string
  border: string
  ring: string
  destructive: string
  chart1: string
  chart2: string
  chart3: string
  chart4: string
  chart5: string
}

export type ThemeMode = 'light' | 'dark' | 'system' | 'custom'
export type CustomBehavior = 'follow-system' | 'light' | 'dark'
export type RadiusPreset = 'compact' | 'default' | 'comfortable' | 'rounded'
export type FontOption = (typeof fonts)[number]

export interface AppearancePreferencesV2 {
  version: 2
  theme: ThemeMode
  customBehavior: CustomBehavior
  customPalettes: {
    light: ThemeTokens
    dark: ThemeTokens
  }
  font: FontOption
  radius: RadiusPreset
}

export interface LegacyCustomThemeColors {
  primary: string
  background: string
  foreground: string
  secondary: string
  accent: string
  border: string
  destructive: string
}

export interface DerivedTokens {
  'card-foreground': string
  popover: string
  'popover-foreground': string
  'primary-foreground': string
  'secondary-foreground': string
  'accent-foreground': string
  'muted-foreground': string
  'destructive-foreground': string
  input: string
  sidebar: string
  'sidebar-foreground': string
  'sidebar-primary': string
  'sidebar-primary-foreground': string
  'sidebar-accent': string
  'sidebar-accent-foreground': string
  'sidebar-border': string
  'sidebar-ring': string
}

export type PaletteMode = 'light' | 'dark'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY_V2 = 'appearance-preferences-v2'
const LEGACY_THEME_KEY = 'vite-ui-theme'
const LEGACY_COLORS_KEY = 'custom-theme-colors'
const LEGACY_FONT_KEY = 'font'

const VALID_THEMES: ThemeMode[] = ['light', 'dark', 'system', 'custom']
const VALID_BEHAVIORS: CustomBehavior[] = ['follow-system', 'light', 'dark']
const VALID_RADII: RadiusPreset[] = [
  'compact',
  'default',
  'comfortable',
  'rounded',
]

export const RADIUS_VALUES: Record<RadiusPreset, string> = {
  compact: '0.25rem',
  default: '0.625rem',
  comfortable: '0.75rem',
  rounded: '1rem',
}

const DEFAULT_LIGHT_CHART_COLORS = {
  chart1: '#e76e50',
  chart2: '#2a9d8f',
  chart3: '#264653',
  chart4: '#e9c46a',
  chart5: '#f4a261',
}

const DEFAULT_DARK_CHART_COLORS = {
  chart1: '#4f6df5',
  chart2: '#34d399',
  chart3: '#f4a261',
  chart4: '#a78bfa',
  chart5: '#f87171',
}

export const DEFAULT_LIGHT_TOKENS: ThemeTokens = {
  background: '#ffffff',
  foreground: '#0f172a',
  card: '#ffffff',
  primary: '#3b82f6',
  secondary: '#f1f5f9',
  accent: '#f1f5f9',
  muted: '#f1f5f9',
  border: '#e2e8f0',
  ring: '#3b82f6',
  destructive: '#ef4444',
  ...DEFAULT_LIGHT_CHART_COLORS,
}

export const DEFAULT_DARK_TOKENS: ThemeTokens = {
  background: '#0a0a0a',
  foreground: '#fafafa',
  card: '#0a0a0a',
  primary: '#fafafa',
  secondary: '#27272a',
  accent: '#27272a',
  muted: '#27272a',
  border: '#3f3f46',
  ring: '#d4d4d8',
  destructive: '#dc2626',
  ...DEFAULT_DARK_CHART_COLORS,
}

export const DEFAULT_PREFERENCES: AppearancePreferencesV2 = {
  version: 2,
  theme: 'system',
  customBehavior: 'follow-system',
  customPalettes: {
    light: DEFAULT_LIGHT_TOKENS,
    dark: DEFAULT_DARK_TOKENS,
  },
  font: fonts[0],
  radius: 'default',
}

const THEME_TOKEN_KEYS: (keyof ThemeTokens)[] = [
  'background',
  'foreground',
  'card',
  'primary',
  'secondary',
  'accent',
  'muted',
  'border',
  'ring',
  'destructive',
  'chart1',
  'chart2',
  'chart3',
  'chart4',
  'chart5',
]

// ---------------------------------------------------------------------------
// Radius Mapping
// ---------------------------------------------------------------------------

export function radiusToCSS(preset: RadiusPreset): string {
  return RADIUS_VALUES[preset] ?? RADIUS_VALUES.default
}

export function getPaletteModeForBackground(backgroundHex: string): PaletteMode {
  return getPerceivedLightness(backgroundHex) < 0.4 ? 'dark' : 'light'
}

// ---------------------------------------------------------------------------
// Token Normalization (7-token legacy -> 15-token ThemeTokens)
// ---------------------------------------------------------------------------

export function normalizePresetToThemeTokens(
  legacy: Partial<LegacyCustomThemeColors & ThemeTokens>,
  mode: 'light' | 'dark' = 'light'
): ThemeTokens {
  const defaults = mode === 'dark' ? DEFAULT_DARK_TOKENS : DEFAULT_LIGHT_TOKENS

  const bg = validHexOrDefault(legacy.background, defaults.background)
  const fg = validHexOrDefault(legacy.foreground, defaults.foreground)
  const primary = validHexOrDefault(legacy.primary, defaults.primary)
  const secondary = validHexOrDefault(legacy.secondary, defaults.secondary)
  const accent = validHexOrDefault(legacy.accent, defaults.accent)
  const border = validHexOrDefault(legacy.border, defaults.border)
  const destructive = validHexOrDefault(legacy.destructive, defaults.destructive)

  return {
    background: bg,
    foreground: fg,
    card: validHexOrDefault(legacy.card, bg),
    primary,
    secondary,
    accent,
    muted: validHexOrDefault(legacy.muted, secondary),
    border,
    ring: validHexOrDefault(legacy.ring, primary),
    destructive,
    chart1: validHexOrDefault(legacy.chart1, defaults.chart1),
    chart2: validHexOrDefault(legacy.chart2, defaults.chart2),
    chart3: validHexOrDefault(legacy.chart3, defaults.chart3),
    chart4: validHexOrDefault(legacy.chart4, defaults.chart4),
    chart5: validHexOrDefault(legacy.chart5, defaults.chart5),
  }
}

/**
 * Derive a dark palette from a light one by swapping lightness direction.
 * Produces a usable dark counterpart for light-category presets.
 */
export function deriveDarkFromLight(light: ThemeTokens): ThemeTokens {
  return {
    background: adjustLightness(light.background, 0.08),
    foreground: adjustLightness(light.foreground, 0.95),
    card: adjustLightness(light.card ?? light.background, 0.10),
    primary: light.primary,
    secondary: adjustLightness(light.secondary, 0.18),
    accent: adjustLightness(light.accent, 0.18),
    muted: adjustLightness(light.muted ?? light.secondary, 0.18),
    border: adjustLightness(light.border, 0.28),
    ring: light.ring ?? light.primary,
    destructive: '#dc2626',
    chart1: light.chart1,
    chart2: light.chart2,
    chart3: light.chart3,
    chart4: light.chart4,
    chart5: light.chart5,
  }
}

export function deriveLightFromDark(dark: ThemeTokens): ThemeTokens {
  return {
    background: adjustLightness(dark.background, 0.98),
    foreground: adjustLightness(dark.foreground, 0.10),
    card: adjustLightness(dark.card ?? dark.background, 0.97),
    primary: dark.primary,
    secondary: adjustLightness(dark.secondary, 0.95),
    accent: adjustLightness(dark.accent, 0.95),
    muted: adjustLightness(dark.muted ?? dark.secondary, 0.95),
    border: adjustLightness(dark.border, 0.88),
    ring: dark.ring ?? dark.primary,
    destructive: '#ef4444',
    chart1: dark.chart1,
    chart2: dark.chart2,
    chart3: dark.chart3,
    chart4: dark.chart4,
    chart5: dark.chart5,
  }
}

// ---------------------------------------------------------------------------
// Derived Token Computation
// ---------------------------------------------------------------------------

export function computeDerivedTokens(tokens: ThemeTokens): DerivedTokens {
  const cardFg = surfaceForeground(tokens.card, tokens.foreground)
  const popoverFg = surfaceForeground(tokens.card, tokens.foreground)
  const primaryFg = surfaceForeground(tokens.primary, tokens.foreground)
  const secondaryFg = surfaceForeground(tokens.secondary, tokens.foreground)
  const accentFg = surfaceForeground(tokens.accent, tokens.foreground)
  const mutedFg = surfaceForeground(tokens.muted, tokens.foreground)
  const destructiveFg = surfaceForeground(tokens.destructive, tokens.foreground)
  const sidebarFg = surfaceForeground(tokens.background, tokens.foreground)

  return {
    'card-foreground': cardFg,
    popover: tokens.card,
    'popover-foreground': popoverFg,
    'primary-foreground': primaryFg,
    'secondary-foreground': secondaryFg,
    'accent-foreground': accentFg,
    'muted-foreground': mutedFg,
    'destructive-foreground': destructiveFg,
    input: tokens.border,
    sidebar: tokens.background,
    'sidebar-foreground': sidebarFg,
    'sidebar-primary': tokens.primary,
    'sidebar-primary-foreground': primaryFg,
    'sidebar-accent': tokens.accent,
    'sidebar-accent-foreground': accentFg,
    'sidebar-border': tokens.border,
    'sidebar-ring': tokens.ring,
  }
}

// ---------------------------------------------------------------------------
// Hydration & Migration
// ---------------------------------------------------------------------------

export function hydratePreferences(): AppearancePreferencesV2 {
  const v2 = readV2FromStorage()
  if (v2) return v2

  return migrateLegacy()
}

export function persistPreferences(prefs: AppearancePreferencesV2): void {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(prefs))
  } catch {
    // localStorage full or restricted -- silent fail
  }

  syncLegacyKeys(prefs)
}

function readV2FromStorage(): AppearancePreferencesV2 | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V2)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 2)
      return null

    return normalizeV2(parsed)
  } catch {
    return null
  }
}

function migrateLegacy(): AppearancePreferencesV2 {
  const theme = readLegacyTheme()
  const font = readLegacyFont()
  const legacyColors = readLegacyColors()

  let lightTokens = DEFAULT_LIGHT_TOKENS
  let darkTokens = DEFAULT_DARK_TOKENS
  let customBehavior: CustomBehavior = 'follow-system'

  if (legacyColors) {
    const legacyMode = getPaletteModeForBackground(legacyColors.background)
    if (legacyMode === 'dark') {
      darkTokens = normalizePresetToThemeTokens(legacyColors, 'dark')
      lightTokens = deriveLightFromDark(darkTokens)
      if (theme === 'custom') customBehavior = 'dark'
    } else {
      lightTokens = normalizePresetToThemeTokens(legacyColors, 'light')
      darkTokens = deriveDarkFromLight(lightTokens)
      if (theme === 'custom') customBehavior = 'light'
    }
  }

  return {
    version: 2,
    theme,
    customBehavior,
    customPalettes: { light: lightTokens, dark: darkTokens },
    font,
    radius: 'default',
  }
}

function readLegacyTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(LEGACY_THEME_KEY)
    if (raw && VALID_THEMES.includes(raw as ThemeMode)) return raw as ThemeMode
  } catch {
    // ignore
  }
  return 'system'
}

function readLegacyFont(): FontOption {
  try {
    const raw = localStorage.getItem(LEGACY_FONT_KEY)
    if (raw && (fonts as readonly string[]).includes(raw))
      return raw as FontOption
  } catch {
    // ignore
  }
  return fonts[0]
}

function readLegacyColors(): LegacyCustomThemeColors | null {
  try {
    const raw = localStorage.getItem(LEGACY_COLORS_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    return parsed as LegacyCustomThemeColors
  } catch {
    return null
  }
}

function syncLegacyKeys(prefs: AppearancePreferencesV2): void {
  try {
    localStorage.setItem(LEGACY_THEME_KEY, prefs.theme)
    localStorage.setItem(LEGACY_FONT_KEY, prefs.font)

    const resolvedMode =
      prefs.theme === 'custom'
        ? prefs.customBehavior === 'follow-system'
          ? typeof window !== 'undefined' &&
            window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : prefs.customBehavior
        : 'light'

    const palette = prefs.customPalettes[resolvedMode] ?? prefs.customPalettes.light
    const legacyColors: LegacyCustomThemeColors = {
      primary: palette.primary,
      background: palette.background,
      foreground: palette.foreground,
      secondary: palette.secondary,
      accent: palette.accent,
      border: palette.border,
      destructive: palette.destructive,
    }
    localStorage.setItem(LEGACY_COLORS_KEY, JSON.stringify(legacyColors))
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// V2 Normalization (guard against corrupt stored V2 data)
// ---------------------------------------------------------------------------

function normalizeV2(raw: Record<string, unknown>): AppearancePreferencesV2 {
  const theme = VALID_THEMES.includes(raw.theme as ThemeMode)
    ? (raw.theme as ThemeMode)
    : 'system'

  const customBehavior = VALID_BEHAVIORS.includes(
    raw.customBehavior as CustomBehavior
  )
    ? (raw.customBehavior as CustomBehavior)
    : 'follow-system'

  const font =
    typeof raw.font === 'string' &&
    (fonts as readonly string[]).includes(raw.font)
      ? (raw.font as FontOption)
      : fonts[0]

  const radius = VALID_RADII.includes(raw.radius as RadiusPreset)
    ? (raw.radius as RadiusPreset)
    : 'default'

  const palettes = raw.customPalettes as
    | Record<string, unknown>
    | null
    | undefined
  const lightRaw =
    palettes && typeof palettes === 'object'
      ? (palettes.light as Partial<ThemeTokens>)
      : undefined
  const darkRaw =
    palettes && typeof palettes === 'object'
      ? (palettes.dark as Partial<ThemeTokens>)
      : undefined

  return {
    version: 2,
    theme,
    customBehavior,
    customPalettes: {
      light: normalizeTokens(lightRaw, 'light'),
      dark: normalizeTokens(darkRaw, 'dark'),
    },
    font,
    radius,
  }
}

function normalizeTokens(
  raw: Partial<ThemeTokens> | undefined | null,
  mode: 'light' | 'dark'
): ThemeTokens {
  if (!raw || typeof raw !== 'object') {
    return mode === 'dark' ? DEFAULT_DARK_TOKENS : DEFAULT_LIGHT_TOKENS
  }
  return normalizePresetToThemeTokens(raw, mode)
}

// ---------------------------------------------------------------------------
// Import / Export Validation
// ---------------------------------------------------------------------------

export function validateImportPayload(
  data: unknown
): { valid: true; prefs: AppearancePreferencesV2 } | { valid: false; error: string } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Import data must be a JSON object.' }
  }

  const obj = data as Record<string, unknown>

  const allowedKeys = new Set([
    'version',
    'theme',
    'customBehavior',
    'customPalettes',
    'font',
    'radius',
  ])
  const unknownKeys = Object.keys(obj).filter((k) => !allowedKeys.has(k))
  if (unknownKeys.length > 0) {
    return {
      valid: false,
      error: `Unknown keys: ${unknownKeys.join(', ')}`,
    }
  }

  if (obj.version !== 2) {
    return { valid: false, error: 'Unsupported version. Expected version: 2.' }
  }

  if (
    typeof obj.font === 'string' &&
    !(fonts as readonly string[]).includes(obj.font)
  ) {
    return {
      valid: false,
      error: `Unknown font "${obj.font}". Supported: ${fonts.join(', ')}`,
    }
  }

  if (
    typeof obj.radius === 'string' &&
    !VALID_RADII.includes(obj.radius as RadiusPreset)
  ) {
    return {
      valid: false,
      error: `Unknown radius "${obj.radius}". Supported: ${VALID_RADII.join(', ')}`,
    }
  }

  const palettes = obj.customPalettes
  if (palettes && typeof palettes === 'object') {
    const p = palettes as Record<string, unknown>
    for (const mode of ['light', 'dark'] as const) {
      const tokens = p[mode]
      if (tokens && typeof tokens === 'object') {
        const t = tokens as Record<string, string>
        for (const key of THEME_TOKEN_KEYS) {
          if (t[key] !== undefined && !validateHex(t[key])) {
            return {
              valid: false,
              error: `Invalid hex color for ${mode}.${key}: "${t[key]}"`,
            }
          }
        }
      }
    }
  }

  return { valid: true, prefs: normalizeV2(obj) }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validHexOrDefault(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  return validateHex(value) ?? fallback
}

function contrastForeground(bgHex: string): string {
  const lightness = getPerceivedLightness(bgHex)
  return lightness < 0.55 ? '#fafafa' : '#0a0a0a'
}

function adjustLightness(hex: string, targetLightness: number): string {
  const validated = validateHex(hex)
  if (!validated) {
    const grey = Math.round(Math.max(0, Math.min(1, targetLightness)) * 255)
    return `#${grey.toString(16).padStart(2, '0').repeat(3)}`
  }

  const r = parseInt(validated.slice(1, 3), 16)
  const g = parseInt(validated.slice(3, 5), 16)
  const b = parseInt(validated.slice(5, 7), 16)

  const currentLightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 510

  if (currentLightness === 0) {
    const grey = Math.round(targetLightness * 255)
    return `#${grey.toString(16).padStart(2, '0').repeat(3)}`
  }

  const ratio = targetLightness / Math.max(currentLightness, 0.01)
  const nr = Math.min(255, Math.max(0, Math.round(r * ratio)))
  const ng = Math.min(255, Math.max(0, Math.round(g * ratio)))
  const nb = Math.min(255, Math.max(0, Math.round(b * ratio)))

  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`
}

function surfaceForeground(surfaceHex: string, preferredFgHex?: string): string {
  const preferred = validateHex(preferredFgHex ?? '')
  if (preferred && getWCAGContrastRatio(surfaceHex, preferred) >= 4.5) {
    return preferred
  }
  return contrastForeground(surfaceHex)
}

// ---------------------------------------------------------------------------
// Exports for storage key constants (used in theme-context migration)
// ---------------------------------------------------------------------------

export {
  STORAGE_KEY_V2,
  LEGACY_THEME_KEY,
  LEGACY_COLORS_KEY,
  LEGACY_FONT_KEY,
  THEME_TOKEN_KEYS,
}
