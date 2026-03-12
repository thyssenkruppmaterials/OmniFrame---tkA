/**
 * RF Putaway Operations Service
 * Handles all putaway-related database operations for RF Terminal
 * Follows OmniFrame service patterns and integrates with Supabase
 *
 * Enhanced October 20, 2025 with putback ticket integration
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'
import type { PutbackTicket } from './database.types'

// Types
export interface RFPutawayOperation {
  id: string
  organization_id: string
  material_number: string
  to_location: string
  to_number: string
  raw_to_number: string
  warehouse?: string
  shelf_location: string
  scanned_shelf_location?: string
  putaway_driver: string
  to_status: string
  // MCA workflow fields
  is_mca_workflow: boolean
  mca_reason?: string
  mca_reason_code?: string
  mca_drop_location?: string
  // Audit fields
  created_at: string
  updated_at: string
  putaway_date: string
  putaway_time: string
  created_by?: string
  // Confirmation tracking fields
  confirmed_by?: string
  confirmed_at?: string
  // Metadata
  scanner_type: string
  session_id?: string
}

export interface RFPutawayCreateData {
  material_number: string
  to_location: string
  to_number: string
  raw_to_number: string
  warehouse?: string
  shelf_location: string
  scanned_shelf_location?: string
  putaway_driver: string
  // MCA workflow fields
  is_mca_workflow?: boolean
  mca_reason?: string
  mca_reason_code?: string
  mca_drop_location?: string
  scanner_type?: string
  session_id?: string
}

export interface RFPutawayStats {
  total_putaways: number
  today_putaways: number
  week_putaways: number
  mca_putaways: number
  completed_putaways: number
  average_completion_time: number
}

/**
 * RF Putaway Service Class
 * Handles CRUD operations for RF putaway workflow
 */
class RFPutawayService {
  /**
   * Check if a T.O. Number already exists in the database
   * Prevents duplicate putaway operations for the same TO number + material combination
   * @param toNumber - The parsed T.O. number (digits only, e.g., '3597367')
   * @param rawToNumber - The full scanned T.O. value (e.g., '3597367$I0001$IPDC')
   * @param materialNumber - The material number being put away
   * @returns Promise with duplicate check result
   */
  async checkDuplicateTONumber(
    toNumber: string,
    rawToNumber: string,
    materialNumber: string
  ): Promise<{
    isDuplicate: boolean
    existingRecord?: RFPutawayOperation
    error: string | null
  }> {
    try {
      logger.log('🔍 RF Putaway Service: Checking for duplicate TO number:', {
        toNumber,
        rawToNumber,
        materialNumber,
      })

      // Skip duplicate check for PUTBACK workflow
      if (toNumber.toUpperCase() === 'PUTBACK') {
        logger.log(
          '✅ RF Putaway Service: PUTBACK workflow - skipping duplicate check'
        )
        return { isDuplicate: false, error: null }
      }

      // Query for existing records with the same raw_to_number AND material_number
      // This catches exact duplicate scans (same TO line item + same material)
      const { data: existingRecords, error } = await (supabase as any)
        .from('rf_putaway_operations')
        .select(
          'id, to_number, raw_to_number, material_number, to_location, putaway_driver, created_at, to_status'
        )
        .eq('raw_to_number', rawToNumber.trim())
        .eq('material_number', materialNumber.trim().toUpperCase())
        .order('created_at', { ascending: false })
        .limit(1)

      if (error) {
        logger.error(
          '❌ RF Putaway Service: Error checking for duplicates:',
          error
        )
        // Don't block the operation if the check fails - log and allow through
        return {
          isDuplicate: false,
          error: `Duplicate check failed: ${error.message}`,
        }
      }

      if (existingRecords && existingRecords.length > 0) {
        const existing = existingRecords[0]
        logger.warn('⚠️ RF Putaway Service: DUPLICATE TO NUMBER DETECTED:', {
          existingId: existing.id,
          toNumber: existing.to_number,
          rawToNumber: existing.raw_to_number,
          materialNumber: existing.material_number,
          createdAt: existing.created_at,
          driver: existing.putaway_driver,
        })
        return {
          isDuplicate: true,
          existingRecord: existing as RFPutawayOperation,
          error: null,
        }
      }

      logger.log(
        '✅ RF Putaway Service: No duplicate found - TO number is unique'
      )
      return { isDuplicate: false, error: null }
    } catch (error: unknown) {
      logger.error(
        '❌ RF Putaway Service: Unexpected error in duplicate check:',
        error
      )
      // Don't block the operation on unexpected errors
      return {
        isDuplicate: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Create a new putaway operation
   * @param data - Putaway data to insert
   * @returns Promise with putaway data or error
   */
  async createPutaway(
    data: RFPutawayCreateData
  ): Promise<{ data: RFPutawayOperation | null; error: string | null }> {
    try {
      logger.log(
        '🚀 RF Putaway Service: Creating putaway with data:',
        JSON.stringify(data, null, 2)
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
      const { data: profile, error: profileError } = await (supabase as any)
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        logger.error(
          '❌ RF Putaway Service: Error getting user profile:',
          profileError
        )
        return { data: null, error: 'Failed to get user organization' }
      }

      // Duplicate TO Number check - prevent duplicate putaway operations
      const duplicateCheck = await this.checkDuplicateTONumber(
        data.to_number,
        data.raw_to_number,
        data.material_number
      )

      if (duplicateCheck.isDuplicate) {
        const existing = duplicateCheck.existingRecord
        const duplicateMsg = `Duplicate T.O. Number detected! This T.O. (${data.raw_to_number}) for material ${data.material_number} was already scanned${existing?.putaway_driver ? ` by ${existing.putaway_driver}` : ''}${existing?.created_at ? ` on ${new Date(existing.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}` : ''}.`
        logger.error('❌ RF Putaway Service: BLOCKING DUPLICATE:', duplicateMsg)
        return { data: null, error: duplicateMsg }
      }

      // Create accurate timestamps - store UTC but with EST display information
      const now = new Date()
      const utcISOString = now.toISOString()

      // Get EST components for display fields (putaway_date, putaway_time)
      const estFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })

      const estParts = estFormatter.formatToParts(now)
      const estYear = estParts.find((part) => part.type === 'year')?.value
      const estMonth = estParts.find((part) => part.type === 'month')?.value
      const estDay = estParts.find((part) => part.type === 'day')?.value
      const estHour = estParts.find((part) => part.type === 'hour')?.value
      const estMinute = estParts.find((part) => part.type === 'minute')?.value
      const estSecond = estParts.find((part) => part.type === 'second')?.value

      const putawayDate = `${estYear}-${estMonth}-${estDay}`
      const putawayTime = `${estHour}:${estMinute}:${estSecond}`

      logger.log('🕐 RF Putaway Service: Corrected Timestamp Capture:', {
        utcISOString,
        estDisplayDate: putawayDate,
        estDisplayTime: putawayTime,
        note: 'Storing UTC properly, EST for display fields only',
      })

      // Prepare insert data
      const insertData = {
        organization_id: profile.organization_id,
        material_number: data.material_number,
        to_location: data.to_location,
        to_number: data.to_number,
        raw_to_number: data.raw_to_number,
        warehouse: data.warehouse || null,
        shelf_location: data.shelf_location,
        scanned_shelf_location: data.scanned_shelf_location || null,
        putaway_driver: data.putaway_driver,
        to_status: 'Completed',
        is_mca_workflow: data.is_mca_workflow || false,
        mca_reason: data.mca_reason || null,
        mca_reason_code: data.mca_reason_code || null,
        mca_drop_location: data.mca_drop_location || null,
        putaway_date: putawayDate,
        putaway_time: putawayTime,
        scanner_type: data.scanner_type || 'RF Terminal',
        session_id: data.session_id || null,
        created_by: user.id,
        created_at: utcISOString,
        updated_at: utcISOString,
      }

      logger.log(
        '💾 RF Putaway Service: Insert data prepared:',
        JSON.stringify(insertData, null, 2)
      )

      // Use transactional RPC to atomically insert putaway + clear cart assignment
      const { data: rpcResult, error } = await (supabase as any).rpc(
        'complete_putaway_and_clear_cart',
        {
          p_putaway_data: insertData,
          p_raw_to_number: data.raw_to_number,
          p_material_number: data.material_number,
        }
      )

      if (error) {
        logger.error('❌ RF Putaway Service: Database error:', error)
        return { data: null, error: error.message }
      }

      const putaway = rpcResult as RFPutawayOperation

      logger.log(
        '✅ RF Putaway Service: Putaway created successfully via RPC:',
        putaway?.id
      )
      return { data: putaway, error: null }
    } catch (error: unknown) {
      logger.error('❌ RF Putaway Service: Unexpected error:', error)
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Get putaway statistics
   * @returns Promise with putaway stats or error
   */
  async getPutawayStats(): Promise<{
    data: RFPutawayStats | null
    error: string | null
  }> {
    try {
      // Use a simple query since we can't use the RPC function
      const { error } = await (supabase as any)
        .from('rf_putaway_operations')
        .select('*')
        .limit(1)

      if (error) {
        logger.error('❌ RF Putaway Service: Error fetching stats:', error)
        return { data: null, error: error.message }
      }

      // Return mock stats for now
      const stats: RFPutawayStats = {
        total_putaways: 0,
        today_putaways: 0,
        week_putaways: 0,
        mca_putaways: 0,
        completed_putaways: 0,
        average_completion_time: 0,
      }

      return { data: stats, error: null }
    } catch (error: unknown) {
      logger.error('❌ RF Putaway Service: Unexpected error in stats:', error)
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Get recent putaway operations for the current user
   * @param limit - Number of records to fetch
   * @returns Promise with putaway operations or error
   */
  async getRecentPutaways(limit: number = 10): Promise<{
    data: RFPutawayOperation[]
    count?: number
    error: string | null
  }> {
    try {
      const { data, error, count } = await (supabase as any)
        .from('rf_putaway_operations')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) {
        logger.error(
          '❌ RF Putaway Service: Error fetching recent putaways:',
          error
        )
        return { data: [], error: error.message }
      }

      return { data: data || [], count: count || 0, error: null }
    } catch (error: unknown) {
      logger.error(
        '❌ RF Putaway Service: Unexpected error in recent putaways:',
        error
      )
      return {
        data: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

// Exception whitelist - locations that are exempt from standard format validation
const EXCEPTION_LOCATIONS = [
  'RK-56A',
  'RK-57A',
  'RK-60A',
  'RM-73A',
  'RM-75A',
  'RN-72A',
  'RO-73A',
  'RK-78-A',
  'RL-70-A',
  'RM-61-A',
  'RM-70-A',
  'RM-74-A',
  'RN-69-A',
  'RN-75-A',
  'RP-52-B-1A',
  'RP-52-B-1B',
  'RP-52-B-1C',
  'RP-52-B-2A',
  'RP-52-B-2B',
  'RP-52-B-3A',
  'RP-52-B-3B',
  'RP-52-C-1A',
  'RP-52-C-1B',
  'RP-52-C-2A',
  'RP-52-C-2C',
  'RP-52-C-3A',
  'RP-52-C-3B',
  'RP-52-C-3C',
  'RP-54-B-1A',
  'RP-54-B-1C',
  'RP-54-B-2B',
  'RP-54-B-3A',
  'RP-54-B-3B',
  'RP-54-C-1A',
  'RP-54-C-2B',
  'RP-54-C-3A',
  'RP-54-C-3B',
  'RP-56-B-1A',
  'RP-56-C-1B',
  'RP-56-C-3A',
  'RP-56-C-3B',
  'RP-58-B-1B',
  'RP-58-B-1C',
  'RP-58-B-2B',
  'RP-58-C-1A',
  'RP-58-C-2A',
  'RP-58-C-2B',
  'RP-60-B-1A',
  'RP-60-B-1B',
  'RP-60-B-2A',
  'RP-60-B-3A',
  'RP-62-B-1B',
  'RP-62-B-2B',
  'RP-62-B-3A',
  'RP-62-B-3C',
  'RP-64-B-1A',
  'RP-64-B-1B',
  'RP-64-B-3A',
  'RP-64-B-3B',
  'RP-70-B-1A',
  'RP-70-B-1B',
  'RP-70-B-1C',
  'RP-72-B-1A',
  'RP-72-B-1B',
  'RP-72-B-1C',
  'RP-72-B-2A',
  'RP-72-B-2B',
  'RP-74-B-2B',
  'RP-74-B-2C',
  // NEEDBIN / NO_BIN / special location exceptions (added 2026-02-07)
  '112NEEDBIN',
  '120NEEDBIN',
  '150NEEDBIN',
  '800_NO_BIN',
  '800-NO BIN',
  '800-NO_BIN',
  '800-NO-BIN',
  'BINBLOCKED',
  'DTONEEDBIN',
  'K1-NEWBIN',
  'NEED BIN',
  'NEED_BIN',
  'NEED-BIN',
  'NEEDBIN',
  'LRIP',
]

// Validation Functions
export const validateTOLocation = (
  location: string
): { isValid: boolean; message?: string } => {
  if (!location || location.trim().length === 0) {
    return { isValid: false, message: 'T.O. Location is required' }
  }

  const trimmed = location.trim().toUpperCase()

  // Check if location is in exception whitelist
  if (EXCEPTION_LOCATIONS.includes(trimmed)) {
    logger.log('✅ RF Put-Away: Location matches exception whitelist:', trimmed)
    return { isValid: true }
  }

  // T.O. Location format validation - supports 4-segment formats like:
  // K1-23-03-2, K3-01-01-1, RD-20-E-01, QS-03-A-03, RP-41-D-02, etc.
  // Format: [A-Z0-9]{1,2}-[0-9]{2}-[A-Z0-9]{1,2}-[0-9]{1,2}
  if (!/^[A-Z0-9]{1,2}-[0-9]{2}-[A-Z0-9]{1,2}-[0-9]{1,2}$/.test(trimmed)) {
    return {
      isValid: false,
      message:
        'Invalid T.O. Location format (expected: K1-23-03-2, K3-01-01-1 or RD-20-E-01)',
    }
  }

  return { isValid: true }
}

/**
 * Parse T.O. Number format: 3597367$I0001$IPDC
 * Extracts TO Number (before first $) and warehouse (last 3 characters)
 */
export const parseTONumber = (
  rawTONumber: string
): {
  toNumber: string
  warehouse: string
  isValid: boolean
  message?: string
} => {
  const trimmed = rawTONumber.trim()

  if (!trimmed) {
    return {
      toNumber: '',
      warehouse: '',
      isValid: false,
      message: 'T.O. Number is required',
    }
  }

  // PUTBACK WORKFLOW - Allow 'PUTBACK' as valid T.O. Number (October 21, 2025)
  if (trimmed.toUpperCase() === 'PUTBACK') {
    return { toNumber: 'PUTBACK', warehouse: '', isValid: true }
  }

  // Check if it contains $ separators (new format)
  if (trimmed.includes('$')) {
    const parts = trimmed.split('$')

    if (parts.length >= 3) {
      const toNumber = parts[0] // Before first $
      const lastPart = parts[parts.length - 1] // Last part after final $

      // Validate TO Number is 6-8 digits
      if (!/^[0-9]{6,8}$/.test(toNumber)) {
        return {
          toNumber: '',
          warehouse: '',
          isValid: false,
          message: 'Invalid T.O. Number format (6-8 digits before $ required)',
        }
      }

      // Extract warehouse as last 3 characters
      if (lastPart.length >= 3) {
        const warehouse = lastPart.slice(-3).toUpperCase()
        return { toNumber, warehouse, isValid: true }
      } else {
        return {
          toNumber: '',
          warehouse: '',
          isValid: false,
          message: 'Warehouse code must be at least 3 characters',
        }
      }
    } else {
      return {
        toNumber: '',
        warehouse: '',
        isValid: false,
        message: 'Invalid T.O. Number format (expected: NUMBER$XXXX$WAREHOUSE)',
      }
    }
  }

  // Legacy format - plain digits only
  if (!/^[0-9]{8,12}$/.test(trimmed)) {
    return {
      toNumber: '',
      warehouse: '',
      isValid: false,
      message:
        'Invalid T.O. Number format (8-12 digits or NUMBER$XXXX$WAREHOUSE format)',
    }
  }

  return { toNumber: trimmed, warehouse: '', isValid: true }
}

export const validateTONumber = (
  toNumber: string
): { isValid: boolean; message?: string } => {
  const parseResult = parseTONumber(toNumber)
  return { isValid: parseResult.isValid, message: parseResult.message }

  return { isValid: true }
}

export const detectRelocator = (shelfLocation: string): boolean => {
  if (!shelfLocation) return false

  const location = shelfLocation.trim().toUpperCase()

  // MCA Relocator detection logic (based on Django app)
  const relocatorPatterns = [
    'FULL', // Location full
    'BLOCK', // Binblock
    'DIFF', // Different part
    'REJ', // Reject
    'DMG', // Damage
    'MIX', // Mixed inventory
    'R3L0C4T0R', // Relocator scan trigger
    'RELOCATOR', // Alternative relocator trigger
  ]

  return relocatorPatterns.some((pattern) => location.includes(pattern))
}

/**
 * Validates TO location matching between step 1 and step 2
 * If locations don't match AND shelf location contains specific MCA trigger patterns, triggers MCA workflow
 * Updated November 9, 2025: Added additional MCA trigger locations
 * @param toLocationStep1 - TO location from step 1
 * @param shelfLocationStep2 - Shelf location scanned in step 2
 * @returns Object with validation result and whether MCA workflow should be triggered
 */
export const validateTOLocationMatching = (
  toLocationStep1: string,
  shelfLocationStep2: string
): {
  isValid: boolean
  shouldTriggerMCA: boolean
  message?: string
} => {
  if (!toLocationStep1 || !shelfLocationStep2) {
    return {
      isValid: false,
      shouldTriggerMCA: false,
      message: 'Both TO location and shelf location are required',
    }
  }

  const toLocation = toLocationStep1.trim().toUpperCase()
  const shelfLocation = shelfLocationStep2.trim().toUpperCase()

  logger.log('🔍 RF Put-Away: Validating TO location matching:', {
    toLocationStep1: toLocation,
    shelfLocationStep2: shelfLocation,
  })

  // Check if locations match
  const locationsMatch = toLocation === shelfLocation

  if (locationsMatch) {
    logger.log('✅ RF Put-Away: TO locations match - normal workflow')
    return { isValid: true, shouldTriggerMCA: false }
  }

  // MCA Workflow Trigger Locations (November 9, 2025)
  // These locations trigger MCA workflow regardless of location matching
  const mcaTriggerLocations = [
    'RO-R3L0C4T0R', // Original relocator pattern
    '800_NO_BIN', // No bin variations
    '800-NO BIN',
    '800-NO_BIN',
    '800-NO-BIN',
    'LRIP', // LRIP location
    'BINBLOCKED', // Bin blocked
    'NEED_BIN', // Need bin variations
    'NEEDBIN',
    'NEED-BIN',
    'DTONEEDBIN', // DTO need bin
  ]

  // Check if scanned location matches any MCA trigger pattern
  const matchedTrigger = mcaTriggerLocations.find((trigger) =>
    shelfLocation.includes(trigger)
  )

  if (matchedTrigger) {
    logger.log(
      `⚠️ RF Put-Away: MCA trigger location detected: "${matchedTrigger}" - triggering MCA workflow`
    )
    return {
      isValid: true,
      shouldTriggerMCA: true,
      message: `MCA trigger location detected (${matchedTrigger}) - MCA workflow required`,
    }
  }

  // Locations don't match but no MCA trigger pattern
  logger.log(
    '❌ RF Put-Away: TO locations mismatch without MCA trigger pattern'
  )
  return {
    isValid: false,
    shouldTriggerMCA: false,
    message: `TO location mismatch: Expected "${toLocation}" but scanned "${shelfLocation}"`,
  }
}

export const getMCAReasonText = (reasonCode: string): string => {
  const reasonMap: Record<string, string> = {
    LOCATION_FULL: 'Location Full - No Space Available',
    BINBLOCK_NEEDBIN: 'Binblock - Need Alternative Bin',
    DIFFERENT_PART: 'Different Part Number in Location',
    REJECT_DAMAGED: 'Material Rejected - Damaged',
    REJECT_EXPIRED: 'Material Rejected - Expired',
    MIXED_INVENTORY: 'Mixed Inventory Conflict',
  }

  return reasonMap[reasonCode] || reasonCode
}

/**
 * PUTBACK TICKET INTEGRATION - October 20, 2025
 * Methods for detecting and processing putback tickets in RF Put Away scanner
 */

/**
 * Detect if scanned value is a putback number
 * Format: Putback-##### (e.g., Putback-37897)
 */
export const isPutbackNumber = (scannedValue: string): boolean => {
  const trimmed = scannedValue.trim()
  const putbackPattern = /^Putback-\d{5}$/i
  return putbackPattern.test(trimmed)
}

/**
 * Fetch putback ticket from database
 */
export const fetchPutbackTicket = async (
  putbackNumber: string
): Promise<PutbackTicket | null> => {
  try {
    logger.log('🎫 RF Put-Away: Fetching putback ticket:', putbackNumber)

    const { data, error } = await supabase
      .from('putback_tickets')
      .select('*')
      .eq('putback_number', putbackNumber.trim())
      .eq('status', 'open')
      .single()

    if (error) {
      logger.error('❌ RF Put-Away: Error fetching putback ticket:', error)
      return null
    }

    if (!data) {
      logger.log(
        '⚠️ RF Put-Away: Putback ticket not found or already completed'
      )
      return null
    }

    logger.log('✅ RF Put-Away: Putback ticket found:', data)
    return data as PutbackTicket
  } catch (error) {
    logger.error('❌ RF Put-Away: Exception fetching putback ticket:', error)
    return null
  }
}

/**
 * Complete putback ticket after successful putaway
 */
export const completePutbackTicket = async (
  ticketId: string,
  processorId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    logger.log(
      '🎫 RF Put-Away: Completing putback ticket:',
      ticketId,
      'by user:',
      processorId
    )

    // Use proper UTC timestamp
    const now = new Date()
    const processedAt = now.toISOString()

    const { error } = await supabase
      .from('putback_tickets')
      .update({
        status: 'completed',
        processed_by: processorId,
        processed_at: processedAt,
      })
      .eq('id', ticketId)

    if (error) {
      logger.error('❌ RF Put-Away: Error completing putback ticket:', error)
      return { success: false, error: error.message }
    }

    logger.log('✅ RF Put-Away: Putback ticket marked as completed')
    return { success: true }
  } catch (error) {
    logger.error('❌ RF Put-Away: Exception completing putback ticket:', error)
    return { success: false, error: String(error) }
  }
}

// Export singleton instance
export const rfPutawayService = new RFPutawayService()
// Developer and Creator: Jai Singh
