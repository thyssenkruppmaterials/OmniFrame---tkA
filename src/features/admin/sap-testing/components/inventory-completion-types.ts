// Created and developed by Jai Singh
/**
 * Shared types + constants for the LX25 Inventory Completion feature
 * (2026-05-10). Lives in its own `.ts` file (not `.tsx`) so the
 * sibling `<InventoryCompletionView />` component file can stay a
 * pure component file — the `react-refresh/only-export-components`
 * rule yells when a `.tsx` file exports both a component and a
 * non-component value (the constant + the JSX-free type definitions
 * trigger this).
 *
 * Both the agent (`omni_agent/lx25_inventory_completion.py` →
 * `LX25_WAREHOUSES`) and the FE (`inventory-management-tab.tsx`
 * variant-summary panel + `<InventoryCompletionView />` cards grid)
 * default-fall-back to this hardcoded list when a request body / prop
 * doesn't override it. Keep them in lockstep — adding/removing a
 * warehouse on one side without the other will silently desync.
 *
 * Related:
 *   - [[Implementations/Implement-LX25-Inventory-Completion]]
 *   - `omni_agent/lx25_inventory_completion.py` § LX25_WAREHOUSES
 */

/** Hardcoded warehouse + variant mapping. Keep in lockstep with the
 *  Python `LX25_WAREHOUSES` list. */
export const LX25_WAREHOUSES: ReadonlyArray<{
  warehouse: string
  variant: string
}> = [
  { warehouse: 'WH5', variant: 'TKAWH5' },
  { warehouse: 'WH8', variant: 'TKAWH8' },
  { warehouse: 'JSM', variant: 'TKAJSM' },
  { warehouse: 'JSF', variant: 'TKAJSF' },
  { warehouse: 'PDC', variant: 'TKAPDC' },
]

/** One row from the LX25 storage-type-level summary block. */
export interface InventoryCompletionStorageRow {
  storage_type: string
  storage_type_name: string
  total_bins: number
  executed: number
  active: number
  planned: number
  not_executed: number
  completion_pct: number | null
}

/** Per-warehouse fan-out result entry. `ok=false` carries error +
 *  step instead of the metric counts so the FE can render the
 *  failed card with a meaningful message. */
export interface InventoryCompletionWarehouse {
  ok: boolean
  warehouse: string
  variant: string
  /** SAP-side warehouse code from the export header. Usually matches
   *  `warehouse` but a misconfigured variant could mismatch. */
  warehouse_code?: string
  warehouse_name?: string
  storage_types?: InventoryCompletionStorageRow[]
  total_bins?: number
  executed?: number
  active?: number
  planned?: number
  not_executed?: number
  completion_pct?: number | null
  empty?: boolean
  sap_message?: string
  error?: string
  step?: string
  elapsed_sec?: number
}

/** Cross-warehouse aggregate. The agent only sums SUCCESSFUL
 *  warehouses into these totals so a failed variant doesn't skew
 *  the cross-warehouse %. */
export interface InventoryCompletionTotals {
  warehouses_succeeded: number
  warehouses_failed: number
  total_bins: number
  executed: number
  active: number
  planned: number
  not_executed: number
  completion_pct: number | null
}

export interface InventoryCompletionMeta {
  transaction: string
  started_at: string
  elapsed_sec: number
  warehouse_count: number
}

/** Agent response envelope for `/sap/lx25/inventory-completion`. */
export interface InventoryCompletionResult {
  ok: boolean
  warehouses?: InventoryCompletionWarehouse[]
  totals?: InventoryCompletionTotals
  meta?: InventoryCompletionMeta
  error?: string
  step?: string
}

// Created and developed by Jai Singh
