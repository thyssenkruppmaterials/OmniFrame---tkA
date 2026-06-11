import { normalizePresetToThemeTokens } from '@/lib/theme/appearance-preferences'

// Created and developed by Jai Singh
/**
 * Theme Presets Library
 *
 * Pre-designed color schemes that users can apply instantly.
 * All colors are converted to OKLCH format automatically by the theme system.
 */

export interface ThemePreset {
  id: string
  name: string
  description: string
  emoji: string
  category: 'light' | 'dark' | 'vibrant' | 'professional'
  colors: {
    primary: string
    background: string
    foreground: string
    secondary: string
    accent: string
    border: string
    destructive: string
  }
  preview?: {
    gradientFrom: string
    gradientTo: string
  }
}

export const THEME_PRESETS: Record<string, ThemePreset> = {
  // Light Themes
  default: {
    id: 'default',
    name: 'Default Blue',
    description: 'Clean and professional default theme',
    emoji: '💙',
    category: 'light',
    colors: {
      primary: '#3b82f6',
      background: '#ffffff',
      foreground: '#0f172a',
      secondary: '#f1f5f9',
      accent: '#f1f5f9',
      border: '#e2e8f0',
      destructive: '#ef4444',
    },
    preview: {
      gradientFrom: '#3b82f6',
      gradientTo: '#60a5fa',
    },
  },

  ocean: {
    id: 'ocean',
    name: 'Ocean Blue',
    description: 'Calm and refreshing blue tones',
    emoji: '🌊',
    category: 'light',
    colors: {
      primary: '#0ea5e9',
      background: '#f0f9ff',
      foreground: '#075985',
      secondary: '#e0f2fe',
      accent: '#bae6fd',
      border: '#7dd3fc',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#0ea5e9',
      gradientTo: '#38bdf8',
    },
  },

  forest: {
    id: 'forest',
    name: 'Forest Green',
    description: 'Natural and calming green palette',
    emoji: '🌲',
    category: 'light',
    colors: {
      primary: '#10b981',
      background: '#f0fdf4',
      foreground: '#065f46',
      secondary: '#dcfce7',
      accent: '#bbf7d0',
      border: '#86efac',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#10b981',
      gradientTo: '#34d399',
    },
  },

  coral: {
    id: 'coral',
    name: 'Coral Light',
    description: 'Light coral elegance',
    emoji: '🪸',
    category: 'light',
    colors: {
      primary: '#f97316',
      background: '#fff7ed',
      foreground: '#9a3412',
      secondary: '#ffedd5',
      accent: '#fed7aa',
      border: '#fdba74',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#f97316',
      gradientTo: '#fb923c',
    },
  },

  sunset: {
    id: 'sunset',
    name: 'Sunset Orange',
    description: 'Warm and energetic orange theme',
    emoji: '🌅',
    category: 'vibrant',
    colors: {
      primary: '#f97316',
      background: '#fff7ed',
      foreground: '#9a3412',
      secondary: '#ffedd5',
      accent: '#fed7aa',
      border: '#fdba74',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#f97316',
      gradientTo: '#fb923c',
    },
  },

  lavender: {
    id: 'lavender',
    name: 'Lavender Purple',
    description: 'Elegant and sophisticated purple',
    emoji: '💜',
    category: 'light',
    colors: {
      primary: '#8b5cf6',
      background: '#faf5ff',
      foreground: '#6b21a8',
      secondary: '#f3e8ff',
      accent: '#ede9fe',
      border: '#d8b4fe',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#8b5cf6',
      gradientTo: '#a78bfa',
    },
  },

  sky: {
    id: 'sky',
    name: 'Sky Blue',
    description: 'Bright and airy sky tones',
    emoji: '☁️',
    category: 'light',
    colors: {
      primary: '#0284c7',
      background: '#f0f9ff',
      foreground: '#0c4a6e',
      secondary: '#e0f2fe',
      accent: '#bae6fd',
      border: '#7dd3fc',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#0284c7',
      gradientTo: '#0ea5e9',
    },
  },

  mint: {
    id: 'mint',
    name: 'Mint Fresh',
    description: 'Cool and refreshing mint',
    emoji: '🌿',
    category: 'light',
    colors: {
      primary: '#14b8a6',
      background: '#f0fdfa',
      foreground: '#134e4a',
      secondary: '#ccfbf1',
      accent: '#99f6e4',
      border: '#5eead4',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#14b8a6',
      gradientTo: '#2dd4bf',
    },
  },

  sand: {
    id: 'sand',
    name: 'Sand Beige',
    description: 'Warm neutral sand tones',
    emoji: '🏖️',
    category: 'light',
    colors: {
      primary: '#d97706',
      background: '#fffbeb',
      foreground: '#78350f',
      secondary: '#fef3c7',
      accent: '#fde68a',
      border: '#fcd34d',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#d97706',
      gradientTo: '#f59e0b',
    },
  },

  cherry: {
    id: 'cherry',
    name: 'Cherry Blossom',
    description: 'Soft pink with warmth',
    emoji: '🌸',
    category: 'light',
    colors: {
      primary: '#f472b6',
      background: '#fdf2f8',
      foreground: '#831843',
      secondary: '#fce7f3',
      accent: '#fbcfe8',
      border: '#f9a8d4',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#f472b6',
      gradientTo: '#ec4899',
    },
  },

  rose: {
    id: 'rose',
    name: 'Rose Pink',
    description: 'Soft and modern pink palette',
    emoji: '🌹',
    category: 'vibrant',
    colors: {
      primary: '#ec4899',
      background: '#fff1f2',
      foreground: '#881337',
      secondary: '#ffe4e6',
      accent: '#fecdd3',
      border: '#fda4af',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#ec4899',
      gradientTo: '#f472b6',
    },
  },

  lime: {
    id: 'lime',
    name: 'Lime Zest',
    description: 'Fresh and energizing lime',
    emoji: '🍋',
    category: 'vibrant',
    colors: {
      primary: '#84cc16',
      background: '#f7fee7',
      foreground: '#365314',
      secondary: '#ecfccb',
      accent: '#d9f99d',
      border: '#bef264',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#84cc16',
      gradientTo: '#a3e635',
    },
  },

  violet: {
    id: 'violet',
    name: 'Violet Dream',
    description: 'Deep violet intensity',
    emoji: '🔮',
    category: 'vibrant',
    colors: {
      primary: '#7c3aed',
      background: '#faf5ff',
      foreground: '#5b21b6',
      secondary: '#f3e8ff',
      accent: '#e9d5ff',
      border: '#d8b4fe',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#7c3aed',
      gradientTo: '#a78bfa',
    },
  },

  // Professional Themes
  corporate: {
    id: 'corporate',
    name: 'Corporate Gray',
    description: 'Professional and minimal',
    emoji: '💼',
    category: 'professional',
    colors: {
      primary: '#475569',
      background: '#ffffff',
      foreground: '#0f172a',
      secondary: '#f8fafc',
      accent: '#f1f5f9',
      border: '#cbd5e1',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#475569',
      gradientTo: '#64748b',
    },
  },

  navy: {
    id: 'navy',
    name: 'Navy Blue',
    description: 'Professional deep blue',
    emoji: '⚓',
    category: 'professional',
    colors: {
      primary: '#1e40af',
      background: '#f8fafc',
      foreground: '#1e293b',
      secondary: '#eff6ff',
      accent: '#dbeafe',
      border: '#93c5fd',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#1e40af',
      gradientTo: '#3b82f6',
    },
  },

  teal: {
    id: 'teal',
    name: 'Teal Aqua',
    description: 'Modern teal and aqua',
    emoji: '🏝️',
    category: 'vibrant',
    colors: {
      primary: '#14b8a6',
      background: '#f0fdfa',
      foreground: '#134e4a',
      secondary: '#ccfbf1',
      accent: '#99f6e4',
      border: '#5eead4',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#14b8a6',
      gradientTo: '#2dd4bf',
    },
  },

  amber: {
    id: 'amber',
    name: 'Amber Gold',
    description: 'Warm amber and gold tones',
    emoji: '🌟',
    category: 'vibrant',
    colors: {
      primary: '#f59e0b',
      background: '#fffbeb',
      foreground: '#78350f',
      secondary: '#fef3c7',
      accent: '#fde68a',
      border: '#fcd34d',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#f59e0b',
      gradientTo: '#fbbf24',
    },
  },

  // Dark Mode Compatible
  midnight: {
    id: 'midnight',
    name: 'Midnight Purple',
    description: 'Deep purple for dark mode',
    emoji: '🌙',
    category: 'dark',
    colors: {
      primary: '#a855f7',
      background: '#0f0a1a',
      foreground: '#e9d5ff',
      secondary: '#1e1b4b',
      accent: '#312e81',
      border: '#4c1d95',
      destructive: '#ef4444',
    },
    preview: {
      gradientFrom: '#a855f7',
      gradientTo: '#c084fc',
    },
  },

  onyx: {
    id: 'onyx',
    name: 'Onyx Black',
    description: 'Pure dark with slate accents',
    emoji: '⬛',
    category: 'dark',
    colors: {
      primary: '#64748b',
      background: '#0a0a0a',
      foreground: '#f1f5f9',
      secondary: '#1e293b',
      accent: '#334155',
      border: '#475569',
      destructive: '#ef4444',
    },
    preview: {
      gradientFrom: '#64748b',
      gradientTo: '#94a3b8',
    },
  },

  deepOcean: {
    id: 'deepOcean',
    name: 'Deep Ocean',
    description: 'Dark blue depths',
    emoji: '🌊',
    category: 'dark',
    colors: {
      primary: '#0ea5e9',
      background: '#0c1420',
      foreground: '#e0f2fe',
      secondary: '#082f49',
      accent: '#0c4a6e',
      border: '#075985',
      destructive: '#ef4444',
    },
    preview: {
      gradientFrom: '#0ea5e9',
      gradientTo: '#38bdf8',
    },
  },

  emerald: {
    id: 'emerald',
    name: 'Emerald Night',
    description: 'Dark green with emerald highlights',
    emoji: '💎',
    category: 'dark',
    colors: {
      primary: '#10b981',
      background: '#0a1512',
      foreground: '#d1fae5',
      secondary: '#064e3b',
      accent: '#065f46',
      border: '#047857',
      destructive: '#ef4444',
    },
    preview: {
      gradientFrom: '#10b981',
      gradientTo: '#34d399',
    },
  },

  charcoal: {
    id: 'charcoal',
    name: 'Charcoal Gray',
    description: 'Sophisticated dark neutral',
    emoji: '🖤',
    category: 'dark',
    colors: {
      primary: '#71717a',
      background: '#18181b',
      foreground: '#fafafa',
      secondary: '#27272a',
      accent: '#3f3f46',
      border: '#52525b',
      destructive: '#ef4444',
    },
    preview: {
      gradientFrom: '#71717a',
      gradientTo: '#a1a1aa',
    },
  },

  crimson: {
    id: 'crimson',
    name: 'Crimson Red',
    description: 'Bold and energetic red',
    emoji: '❤️',
    category: 'vibrant',
    colors: {
      primary: '#dc2626',
      background: '#fef2f2',
      foreground: '#7f1d1d',
      secondary: '#fee2e2',
      accent: '#fecaca',
      border: '#fca5a5',
      destructive: '#b91c1c',
    },
    preview: {
      gradientFrom: '#dc2626',
      gradientTo: '#ef4444',
    },
  },

  // Professional Themes (Enhanced)
  slate: {
    id: 'slate',
    name: 'Slate Professional',
    description: 'Modern slate for business',
    emoji: '📊',
    category: 'professional',
    colors: {
      primary: '#64748b',
      background: '#f8fafc',
      foreground: '#0f172a',
      secondary: '#f1f5f9',
      accent: '#e2e8f0',
      border: '#cbd5e1',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#64748b',
      gradientTo: '#94a3b8',
    },
  },

  executive: {
    id: 'executive',
    name: 'Executive Black',
    description: 'Premium dark professional',
    emoji: '💼',
    category: 'professional',
    colors: {
      primary: '#3b82f6',
      background: '#ffffff',
      foreground: '#0f172a',
      secondary: '#f8fafc',
      accent: '#f1f5f9',
      border: '#cbd5e1',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#3b82f6',
      gradientTo: '#60a5fa',
    },
  },

  sapphire: {
    id: 'sapphire',
    name: 'Sapphire Blue',
    description: 'Premium deep blue',
    emoji: '💠',
    category: 'professional',
    colors: {
      primary: '#1e3a8a',
      background: '#f8fafc',
      foreground: '#1e293b',
      secondary: '#f1f5f9',
      accent: '#e0e7ff',
      border: '#a5b4fc',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#1e3a8a',
      gradientTo: '#3b82f6',
    },
  },

  platinum: {
    id: 'platinum',
    name: 'Platinum Silver',
    description: 'Elegant silver tones',
    emoji: '⚪',
    category: 'professional',
    colors: {
      primary: '#71717a',
      background: '#fafafa',
      foreground: '#18181b',
      secondary: '#f4f4f5',
      accent: '#e4e4e7',
      border: '#d4d4d8',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#71717a',
      gradientTo: '#a1a1aa',
    },
  },

  graphite: {
    id: 'graphite',
    name: 'Graphite',
    description: 'Technical charcoal aesthetic',
    emoji: '⚙️',
    category: 'professional',
    colors: {
      primary: '#52525b',
      background: '#ffffff',
      foreground: '#09090b',
      secondary: '#f4f4f5',
      accent: '#e4e4e7',
      border: '#d4d4d8',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#52525b',
      gradientTo: '#71717a',
    },
  },

  steel: {
    id: 'steel',
    name: 'Steel Blue',
    description: 'Industrial steel aesthetic',
    emoji: '🏭',
    category: 'professional',
    colors: {
      primary: '#0369a1',
      background: '#f8fafc',
      foreground: '#0f172a',
      secondary: '#f0f9ff',
      accent: '#e0f2fe',
      border: '#bae6fd',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#0369a1',
      gradientTo: '#0ea5e9',
    },
  },

  bronze: {
    id: 'bronze',
    name: 'Bronze',
    description: 'Warm professional bronze',
    emoji: '🥉',
    category: 'professional',
    colors: {
      primary: '#92400e',
      background: '#fefce8',
      foreground: '#422006',
      secondary: '#fef9c3',
      accent: '#fef08a',
      border: '#fde047',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#92400e',
      gradientTo: '#b45309',
    },
  },

  emeraldPro: {
    id: 'emeraldPro',
    name: 'Emerald Pro',
    description: 'Professional emerald green',
    emoji: '🏢',
    category: 'professional',
    colors: {
      primary: '#059669',
      background: '#f0fdf4',
      foreground: '#064e3b',
      secondary: '#dcfce7',
      accent: '#bbf7d0',
      border: '#86efac',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#059669',
      gradientTo: '#10b981',
    },
  },

  // Additional Vibrant Themes
  fuchsia: {
    id: 'fuchsia',
    name: 'Fuchsia Pop',
    description: 'Bright fuchsia explosion',
    emoji: '💕',
    category: 'vibrant',
    colors: {
      primary: '#e11d48',
      background: '#fff1f2',
      foreground: '#881337',
      secondary: '#ffe4e6',
      accent: '#fecdd3',
      border: '#fda4af',
      destructive: '#be123c',
    },
    preview: {
      gradientFrom: '#e11d48',
      gradientTo: '#f43f5e',
    },
  },

  electric: {
    id: 'electric',
    name: 'Electric Blue',
    description: 'High-voltage electric blue',
    emoji: '⚡',
    category: 'vibrant',
    colors: {
      primary: '#2563eb',
      background: '#eff6ff',
      foreground: '#1e3a8a',
      secondary: '#dbeafe',
      accent: '#bfdbfe',
      border: '#93c5fd',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#2563eb',
      gradientTo: '#3b82f6',
    },
  },

  neon: {
    id: 'neon',
    name: 'Neon Cyan',
    description: 'Bright neon cyan energy',
    emoji: '🌈',
    category: 'vibrant',
    colors: {
      primary: '#06b6d4',
      background: '#ecfeff',
      foreground: '#164e63',
      secondary: '#cffafe',
      accent: '#a5f3fc',
      border: '#67e8f9',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#06b6d4',
      gradientTo: '#22d3ee',
    },
  },

  // Additional Dark Themes
  darkTeal: {
    id: 'darkTeal',
    name: 'Dark Teal',
    description: 'Deep teal darkness',
    emoji: '🦚',
    category: 'dark',
    colors: {
      primary: '#14b8a6',
      background: '#0a1614',
      foreground: '#ccfbf1',
      secondary: '#042f2e',
      accent: '#134e4a',
      border: '#115e59',
      destructive: '#ef4444',
    },
    preview: {
      gradientFrom: '#14b8a6',
      gradientTo: '#2dd4bf',
    },
  },

  indigoNight: {
    id: 'indigoNight',
    name: 'Indigo Midnight',
    description: 'Deep indigo night',
    emoji: '🌠',
    category: 'dark',
    colors: {
      primary: '#6366f1',
      background: '#0f0a1e',
      foreground: '#e0e7ff',
      secondary: '#1e1b4b',
      accent: '#312e81',
      border: '#4338ca',
      destructive: '#ef4444',
    },
    preview: {
      gradientFrom: '#6366f1',
      gradientTo: '#818cf8',
    },
  },

  amberNight: {
    id: 'amberNight',
    name: 'Amber Night',
    description: 'Dark with warm amber glow',
    emoji: '🔥',
    category: 'dark',
    colors: {
      primary: '#f59e0b',
      background: '#1a1208',
      foreground: '#fef3c7',
      secondary: '#451a03',
      accent: '#78350f',
      border: '#92400e',
      destructive: '#ef4444',
    },
    preview: {
      gradientFrom: '#f59e0b',
      gradientTo: '#fbbf24',
    },
  },

  roseNoir: {
    id: 'roseNoir',
    name: 'Rose Noir',
    description: 'Dark with rose accents',
    emoji: '🥀',
    category: 'dark',
    colors: {
      primary: '#f43f5e',
      background: '#1a0a0f',
      foreground: '#ffe4e6',
      secondary: '#4c0519',
      accent: '#881337',
      border: '#9f1239',
      destructive: '#be123c',
    },
    preview: {
      gradientFrom: '#f43f5e',
      gradientTo: '#fb7185',
    },
  },

  slateNight: {
    id: 'slateNight',
    name: 'Slate Night',
    description: 'Professional dark slate',
    emoji: '🌑',
    category: 'dark',
    colors: {
      primary: '#94a3b8',
      background: '#0f172a',
      foreground: '#f1f5f9',
      secondary: '#1e293b',
      accent: '#334155',
      border: '#475569',
      destructive: '#ef4444',
    },
    preview: {
      gradientFrom: '#94a3b8',
      gradientTo: '#cbd5e1',
    },
  },

  // ─── Tech & Brand Inspired ────────────────────────────────────────

  claudeCode: {
    id: 'claudeCode',
    name: 'Claude Code',
    description: "Anthropic's warm terracotta on a deep terminal dark",
    emoji: '🤖',
    category: 'dark',
    colors: {
      primary: '#d97757',
      background: '#1a1a1a',
      foreground: '#e8e0d8',
      secondary: '#2a2520',
      accent: '#3d322a',
      border: '#4a3f35',
      destructive: '#e06c75',
    },
    preview: {
      gradientFrom: '#d97757',
      gradientTo: '#c4613f',
    },
  },

  claudeLight: {
    id: 'claudeLight',
    name: 'Claude Light',
    description: 'Warm, approachable light theme inspired by Claude',
    emoji: '☀️',
    category: 'light',
    colors: {
      primary: '#d97757',
      background: '#faf8f6',
      foreground: '#2d1f14',
      secondary: '#f0ebe6',
      accent: '#e8ddd4',
      border: '#d4c8bc',
      destructive: '#dc3545',
    },
    preview: {
      gradientFrom: '#d97757',
      gradientTo: '#e8a48c',
    },
  },

  github: {
    id: 'github',
    name: 'GitHub Dark',
    description: 'GitHub-inspired dark developer theme',
    emoji: '🐙',
    category: 'dark',
    colors: {
      primary: '#58a6ff',
      background: '#0d1117',
      foreground: '#c9d1d9',
      secondary: '#161b22',
      accent: '#21262d',
      border: '#30363d',
      destructive: '#f85149',
    },
    preview: {
      gradientFrom: '#58a6ff',
      gradientTo: '#1f6feb',
    },
  },

  vscode: {
    id: 'vscode',
    name: 'VS Code',
    description: 'Visual Studio Code default dark theme',
    emoji: '💻',
    category: 'dark',
    colors: {
      primary: '#569cd6',
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      secondary: '#252526',
      accent: '#2d2d30',
      border: '#3c3c3c',
      destructive: '#f44747',
    },
    preview: {
      gradientFrom: '#569cd6',
      gradientTo: '#4ec9b0',
    },
  },

  discord: {
    id: 'discord',
    name: 'Discord',
    description: 'The iconic blurple chat experience',
    emoji: '💬',
    category: 'dark',
    colors: {
      primary: '#5865f2',
      background: '#313338',
      foreground: '#f2f3f5',
      secondary: '#2b2d31',
      accent: '#383a40',
      border: '#3f4147',
      destructive: '#ed4245',
    },
    preview: {
      gradientFrom: '#5865f2',
      gradientTo: '#7289da',
    },
  },

  spotify: {
    id: 'spotify',
    name: 'Spotify',
    description: 'Music-inspired green on black',
    emoji: '🎵',
    category: 'dark',
    colors: {
      primary: '#1db954',
      background: '#121212',
      foreground: '#ffffff',
      secondary: '#1a1a1a',
      accent: '#282828',
      border: '#333333',
      destructive: '#e34040',
    },
    preview: {
      gradientFrom: '#1db954',
      gradientTo: '#1ed760',
    },
  },

  notion: {
    id: 'notion',
    name: 'Notion',
    description: 'Clean and minimal productivity theme',
    emoji: '📝',
    category: 'light',
    colors: {
      primary: '#2f3437',
      background: '#ffffff',
      foreground: '#37352f',
      secondary: '#f7f6f3',
      accent: '#ebeced',
      border: '#e3e2de',
      destructive: '#eb5757',
    },
    preview: {
      gradientFrom: '#37352f',
      gradientTo: '#787774',
    },
  },

  slack: {
    id: 'slack',
    name: 'Slack',
    description: 'Familiar workspace communication vibes',
    emoji: '💼',
    category: 'dark',
    colors: {
      primary: '#4a154b',
      background: '#1a1d21',
      foreground: '#d1d2d3',
      secondary: '#222529',
      accent: '#2c2e33',
      border: '#383b40',
      destructive: '#e01e5a',
    },
    preview: {
      gradientFrom: '#4a154b',
      gradientTo: '#e01e5a',
    },
  },

  linear: {
    id: 'linear',
    name: 'Linear',
    description: 'Sleek project management aesthetic',
    emoji: '📐',
    category: 'dark',
    colors: {
      primary: '#5e6ad2',
      background: '#141517',
      foreground: '#edeef0',
      secondary: '#1c1d20',
      accent: '#25262a',
      border: '#303136',
      destructive: '#d9534f',
    },
    preview: {
      gradientFrom: '#5e6ad2',
      gradientTo: '#8a8ff8',
    },
  },

  vercel: {
    id: 'vercel',
    name: 'Vercel',
    description: 'Monochrome elegance, pure black and white',
    emoji: '▲',
    category: 'dark',
    colors: {
      primary: '#ffffff',
      background: '#000000',
      foreground: '#ededed',
      secondary: '#111111',
      accent: '#1a1a1a',
      border: '#333333',
      destructive: '#ee5555',
    },
    preview: {
      gradientFrom: '#000000',
      gradientTo: '#333333',
    },
  },

  figma: {
    id: 'figma',
    name: 'Figma',
    description: 'Design tool inspired vibrant palette',
    emoji: '🎨',
    category: 'vibrant',
    colors: {
      primary: '#a259ff',
      background: '#2c2c2c',
      foreground: '#ffffff',
      secondary: '#383838',
      accent: '#444444',
      border: '#4e4e4e',
      destructive: '#f24e1e',
    },
    preview: {
      gradientFrom: '#a259ff',
      gradientTo: '#f24e1e',
    },
  },

  tailwind: {
    id: 'tailwind',
    name: 'Tailwind',
    description: 'Utility-first CSS framework colors',
    emoji: '💨',
    category: 'light',
    colors: {
      primary: '#0ea5e9',
      background: '#f8fafc',
      foreground: '#0f172a',
      secondary: '#f1f5f9',
      accent: '#e2e8f0',
      border: '#cbd5e1',
      destructive: '#ef4444',
    },
    preview: {
      gradientFrom: '#0ea5e9',
      gradientTo: '#06b6d4',
    },
  },

  // ─── Nature & Aesthetic ───────────────────────────────────────────

  aurora: {
    id: 'aurora',
    name: 'Aurora Borealis',
    description: 'Northern lights on a dark sky',
    emoji: '🌌',
    category: 'vibrant',
    colors: {
      primary: '#22d3ee',
      background: '#0a0e1a',
      foreground: '#e0f7fa',
      secondary: '#112240',
      accent: '#1a3353',
      border: '#264466',
      destructive: '#ff6b6b',
    },
    preview: {
      gradientFrom: '#22d3ee',
      gradientTo: '#a78bfa',
    },
  },

  sakura: {
    id: 'sakura',
    name: 'Sakura',
    description: 'Japanese cherry blossom delicacy',
    emoji: '🌸',
    category: 'light',
    colors: {
      primary: '#ec4899',
      background: '#fff5f7',
      foreground: '#4a1942',
      secondary: '#ffe4ef',
      accent: '#ffd1e3',
      border: '#f9a8d4',
      destructive: '#e11d48',
    },
    preview: {
      gradientFrom: '#ec4899',
      gradientTo: '#f9a8d4',
    },
  },

  monokai: {
    id: 'monokai',
    name: 'Monokai',
    description: 'Classic code editor dark with warm accents',
    emoji: '🖥️',
    category: 'dark',
    colors: {
      primary: '#a6e22e',
      background: '#272822',
      foreground: '#f8f8f2',
      secondary: '#3e3d32',
      accent: '#49483e',
      border: '#75715e',
      destructive: '#f92672',
    },
    preview: {
      gradientFrom: '#a6e22e',
      gradientTo: '#f92672',
    },
  },

  dracula: {
    id: 'dracula',
    name: 'Dracula',
    description: 'Popular developer dark theme with purple accents',
    emoji: '🧛',
    category: 'dark',
    colors: {
      primary: '#bd93f9',
      background: '#282a36',
      foreground: '#f8f8f2',
      secondary: '#383a59',
      accent: '#44475a',
      border: '#6272a4',
      destructive: '#ff5555',
    },
    preview: {
      gradientFrom: '#bd93f9',
      gradientTo: '#ff79c6',
    },
  },

  nord: {
    id: 'nord',
    name: 'Nord',
    description: 'Arctic, north-bluish clean aesthetic',
    emoji: '❄️',
    category: 'dark',
    colors: {
      primary: '#88c0d0',
      background: '#2e3440',
      foreground: '#eceff4',
      secondary: '#3b4252',
      accent: '#434c5e',
      border: '#4c566a',
      destructive: '#bf616a',
    },
    preview: {
      gradientFrom: '#88c0d0',
      gradientTo: '#5e81ac',
    },
  },

  solarizedDark: {
    id: 'solarizedDark',
    name: 'Solarized Dark',
    description: 'Ethan Schoonover precision colors for code',
    emoji: '🌗',
    category: 'dark',
    colors: {
      primary: '#268bd2',
      background: '#002b36',
      foreground: '#839496',
      secondary: '#073642',
      accent: '#094554',
      border: '#586e75',
      destructive: '#dc322f',
    },
    preview: {
      gradientFrom: '#268bd2',
      gradientTo: '#2aa198',
    },
  },

  solarizedLight: {
    id: 'solarizedLight',
    name: 'Solarized Light',
    description: 'Warm parchment take on Solarized',
    emoji: '🌕',
    category: 'light',
    colors: {
      primary: '#268bd2',
      background: '#fdf6e3',
      foreground: '#657b83',
      secondary: '#eee8d5',
      accent: '#e4dcc6',
      border: '#93a1a1',
      destructive: '#dc322f',
    },
    preview: {
      gradientFrom: '#268bd2',
      gradientTo: '#2aa198',
    },
  },

  catppuccinMocha: {
    id: 'catppuccinMocha',
    name: 'Catppuccin Mocha',
    description: 'Soothing pastel theme for the high-spirited',
    emoji: '🐱',
    category: 'dark',
    colors: {
      primary: '#cba6f7',
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      secondary: '#313244',
      accent: '#45475a',
      border: '#585b70',
      destructive: '#f38ba8',
    },
    preview: {
      gradientFrom: '#cba6f7',
      gradientTo: '#f5c2e7',
    },
  },

  catppuccinLatte: {
    id: 'catppuccinLatte',
    name: 'Catppuccin Latte',
    description: 'Soft pastel light variant',
    emoji: '☕',
    category: 'light',
    colors: {
      primary: '#8839ef',
      background: '#eff1f5',
      foreground: '#4c4f69',
      secondary: '#e6e9ef',
      accent: '#dce0e8',
      border: '#ccd0da',
      destructive: '#d20f39',
    },
    preview: {
      gradientFrom: '#8839ef',
      gradientTo: '#ea76cb',
    },
  },

  tokyoNight: {
    id: 'tokyoNight',
    name: 'Tokyo Night',
    description: 'Dark blue hues of late-night Tokyo',
    emoji: '🗼',
    category: 'dark',
    colors: {
      primary: '#7aa2f7',
      background: '#1a1b26',
      foreground: '#a9b1d6',
      secondary: '#24283b',
      accent: '#2f3451',
      border: '#3b4261',
      destructive: '#f7768e',
    },
    preview: {
      gradientFrom: '#7aa2f7',
      gradientTo: '#bb9af7',
    },
  },

  gruvboxDark: {
    id: 'gruvboxDark',
    name: 'Gruvbox Dark',
    description: 'Retro groove color scheme for code',
    emoji: '🎸',
    category: 'dark',
    colors: {
      primary: '#fabd2f',
      background: '#282828',
      foreground: '#ebdbb2',
      secondary: '#3c3836',
      accent: '#504945',
      border: '#665c54',
      destructive: '#fb4934',
    },
    preview: {
      gradientFrom: '#fabd2f',
      gradientTo: '#fe8019',
    },
  },

  rosePine: {
    id: 'rosePine',
    name: 'Rose Pine',
    description: 'All natural pine, faux fur and a bit of soho',
    emoji: '🌹',
    category: 'dark',
    colors: {
      primary: '#c4a7e7',
      background: '#191724',
      foreground: '#e0def4',
      secondary: '#1f1d2e',
      accent: '#26233a',
      border: '#403d52',
      destructive: '#eb6f92',
    },
    preview: {
      gradientFrom: '#c4a7e7',
      gradientTo: '#eb6f92',
    },
  },

  // ─── More Light Themes ────────────────────────────────────────────

  paper: {
    id: 'paper',
    name: 'Paper',
    description: 'Ultra clean white-on-white reading experience',
    emoji: '📄',
    category: 'light',
    colors: {
      primary: '#1a1a2e',
      background: '#ffffff',
      foreground: '#1a1a2e',
      secondary: '#f5f5f5',
      accent: '#eeeeee',
      border: '#e0e0e0',
      destructive: '#d32f2f',
    },
    preview: {
      gradientFrom: '#1a1a2e',
      gradientTo: '#536390',
    },
  },

  peach: {
    id: 'peach',
    name: 'Peach Cream',
    description: 'Warm and inviting peach tones',
    emoji: '🍑',
    category: 'light',
    colors: {
      primary: '#f97316',
      background: '#fffbf5',
      foreground: '#431407',
      secondary: '#fff7ed',
      accent: '#fed7aa',
      border: '#fdba74',
      destructive: '#dc2626',
    },
    preview: {
      gradientFrom: '#f97316',
      gradientTo: '#fb923c',
    },
  },

  ice: {
    id: 'ice',
    name: 'Ice',
    description: 'Cool blue minimal with crystalline clarity',
    emoji: '🧊',
    category: 'light',
    colors: {
      primary: '#3b82f6',
      background: '#f0f9ff',
      foreground: '#1e3a5f',
      secondary: '#e0f2fe',
      accent: '#dbeafe',
      border: '#bfdbfe',
      destructive: '#ef4444',
    },
    preview: {
      gradientFrom: '#3b82f6',
      gradientTo: '#93c5fd',
    },
  },

  // ─── More Professional ────────────────────────────────────────────

  fintech: {
    id: 'fintech',
    name: 'Fintech',
    description: 'Banking and financial services aesthetic',
    emoji: '💳',
    category: 'professional',
    colors: {
      primary: '#0052cc',
      background: '#fafbfc',
      foreground: '#172b4d',
      secondary: '#f4f5f7',
      accent: '#ebecf0',
      border: '#dfe1e6',
      destructive: '#de350b',
    },
    preview: {
      gradientFrom: '#0052cc',
      gradientTo: '#0065ff',
    },
  },

  medical: {
    id: 'medical',
    name: 'Medical',
    description: 'Healthcare and wellness trustworthy look',
    emoji: '🏥',
    category: 'professional',
    colors: {
      primary: '#0891b2',
      background: '#f0fdfa',
      foreground: '#134e4a',
      secondary: '#ccfbf1',
      accent: '#99f6e4',
      border: '#5eead4',
      destructive: '#ef4444',
    },
    preview: {
      gradientFrom: '#0891b2',
      gradientTo: '#06b6d4',
    },
  },

  law: {
    id: 'law',
    name: 'Legal',
    description: 'Traditional and authoritative for legal/consulting',
    emoji: '⚖️',
    category: 'professional',
    colors: {
      primary: '#78350f',
      background: '#fefce8',
      foreground: '#422006',
      secondary: '#fef9c3',
      accent: '#fef08a',
      border: '#d4a017',
      destructive: '#991b1b',
    },
    preview: {
      gradientFrom: '#78350f',
      gradientTo: '#a16207',
    },
  },

  // ─── More Vibrant ─────────────────────────────────────────────────

  retroWave: {
    id: 'retroWave',
    name: 'Retrowave',
    description: '80s synthwave neon on dark purple',
    emoji: '🕹️',
    category: 'vibrant',
    colors: {
      primary: '#ff2975',
      background: '#0d0221',
      foreground: '#f0e6ff',
      secondary: '#1a0a3e',
      accent: '#2d1066',
      border: '#4c1d95',
      destructive: '#ff4444',
    },
    preview: {
      gradientFrom: '#ff2975',
      gradientTo: '#f222ff',
    },
  },

  cyberpunk: {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    description: 'High tech, low life, neon yellow on dark',
    emoji: '⚡',
    category: 'vibrant',
    colors: {
      primary: '#f5e642',
      background: '#0c0c1d',
      foreground: '#e0e0e0',
      secondary: '#1a1a2e',
      accent: '#16213e',
      border: '#2c3e6b',
      destructive: '#ff003c',
    },
    preview: {
      gradientFrom: '#f5e642',
      gradientTo: '#00f5d4',
    },
  },

  matrix: {
    id: 'matrix',
    name: 'Matrix',
    description: 'Green phosphor on black terminal',
    emoji: '🟢',
    category: 'vibrant',
    colors: {
      primary: '#00ff41',
      background: '#0d0208',
      foreground: '#00ff41',
      secondary: '#0d1a0f',
      accent: '#1a2e1c',
      border: '#003b00',
      destructive: '#ff073a',
    },
    preview: {
      gradientFrom: '#00ff41',
      gradientTo: '#008f11',
    },
  },

  bubblegum: {
    id: 'bubblegum',
    name: 'Bubblegum',
    description: 'Playful pink and blue candy colors',
    emoji: '🫧',
    category: 'vibrant',
    colors: {
      primary: '#ff6bcb',
      background: '#1a1025',
      foreground: '#f8f0ff',
      secondary: '#2a1a3a',
      accent: '#3a2550',
      border: '#4a3060',
      destructive: '#ff4466',
    },
    preview: {
      gradientFrom: '#ff6bcb',
      gradientTo: '#6b8cff',
    },
  },

  ocean2: {
    id: 'ocean2',
    name: 'Deep Ocean',
    description: 'Bioluminescent blues from the deep sea',
    emoji: '🐠',
    category: 'vibrant',
    colors: {
      primary: '#00d4ff',
      background: '#021526',
      foreground: '#c8f7ff',
      secondary: '#032a40',
      accent: '#054060',
      border: '#0a5580',
      destructive: '#ff6b6b',
    },
    preview: {
      gradientFrom: '#00d4ff',
      gradientTo: '#0077b6',
    },
  },
}

/**
 * Get all presets as an array
 */
export function getAllPresets(): ThemePreset[] {
  return Object.values(THEME_PRESETS)
}

/**
 * Get presets filtered by category
 */
export function getPresetsByCategory(
  category: ThemePreset['category']
): ThemePreset[] {
  return getAllPresets().filter((preset) => preset.category === category)
}

/**
 * Get a specific preset by ID
 */
export function getPresetById(id: string): ThemePreset | undefined {
  return THEME_PRESETS[id]
}

/**
 * Get preset categories
 */
export const PRESET_CATEGORIES = [
  { value: 'all', label: 'All Themes' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'vibrant', label: 'Vibrant' },
  { value: 'professional', label: 'Professional' },
] as const

export { normalizePresetToThemeTokens } from '@/lib/theme/appearance-preferences'

export function getPresetTokens(
  presetId: string,
  mode: 'light' | 'dark' = 'light'
) {
  const preset = THEME_PRESETS[presetId]
  if (!preset) return null
  return normalizePresetToThemeTokens(preset.colors, mode)
}

// Created and developed by Jai Singh
