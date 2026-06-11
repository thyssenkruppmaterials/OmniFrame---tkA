// Created and developed by Jai Singh
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — warehouse_scene_objects (migration 335) not yet in generated database.types.ts
// ---------------------------------------------------------------------------
// Scene-object persistence for the 3D Location-tab editor. Kept as a focused
// module (not folded into the 988-line warehouse-map.service.ts) so the editor
// feature is self-contained. Mirrors the CRUD + org-resolution patterns of
// WarehouseMapService.
// ---------------------------------------------------------------------------
import { logger } from '@/lib/utils/logger'
import type {
  SceneObjectKind,
  WarehouseSceneObject,
} from '@/components/warehouse-map/types'
import { supabase } from './client'

const TABLE = 'warehouse_scene_objects'

async function getOrganizationId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.organization_id)
    throw new Error('No organization found for user')
  return profile.organization_id
}

export type NewSceneObject = Pick<
  WarehouseSceneObject,
  'kind' | 'position_x' | 'position_y'
> &
  Partial<
    Pick<
      WarehouseSceneObject,
      | 'label'
      | 'position_z'
      | 'width'
      | 'depth'
      | 'height'
      | 'rotation'
      | 'color'
      | 'floor_level'
      | 'metadata'
    >
  >

export const warehouseSceneObjectsService = {
  /**
   * Fetch all placed objects for a map. Returns [] (never throws) if the table
   * is missing — so the editor degrades gracefully before migration 335 is
   * applied, and the read path can't break the Location tab.
   */
  async list(mapId: string): Promise<WarehouseSceneObject[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('map_id', mapId)
    if (error) {
      logger.warn(
        '[scene-objects] list failed (table may not exist yet)',
        error
      )
      return []
    }
    return (data ?? []) as unknown as WarehouseSceneObject[]
  },

  async create(
    mapId: string,
    obj: NewSceneObject
  ): Promise<WarehouseSceneObject> {
    const organizationId = await getOrganizationId()
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        map_id: mapId,
        organization_id: organizationId,
        position_z: 0,
        width: 100,
        depth: 100,
        height: 100,
        rotation: 0,
        floor_level: 0,
        metadata: {},
        ...obj,
      } as any)
      .select('*')
      .single()
    if (error) throw error
    return data as unknown as WarehouseSceneObject
  },

  async update(
    id: string,
    patch: Partial<
      Omit<
        WarehouseSceneObject,
        'id' | 'map_id' | 'organization_id' | 'updated_at'
      >
    >
  ): Promise<WarehouseSceneObject> {
    const { data, error } = await supabase
      .from(TABLE)
      .update(patch as any)
      .eq('id', id)
      .select('*')
      .single()
    if (error) throw error
    return data as unknown as WarehouseSceneObject
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from(TABLE).delete().eq('id', id)
    if (error) throw error
  },

  /**
   * Re-insert a previously-deleted object with its ORIGINAL id (exact undo of a
   * delete). Strips server-managed timestamps; keeps id/map/org/geometry.
   */
  async restore(obj: WarehouseSceneObject): Promise<WarehouseSceneObject> {
    const { updated_at: _ignored, ...row } = obj
    const { data, error } = await supabase
      .from(TABLE)
      .insert(row as any)
      .select('*')
      .single()
    if (error) throw error
    return data as unknown as WarehouseSceneObject
  },

  /** Bulk insert (used by the "duplicate layout" / seed-from-template flows). */
  async bulkCreate(
    mapId: string,
    objects: NewSceneObject[]
  ): Promise<WarehouseSceneObject[]> {
    if (objects.length === 0) return []
    const organizationId = await getOrganizationId()
    const rows = objects.map((o) => ({
      map_id: mapId,
      organization_id: organizationId,
      position_z: 0,
      width: 100,
      depth: 100,
      height: 100,
      rotation: 0,
      floor_level: 0,
      metadata: {},
      ...o,
    }))
    const { data, error } = await supabase
      .from(TABLE)
      .insert(rows as any)
      .select('*')
    if (error) throw error
    return (data ?? []) as unknown as WarehouseSceneObject[]
  },
}

export type { SceneObjectKind }
// Created and developed by Jai Singh
