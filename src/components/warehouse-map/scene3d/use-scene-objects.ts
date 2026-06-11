// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Scene-object data hook — TanStack Query read + mutations for the 3D editor.
// ---------------------------------------------------------------------------
// Polling/manual-invalidation only (no supabase.channel) — realtime-policy
// compliant. Reads are resilient: the service returns [] if migration 335 isn't
// applied yet, so the Location tab never breaks.
import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  warehouseSceneObjectsService,
  type NewSceneObject,
} from '@/lib/supabase/warehouse-scene-objects.service'
import type { WarehouseSceneObject } from '../types'

export const sceneObjectsKey = (mapId: string | null | undefined) => [
  'warehouse-scene-objects',
  mapId,
]

export function useSceneObjects(mapId: string | null | undefined) {
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: sceneObjectsKey(mapId),
    queryFn: () => warehouseSceneObjectsService.list(mapId as string),
    enabled: !!mapId,
    staleTime: 30_000,
  })

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: sceneObjectsKey(mapId) }),
    [qc, mapId]
  )

  const create = useCallback(
    async (obj: NewSceneObject) => {
      if (!mapId) return
      const created = await warehouseSceneObjectsService.create(mapId, obj)
      await invalidate()
      return created
    },
    [mapId, invalidate]
  )

  const update = useCallback(
    async (
      id: string,
      patch: Partial<
        Omit<
          WarehouseSceneObject,
          'id' | 'map_id' | 'organization_id' | 'updated_at'
        >
      >
    ) => {
      await warehouseSceneObjectsService.update(id, patch)
      await invalidate()
    },
    [invalidate]
  )

  const remove = useCallback(
    async (id: string) => {
      await warehouseSceneObjectsService.remove(id)
      await invalidate()
    },
    [invalidate]
  )

  const restore = useCallback(
    async (obj: WarehouseSceneObject) => {
      await warehouseSceneObjectsService.restore(obj)
      await invalidate()
    },
    [invalidate]
  )

  // ---- Bulk operations (one invalidation per batch) -----------------------

  const bulkUpdate = useCallback(
    async (
      changes: {
        id: string
        patch: Partial<
          Omit<
            WarehouseSceneObject,
            'id' | 'map_id' | 'organization_id' | 'updated_at'
          >
        >
      }[]
    ) => {
      await Promise.all(
        changes.map((c) => warehouseSceneObjectsService.update(c.id, c.patch))
      )
      await invalidate()
    },
    [invalidate]
  )

  const bulkRemove = useCallback(
    async (ids: string[]) => {
      await Promise.all(
        ids.map((id) => warehouseSceneObjectsService.remove(id))
      )
      await invalidate()
    },
    [invalidate]
  )

  const bulkRestore = useCallback(
    async (objs: WarehouseSceneObject[]) => {
      await Promise.all(
        objs.map((o) => warehouseSceneObjectsService.restore(o))
      )
      await invalidate()
    },
    [invalidate]
  )

  const bulkCreate = useCallback(
    async (objs: NewSceneObject[]) => {
      if (!mapId) return []
      const created = await warehouseSceneObjectsService.bulkCreate(mapId, objs)
      await invalidate()
      return created
    },
    [mapId, invalidate]
  )

  return {
    objects: query.data ?? [],
    isLoading: query.isLoading,
    create,
    update,
    remove,
    restore,
    bulkUpdate,
    bulkRemove,
    bulkRestore,
    bulkCreate,
  }
}

// Created and developed by Jai Singh
