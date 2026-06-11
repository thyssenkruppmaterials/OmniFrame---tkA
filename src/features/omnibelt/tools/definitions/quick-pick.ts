// Created and developed by Jai Singh
/**
 * OmniBelt — Quick Pick tool (P4)
 *
 * Operations-tab navigation tool that takes the operator to the
 * outbound picking surface. Spec §11.2 lists the canonical target
 * as `/operations/pick/quick`, but no `/operations/*` route exists
 * in the v1 router; the closest production-shipped equivalent is
 * the outbound applications hub at `/apps/outbound`, which already
 * houses the picking workflow and is the route Outbound users hit
 * today. Documented as a P4 deviation.
 *
 * Permission: spec calls for `view:operations` — the corresponding
 * permission resource was never seeded (no `operations` row in the
 * `permissions` table). Mapped instead to the live
 * `view:outbound_apps` resource that already gates the same route
 * via `createStandardProtectedRoute('OUTBOUND')` in
 * `src/lib/auth/route-protection.ts`. This keeps the OmniBelt tile
 * visible exactly to users who can reach the destination — the
 * tile would 403 otherwise.
 */
import { IconHandClick } from '@tabler/icons-react'
import type { ToolDef } from '../registry'

export const quickPickTool: ToolDef = {
  id: 'quick_pick',
  label: 'Quick Pick',
  description: 'Jump to the outbound picking workflow',
  icon: IconHandClick,
  accent: 'teal',
  category: 'operations',
  permission: { action: 'view', resource: 'outbound_apps' },
  navigationUrl: '/apps/outbound',
  searchable: true,
}

// Created and developed by Jai Singh
