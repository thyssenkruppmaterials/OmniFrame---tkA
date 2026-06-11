// Created and developed by Jai Singh
/**
 * OmniBelt — Build Info tool (P3 placeholder)
 *
 * Diagnostic surface showing app mode (`import.meta.env.MODE`) and
 * the current deployed build hash from `/build-info.json`. Used as
 * one of two placeholder tools in P3 so the Panel grid is never
 * empty; P4 keeps it in the final 8-tool roster (spec §11.2).
 *
 * Shell loads lazily on first open — keeps the host bundle slim.
 */
import { IconInfoCircle } from '@tabler/icons-react'
import type { ToolDef } from '../registry'

export const buildInfoTool: ToolDef = {
  id: 'build_info',
  label: 'Build Info',
  description: 'App mode + currently-deployed build hash',
  icon: IconInfoCircle,
  accent: 'cyan',
  category: 'self',
  searchable: true,
  shell: () => import('../shells/BuildInfoShell'),
}

// Created and developed by Jai Singh
