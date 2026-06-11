// Created and developed by Jai Singh
/**
 * OmniBelt — Quick Note tool (P3 placeholder)
 *
 * Per-user localStorage scratchpad. Useful by itself, doubles as a
 * smoke test that the lazy-shell pipeline + per-user store wiring
 * are functional. Persists under
 *   `omniframe.omnibelt.quick-note.${userId}`
 * (separate from the main store key so a `reset()` doesn't nuke
 * the user's notes).
 *
 * P4 keeps this in the final 8-tool roster (spec §11.2).
 */
import { IconNotebook } from '@tabler/icons-react'
import type { ToolDef } from '../registry'

export const quickNoteTool: ToolDef = {
  id: 'quick_note',
  label: 'Quick Note',
  description: 'Per-user scratchpad saved to your browser',
  icon: IconNotebook,
  accent: 'amber',
  category: 'self',
  searchable: true,
  shell: () => import('../shells/QuickNoteShell'),
}

// Created and developed by Jai Singh
