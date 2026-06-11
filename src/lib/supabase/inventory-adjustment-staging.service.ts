// Created and developed by Jai Singh
/**
 * Inventory Adjustment Staging — Supabase service.
 *
 * Backs the new "Inventory Adjustment" workflow on the SAP Testing →
 * Inventory Management tab (2026-05-07). Wraps the three operations the
 * FE needs against the migration-288 `inventory_adjustment_staging`
 * table:
 *
 *   - listForOrg(orgId)  — fetch all rows for the user's org, newest first
 *   - insertRow(...)     — append one row from an LT10 + ZMM60 lookup
 *   - removeRow(id)      — delete a single staging row
 *
 * The table isn't in the (auto-generated) `database.types.ts` snapshot
 * yet, so this module owns the one local type narrowing dance and the
 * rest of the codebase consumes a clean, typed API. RLS guarantees
 * org-scoping; the explicit `eq('organization_id', orgId)` filters here
 * are defence-in-depth only.
 *
 * Realtime is intentionally NOT used. See `.cursor/rules/realtime-policy.mdc`
 * — adds happen one-at-a-time via the agent at human pace, the table is
 * org-scoped, and the user driving the inserts is the user reading the
 * table. TanStack Query `invalidateQueries` after each mutation keeps
 * the UI in sync without a Realtime channel.
 */
import type {
  PostgrestError,
  PostgrestSingleResponse,
  PostgrestResponse,
} from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'

/** Shape of a row in `public.inventory_adjustment_staging`. */
export interface InventoryAdjustmentStagingRow {
  id: string
  organization_id: string
  created_by: string | null
  storage_type: string | null
  plant: string | null
  storage_location: string | null
  storage_bin: string | null
  material: string
  total_stock: number
  unit_value: number
  currency: string | null
  /** STORED generated column = total_stock * unit_value. */
  extended_value: number | null
  zmm60_raw: Record<string, unknown> | null
  created_at: string
}

/** Subset the FE INSERTs. The DB fills in `id`, `extended_value`, and
 *  `created_at`; `created_by` is set to the current user. */
export interface InventoryAdjustmentStagingInsert {
  organization_id: string
  created_by: string | null
  storage_type: string | null
  plant: string | null
  storage_location: string | null
  storage_bin: string | null
  material: string
  total_stock: number
  unit_value: number
  currency: string | null
  zmm60_raw: Record<string, unknown> | null
}

const TABLE_NAME = 'inventory_adjustment_staging'

// One-time type narrowing for a table that hasn't been added to the
// generated `Database` type yet. Keep this isolated so the rest of the
// module reads as plain typed code.
type StagingTableClient = {
  select: (columns?: string) => {
    eq: (
      column: string,
      value: string
    ) => {
      order: (
        column: string,
        options: { ascending: boolean }
      ) => Promise<PostgrestResponse<InventoryAdjustmentStagingRow>>
    }
  }
  insert: (
    rows: InventoryAdjustmentStagingInsert | InventoryAdjustmentStagingInsert[]
  ) => {
    select: (columns?: string) => {
      single: () => Promise<
        PostgrestSingleResponse<InventoryAdjustmentStagingRow>
      >
    }
  }
  delete: () => {
    eq: (
      column: string,
      value: string
    ) => {
      eq: (
        column: string,
        value: string
      ) => Promise<{ error: PostgrestError | null }>
    }
  }
}

// The generated `Database` type lags behind the migration; we know the
// shape from migration 288 + the post-apply `information_schema.columns`
// verification, so a one-spot narrowing keeps the rest of the module
// strictly typed. We cast `supabase` itself once so the `.from()` call
// site doesn't need a type-assertion comment.
const _supabaseUntyped = supabase as unknown as {
  from: (table: string) => StagingTableClient
}

function table(): StagingTableClient {
  return _supabaseUntyped.from(TABLE_NAME)
}

/**
 * Fetch every staging row for an org, newest first. Empty array when
 * nothing has been added yet. Caller passes the org id (resolved via
 * `useOrgId()` / `getCurrentOrgId()`) so the hook stays simple and
 * doesn't re-query `user_profiles`.
 */
export async function listInventoryAdjustmentStagingForOrg(
  orgId: string
): Promise<InventoryAdjustmentStagingRow[]> {
  const { data, error } = await table()
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/**
 * INSERT one staging row and return it (with the DB-computed
 * `extended_value` so the caller can update its TanStack cache without
 * a refetch). Throws on PostgREST error so the caller can surface a toast.
 */
export async function insertInventoryAdjustmentStagingRow(
  payload: InventoryAdjustmentStagingInsert
): Promise<InventoryAdjustmentStagingRow> {
  const { data, error } = await table().insert(payload).select('*').single()
  if (error) throw error
  if (!data) {
    throw new Error(
      'Insert succeeded but returned no row — RLS may be blocking SELECT'
    )
  }
  return data
}

/**
 * DELETE one staging row by id, scoped to the user's org so a stale id
 * from a different org can't accidentally cross-contaminate. RLS would
 * also reject it, but the explicit filter avoids a 0-rows silent pass.
 */
export async function deleteInventoryAdjustmentStagingRow(
  id: string,
  orgId: string
): Promise<void> {
  const { error } = await table()
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)
  if (error) throw error
}

// ──────────────────────────────────────────────────────────────────────
// TanStack Query helpers — colocated so the LT10 row action and the
// InventoryAdjustmentView share one cache key without a circular import
// through the view file.
// ──────────────────────────────────────────────────────────────────────

/** Per-org TanStack Query key for the staging-row list. Pass the
 *  current orgId so a tenant switch invalidates the cache without
 *  manual refetch. Returned as a constant tuple so consumers can use
 *  it directly with `useQuery`. */
export function inventoryAdjustmentStagingQueryKey(
  orgId: string | null
): readonly ['inventory-adjustment-staging', string | null] {
  return ['inventory-adjustment-staging', orgId] as const
}

/** Convenience for callers that need to invalidate the staging cache
 *  without binding to a specific org id (TanStack Query treats prefix
 *  invalidation as exact-match by default; we widen to "any orgId"). */
export const INV_ADJUSTMENT_STAGING_KEY_PREFIX = [
  'inventory-adjustment-staging',
] as const

/** One-shot helper used by the LT10 "+ Add to Inv. Adjust" handler.
 *  Wraps `insertInventoryAdjustmentStagingRow` + an invalidate callback
 *  so the row action stays a single call. The caller passes the
 *  invalidate fn (typically `queryClient.invalidateQueries({...})`) to
 *  avoid coupling this module to TanStack Query directly. */
export async function appendInventoryAdjustmentRow(
  payload: InventoryAdjustmentStagingInsert,
  invalidate: () => void
): Promise<InventoryAdjustmentStagingRow> {
  const inserted = await insertInventoryAdjustmentStagingRow(payload)
  invalidate()
  return inserted
}

// Created and developed by Jai Singh
