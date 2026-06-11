// Created and developed by Jai Singh
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'
import type { Tables } from './database.types'

/**
 * Inbound Part Transfer Service
 *
 * Records transfers of TKA batches from the inbound area to a configured
 * drop-off zone and fetches the latest transfer per batch (via
 * v_latest_inbound_part_transfers) for display on Inbound Scan Search.
 */

export type InboundPartTransfer = Tables<'rr_inbound_part_transfers'>

export interface LatestInboundPartTransfer {
  transfer_id: string
  organization_id: string
  tka_batch_number: string
  drop_off_area_id: string
  area_name: string | null
  area_barcode: string | null
  accepted_by_associate_id: string
  associate_user_id: string | null
  associate_name: string | null
  associate_email: string | null
  associate_badge_code: string | null
  dropped_off_by: string
  dropped_off_by_name: string | null
  dropped_off_by_email: string | null
  dropped_off_at: string
  accepted_at: string
  notes: string | null
}

export interface CreateInboundPartTransferInput {
  tka_batch_number: string
  drop_off_area_id: string
  accepted_by_associate_id: string
  notes?: string | null
}

interface InboundScanBatchRow {
  id: string
  tka_batch_number: string | null
  material_number: string | null
  tracking_number: string | null
  so_line_rma_afa: string | null
  quantity: number | null
  hot_truck: boolean | null
  scanned_at: string | null
}

class InboundPartTransferService {
  private static instance: InboundPartTransferService

  private constructor() {}

  public static getInstance(): InboundPartTransferService {
    if (!InboundPartTransferService.instance) {
      InboundPartTransferService.instance = new InboundPartTransferService()
    }
    return InboundPartTransferService.instance
  }

  /**
   * Validate that a TKA batch number has at least one matching inbound scan
   * row (org-scoped via RLS). Returns a lightweight preview payload for the
   * RF confirm screen.
   */
  async findScanByBatch(
    tkaBatchNumber: string
  ): Promise<{ data: InboundScanBatchRow | null; error: unknown }> {
    const normalized = tkaBatchNumber.trim()
    if (!normalized) {
      return { data: null, error: null }
    }

    const { data, error } = await supabase
      .from('rr_inbound_scans')
      .select(
        'id, tka_batch_number, material_number, tracking_number, so_line_rma_afa, quantity, hot_truck, scanned_at'
      )
      .ilike('tka_batch_number', normalized)
      .order('scanned_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      logger.error('Error looking up TKA batch:', error)
    }

    return { data: data as InboundScanBatchRow | null, error }
  }

  async createTransfer(
    input: CreateInboundPartTransferInput
  ): Promise<{ data: InboundPartTransfer | null; error: unknown }> {
    const batch = input.tka_batch_number.trim()
    if (!batch) {
      return { data: null, error: new Error('TKA batch number is required') }
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      logger.error(
        'No authenticated user for inbound part transfer:',
        userError
      )
      return {
        data: null,
        error: userError ?? new Error('Not authenticated'),
      }
    }

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.organization_id) {
      logger.error('Failed to resolve organization for transfer:', profileError)
      return {
        data: null,
        error:
          profileError ??
          new Error('User is not associated with an organization'),
      }
    }

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('rr_inbound_part_transfers')
      .insert({
        organization_id: profile.organization_id,
        tka_batch_number: batch,
        drop_off_area_id: input.drop_off_area_id,
        accepted_by_associate_id: input.accepted_by_associate_id,
        dropped_off_by: user.id,
        dropped_off_at: now,
        accepted_at: now,
        notes: input.notes?.trim() || null,
      })
      .select()
      .single()

    if (error) {
      logger.error('Error creating inbound part transfer:', error)
    }

    return { data, error }
  }

  /**
   * Batched lookup of the latest transfer per TKA batch number.
   * Chunks the `.in()` query to stay within the Postgres/PostgREST param limit.
   */
  async fetchLatestTransfersByBatches(batchNumbers: string[]): Promise<{
    data: Record<string, LatestInboundPartTransfer>
    error: unknown
  }> {
    const unique = Array.from(
      new Set(
        batchNumbers
          .map((b) => (typeof b === 'string' ? b.trim() : ''))
          .filter((b) => b.length > 0)
      )
    )

    if (unique.length === 0) {
      return { data: {}, error: null }
    }

    const CHUNK_SIZE = 200
    const map: Record<string, LatestInboundPartTransfer> = {}

    try {
      // v_latest_inbound_part_transfers is intentionally not in generated
      // Supabase types (adding any view there collides with existing
      // `as any` casts in kit services). Cast at point of use.
      const client = supabase as unknown as {
        from: (table: string) => {
          select: (cols: string) => {
            in: (
              column: string,
              values: string[]
            ) => Promise<{
              data: LatestInboundPartTransfer[] | null
              error: unknown
            }>
          }
        }
      }

      for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
        const chunk = unique.slice(i, i + CHUNK_SIZE)
        const { data, error } = await client
          .from('v_latest_inbound_part_transfers')
          .select('*')
          .in('tka_batch_number', chunk)

        if (error) {
          logger.error('Error fetching latest transfers chunk:', error)
          return { data: map, error }
        }

        for (const row of (data ?? []) as LatestInboundPartTransfer[]) {
          if (row.tka_batch_number) {
            map[row.tka_batch_number] = row
          }
        }
      }

      return { data: map, error: null }
    } catch (error) {
      logger.error('Error batching latest transfers:', error)
      return { data: map, error }
    }
  }

  async fetchTransfersByBatch(
    tkaBatchNumber: string
  ): Promise<{ data: LatestInboundPartTransfer[]; error: unknown }> {
    const normalized = tkaBatchNumber.trim()
    if (!normalized) {
      return { data: [], error: null }
    }

    const { data, error } = await supabase
      .from('rr_inbound_part_transfers')
      .select(
        `
          id,
          organization_id,
          tka_batch_number,
          drop_off_area_id,
          accepted_by_associate_id,
          dropped_off_by,
          dropped_off_at,
          accepted_at,
          notes,
          area:rr_drop_off_areas!rr_inbound_part_transfers_drop_off_area_id_fkey(name, barcode),
          associate:rr_drop_off_area_associates!rr_inbound_part_transfers_accepted_by_associate_id_fkey(
            user_id,
            full_name,
            badge_code,
            user_profile:user_profiles!rr_drop_off_area_associates_user_id_fkey(full_name, email)
          ),
          dropped_by:user_profiles!rr_inbound_part_transfers_dropped_off_by_fkey(full_name, email)
        `
      )
      .ilike('tka_batch_number', normalized)
      .order('dropped_off_at', { ascending: false })

    if (error) {
      logger.error('Error fetching transfer history for batch:', error)
      return { data: [], error }
    }

    const mapped: LatestInboundPartTransfer[] = (data ?? []).map((row) => {
      const area = (row as { area?: { name: string; barcode: string } | null })
        .area
      const associate = (
        row as {
          associate?: {
            user_id: string | null
            full_name: string | null
            badge_code: string | null
            user_profile?: {
              full_name: string | null
              email: string | null
            } | null
          } | null
        }
      ).associate
      const droppedBy = (
        row as {
          dropped_by?: { full_name: string | null; email: string | null } | null
        }
      ).dropped_by

      return {
        transfer_id: row.id,
        organization_id: row.organization_id,
        tka_batch_number: row.tka_batch_number,
        drop_off_area_id: row.drop_off_area_id,
        area_name: area?.name ?? null,
        area_barcode: area?.barcode ?? null,
        accepted_by_associate_id: row.accepted_by_associate_id,
        associate_user_id: associate?.user_id ?? null,
        associate_name:
          associate?.user_profile?.full_name ?? associate?.full_name ?? null,
        associate_email: associate?.user_profile?.email ?? null,
        associate_badge_code: associate?.badge_code ?? null,
        dropped_off_by: row.dropped_off_by,
        dropped_off_by_name: droppedBy?.full_name ?? null,
        dropped_off_by_email: droppedBy?.email ?? null,
        dropped_off_at: row.dropped_off_at,
        accepted_at: row.accepted_at,
        notes: row.notes,
      }
    })

    return { data: mapped, error: null }
  }
}

export const inboundPartTransferService =
  InboundPartTransferService.getInstance()

// Created and developed by Jai Singh
