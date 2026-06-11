// Created and developed by Jai Singh
/**
 * OmniBelt — Help & Docs shortcut tool (P4)
 *
 * Help-tab navigation tool. The spec calls for `/help`; the
 * concrete route in this app is `/help-center`
 * (`src/routes/_authenticated/help-center/index.tsx`), so we link
 * there to avoid a 404. No permission gate.
 */
import { IconHelpCircle } from '@tabler/icons-react'
import type { ToolDef } from '../registry'

export const helpDocsTool: ToolDef = {
  id: 'help_docs',
  label: 'Help & Docs',
  description: 'Open the help center',
  icon: IconHelpCircle,
  accent: 'indigo',
  category: 'help',
  navigationUrl: '/help-center',
  searchable: true,
}

// Created and developed by Jai Singh
