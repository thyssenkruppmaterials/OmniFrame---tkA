// Created and developed by Jai Singh
/**
 * Warehouse allowlist hooks.
 *
 * `useWarehouses()` — admin CRUD surface (Count Settings > Warehouses).
 * `useWarehouseCodes()` — read-only accessor the RF put-away scan path uses to
 *   validate scanned warehouse codes. Returns a `Set` of active codes plus an
 *   `isLoaded` flag. Enforcement is gated on `isLoaded` by the caller so a
 *   transient outage never hard-blocks the floor (fail-open); the
 *   `FALLBACK_WAREHOUSE_CODES` constant keeps `codes` populated for display.
 */
import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  deleteWarehouse,
  listWarehouses,
  upsertWarehouse,
  type Warehouse,
  type WarehouseUpsert,
} from '@/lib/supabase/warehouses.service'

export const WAREHOUSES_QUERY_KEY = ['warehouses'] as const

/**
 * Offline / pre-load fallback. The three real warehouses confirmed in the
 * data and seeded by migration 334. Used so the scan path always has a sane
 * default set before the DB list resolves — but enforcement is gated on
 * `isLoaded`, so this never causes a hard block on a transient outage.
 */
export const FALLBACK_WAREHOUSE_CODES = ['PDC', 'WH5', 'JSF'] as const

export interface UseWarehousesReturn {
  warehouses: Warehouse[]
  isLoading: boolean
  isMutating: boolean
  save: (warehouse: WarehouseUpsert) => Promise<Warehouse | null>
  remove: (id: string) => Promise<void>
  refetch: () => Promise<void>
}

export function useWarehouses(): UseWarehousesReturn {
  const queryClient = useQueryClient()

  const { data, isLoading, refetch } = useQuery({
    queryKey: WAREHOUSES_QUERY_KEY,
    queryFn: listWarehouses,
    staleTime: 60_000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: WAREHOUSES_QUERY_KEY })
  }

  const { mutateAsync: upsertMutateAsync, isPending: isUpserting } =
    useMutation({
      mutationFn: upsertWarehouse,
      onSuccess: invalidate,
      onError: (err) =>
        toast.error(
          err instanceof Error ? err.message : 'Failed to save warehouse'
        ),
    })

  const { mutateAsync: deleteMutateAsync, isPending: isDeleting } = useMutation(
    {
      mutationFn: deleteWarehouse,
      onSuccess: invalidate,
      onError: (err) =>
        toast.error(
          err instanceof Error ? err.message : 'Failed to delete warehouse'
        ),
    }
  )

  const save = useCallback(
    async (warehouse: WarehouseUpsert) => await upsertMutateAsync(warehouse),
    [upsertMutateAsync]
  )

  const remove = useCallback(
    async (id: string) => {
      await deleteMutateAsync(id)
    },
    [deleteMutateAsync]
  )

  const manualRefetch = useCallback(async () => {
    await refetch()
  }, [refetch])

  return {
    warehouses: data ?? [],
    isLoading,
    isMutating: isUpserting || isDeleting,
    save,
    remove,
    refetch: manualRefetch,
  }
}

export interface UseWarehouseCodesReturn {
  /** Active warehouse codes (UPPER). DB-backed when loaded, else fallback. */
  codes: ReadonlySet<string>
  /**
   * True only when the DB list has successfully resolved with ≥1 active code.
   * Callers should enforce the allowlist ONLY when this is true so a loading /
   * errored fetch fails open (never hard-blocks the warehouse floor).
   */
  isLoaded: boolean
}

export function useWarehouseCodes(): UseWarehouseCodesReturn {
  const { data, isSuccess } = useQuery({
    queryKey: WAREHOUSES_QUERY_KEY,
    queryFn: listWarehouses,
    staleTime: 60_000,
  })

  return useMemo(() => {
    const active = (data ?? [])
      .filter((w) => w.is_active)
      .map((w) => w.code.toUpperCase())
    const hasRows = active.length > 0
    const codes: ReadonlySet<string> = new Set<string>(
      hasRows ? active : FALLBACK_WAREHOUSE_CODES
    )
    return { codes, isLoaded: isSuccess && hasRows }
  }, [data, isSuccess])
}

// Created and developed by Jai Singh
