// Created and developed by Jai Singh
/**
 * OmniBelt — Tool registry (P3 skeleton)
 *
 * Central definition of every tool surface the launcher knows about.
 * Mirrors spec §11.1. P4 fills in the full 8-tool roster; P3 ships
 * two placeholder tools (`build_info`, `quick_note`) so the Panel
 * grid has something to render and the resolve pipeline exercises
 * end-to-end.
 *
 * Each definition is plain data plus a lazy `shell` import for
 * tools that render in-panel UI (vs `navigationUrl` for tools that
 * just route somewhere). Tools are filtered by:
 *   1. Org allow-list (settings.system.omnibelt.allow_list)
 *   2. Role default_tool_ids (when admin-curated)
 *   3. Per-user hidden_tool_ids
 *   4. Per-tool permission via `usePermissionStore.hasPermission(...)`
 *
 * The shape intentionally avoids hard React/lucide deps at runtime so
 * the registry can be tree-shaken from non-UI consumers (admin
 * dashboard config previewer in P8).
 */
import type { ComponentType } from 'react'
import { agentChatTool } from './definitions/agent-chat'
import { backgroundJobsTool } from './definitions/background-jobs'
import { buildInfoTool } from './definitions/build-info'
import { helpDocsTool } from './definitions/help-docs'
import { inventoryLookupTool } from './definitions/inventory-lookup'
import { quickNoteTool } from './definitions/quick-note'
// ---------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------
//
// P4 shipped the v1 8-tool roster from spec §11.2. 2026-05-24 PM
// adds `agent_chat` between `background_jobs` and `quick_note` so the
// "self" cluster lists the most recently launched tool first. Order
// matters: it drives default tile placement in the Panel grid until
// the user (or an admin role) overrides it via `tool_order`.
//
//   1. `quick_pick`        — operations  (route)
//   2. `sap_status`        — operations  (panel shell)
//   3. `inventory_lookup`  — operations  (panel shell)
//   4. `background_jobs`   — self        (panel shell — P5 lands live data)
//   5. `agent_chat`        — self        (panel shell — v1 stubbed agent)
//   6. `quick_note`        — self        (panel shell)
//   7. `build_info`        — self        (panel shell)
//   8. `settings_shortcut` — self        (route)
//   9. `help_docs`         — help        (route)

import { quickPickTool } from './definitions/quick-pick'
import { sapStatusTool } from './definitions/sap-status'
import { settingsShortcutTool } from './definitions/settings-shortcut'

/**
 * Icon component shape. Tabler-react and lucide-react both render
 * a React component accepting `className` + optional `size` — we
 * keep the type loose so either family slots in without per-tool
 * cast noise.
 */
export type OmnibeltIconComponent = ComponentType<{
  className?: string
  size?: number | string
}>

/** Accent tone — drives the icon disc gradient + halo color when a
 *  job is attached. Mirrors the `--omnibelt-job-*` token family in
 *  spec §10.3. */
export type ToolAccent =
  | 'teal'
  | 'blue'
  | 'violet'
  | 'amber'
  | 'rose'
  | 'lime'
  | 'cyan'
  | 'indigo'

/** Coarse category — drives panel tab placement and admin grouping. */
export type ToolCategory = 'operations' | 'admin' | 'self' | 'help'

/** Props handed to every lazy panel shell. */
export type ToolShellProps = {
  onClose: () => void
}

/** Badge descriptor returned by an optional `badge()` callback —
 *  e.g. "3 SAP jobs queued". Tone drives the dot color. */
export type ToolBadge = {
  count: number
  tone: 'info' | 'warn' | 'error'
}

/**
 * Public tool definition. EITHER `navigationUrl` (route via
 * TanStack Router) OR `shell` (lazy-loaded panel UI) — not both.
 */
export type ToolDef = {
  id: string
  label: string
  description?: string
  icon: OmnibeltIconComponent
  accent: ToolAccent
  category: ToolCategory
  /** RBAC gate — paired against `usePermissionStore.hasPermission`. */
  permission?: { action: string; resource: string }
  /** Mutually exclusive with `shell`. */
  navigationUrl?: string
  /** Mutually exclusive with `navigationUrl`. */
  shell?: () => Promise<{ default: ComponentType<ToolShellProps> }>
  /** Whether to surface in the panel's search-box. */
  searchable: boolean
  /** Optional live badge for the tool tile. */
  badge?: () => ToolBadge | null
}

export const TOOL_REGISTRY: readonly ToolDef[] = [
  quickPickTool,
  sapStatusTool,
  inventoryLookupTool,
  backgroundJobsTool,
  agentChatTool,
  quickNoteTool,
  buildInfoTool,
  settingsShortcutTool,
  helpDocsTool,
]

// Created and developed by Jai Singh
