---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# ThemeSystem - Styling

## Purpose
Documents the comprehensive theming system in OneBox, covering CSS variable-based styling, dark/light/system/custom modes, theme presets, color generation, and user appearance preferences.

## Architecture Overview

The theme system consists of three layers:
1. **Preferences Engine** (`lib/theme/appearance-preferences.ts`) — V2 preferences format, token normalization, persistence, migration
2. **Preset Library** (`lib/theme/presets.ts`) — 50+ pre-designed color schemes
3. **Color Generator** (`lib/theme/shadcn-color-generator.ts`) — OKLCH-based color generation from base colors
4. **UI Components** (`components/theme/`) — Selector, preview, import/export UI

## Theme Modes

```typescript
type ThemeMode = 'light' | 'dark' | 'system' | 'custom'
type CustomBehavior = 'follow-system' | 'light' | 'dark'
```

- **light/dark** — Static mode
- **system** — Follows `prefers-color-scheme` media query
- **custom** — User-defined palette with configurable behavior (follow system, force light, or force dark)

## Theme Tokens (V2 Format)

15-token palette defining all semantic colors:

```typescript
interface ThemeTokens {
  background: string    // Page background
  foreground: string    // Default text color
  card: string          // Card background
  primary: string       // Primary brand color
  secondary: string     // Secondary surfaces
  accent: string        // Accent/highlight
  muted: string         // Muted backgrounds
  border: string        // Border color
  ring: string          // Focus ring
  destructive: string   // Danger/error
  chart1-5: string      // Chart colors (5 slots)
}
```

**Derived tokens** (auto-computed from base tokens):
- `card-foreground`, `popover`, `popover-foreground`
- `primary-foreground`, `secondary-foreground`, `accent-foreground`
- `muted-foreground`, `destructive-foreground`
- `input`, `sidebar-*` (7 sidebar tokens)
- Foreground colors auto-selected for WCAG 4.5:1 contrast ratio

## CSS Variable Strategy

All tokens are converted to **OKLCH** color space and applied as CSS custom properties:
- `--background`, `--foreground`, `--primary`, `--secondary`, etc.
- `--chart-1` through `--chart-5`
- `--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, etc.
- `--radius` — Border radius (preset-based)

## Appearance Preferences (V2)

```typescript
interface AppearancePreferencesV2 {
  version: 2
  theme: ThemeMode
  customBehavior: CustomBehavior
  customPalettes: {
    light: ThemeTokens
    dark: ThemeTokens
  }
  font: FontOption
  radius: RadiusPreset  // 'compact' | 'default' | 'comfortable' | 'rounded'
}
```

**Radius presets:**
| Preset | Value |
|--------|-------|
| compact | 0.25rem |
| default | 0.625rem |
| comfortable | 0.75rem |
| rounded | 1rem |

**Storage:** `localStorage` key `appearance-preferences-v2`

**Legacy migration:** Auto-migrates from V1 keys (`vite-ui-theme`, `custom-theme-colors`, `font`)

## Theme Presets Library

50+ presets across 4 categories:
- **Light** (14): Default Blue, Ocean, Forest, Coral, Lavender, Sky, Mint, Sand, Cherry, warm light theme preset (see `src/lib/theme/presets.ts`), Sakura, Solarized Light, Catppuccin Latte, Paper, Peach, Ice, Notion, Tailwind
- **Dark** (16): Midnight Purple, Onyx, Deep Ocean, Emerald Night, Charcoal, warm dark theme preset (see `src/lib/theme/presets.ts`), GitHub, VS Code, Discord, Spotify, Slack, Linear, Vercel, Monokai, Dracula, Nord, Solarized Dark, Catppuccin Mocha, Tokyo Night, Gruvbox, Rose Pine, Slate Night, Indigo Night, Amber Night, Rose Noir, Dark Teal
- **Vibrant** (12): Sunset, Rose, Lime, Violet, Teal, Amber, Crimson, Fuchsia, Electric, Neon, Figma, Aurora, Retrowave, Cyberpunk, Matrix, Bubblegum, Deep Ocean
- **Professional** (12): Corporate, Navy, Slate, Executive, Sapphire, Platinum, Graphite, Steel, Bronze, Emerald Pro, Fintech, Medical, Legal

Each preset defines 7 base colors (primary, background, foreground, secondary, accent, border, destructive) plus optional gradient preview.

## shadcn/ui Color Generator

Generates complete palettes from a single base color using OKLCH color space (via `culori` library).

**12 base colors:** slate, gray, zinc, neutral, stone, red, rose, orange, green, blue, yellow, violet

The generator creates harmonious light and dark mode palettes by adjusting OKLCH lightness and chroma values while preserving the base hue.

## Color Derivation

- `deriveDarkFromLight()` — Inverts lightness to create dark counterpart
- `deriveLightFromDark()` — Inverts lightness to create light counterpart
- `computeDerivedTokens()` — Generates foreground colors for each surface using WCAG contrast checking
- `surfaceForeground()` — Selects foreground color that meets 4.5:1 contrast ratio

## Theme UI Components

| Component | File | Description |
|-----------|------|-------------|
| ThemePresetSelector | `theme-preset-selector.tsx` | Grid/list view of all presets with search, category filter, compact/detailed views |
| ThemeLivePreview | `theme-live-preview.tsx` | Live preview panel showing buttons, inputs, badges, cards, sidebar with active tokens |
| ThemeImportExport | `theme-import-export.tsx` | JSON import/export of theme preferences |
| ColorTokenField | `color-token-field.tsx` | Individual color token editor |
| ContrastIndicator | `contrast-indicator.tsx` | WCAG contrast ratio display |
| ShadcnBaseColorSelector | `shadcn-base-color-selector.tsx` | shadcn/ui base color picker |

## Import/Export Validation

The `validateImportPayload()` function validates imported theme JSON:
- Checks required `version: 2`
- Validates allowed keys
- Validates font against supported fonts list
- Validates radius against allowed presets
- Validates all hex colors in palettes

## Related
- [[UILibrary - Component Catalog]]
- [[UI-Component-Conventions]]
- [[Layout - App Shell]]
