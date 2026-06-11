// Created and developed by Jai Singh
/**
 * Warehouse Allowlist Service
 *
 * CRUD for the `warehouses` table (migration 334). The table is the canonical
 * per-organization set of valid warehouse codes. It powers two surfaces:
 *   - The "Warehouses" sub-tab in Count Settings (admin edit/add/remove).
 *   - The RF put-away scan allowlist (`parseTONumber`) which hard-blocks codes
 *     that aren't in this list, stopping scanner-corrupted values (H52, -01,
 *     SF1, ...) from persisting at the source.
 *
 * Mirrors the shape of `priority-rules.service.ts`. The generated supabase
 * types don't yet include `warehouses` (added in migration 334), so the
 * client is cast to bypass the typed overload until the next
 * `pnpm supabase gen types` regeneration — same approach the priority-rules
 * and sap-audit services already take.
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

export interface Warehouse {
  id: string
  organization_id: string
  code: string
  name: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type WarehouseUpsert = Pick<
  Warehouse,
  'code' | 'name' | 'is_active' | 'sort_order'
> & { id?: string }

async function currentOrgId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  return profile?.organization_id ?? null
}

export async function listWarehouses(): Promise<Warehouse[]> {
  try {
    const orgId = await currentOrgId()
    if (!orgId) return []

    const { data, error } = await (supabase as any)
      .from('warehouses')
      .select('*')
      .eq('organization_id', orgId)
      .order('sort_order', { ascending: true })
      .order('code', { ascending: true })

    if (error) {
      logger.error('listWarehouses error:', error)
      return []
    }
    return (data ?? []) as Warehouse[]
  } catch (err) {
    logger.error('listWarehouses exception:', err)
    return []
  }
}

export async function upsertWarehouse(
  warehouse: WarehouseUpsert
): Promise<Warehouse | null> {
  try {
    const orgId = await currentOrgId()
    if (!orgId) throw new Error('No organization for current user')

    const {
      data: { user },
    } = await supabase.auth.getUser()

    const code = warehouse.code.trim().toUpperCase()
    if (!code) throw new Error('Warehouse code is required')

    const payload: Record<string, unknown> = {
      organization_id: orgId,
      code,
      name: warehouse.name?.trim() || null,
      is_active: warehouse.is_active,
      sort_order: warehouse.sort_order,
      updated_by: user?.id ?? null,
    }
    if (warehouse.id) {
      payload.id = warehouse.id
    } else {
      payload.created_by = user?.id ?? null
    }

    const { data, error } = await (supabase as any)
      .from('warehouses')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single()

    if (error) {
      logger.error('upsertWarehouse error:', error)
      throw error
    }
    return data as Warehouse
  } catch (err) {
    logger.error('upsertWarehouse exception:', err)
    throw err
  }
}

export async function deleteWarehouse(id: string): Promise<void> {
  try {
    const { error } = await (supabase as any)
      .from('warehouses')
      .delete()
      .eq('id', id)
    if (error) throw error
  } catch (err) {
    logger.error('deleteWarehouse exception:', err)
    throw err
  }
}

// Created and developed by Jai Singh
