// Created and developed by Jai Singh
/**
 * OmniBelt — Inventory Lookup tool (P4)
 *
 * Panel shell with a search-by-bin / search-by-part input. The
 * full `/admin/sap-testing` LX03 lookup is too coupled to the
 * SAP-testing dashboard to lift into a small shell for v1, so the
 * shell ships as a STUB with a deep-link to the existing surface.
 * Documented as a P4 deviation (see implementation log).
 *
 * Permission: spec calls for `view:inventory`; the live equivalent
 * is `view:inventory_apps` (the resource that already gates
 * `/apps/inventory`). Mapped to that so the tile is visible to
 * exactly the population that can actually navigate to a fuller
 * inventory surface today.
 */
import { IconPackage } from '@tabler/icons-react'
import type { ToolDef } from '../registry'

export const inventoryLookupTool: ToolDef = {
  id: 'inventory_lookup',
  label: 'Inventory Lookup',
  description: 'Search inventory by bin or part number',
  icon: IconPackage,
  accent: 'violet',
  category: 'operations',
  permission: { action: 'view', resource: 'inventory_apps' },
  searchable: true,
  shell: () => import('../shells/InventoryLookupShell'),
}

// Created and developed by Jai Singh
