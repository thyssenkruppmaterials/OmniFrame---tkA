// Created and developed by Jai Singh
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'
import type { Tables } from './database.types'

/**
 * Drop-off Area Service
 *
 * Manages configurable drop-off zones and the associates authorized to accept
 * part drop-offs at each zone. Used by the Inbound Part Transfer RF workflow
 * and the "Manage Drop-off Areas" dialog on Inbound Scan Search.
 */

export type DropOffArea = Tables<'rr_drop_off_areas'>
export type DropOffAreaAssociate = Tables<'rr_drop_off_area_associates'>

export interface OrganizationUser {
  id: string
  full_name: string | null
  email: string | null
}

export interface DropOffAreaAssociateWithUser extends DropOffAreaAssociate {
  user_profile: OrganizationUser | null
}

export type DropOffAreaInsert = {
  organization_id: string
  name: string
  barcode: string
  description?: string | null
  is_active?: boolean
  display_order?: number
  created_by?: string | null
}

export type DropOffAreaUpdate = Partial<
  Pick<
    DropOffArea,
    'name' | 'barcode' | 'description' | 'is_active' | 'display_order'
  >
> & { updated_by?: string | null }

// Associates are now always tied to a real user_profiles row (matched by the
// email encoded in that user's lanyard QR). badge_code and full_name remain
// optional display/label overrides.
export type DropOffAreaAssociateInsert = {
  organization_id: string
  drop_off_area_id: string
  user_id: string
  full_name?: string | null
  badge_code?: string | null
  is_active?: boolean
  created_by?: string | null
}

export type DropOffAreaAssociateUpdate = Partial<
  Pick<DropOffAreaAssociate, 'full_name' | 'badge_code' | 'is_active'>
> & { updated_by?: string | null }

export interface DropOffAreaWithAssociates extends DropOffArea {
  associates: DropOffAreaAssociateWithUser[]
}

class DropOffAreaService {
  private static instance: DropOffAreaService

  private constructor() {}

  public static getInstance(): DropOffAreaService {
    if (!DropOffAreaService.instance) {
      DropOffAreaService.instance = new DropOffAreaService()
    }
    return DropOffAreaService.instance
  }

  async fetchAreasWithAssociates(
    activeOnly = false
  ): Promise<{ data: DropOffAreaWithAssociates[]; error: unknown }> {
    try {
      let areasQuery = supabase
        .from('rr_drop_off_areas')
        .select('*')
        .order('display_order', { ascending: true })
        .order('name', { ascending: true })

      if (activeOnly) {
        areasQuery = areasQuery.eq('is_active', true)
      }

      const { data: areas, error: areasError } = await areasQuery

      if (areasError) {
        logger.error('Error fetching drop-off areas:', areasError)
        return { data: [], error: areasError }
      }

      const areaIds = (areas ?? []).map((area) => area.id)
      if (areaIds.length === 0) {
        return { data: [], error: null }
      }

      let associatesQuery = supabase
        .from('rr_drop_off_area_associates')
        .select(
          `
            *,
            user_profile:user_profiles!rr_drop_off_area_associates_user_id_fkey(
              id,
              full_name,
              email
            )
          `
        )
        .in('drop_off_area_id', areaIds)

      if (activeOnly) {
        associatesQuery = associatesQuery.eq('is_active', true)
      }

      const { data: associates, error: associatesError } = await associatesQuery

      if (associatesError) {
        logger.error(
          'Error fetching drop-off area associates:',
          associatesError
        )
        return { data: [], error: associatesError }
      }

      const associatesByArea = new Map<string, DropOffAreaAssociateWithUser[]>()
      for (const raw of (associates ?? []) as DropOffAreaAssociateWithUser[]) {
        const list = associatesByArea.get(raw.drop_off_area_id) ?? []
        list.push(raw)
        associatesByArea.set(raw.drop_off_area_id, list)
      }

      // Sort each area's associates by display name (user_profile.full_name
      // wins, fallback to stored full_name, then email) so the dialog feels
      // stable across refreshes.
      for (const list of associatesByArea.values()) {
        list.sort((a, b) => {
          const an = (
            a.user_profile?.full_name ||
            a.full_name ||
            a.user_profile?.email ||
            ''
          ).toLowerCase()
          const bn = (
            b.user_profile?.full_name ||
            b.full_name ||
            b.user_profile?.email ||
            ''
          ).toLowerCase()
          return an.localeCompare(bn)
        })
      }

      const combined: DropOffAreaWithAssociates[] = (areas ?? []).map(
        (area) => ({
          ...area,
          associates: associatesByArea.get(area.id) ?? [],
        })
      )

      return { data: combined, error: null }
    } catch (error) {
      logger.error('Error fetching drop-off areas with associates:', error)
      return { data: [], error }
    }
  }

  /**
   * List all user_profiles visible to the current user via RLS (i.e. same
   * organization). Used by the Manage Drop-off Areas dialog to pick who can
   * accept drop-offs at an area.
   */
  async fetchOrganizationUsers(): Promise<{
    data: OrganizationUser[]
    error: unknown
  }> {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, full_name, email')
      .order('full_name', { ascending: true })

    if (error) {
      logger.error('Error fetching organization users:', error)
      return { data: [], error }
    }

    return {
      data: (data ?? []).map((row) => ({
        id: row.id,
        full_name: row.full_name ?? null,
        email: row.email ?? null,
      })),
      error: null,
    }
  }

  async createArea(
    payload: DropOffAreaInsert
  ): Promise<{ data: DropOffArea | null; error: unknown }> {
    const { data, error } = await supabase
      .from('rr_drop_off_areas')
      .insert(payload)
      .select()
      .single()

    if (error) {
      logger.error('Error creating drop-off area:', error)
    }

    return { data, error }
  }

  async updateArea(
    id: string,
    updates: DropOffAreaUpdate
  ): Promise<{ data: DropOffArea | null; error: unknown }> {
    const { data, error } = await supabase
      .from('rr_drop_off_areas')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      logger.error('Error updating drop-off area:', error)
    }

    return { data, error }
  }

  async deleteArea(id: string): Promise<{ success: boolean; error: unknown }> {
    const { error } = await supabase
      .from('rr_drop_off_areas')
      .delete()
      .eq('id', id)

    if (error) {
      logger.error('Error deleting drop-off area:', error)
    }

    return { success: !error, error }
  }

  async createAssociate(
    payload: DropOffAreaAssociateInsert
  ): Promise<{ data: DropOffAreaAssociate | null; error: unknown }> {
    const { data, error } = await supabase
      .from('rr_drop_off_area_associates')
      .insert(payload)
      .select()
      .single()

    if (error) {
      logger.error('Error creating drop-off area associate:', error)
    }

    return { data, error }
  }

  async updateAssociate(
    id: string,
    updates: DropOffAreaAssociateUpdate
  ): Promise<{ data: DropOffAreaAssociate | null; error: unknown }> {
    const { data, error } = await supabase
      .from('rr_drop_off_area_associates')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      logger.error('Error updating drop-off area associate:', error)
    }

    return { data, error }
  }

  async deleteAssociate(
    id: string
  ): Promise<{ success: boolean; error: unknown }> {
    const { error } = await supabase
      .from('rr_drop_off_area_associates')
      .delete()
      .eq('id', id)

    if (error) {
      logger.error('Error deleting drop-off area associate:', error)
    }

    return { success: !error, error }
  }

  /**
   * Look up an active drop-off area by its scannable barcode (org-scoped via RLS).
   * Case-insensitive match on the trimmed barcode.
   */
  async findAreaByBarcode(
    barcode: string
  ): Promise<{ data: DropOffArea | null; error: unknown }> {
    const normalized = barcode.trim()
    if (!normalized) {
      return { data: null, error: null }
    }

    const { data, error } = await supabase
      .from('rr_drop_off_areas')
      .select('*')
      .ilike('barcode', normalized)
      .eq('is_active', true)
      .maybeSingle()

    if (error) {
      logger.error('Error looking up drop-off area by barcode:', error)
    }

    return { data, error }
  }

  /**
   * Resolve an associate authorized to accept drop-offs at a given area by
   * the email encoded in their lanyard QR code. Flow:
   *   1. Look up user_profiles by email (case-insensitive, org-scoped via RLS).
   *   2. Check that user is on the active allow-list for this drop-off area.
   *
   * Returns null if the email doesn't match any user in the org or the user
   * isn't authorized for this area.
   */
  async findAssociateByUserEmail(
    areaId: string,
    email: string
  ): Promise<{
    data: DropOffAreaAssociateWithUser | null
    error: unknown
    reason?: 'unknown_user' | 'not_authorized'
  }> {
    const normalized = email.trim()
    if (!areaId || !normalized) {
      return { data: null, error: null }
    }

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('id, full_name, email')
      .ilike('email', normalized)
      .maybeSingle()

    if (profileError) {
      logger.error(
        'Error resolving associate email to user profile:',
        profileError
      )
      return { data: null, error: profileError }
    }

    if (!profile) {
      return { data: null, error: null, reason: 'unknown_user' }
    }

    const { data: associate, error } = await supabase
      .from('rr_drop_off_area_associates')
      .select('*')
      .eq('drop_off_area_id', areaId)
      .eq('user_id', profile.id)
      .eq('is_active', true)
      .maybeSingle()

    if (error) {
      logger.error('Error looking up associate by user email:', error)
      return { data: null, error }
    }

    if (!associate) {
      return { data: null, error: null, reason: 'not_authorized' }
    }

    return {
      data: {
        ...associate,
        user_profile: {
          id: profile.id,
          full_name: profile.full_name ?? null,
          email: profile.email ?? null,
        },
      },
      error: null,
    }
  }
}

export const dropOffAreaService = DropOffAreaService.getInstance()

// Created and developed by Jai Singh
