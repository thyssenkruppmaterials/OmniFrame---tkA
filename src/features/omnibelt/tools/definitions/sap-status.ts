// Created and developed by Jai Singh
/**
 * OmniBelt — SAP Status tool (P4)
 *
 * Read-only panel surfacing the local SAP agent heartbeat + fleet
 * snapshot from `useAgentDetection` (the same hook that drives the
 * SmartImportButton / Agent Triggers UI). The shell offers a
 * deep-link to `/admin/sap-testing` for users who want to mutate
 * jobs — OmniBelt itself never mutates SAP state.
 *
 * Permission: spec calls for `view:sap_status` which doesn't exist
 * as a seeded resource. The closest live grant is
 * `manage:sap_testing` (the resource the SAP Testing route checks
 * via the sidebar definition) — same population that needs a
 * status surface in the wild. Documented as a P4 deviation.
 */
import { IconPlugConnected } from '@tabler/icons-react'
import type { ToolDef } from '../registry'

export const sapStatusTool: ToolDef = {
  id: 'sap_status',
  label: 'SAP Status',
  description: 'Live agent + RFC heartbeat for SAP integration',
  icon: IconPlugConnected,
  accent: 'blue',
  category: 'operations',
  permission: { action: 'manage', resource: 'sap_testing' },
  searchable: true,
  shell: () => import('../shells/SapStatusShell'),
}

// Created and developed by Jai Singh
