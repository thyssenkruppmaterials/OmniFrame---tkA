// Created and developed by Jai Singh
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  computeDerivedTokens,
  getPaletteModeForBackground,
  hydratePreferences,
  persistPreferences,
  radiusToCSS,
  DEFAULT_PREFERENCES,
  THEME_TOKEN_KEYS,
  type AppearancePreferencesV2,
  type ThemeMode,
  type CustomBehavior,
  type RadiusPreset,
  type FontOption,
  type ThemeTokens,
} from '@/lib/theme/appearance-preferences'
import { hexToOklch, validateHex } from '@/lib/utils/color-conversion'
import { logger } from '@/lib/utils/logger'

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: ThemeMode
  storageKey?: string
}

type ThemeProviderState = {
  /** Raw user-selected mode */
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  /** Active stored palette slot */
  activePalette: 'light' | 'dark'
  /** Effective resolved mode after system detection */
  resolvedTheme: 'light' | 'dark'
  /** Whether the current theme is custom */
  isCustomTheme: boolean
  /** Full V2 preferences */
  preferences: AppearancePreferencesV2
  setPreferences: (prefs: AppearancePreferencesV2) => void
  /** Legacy API: custom colors for the resolved mode (backward compat) */
  customColors: {
    primary: string
    background: string
    foreground: string
    secondary: string
    accent: string
    border: string
    destructive: string
  }
  setCustomColors: (colors: {
    primary: string
    background: string
    foreground: string
    secondary: string
    accent: string
    border: string
    destructive: string
  }) => void
}

const initialState: ThemeProviderState = {
  theme: 'system',
  setTheme: () => null,
  activePalette: 'light',
  resolvedTheme: 'light',
  isCustomTheme: false,
  preferences: DEFAULT_PREFERENCES,
  setPreferences: () => null,
  customColors: {
    primary: '#3b82f6',
    background: '#ffffff',
    foreground: '#0f172a',
    secondary: '#f1f5f9',
    accent: '#f1f5f9',
    border: '#e2e8f0',
    destructive: '#ef4444',
  },
  setCustomColors: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

const TOKEN_CSS_MAP: Record<string, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  primary: '--primary',
  secondary: '--secondary',
  accent: '--accent',
  muted: '--muted',
  border: '--border',
  ring: '--ring',
  destructive: '--destructive',
  chart1: '--chart-1',
  chart2: '--chart-2',
  chart3: '--chart-3',
  chart4: '--chart-4',
  chart5: '--chart-5',
}

function tokenKeyToCSSVar(key: string): string {
  return TOKEN_CSS_MAP[key] ?? `--${key}`
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  const [preferences, _setPreferences] = useState<AppearancePreferencesV2>(() =>
    hydratePreferences()
  )

  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const activePalette = useMemo<'light' | 'dark'>(() => {
    const { theme, customBehavior } = preferences
    if (theme === 'light') return 'light'
    if (theme === 'dark') return 'dark'
    if (theme === 'system') return systemDark ? 'dark' : 'light'
    if (theme === 'custom') {
      if (customBehavior === 'follow-system')
        return systemDark ? 'dark' : 'light'
      return customBehavior
    }
    return 'light'
  }, [preferences, systemDark])

  const resolvedTheme = useMemo<'light' | 'dark'>(() => {
    if (preferences.theme !== 'custom') return activePalette
    const activeTokens = preferences.customPalettes[activePalette]
    return getPaletteModeForBackground(activeTokens.background)
  }, [preferences, activePalette])

  const isCustomTheme = preferences.theme === 'custom'

  const customColors = useMemo(() => {
    const palette = preferences.customPalettes[activePalette]
    return {
      primary: palette.primary,
      background: palette.background,
      foreground: palette.foreground,
      secondary: palette.secondary,
      accent: palette.accent,
      border: palette.border,
      destructive: palette.destructive,
    }
  }, [preferences, activePalette])

  const applyThemeToDOM = (
    visualMode: 'light' | 'dark',
    paletteMode: 'light' | 'dark',
    prefs: AppearancePreferencesV2
  ) => {
    const root = document.documentElement

    root.classList.remove('light', 'dark', 'custom')

    root.style.setProperty('--radius', radiusToCSS(prefs.radius))

    if (prefs.theme === 'custom') {
      const tokens = prefs.customPalettes[paletteMode]
      root.classList.add(visualMode, 'custom')

      const derived = computeDerivedTokens(tokens)

      for (const key of THEME_TOKEN_KEYS) {
        const cssVar = tokenKeyToCSSVar(key)
        const hex = tokens[key]
        const validated = validateHex(hex)
        if (validated) {
          root.style.setProperty(cssVar, hexToOklch(validated))
        }
      }

      for (const [key, value] of Object.entries(derived)) {
        const validated = validateHex(value)
        if (validated) {
          root.style.setProperty(`--${key}`, hexToOklch(validated))
        }
      }

      updateMetaThemeColor(tokens.background)
      logger.log(
        `Custom theme applied from ${paletteMode} palette in ${visualMode} mode`
      )
    } else {
      root.classList.add(visualMode)
      clearCustomProperties(root)
      updateMetaThemeColor(visualMode === 'dark' ? '#020817' : '#ffffff')
    }
  }

  const clearCustomProperties = (root: HTMLElement) => {
    const allVars = [
      ...THEME_TOKEN_KEYS.map((k) => tokenKeyToCSSVar(k)),
      '--card-foreground',
      '--popover',
      '--popover-foreground',
      '--primary-foreground',
      '--secondary-foreground',
      '--accent-foreground',
      '--muted-foreground',
      '--destructive-foreground',
      '--input',
      '--sidebar',
      '--sidebar-foreground',
      '--sidebar-primary',
      '--sidebar-primary-foreground',
      '--sidebar-accent',
      '--sidebar-accent-foreground',
      '--sidebar-border',
      '--sidebar-ring',
    ]
    allVars.forEach((v) => root.style.removeProperty(v))
  }

  useEffect(() => {
    applyThemeToDOM(resolvedTheme, activePalette, preferences)
  }, [resolvedTheme, activePalette, preferences])

  const setPreferences = (prefs: AppearancePreferencesV2) => {
    _setPreferences(prefs)
    persistPreferences(prefs)
  }

  const setTheme = (theme: ThemeMode) => {
    const next = { ...preferences, theme }
    setPreferences(next)
  }

  const setCustomColors = (colors: {
    primary: string
    background: string
    foreground: string
    secondary: string
    accent: string
    border: string
    destructive: string
  }) => {
    const targetSlot = getPaletteModeForBackground(colors.background)

    const next = { ...preferences }
    const tokens = { ...next.customPalettes[targetSlot], ...colors }
    next.customPalettes = {
      ...next.customPalettes,
      [targetSlot]: tokens,
    }
    if (next.theme !== 'custom') next.theme = 'custom'
    if (preferences.theme !== 'custom') next.customBehavior = targetSlot
    setPreferences(next)
  }

  const value: ThemeProviderState = {
    theme: preferences.theme,
    setTheme,
    activePalette,
    resolvedTheme,
    isCustomTheme,
    preferences,
    setPreferences,
    customColors,
    setCustomColors,
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)
  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider')
  return context
}

function updateMetaThemeColor(color: string) {
  const validated = validateHex(color)
  if (!validated) return
  const metaThemeColor = document.querySelector("meta[name='theme-color']")
  if (metaThemeColor) metaThemeColor.setAttribute('content', validated)
}

export type {
  ThemeMode,
  CustomBehavior,
  RadiusPreset,
  FontOption,
  ThemeTokens,
  AppearancePreferencesV2,
}

// Created and developed by Jai Singh
