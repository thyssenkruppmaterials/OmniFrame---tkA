// Created and developed by Jai Singh
/**
 * OmniBelt — Settings shortcut tool (P4)
 *
 * Self-tab navigation tool that drops the user at their personal
 * settings index. `/settings` is a real route in this repo
 * (`src/routes/_authenticated/settings/index.tsx`) so we link
 * directly — no permission gate.
 */
import { IconSettings } from '@tabler/icons-react'
import type { ToolDef } from '../registry'

export const settingsShortcutTool: ToolDef = {
  id: 'settings_shortcut',
  label: 'Settings',
  description: 'Open your account & app settings',
  icon: IconSettings,
  accent: 'cyan',
  category: 'self',
  navigationUrl: '/settings',
  searchable: true,
}

// Created and developed by Jai Singh
