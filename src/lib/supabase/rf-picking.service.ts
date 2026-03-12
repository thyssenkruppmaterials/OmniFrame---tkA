/**
 * RF Picking Operations Service
 * Handles all picking-related database operations for RF Terminal
 * Follows OmniFrame service patterns and integrates with Supabase outbound_to_data table
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

// Types
export interface RFPickingOperation {
  id: string
  delivery: string
  material: string
  material_description: string | null
  source_storage_bin: string
  source_target_qty: number
  picked_qty: number
  picker_user_id: string
  picker_user_name: string
  picked_at: string
  pick_status: 'picked' | 'picked_short' | 'picked_split' | 'not_in_location'
  exception_reason?: string
  organization_id: string
}

export interface RFPickingDelivery {
  delivery: string
  items: RFPickingItem[]
  total_expected_qty: number
  unique_locations: string[]
  warehouse_number?: string
}

export interface RFPickingItem {
  id: string
  material: string
  material_description: string | null
  source_storage_bin: string
  source_target_qty: number
  batch?: string
  transfer_order_number?: string
  warehouse_number?: string
  current_status: string
}

export interface RFPickingValidation {
  isValid: boolean
  message?: string
  expectedQuantity?: number
  isShortPick?: boolean
  isOverPick?: boolean
  quantityDifference?: number
}

export interface RFPickingStats {
  total_picks: number
  today_picks: number
  week_picks: number
  short_picks: number
  over_picks: number
  not_in_location_picks: number
  average_pick_time: number
}

/**
 * RF Picking Service Class
 * Handles CRUD operations for RF picking workflow using outbound_to_data table
 */
class RFPickingService {
  /**
   * Get delivery items for picking by delivery number
   * @param deliveryNumber - Delivery number to search for
   * @returns Promise with delivery data or error
   */
  async getDeliveryItems(
    deliveryNumber: string
  ): Promise<{ data: RFPickingDelivery | null; error: string | null }> {
    try {
      logger.log(
        '🔍 RF Picking Service: Searching for delivery:',
        deliveryNumber
      )

      // Get the user's organization ID
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: null, error: 'User not authenticated' }
      }

      // Get user profile to get organization_id
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        logger.error(
          '❌ RF Picking Service: Error getting user profile:',
          profileError
        )
        return { data: null, error: 'Failed to get user organization' }
      }

      // Query outbound_to_data for delivery items
      const { data: deliveryItems, error } = await supabase
        .from('outbound_to_data')
        .select(
          `
          id,
          delivery,
          material,
          material_description,
          source_storage_bin,
          source_target_qty,
          batch,
          transfer_order_number,
          warehouse_number,
          status
        `
        )
        .eq('organization_id', profile.organization_id || '')
        .eq('delivery', deliveryNumber)
        .in('status', ['processing']) // Only waved deliveries ready for picking
        .order('transfer_order_number', { ascending: true })
        .order('source_storage_bin', { ascending: true })
        .order('material', { ascending: true })

      if (error) {
        logger.error('❌ RF Picking Service: Database error:', error)
        return { data: null, error: error.message }
      }

      if (!deliveryItems || deliveryItems.length === 0) {
        logger.log(
          `❌ RF Picking Service: No items found for delivery: ${deliveryNumber}`
        )

        // Check if delivery exists in pending status (not yet waved)
        const { data: pendingDelivery, error: pendingError } = await supabase
          .from('outbound_to_data')
          .select('delivery, status')
          .eq('organization_id', profile.organization_id || '')
          .eq('delivery', deliveryNumber)
          .in('status', ['pending'])
          .limit(1)

        if (!pendingError && pendingDelivery && pendingDelivery.length > 0) {
          return {
            data: null,
            error: `Delivery ${deliveryNumber} has not been waved. Please wave the delivery in the Outbound Apps Data Manager before picking.`,
          }
        }

        return {
          data: null,
          error: `Delivery ${deliveryNumber} not found or already picked`,
        }
      }

      // Transform data into picking format
      const items: RFPickingItem[] = deliveryItems.map((item) => ({
        id: item.id,
        material: item.material || '',
        material_description: item.material_description || null,
        source_storage_bin: item.source_storage_bin || '',
        source_target_qty:
          typeof item.source_target_qty === 'number'
            ? item.source_target_qty
            : parseFloat(String(item.source_target_qty || '0')) || 0,
        batch: item.batch || undefined,
        transfer_order_number: item.transfer_order_number || undefined,
        warehouse_number: item.warehouse_number || undefined,
        current_status: item.status,
      }))

      // Calculate totals and get unique locations
      const total_expected_qty = items.reduce(
        (sum, item) => sum + item.source_target_qty,
        0
      )
      logger.log(
        `🔢 RF Picking Service: Calculated total_expected_qty: ${total_expected_qty} from ${items.length} items`
      )
      const unique_locations = [
        ...new Set(
          items.map((item) => item.source_storage_bin).filter(Boolean)
        ),
      ]

      const deliveryData: RFPickingDelivery = {
        delivery: deliveryNumber,
        items,
        total_expected_qty,
        unique_locations,
        warehouse_number: items[0]?.warehouse_number,
      }

      logger.log(
        `✅ RF Picking Service: Found ${items.length} items for delivery ${deliveryNumber}`
      )
      return { data: deliveryData, error: null }
    } catch (error: unknown) {
      logger.error('❌ RF Picking Service: Unexpected error:', error)
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Validate picked quantity against expected
   * @param expectedQty - Expected quantity
   * @param pickedQty - Actual picked quantity
   * @returns Validation result with pick type
   */
  validatePickedQuantity(
    expectedQty: number,
    pickedQty: number
  ): RFPickingValidation {
    // Handle negative quantities
    if (pickedQty < 0) {
      return { isValid: false, message: 'Quantity cannot be negative' }
    }

    // Handle zero quantity (not in location)
    if (pickedQty === 0) {
      return {
        isValid: true,
        message: 'Zero quantity - Item not in location',
        expectedQuantity: expectedQty,
        quantityDifference: expectedQty,
      }
    }

    // ✅ FIX: Use epsilon-based comparison for floating point safety
    // Database stores quantities as decimal strings like "60.00" which can cause precision issues
    const EPSILON = 0.001 // Tolerance for floating point comparison
    const difference = Math.abs(pickedQty - expectedQty)

    // Perfect pick - quantities match within tolerance
    if (difference < EPSILON) {
      return {
        isValid: true,
        message: 'Perfect pick - quantities match',
        expectedQuantity: expectedQty,
      }
    }

    // Short pick - picked less than expected
    if (pickedQty < expectedQty) {
      return {
        isValid: true,
        message: `Short pick detected: Expected ${expectedQty}, picked ${pickedQty}`,
        expectedQuantity: expectedQty,
        isShortPick: true,
        quantityDifference: expectedQty - pickedQty,
      }
    }

    // Over pick - picked more than expected
    if (pickedQty > expectedQty) {
      return {
        isValid: true,
        message: `Over pick detected: Expected ${expectedQty}, picked ${pickedQty}`,
        expectedQuantity: expectedQty,
        isOverPick: true,
        quantityDifference: pickedQty - expectedQty,
      }
    }

    return { isValid: false, message: 'Unknown validation state' }
  }

  /**
   * Complete pick operation for a SINGLE ITEM with status update
   * @param itemId - Specific item ID to update (NOT the entire delivery)
   * @param pickedQty - Actual picked quantity
   * @param pickStatus - Pick result status
   * @param exceptionReason - Optional exception reason
   * @returns Promise with operation result
   */
  async completePick(
    itemId: string,
    _pickedQty: number,
    pickStatus: 'picked' | 'picked_short' | 'picked_split' | 'not_in_location',
    _exceptionReason?: string
  ): Promise<{ data: boolean; error: string | null }> {
    try {
      logger.log('📦 RF Picking Service: Completing pick for item:', itemId)

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: false, error: 'User not authenticated' }
      }

      // Get user profile
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('id, full_name')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        return { data: false, error: 'Failed to get user profile' }
      }

      // Create accurate timestamps - store proper UTC for correct timezone handling
      const currentTime = new Date()
      const now = currentTime.toISOString()

      logger.log('🕐 RF Picking Service: Corrected Timestamp Capture:', {
        utcISOString: now,
        localTime: currentTime.toLocaleString('en-US', {
          timeZone: 'America/New_York',
        }),
        note: 'Storing proper UTC, database will display in user timezone',
      })

      // Determine outbound status based on pick status - using granular statuses for better tracking
      let outboundStatus:
        | 'pending'
        | 'processing'
        | 'picked'
        | 'picked_short'
        | 'picked_bulk'
        | 'not_in_location'
        | 'completed'
        | 'cancelled'
        | 'on_hold'
        | 'packed'
        | 'final_packed'
        | 'shipped'
      switch (pickStatus) {
        case 'picked':
          outboundStatus = 'picked' // Items successfully picked with exact quantity, ready for packing
          break
        case 'picked_short':
          outboundStatus = 'picked_short' // Items picked with short quantity - requires review
          break
        case 'picked_split':
          outboundStatus = 'picked_bulk' // Items picked with over quantity for bulk split handling
          break
        case 'not_in_location':
          outboundStatus = 'not_in_location' // Items not found at expected location - requires investigation
          break
        default:
          outboundStatus = 'processing'
      }

      // ✅ CRITICAL FIX: Update ONLY the specific item being picked (by ID)
      // NOT all items in the delivery
      const { error: updateError } = await supabase
        .from('outbound_to_data')
        .update({
          status: outboundStatus,
          picked_at: now,
          picked_by: profile.id,
          updated_at: now,
        })
        .eq('id', itemId) // ✅ Update only THIS specific item

      if (updateError) {
        logger.error('❌ RF Picking Service: Error updating item:', updateError)
        return { data: false, error: updateError.message }
      }

      const statusText =
        {
          picked: 'completed',
          picked_short: 'completed with short pick',
          picked_split: 'completed with over pick for bulk split',
          not_in_location: 'marked as not in location',
        }[pickStatus] || 'processed'

      logger.log(`✅ RF Picking Service: Pick ${statusText} for item ${itemId}`)
      return { data: true, error: null }
    } catch (error: unknown) {
      logger.error(
        '❌ RF Picking Service: Unexpected error completing pick:',
        error
      )
      return {
        data: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Get picking statistics for current user
   * @returns Promise with stats or error
   */
  async getPickingStats(): Promise<{
    data: RFPickingStats | null
    error: string | null
  }> {
    try {
      // For now, return mock stats - could be implemented with RPC functions later
      const stats: RFPickingStats = {
        total_picks: 0,
        today_picks: 0,
        week_picks: 0,
        short_picks: 0,
        over_picks: 0,
        not_in_location_picks: 0,
        average_pick_time: 0,
      }

      return { data: stats, error: null }
    } catch (error: unknown) {
      logger.error('❌ RF Picking Service: Unexpected error in stats:', error)
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

// Validation Functions
export const validateDeliveryNumber = (
  deliveryNumber: string
): { isValid: boolean; message?: string } => {
  if (!deliveryNumber || deliveryNumber.trim().length === 0) {
    return { isValid: false, message: 'Delivery number is required' }
  }

  const trimmed = deliveryNumber.trim()

  // Delivery number validation - should be 8-12 characters
  if (!/^[0-9A-Z]{8,12}$/i.test(trimmed)) {
    return {
      isValid: false,
      message: 'Invalid delivery number format (8-12 characters, alphanumeric)',
    }
  }

  return { isValid: true }
}

export const validateLocation = (
  location: string,
  expectedLocation: string
): { isValid: boolean; message?: string } => {
  if (!location || location.trim().length === 0) {
    return { isValid: false, message: 'Location is required' }
  }

  if (!expectedLocation) {
    return { isValid: true } // No expected location to compare
  }

  const scanned = location.trim().toUpperCase()
  const expected = expectedLocation.trim().toUpperCase()

  if (scanned !== expected) {
    return {
      isValid: false,
      message: `Location mismatch! Expected: ${expected}, Scanned: ${scanned}`,
    }
  }

  return { isValid: true }
}

// Export singleton instance
export const rfPickingService = new RFPickingService()
// Developer and Creator: Jai Singh
