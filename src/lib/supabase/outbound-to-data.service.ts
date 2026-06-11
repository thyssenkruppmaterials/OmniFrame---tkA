// Created and developed by Jai Singh
import { toast } from 'sonner'
import { singletonAuthManager } from '@/lib/auth/singleton-auth-manager'
import { rustOutboundTODataService } from '@/lib/rust-core/outbound-to-data.service'
import { logger } from '@/lib/utils/logger'
import {
  getTodayEST,
  getStartOfTodayEST,
  getEndOfTodayEST,
  getDaysAgoEST,
} from '@/lib/utils/timezone'
import { supabase, supabaseRead } from './client'
import type {
  Database,
  PutbackTicket,
  PutbackTicketInsert,
  PutbackTicketUpdate,
  Tables,
  TablesInsert,
} from './database.types'

// Rust core integration
const RUST_CORE_ENABLED = import.meta.env.VITE_RUST_CORE_ENABLED === 'true'

// Type definitions
export type OutboundTOData = Tables<'outbound_to_data'> & {
  priority?: string | null
  transfer_order_priority?: string | null
  // Ensure new workflow tracking fields are included
  waved_by?: string | null
  waved_at?: string | null
  picked_by?: string | null
  picked_at?: string | null
}
export type OutboundTODataInsert = TablesInsert<'outbound_to_data'>

export interface ClipboardData {
  headers: string[]
  rows: string[][]
}

export interface ImportResult {
  success: boolean
  totalRows: number
  insertedRows: number
  duplicateRows: number
  errorRows: number
  errors: string[]
}

export interface ColumnMapping {
  [key: string]: string
}

// Expected column headers for validation
export const EXPECTED_HEADERS = [
  'Delivery',
  'Transfer Order Number',
  'Transfer order priority',
  'Source Storage Type',
  'Warehouse Number',
  'Dest. Storage Type',
  'Movement Type (IM)',
  'Movement Type (WM)',
  'Source Storage Bin',
  'Plant',
  'Storage Location',
  'Material',
  'Material Description',
  'Batch',
  'Source target qty',
  'Creation Date',
  'Creation time',
  'User',
  'Printer',
]

// Column mapping from Excel headers to database fields
export const COLUMN_MAPPING: ColumnMapping = {
  Delivery: 'delivery',
  'Transfer Order Number': 'transfer_order_number',
  'Transfer order priority': 'transfer_order_priority',
  'Source Storage Type': 'source_storage_type',
  'Warehouse Number': 'warehouse_number',
  'Dest. Storage Type': 'dest_storage_type',
  'Movement Type (IM)': 'movement_type_im',
  'Movement Type (WM)': 'movement_type_wm',
  'Source Storage Bin': 'source_storage_bin',
  Plant: 'plant',
  'Storage Location': 'storage_location',
  Material: 'material',
  'Material Description': 'material_description',
  Batch: 'batch',
  'Source target qty': 'source_target_qty',
  'Creation Date': 'creation_date',
  'Creation time': 'creation_time',
  User: 'user_name',
  Printer: 'printer',
}

export class OutboundTODataService {
  private static instance: OutboundTODataService

  public static getInstance(): OutboundTODataService {
    if (!OutboundTODataService.instance) {
      OutboundTODataService.instance = new OutboundTODataService()
    }
    return OutboundTODataService.instance
  }

  /**
   * Fetch outbound TO data with optimized initial load (1000 rows)
   * @param limit - Maximum number of records to fetch (default: 1000)
   * @param offset - Starting position for pagination (default: 0)
   */
  async fetchOutboundData(
    limit: number = 1000,
    offset: number = 0
  ): Promise<OutboundTOData[]> {
    // 🦀 Use Rust-optimized service when enabled
    if (RUST_CORE_ENABLED) {
      try {
        logger.log('🦀 Using Rust-optimized outbound TO data service...')
        return await rustOutboundTODataService.fetchOutboundData(limit, offset)
      } catch (error) {
        logger.warn('⚠️ Rust service error, falling back to Supabase:', error)
        // Fall through to Supabase implementation
      }
    }

    try {
      // Enhanced authentication debugging and fallback logic
      const authState = singletonAuthManager.getAuthState()
      logger.log('🔍 OutboundTODataService: Auth state debug:', {
        isAuthenticated: authState.isAuthenticated,
        hasUser: !!authState.user,
        hasProfile: !!authState.profile,
        userId: authState.user?.id,
        profileId: authState.profile?.id,
        organizationId: authState.profile?.organization_id,
        role_id: authState.profile?.role_id,
      })

      const userProfile = authState.profile
      const organizationId = userProfile?.organization_id

      if (!organizationId) {
        // Enhanced error with full context
        logger.error('❌ Organization not found. Auth debug:', {
          authState,
          userProfile: JSON.stringify(userProfile, null, 2),
        })

        // Try to reload profile if user is authenticated but profile is missing org
        if (
          authState.isAuthenticated &&
          authState.user?.id &&
          !authState.profile?.organization_id
        ) {
          logger.log('🔄 Attempting to reload user profile...')

          // Direct database query as fallback
          const { data: directProfile, error: directError } = await supabase
            .from('user_profiles')
            .select('id, role_id, organization_id, email, full_name')
            .eq('id', authState.user.id)
            .single()

          if (directError) {
            logger.error('❌ Direct profile query failed:', directError)
            throw new Error(
              `User organization not found. Profile query error: ${directError.message}`
            )
          }

          if (directProfile?.organization_id) {
            logger.log('✅ Direct profile query successful:', directProfile)
            // Use direct profile data for this query
            const fallbackOrgId = directProfile.organization_id

            // Use controlled chunking even in fallback scenario
            logger.log(
              '🔄 Fallback: Using controlled chunking for outbound data...'
            )

            // Read-only — route to replica when configured.
            const { count: fallbackCount, error: fallbackCountError } =
              await supabaseRead
                .from('outbound_to_data')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', fallbackOrgId)

            if (fallbackCountError) throw fallbackCountError

            if (!fallbackCount) {
              logger.warn('⚠️ No outbound records found in fallback')
              return []
            }

            logger.log(
              `📊 Fallback: Total outbound records to fetch: ${fallbackCount}`
            )

            // Use sequential chunking for fallback (more conservative)
            const chunkSize = 1000
            const totalChunks = Math.ceil(fallbackCount / chunkSize)
            const outboundData: any[] = []

            for (let i = 0; i < totalChunks; i++) {
              const start = i * chunkSize
              const end = start + chunkSize - 1

              const { data: chunkData, error: chunkError } = await supabaseRead
                .from('outbound_to_data')
                .select('*')
                .eq('organization_id', fallbackOrgId)
                .order('created_at', { ascending: false })
                .range(start, end)

              if (chunkError) {
                logger.error(`❌ Fallback chunk ${i + 1} failed:`, chunkError)
                throw chunkError
              }

              if (chunkData) {
                outboundData.push(...chunkData)
                logger.log(
                  `✅ Fallback chunk ${i + 1}/${totalChunks} completed: ${chunkData.length} records`
                )
              }

              // Add delay between chunks in fallback
              if (i < totalChunks - 1) {
                await new Promise((resolve) => setTimeout(resolve, 150))
              }
            }

            logger.log(
              `✅ Fallback: Successfully fetched ${outboundData.length} outbound records`
            )

            // Get priority data for fallback
            const deliveryNumbers =
              outboundData?.map((item) => item.delivery).filter(Boolean) || []
            let deliveryPriorities: Record<string, string> = {}

            if (deliveryNumbers.length > 0) {
              const { data: priorityData, error: priorityError } =
                await supabaseRead
                  .from('rr_all_deliveries')
                  .select('delivery, delivery_priority')
                  .in(
                    'delivery',
                    deliveryNumbers.filter((d): d is string => d !== null)
                  )
                  .eq('organization_id', fallbackOrgId)

              if (!priorityError && priorityData) {
                deliveryPriorities = priorityData.reduce(
                  (acc, item) => {
                    if (item.delivery) {
                      acc[item.delivery] = item.delivery_priority || 'Normal'
                    }
                    return acc
                  },
                  {} as Record<string, string>
                )
              }
            }

            // Combine data with priority
            const combinedData: OutboundTOData[] =
              outboundData?.map((item) => ({
                ...item,
                priority: deliveryPriorities[item.delivery || ''] || null,
              })) || []

            logger.log('✅ Fallback data fetch successful:', {
              records: combinedData.length,
              priorities: Object.keys(deliveryPriorities).length,
            })

            return combinedData
          }
        }

        throw new Error(
          `User organization not found. User: ${authState.user?.email || 'unknown'}, Profile exists: ${!!authState.profile}`
        )
      }

      // Get outbound data with optimized pagination
      logger.log(
        `🚀 Fetching outbound data (limit: ${limit}, offset: ${offset})...`
      )

      const { data: outboundData, error: outboundError } = await supabaseRead
        .from('outbound_to_data')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (outboundError) {
        logger.error('❌ Outbound query error:', outboundError)
        throw outboundError
      }

      if (!outboundData || outboundData.length === 0) {
        logger.warn('⚠️ No outbound records found')
        return []
      }

      logger.log(`📊 Fetched ${outboundData.length} outbound records`)

      // Get delivery priorities separately
      const deliveryNumbers = [
        ...new Set(
          outboundData
            ?.map((item) => item.delivery)
            .filter((delivery): delivery is string => Boolean(delivery)) || []
        ),
      ]

      let deliveryPriorities: { [key: string]: string } = {}

      if (deliveryNumbers.length > 0) {
        const { data: priorityData, error: priorityError } = await supabaseRead
          .from('rr_all_deliveries')
          .select('delivery, delivery_priority')
          .in('delivery', deliveryNumbers)
          .eq('organization_id', organizationId)

        if (!priorityError && priorityData) {
          deliveryPriorities = priorityData.reduce(
            (acc, item) => {
              if (item.delivery) {
                acc[item.delivery] = item.delivery_priority || 'N/A'
              }
              return acc
            },
            {} as { [key: string]: string }
          )
        }
      }

      // Transform data to include priority field directly
      const transformedData = (outboundData || []).map((item) => ({
        ...item,
        priority: item.delivery
          ? deliveryPriorities[item.delivery] || null
          : null,
      }))

      return transformedData || []
    } catch (error) {
      logger.error('Error fetching outbound data:', error)
      throw error
    }
  }

  /**
   * Insert new outbound TO data record
   */
  async insertOutboundData(
    data: Omit<OutboundTODataInsert, 'id' | 'created_at' | 'updated_at'>
  ): Promise<OutboundTOData> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      const insertData: OutboundTODataInsert = {
        ...data,
        organization_id: userProfile.organization_id,
        uploaded_by: userProfile.id,
        status: 'pending', // Default status for all new imports
      }

      const { data: result, error } = await supabase
        .from('outbound_to_data')
        .insert(insertData)
        .select()
        .single()

      if (error) throw error
      return result
    } catch (error) {
      logger.error('Error inserting outbound data:', error)
      throw error
    }
  }

  /**
   * Bulk insert outbound TO data with UPSERT to handle duplicates
   * Uses database-level unique constraint to prevent duplicates
   */
  async bulkInsertOutboundData(
    dataArray: Omit<OutboundTODataInsert, 'id' | 'created_at' | 'updated_at'>[]
  ): Promise<ImportResult> {
    const result: ImportResult = {
      success: false,
      totalRows: dataArray.length,
      insertedRows: 0,
      duplicateRows: 0,
      errorRows: 0,
      errors: [],
    }

    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      // Prepare insert data
      const insertData: OutboundTODataInsert[] = dataArray.map((row) => ({
        ...row,
        organization_id: userProfile.organization_id,
        uploaded_by: userProfile.id,
        status: 'pending', // All imported data starts with pending status
      }))

      if (insertData.length === 0) {
        result.success = true
        return result
      }

      // Use UPSERT with ignoreDuplicates so the matching unique constraint
      // silently absorbs duplicate keys instead of producing 23505 errors
      // that flood Postgres logs. PostgREST translates this to:
      //   INSERT ... ON CONFLICT (
      //     organization_id, delivery, transfer_order_number,
      //     material, batch, source_storage_bin
      //   ) DO NOTHING
      //
      // The columns MUST exactly match a unique constraint or simple-column
      // unique index. Migration 320 added
      //   CONSTRAINT outbound_to_data_unique_record
      //     UNIQUE NULLS NOT DISTINCT (...)
      // for that purpose, replacing the old COALESCE expression index from
      // migration 047 (which `ON CONFLICT (cols)` cannot match — see
      // [[Debug/Fix-Outbound-Import-OnConflict-Constraint]]).
      //
      // The returned `data` array only contains the rows that were actually
      // inserted (duplicates are silently skipped).
      const { data, error } = await supabase
        .from('outbound_to_data')
        .upsert(insertData, {
          onConflict:
            'organization_id,delivery,transfer_order_number,material,batch,source_storage_bin',
          ignoreDuplicates: true,
        })
        .select()

      if (error) {
        logger.error('Bulk upsert error:', error)
        result.errors.push(error.message)
        result.errorRows = insertData.length
        return result
      }

      const insertedCount = data?.length || 0
      result.insertedRows = insertedCount
      result.duplicateRows = insertData.length - insertedCount
      result.success = true

      return result
    } catch (error) {
      logger.error('Error bulk inserting outbound data:', error)
      result.errors.push(
        error instanceof Error ? error.message : 'Unknown error'
      )
      result.errorRows = dataArray.length
      return result
    }
  }

  /**
   * Parse clipboard data (Excel format)
   */
  async parseClipboardData(): Promise<ClipboardData> {
    try {
      // Check if clipboard API is available
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        throw new Error('Clipboard API not available')
      }

      // Read clipboard content
      const clipboardText = await navigator.clipboard.readText()

      if (!clipboardText.trim()) {
        throw new Error('Clipboard is empty')
      }

      // Parse TSV/CSV data (Excel typically copies as TSV)
      const lines = clipboardText.trim().split('\n')

      if (lines.length < 2) {
        throw new Error(
          'Clipboard data must contain headers and at least one row'
        )
      }

      // Parse headers (first line)
      const headers = lines[0].split('\t').map((h) => h.trim())

      // Parse data rows
      const rows = lines
        .slice(1)
        .map((line) => line.split('\t').map((cell) => cell.trim()))

      return { headers, rows }
    } catch (error) {
      logger.error('Error parsing clipboard data:', error)
      throw error
    }
  }

  /**
   * Validate column headers match expected format
   */
  validateHeaders(headers: string[]): {
    isValid: boolean
    missingHeaders: string[]
    extraHeaders: string[]
  } {
    const missingHeaders = EXPECTED_HEADERS.filter(
      (expected) =>
        !headers.some(
          (header) => header.toLowerCase() === expected.toLowerCase()
        )
    )

    const extraHeaders = headers.filter(
      (header) =>
        !EXPECTED_HEADERS.some(
          (expected) => expected.toLowerCase() === header.toLowerCase()
        )
    )

    return {
      isValid: missingHeaders.length === 0,
      missingHeaders,
      extraHeaders,
    }
  }

  /**
   * Transform clipboard row data to database format
   */
  transformRowToDatabase(
    headers: string[],
    row: string[]
  ): Omit<
    OutboundTODataInsert,
    'id' | 'organization_id' | 'uploaded_by' | 'created_at' | 'updated_at'
  > {
    const transformed: any = {}

    headers.forEach((header, index) => {
      const dbField = COLUMN_MAPPING[header]
      if (dbField && row[index] !== undefined) {
        const value = row[index]?.trim()

        // Handle empty strings
        if (value === '') {
          transformed[dbField] = null
          return
        }

        // Special handling for numeric fields
        if (dbField === 'source_target_qty' && value) {
          const numValue = parseFloat(value)
          transformed[dbField] = isNaN(numValue) ? null : numValue
        }
        // Special handling for date fields
        else if (dbField === 'creation_date' && value) {
          try {
            // Try to parse various date formats
            const date = new Date(value)
            transformed[dbField] = isNaN(date.getTime())
              ? null
              : date.toISOString().split('T')[0]
          } catch {
            transformed[dbField] = null
          }
        }
        // Special handling for time fields
        else if (dbField === 'creation_time' && value) {
          try {
            // Handle time format (HH:MM:SS or HH:MM)
            if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(value)) {
              transformed[dbField] = value.length === 5 ? `${value}:00` : value
            } else {
              transformed[dbField] = null
            }
          } catch {
            transformed[dbField] = null
          }
        } else {
          transformed[dbField] = value
        }
      }
    })

    return transformed
  }

  /**
   * Import data from clipboard with validation and duplicate detection
   */
  async importFromClipboard(): Promise<ImportResult> {
    try {
      // Parse clipboard data
      const clipboardData = await this.parseClipboardData()

      // Validate headers
      const validation = this.validateHeaders(clipboardData.headers)
      if (!validation.isValid) {
        throw new Error(
          `Missing required columns: ${validation.missingHeaders.join(', ')}`
        )
      }

      // Transform data
      const transformedData = clipboardData.rows.map((row) =>
        this.transformRowToDatabase(clipboardData.headers, row)
      )

      // Bulk insert with duplicate detection
      const result = await this.bulkInsertOutboundData(transformedData)

      // Show result toast
      if (result.success) {
        toast.success(
          `Import successful! ${result.insertedRows} new records added.`,
          {
            description:
              result.duplicateRows > 0
                ? `${result.duplicateRows} duplicates skipped.`
                : undefined,
          }
        )
      } else {
        toast.error(`Import failed: ${result.errors.join(', ')}`)
      }

      return result
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      toast.error(`Import failed: ${errorMessage}`)

      return {
        success: false,
        totalRows: 0,
        insertedRows: 0,
        duplicateRows: 0,
        errorRows: 0,
        errors: [errorMessage],
      }
    }
  }

  /**
   * Subscribe to real-time changes
   */
  subscribeToChanges(callback: (payload: any) => void) {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      const subscription = supabase
        .channel('outbound_to_data_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'outbound_to_data',
            filter: `organization_id=eq.${userProfile.organization_id}`,
          },
          callback
        )
        .subscribe()

      return subscription
    } catch (error) {
      logger.error('Error subscribing to changes:', error)
      return null
    }
  }

  /**
   * Delete outbound TO data record
   */
  async deleteOutboundData(id: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('outbound_to_data')
        .delete()
        .eq('id', id)

      if (error) throw error
    } catch (error) {
      logger.error('Error deleting outbound data:', error)
      throw error
    }
  }

  /**
   * Search for outbound TO data by Delivery # or Transfer Order #
   * Returns all matching records for the given identifier
   */
  async searchByDeliveryOrTO(identifier: string): Promise<OutboundTOData[]> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      // Trim the identifier to handle barcode scanner whitespace
      const searchValue = identifier.trim()

      // Search by both delivery and transfer_order_number
      const { data, error } = await supabase
        .from('outbound_to_data')
        .select('*')
        .eq('organization_id', userProfile.organization_id)
        .or(
          `delivery.eq.${searchValue},transfer_order_number.eq.${searchValue}`
        )
        .order('created_at', { ascending: false })

      if (error) {
        logger.error('Error searching by delivery or TO:', error)
        throw error
      }

      return data || []
    } catch (error) {
      logger.error('Error in searchByDeliveryOrTO:', error)
      throw error
    }
  }

  /**
   * Update outbound TO data record
   */
  async updateOutboundData(
    id: string,
    updates: Partial<OutboundTODataInsert>
  ): Promise<OutboundTOData> {
    try {
      const { data, error } = await supabase
        .from('outbound_to_data')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    } catch (error) {
      logger.error('Error updating outbound data:', error)
      throw error
    }
  }

  /**
   * Update record status
   */
  async updateStatus(
    id: string,
    status: Database['public']['Enums']['outbound_status']
  ): Promise<OutboundTOData> {
    try {
      // Prepare update object
      const updateData: any = { status, updated_at: new Date().toISOString() }

      // If status is changing to 'processing', track who waved it and when
      if (status === 'processing') {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()
        if (!userError && user) {
          updateData.waved_by = user.id
          updateData.waved_at = new Date().toISOString()
          logger.log('📋 Outbound Service: Recording waved_by:', user.id)
        }
      }

      const { data, error } = await supabase
        .from('outbound_to_data')
        .update(updateData)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    } catch (error) {
      logger.error('Error updating status:', error)
      throw error
    }
  }

  /**
   * Verify delivery exists and get its current status (for wave scanning)
   * This queries the database directly, not limited to loaded data
   */
  async verifyDeliveryForWave(deliveryNumber: string): Promise<{
    exists: boolean
    deliveryData?: OutboundTOData[]
    allPending?: boolean
    currentStatus?: string
  }> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      logger.log(
        `🔍 Wave Scanner: Searching for delivery ${deliveryNumber} in database...`
      )

      // Query database directly for this delivery (not limited to loaded 1000 rows)
      const { data, error } = await supabase
        .from('outbound_to_data')
        .select('*')
        .eq('delivery', deliveryNumber.toString())
        .eq('organization_id', userProfile.organization_id)

      if (error) {
        logger.error('❌ Wave Scanner: Database query error:', error)
        throw error
      }

      if (!data || data.length === 0) {
        logger.log(
          `⚠️ Wave Scanner: Delivery ${deliveryNumber} not found in database`
        )
        return { exists: false }
      }

      logger.log(
        `✅ Wave Scanner: Found ${data.length} row(s) for delivery ${deliveryNumber}`
      )

      // Check if ALL rows are in pending status
      const nonPendingRows = data.filter((row) => row.status !== 'pending')
      const allPending = nonPendingRows.length === 0

      return {
        exists: true,
        deliveryData: data,
        allPending,
        currentStatus:
          nonPendingRows.length > 0 ? nonPendingRows[0].status : 'pending',
      }
    } catch (error) {
      logger.error('Error verifying delivery for wave:', error)
      throw error
    }
  }

  /**
   * Update status for ALL rows of a delivery (for multi-line deliveries)
   * Used when waving a delivery that has multiple material lines
   */
  async updateDeliveryStatus(
    deliveryNumber: string,
    status: Database['public']['Enums']['outbound_status']
  ): Promise<OutboundTOData[]> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.id || !userProfile?.organization_id) {
        throw new Error('User not authenticated')
      }

      // Prepare update object
      const updateData: any = {
        status,
        updated_at: new Date().toISOString(),
      }

      // If status is changing to 'processing', track who waved it and when
      if (status === 'processing') {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()
        if (!userError && user) {
          updateData.waved_by = user.id
          updateData.waved_at = new Date().toISOString()
          logger.log(
            '📋 Outbound Service: Recording waved_by for delivery:',
            deliveryNumber,
            'User:',
            user.id
          )
        }
      }

      // Update ALL rows with this delivery number
      const { data, error } = await supabase
        .from('outbound_to_data')
        .update(updateData)
        .eq('delivery', deliveryNumber.toString())
        .eq('organization_id', userProfile.organization_id)
        .select()

      if (error) throw error

      logger.log(
        `✅ Outbound Service: Updated ${data?.length || 0} row(s) for delivery ${deliveryNumber} to status: ${status}`
      )
      return data || []
    } catch (error) {
      logger.error('Error updating delivery status:', error)
      throw error
    }
  }

  // ==================== PACK TOOL SPECIFIC METHODS ====================

  /**
   * Get all unique TO numbers for a delivery
   */
  async getDeliveryTONumbers(
    deliveryId: string
  ): Promise<{ toNumbers: string[]; totalTOs: number }> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      const { data, error } = await supabase
        .from('outbound_to_data')
        .select('transfer_order_number')
        .eq('delivery', deliveryId)
        .eq('organization_id', userProfile.organization_id)
        .in('status', ['pending', 'processing']) // Only unpacked deliveries

      if (error) throw error

      // Get unique TO numbers, filtering out nulls
      const uniqueTONumbers = Array.from(
        new Set(
          data?.map((item) => item.transfer_order_number).filter(Boolean) || []
        )
      ) as string[] // Type assertion since filter(Boolean) removes nulls

      return {
        toNumbers: uniqueTONumbers,
        totalTOs: uniqueTONumbers.length,
      }
    } catch (error) {
      logger.error('Error fetching delivery TO numbers:', error)
      throw error
    }
  }

  /**
   * Verify if a delivery exists and get its details with TO information
   */
  async verifyDelivery(deliveryId: string): Promise<{
    exists: boolean
    deliveryData?: OutboundTOData[]
    toNumbers?: string[]
    requiresTOScanning?: boolean
  }> {
    try {
      const authState = singletonAuthManager.getAuthState()
      const userProfile = authState.profile

      // Enhanced debugging
      logger.log('=== PACK TOOL DEBUG ===')
      logger.log('Delivery ID being searched:', deliveryId)
      logger.log('Auth state:', {
        isAuthenticated: authState.isAuthenticated,
        userId: authState.user?.id,
        profileExists: !!userProfile,
        organizationId: userProfile?.organization_id,
      })

      if (!userProfile?.organization_id) {
        logger.error('User profile or organization_id missing:', {
          userProfile,
        })
        throw new Error(
          `User organization not found. Profile: ${JSON.stringify(userProfile)}`
        )
      }

      logger.log('Searching with filters:', {
        delivery: deliveryId,
        organization_id: userProfile.organization_id,
        status: ['picked', 'picked_short', 'picked_bulk'],
      })

      const { data, error } = await supabase
        .from('outbound_to_data')
        .select('*')
        .eq('delivery', deliveryId)
        .eq('organization_id', userProfile.organization_id)
        .in('status', ['picked', 'picked_short', 'picked_bulk']) // Only picked deliveries ready for packing

      if (error) {
        logger.error('Supabase query error:', error)
        throw error
      }

      logger.log('Query result:', { dataCount: data?.length, data })

      // Get TO numbers for this delivery
      const toInfo = await this.getDeliveryTONumbers(deliveryId)
      logger.log('TO Numbers for delivery:', toInfo)
      logger.log('=== END DEBUG ===')

      return {
        exists: data && data.length > 0,
        deliveryData: data || undefined,
        toNumbers: toInfo.toNumbers,
        requiresTOScanning: toInfo.totalTOs > 1,
      }
    } catch (error) {
      logger.error('Error verifying delivery:', error)
      throw error
    }
  }

  /**
   * Validate that a TO number belongs to the specified delivery
   */
  async validateTONumber(
    deliveryId: string,
    toNumber: string
  ): Promise<{ isValid: boolean; toData?: OutboundTOData[] }> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      const { data, error } = await supabase
        .from('outbound_to_data')
        .select('*')
        .eq('delivery', deliveryId)
        .eq('transfer_order_number', toNumber)
        .eq('organization_id', userProfile.organization_id)
        .in('status', ['pending', 'processing']) // Only unpacked deliveries

      if (error) throw error

      return {
        isValid: data && data.length > 0,
        toData: data || undefined,
      }
    } catch (error) {
      logger.error('Error validating TO number:', error)
      throw error
    }
  }

  /**
   * Get all items for a specific delivery
   */
  async getDeliveryItems(deliveryId: string): Promise<OutboundTOData[]> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      const { data, error } = await supabase
        .from('outbound_to_data')
        .select('*')
        .eq('delivery', deliveryId)
        .eq('organization_id', userProfile.organization_id)
        .order('material')

      if (error) throw error
      return data || []
    } catch (error) {
      logger.error('Error fetching delivery items:', error)
      throw error
    }
  }

  /**
   * Update packing information for a delivery
   */
  async updatePackingInfo(
    deliveryId: string,
    packingData: {
      package_length: number
      package_width: number
      package_height: number
      package_weight: number
    }
  ): Promise<OutboundTOData[]> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.id || !userProfile?.organization_id) {
        throw new Error('User not authenticated')
      }

      // Create accurate timestamp - store proper UTC for correct timezone handling
      const now = new Date()
      const utcISOString = now.toISOString()

      logger.log('🕐 Outbound TO Data Service: Corrected Timestamp Capture:', {
        utcISOString,
        localTime: now.toLocaleString('en-US', {
          timeZone: 'America/New_York',
        }),
        note: 'Storing proper UTC, database will display in user timezone',
      })

      const { data, error } = await supabase
        .from('outbound_to_data')
        .update({
          ...packingData,
          packed_by: userProfile.id,
          packed_at: utcISOString,
        })
        .eq('delivery', deliveryId)
        .eq('organization_id', userProfile.organization_id)
        .select()

      if (error) throw error
      return data || []
    } catch (error) {
      logger.error('Error updating packing info:', error)
      throw error
    }
  }

  /**
   * Complete the packing process - set status to 'packed' and mark label as printed
   */
  async completePacking(deliveryId: string): Promise<OutboundTOData[]> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.id || !userProfile?.organization_id) {
        throw new Error('User not authenticated')
      }

      // Create accurate timestamp - store proper UTC for correct timezone handling
      const now = new Date()
      const utcISOString = now.toISOString()

      logger.log(
        '🕐 Pack Tool Service: Completing packing for delivery:',
        deliveryId.trim()
      )

      const { data, error } = await supabase
        .from('outbound_to_data')
        .update({
          status: 'packed',
          packed_by: userProfile.id,
          packed_at: utcISOString,
          label_printed_at: utcISOString,
          updated_at: utcISOString,
        })
        .eq('delivery', deliveryId.trim()) // Trim whitespace from barcode scanner
        .eq('organization_id', userProfile.organization_id)
        .select()

      if (error) throw error

      logger.log(
        '✅ Pack Tool Service: Packing completed, records updated:',
        data?.length || 0
      )
      return data || []
    } catch (error) {
      logger.error('Error completing packing:', error)
      throw error
    }
  }

  /**
   * Get delivery statistics for pack tool dashboard
   */
  async getPackToolStats(): Promise<{
    totalDeliveries: number
    pendingDeliveries: number
    packedDeliveries: number
    todayPacked: number
  }> {
    try {
      // Enhanced authentication debugging and fallback logic for pack tool stats
      const authState = singletonAuthManager.getAuthState()
      logger.log(
        '🔍 OutboundTODataService.getPackToolStats: Auth state debug:',
        {
          isAuthenticated: authState.isAuthenticated,
          hasUser: !!authState.user,
          hasProfile: !!authState.profile,
          organizationId: authState.profile?.organization_id,
        }
      )

      const userProfile = authState.profile
      let organizationId = userProfile?.organization_id

      if (!organizationId) {
        logger.error(
          '❌ Organization not found in getPackToolStats. Attempting fallback...'
        )

        // Try direct database query as fallback
        if (authState.isAuthenticated && authState.user?.id) {
          const { data: directProfile, error: directError } = await supabase
            .from('user_profiles')
            .select('organization_id')
            .eq('id', authState.user.id)
            .single()

          if (directError) {
            logger.error(
              '❌ Direct profile query failed in getPackToolStats:',
              directError
            )
            throw new Error(
              `User organization not found in getPackToolStats. Profile query error: ${directError.message}`
            )
          }

          organizationId = directProfile?.organization_id
          if (!organizationId) {
            throw new Error('No organization_id found even in direct query')
          }

          logger.log(
            '✅ Fallback organization_id found for pack tool stats:',
            organizationId
          )
        } else {
          throw new Error(
            `User organization not found in getPackToolStats. User: ${authState.user?.email || 'unknown'}`
          )
        }
      }

      // Use validated organizationId (guaranteed non-null after fallback logic above)
      const orgId = organizationId!

      // Get all delivery counts
      const { data: totalData, error: totalError } = await supabase
        .from('outbound_to_data')
        .select('delivery', { count: 'exact' })
        .eq('organization_id', orgId)

      if (totalError) throw totalError

      // Get pending deliveries (including picked deliveries ready for packing)
      const { data: pendingData, error: pendingError } = await supabase
        .from('outbound_to_data')
        .select('delivery', { count: 'exact' })
        .eq('organization_id', orgId)
        .in('status', [
          'pending',
          'processing',
          'picked',
          'picked_short',
          'picked_bulk',
        ])

      if (pendingError) throw pendingError

      // Get packed deliveries
      const { data: packedData, error: packedError } = await supabase
        .from('outbound_to_data')
        .select('delivery', { count: 'exact' })
        .eq('organization_id', orgId)
        .eq('status', 'packed')

      if (packedError) throw packedError

      // Get today's packed deliveries using EST timezone
      const startOfToday = getStartOfTodayEST()
      const endOfToday = getEndOfTodayEST()
      const { data: todayData, error: todayError } = await supabase
        .from('outbound_to_data')
        .select('delivery', { count: 'exact' })
        .eq('organization_id', orgId)
        .eq('status', 'packed')
        .gte('packed_at', startOfToday)
        .lte('packed_at', endOfToday)

      if (todayError) throw todayError

      return {
        totalDeliveries: totalData?.length || 0,
        pendingDeliveries: pendingData?.length || 0,
        packedDeliveries: packedData?.length || 0,
        todayPacked: todayData?.length || 0,
      }
    } catch (error) {
      logger.error('Error fetching pack tool stats:', error)
      throw error
    }
  }

  /**
   * Save user column order preferences
   */
  async saveColumnOrder(columnOrder: string[]): Promise<void> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.id) {
        throw new Error('User not found')
      }

      const { error } = await supabase
        .from('user_profiles')
        .update({ outbound_column_order: columnOrder })
        .eq('id', userProfile.id)

      if (error) throw error
    } catch (error) {
      logger.error('Error saving column order:', error)
      throw error
    }
  }

  /**
   * Get user column order preferences
   */
  async getColumnOrder(): Promise<string[]> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.id) {
        return [] // Default order if no user
      }

      const { data, error } = await supabase
        .from('user_profiles')
        .select('outbound_column_order')
        .eq('id', userProfile.id)
        .single()

      if (error) throw error

      // Return saved order or default order
      return (data?.outbound_column_order as string[]) || []
    } catch (error) {
      logger.error('Error getting column order:', error)
      return [] // Default order on error
    }
  }

  /**
   * Get outbound data statistics with status breakdown
   */
  async getStatistics(): Promise<{
    total: number
    todayCount: number
    thisWeekCount: number
    uniqueTransferOrders: number
    uniqueMaterials: number
    statusBreakdown: Record<string, number>
    pickedToday: number
    packedToday: number
    finalPackedToday: number
    pendingCount: number
    wavedToday: number
    criticalDeliveries: number
    // New fields for "Available" metrics (December 16, 2025)
    picksAvailable: number // Processing status - ready to be picked
    packingAvailable: number // Picked status - ready to be packed
    shippedToday: number // Shipped today count
    shippedAvailable: number // Shipped status - ready for final packing
  }> {
    // 🦀 Use Rust-optimized service when enabled
    if (RUST_CORE_ENABLED) {
      try {
        logger.log('🦀 Using Rust-optimized outbound TO statistics...')
        const rustStats = await rustOutboundTODataService.getStatistics()

        // Fetch additional stats from Supabase that Rust doesn't provide yet
        const authState = singletonAuthManager.getAuthState()
        const organizationId = authState.profile?.organization_id

        let pickedTodayCount = 0
        let wavedTodayCount = 0
        let criticalDeliveriesCount = 0
        let picksAvailableCount = 0
        let packingAvailableCount = 0
        let shippedAvailableCount = 0

        if (organizationId) {
          // Use EST timezone for accurate "today" calculation
          const startOfToday = getStartOfTodayEST()
          const endOfToday = getEndOfTodayEST()

          // Cutoff date for "available" metrics - only count items from 2026 onwards
          const availableCutoffDate = '2026-01-01'

          // Get picked today count
          const { count: pickedCount, error: pickedError } = await supabase
            .from('outbound_to_data')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .gte('picked_at', startOfToday)
            .lte('picked_at', endOfToday)

          if (!pickedError) pickedTodayCount = pickedCount || 0

          // Get waved today count
          const { count: wavedCount, error: wavedError } = await supabase
            .from('outbound_to_data')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .gte('waved_at', startOfToday)
            .lte('waved_at', endOfToday)

          if (!wavedError) wavedTodayCount = wavedCount || 0

          // Get critical deliveries count
          const { count: criticalCount, error: criticalError } = await supabase
            .from('outbound_to_data')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .neq('status', 'final_packed')
            .in('transfer_order_priority', ['10', '12', '13'])
            .gt('creation_date', '2025-11-12')

          if (!criticalError) criticalDeliveriesCount = criticalCount || 0

          // Get picks available count (only items from 2026 onwards)
          const { count: picksCount, error: picksError } = await supabase
            .from('outbound_to_data')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('status', 'processing')
            .gte('created_at', availableCutoffDate)

          if (!picksError) picksAvailableCount = picksCount || 0

          // Get packing available count (only items from 2026 onwards)
          const { count: packingCount, error: packingError } = await supabase
            .from('outbound_to_data')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .in('status', ['picked', 'picked_short', 'picked_bulk'])
            .gte('created_at', availableCutoffDate)

          if (!packingError) packingAvailableCount = packingCount || 0

          // Get shipped available count (only items from 2026 onwards)
          const { count: shippedCount, error: shippedError } = await supabase
            .from('outbound_to_data')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('status', 'shipped')
            .gte('created_at', availableCutoffDate)

          if (!shippedError) shippedAvailableCount = shippedCount || 0
        }

        // Map Rust stats to expected interface with Supabase-filled values
        return {
          total: rustStats.total,
          todayCount: rustStats.todayPacked + rustStats.todayShipped,
          thisWeekCount: 0, // Rust service doesn't compute this yet
          uniqueTransferOrders: 0, // Rust service doesn't compute this yet
          uniqueMaterials: 0, // Rust service doesn't compute this yet
          statusBreakdown: {
            pending: rustStats.pending,
            processing: rustStats.waved,
            picked: rustStats.picked,
            packed: rustStats.packed,
            final_packed: rustStats.finalPacked,
            shipped: rustStats.shipped,
            completed: rustStats.completed,
            error: rustStats.error,
            putback: rustStats.putback,
          },
          pickedToday: pickedTodayCount,
          packedToday: rustStats.todayPacked,
          finalPackedToday: rustStats.todayFinalPacked,
          pendingCount: rustStats.pending,
          wavedToday: wavedTodayCount,
          criticalDeliveries: criticalDeliveriesCount,
          picksAvailable: picksAvailableCount,
          packingAvailable: packingAvailableCount,
          shippedToday: rustStats.todayShipped,
          shippedAvailable: shippedAvailableCount,
        }
      } catch (error) {
        logger.warn(
          '⚠️ Rust statistics error, falling back to Supabase:',
          error
        )
        // Fall through to Supabase implementation
      }
    }

    try {
      // Enhanced authentication debugging and fallback logic for statistics
      const authState = singletonAuthManager.getAuthState()
      logger.log('🔍 OutboundTODataService.getStatistics: Auth state debug:', {
        isAuthenticated: authState.isAuthenticated,
        hasUser: !!authState.user,
        hasProfile: !!authState.profile,
        organizationId: authState.profile?.organization_id,
      })

      const userProfile = authState.profile
      let organizationId = userProfile?.organization_id

      if (!organizationId) {
        logger.error(
          '❌ Organization not found in getStatistics. Attempting fallback...'
        )

        // Try direct database query as fallback
        if (authState.isAuthenticated && authState.user?.id) {
          const { data: directProfile, error: directError } = await supabase
            .from('user_profiles')
            .select('organization_id')
            .eq('id', authState.user.id)
            .single()

          if (directError) {
            logger.error(
              '❌ Direct profile query failed in getStatistics:',
              directError
            )
            throw new Error(
              `User organization not found in getStatistics. Profile query error: ${directError.message}`
            )
          }

          organizationId = directProfile?.organization_id
          if (!organizationId) {
            throw new Error('No organization_id found even in direct query')
          }

          logger.log(
            '✅ Fallback organization_id found for statistics:',
            organizationId
          )
        } else {
          throw new Error(
            `User organization not found in getStatistics. User: ${authState.user?.email || 'unknown'}`
          )
        }
      }

      logger.log(
        '🚀 Fetching outbound statistics using optimized count queries...'
      )

      // All statistics reads route to the replica via supabaseRead. None of them
      // chain to a write, so replication lag is irrelevant for correctness.
      const { count: totalCount, error: countError } = await supabaseRead
        .from('outbound_to_data')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)

      if (countError) {
        logger.error('❌ Count query error in statistics:', countError)
        throw countError
      }

      logger.log(`📊 Total outbound records for statistics: ${totalCount}`)

      // Use EST timezone for accurate "today" calculation
      const today = getTodayEST()
      const startOfToday = getStartOfTodayEST()
      const endOfToday = getEndOfTodayEST()
      const weekAgo = getDaysAgoEST(7)

      logger.log(
        `📅 Outbound Statistics: Using EST dates - Today: ${today}, Week Ago: ${weekAgo}`
      )

      const { count: todayCount, error: todayError } = await supabaseRead
        .from('outbound_to_data')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .gte('created_at', startOfToday)
        .lte('created_at', endOfToday)

      const { count: weekCount, error: weekError } = await supabaseRead
        .from('outbound_to_data')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .gte('created_at', `${weekAgo}T00:00:00`)

      const { data: transferOrderData, error: transferOrderError } =
        await supabaseRead
          .from('outbound_to_data')
          .select('transfer_order_number')
          .eq('organization_id', organizationId)
          .not('transfer_order_number', 'is', null)

      const { data: materialData, error: materialError } = await supabaseRead
        .from('outbound_to_data')
        .select('material')
        .eq('organization_id', organizationId)
        .not('material', 'is', null)

      const { data: statusData, error: statusError } = await supabaseRead
        .from('outbound_to_data')
        .select('status')
        .eq('organization_id', organizationId)

      const { count: pickedTodayCount, error: pickedTodayError } =
        await supabaseRead
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .gte('picked_at', startOfToday)
          .lte('picked_at', endOfToday)

      if (pickedTodayError)
        logger.warn('⚠️ Picked today count error:', pickedTodayError)

      const { count: packedTodayCount, error: packedTodayError } =
        await supabaseRead
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .gte('packed_at', startOfToday)
          .lte('packed_at', endOfToday)

      if (packedTodayError)
        logger.warn('⚠️ Packed today count error:', packedTodayError)

      const { count: finalPackedTodayCount, error: finalPackedTodayError } =
        await supabaseRead
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .gte('final_packed_at', startOfToday)
          .lte('final_packed_at', endOfToday)

      if (finalPackedTodayError)
        logger.warn('⚠️ Final packed today count error:', finalPackedTodayError)

      const { count: pendingCount, error: pendingCountError } =
        await supabaseRead
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('status', 'pending')

      if (pendingCountError)
        logger.warn('⚠️ Pending count error:', pendingCountError)

      const { count: wavedTodayCount, error: wavedTodayError } =
        await supabaseRead
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .gte('waved_at', startOfToday)
          .lte('waved_at', endOfToday)

      if (wavedTodayError)
        logger.warn('⚠️ Waved today count error:', wavedTodayError)

      const { count: criticalDeliveriesCount, error: criticalError } =
        await supabaseRead
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .neq('status', 'final_packed')
          .in('transfer_order_priority', ['10', '12', '13'])
          .gt('creation_date', '2025-11-12')

      if (criticalError)
        logger.warn('⚠️ Critical deliveries count error:', criticalError)

      const availableCutoffDate = '2026-01-01'

      const { count: picksAvailableCount, error: picksAvailableError } =
        await supabaseRead
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('status', 'processing')
          .gte('created_at', availableCutoffDate)

      if (picksAvailableError)
        logger.warn('⚠️ Picks available count error:', picksAvailableError)

      const { count: packingAvailableCount, error: packingAvailableError } =
        await supabaseRead
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .in('status', ['picked', 'picked_short', 'picked_bulk'])
          .gte('created_at', availableCutoffDate)

      if (packingAvailableError)
        logger.warn('⚠️ Packing available count error:', packingAvailableError)

      const { count: shippedTodayCount, error: shippedTodayError } =
        await supabaseRead
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .gte('shipped_at', startOfToday)
          .lte('shipped_at', endOfToday)

      if (shippedTodayError)
        logger.warn('⚠️ Shipped today count error:', shippedTodayError)

      const { count: shippedAvailableCount, error: shippedAvailableError } =
        await supabaseRead
          .from('outbound_to_data')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('status', 'shipped')
          .gte('created_at', availableCutoffDate)

      if (shippedAvailableError)
        logger.warn('⚠️ Shipped available count error:', shippedAvailableError)

      // Handle any query errors gracefully
      if (todayError) logger.warn('Today count error:', todayError)
      if (weekError) logger.warn('Week count error:', weekError)
      if (transferOrderError)
        logger.warn('Transfer order error:', transferOrderError)
      if (materialError) logger.warn('Material error:', materialError)
      if (statusError) logger.warn('Status error:', statusError)

      // Calculate unique counts
      const uniqueTransferOrders = transferOrderData
        ? new Set(
            transferOrderData
              .map((r) => r.transfer_order_number)
              .filter(Boolean)
          ).size
        : 0
      const uniqueMaterials = materialData
        ? new Set(materialData.map((r) => r.material).filter(Boolean)).size
        : 0

      // Calculate status breakdown
      const statusBreakdown: Record<string, number> = {}
      if (statusData) {
        statusData.forEach((record) => {
          const status = record.status || 'unknown'
          statusBreakdown[status] = (statusBreakdown[status] || 0) + 1
        })
      }

      const result = {
        total: totalCount || 0,
        todayCount: todayCount || 0,
        thisWeekCount: weekCount || 0,
        uniqueTransferOrders,
        uniqueMaterials,
        statusBreakdown,
        pickedToday: pickedTodayCount || 0,
        packedToday: packedTodayCount || 0,
        finalPackedToday: finalPackedTodayCount || 0,
        pendingCount: pendingCount || 0,
        wavedToday: wavedTodayCount || 0,
        criticalDeliveries: criticalDeliveriesCount || 0,
        // New fields (December 16, 2025)
        picksAvailable: picksAvailableCount || 0,
        packingAvailable: packingAvailableCount || 0,
        shippedToday: shippedTodayCount || 0,
        shippedAvailable: shippedAvailableCount || 0,
      }

      logger.log('✅ Outbound statistics calculated:', {
        total: result.total.toLocaleString(),
        todayCount: result.todayCount,
        thisWeekCount: result.thisWeekCount,
        uniqueTransferOrders: result.uniqueTransferOrders,
        uniqueMaterials: result.uniqueMaterials,
        statusBreakdown:
          Object.keys(result.statusBreakdown).length + ' statuses',
        pickedToday: result.pickedToday,
        packedToday: result.packedToday,
        finalPackedToday: result.finalPackedToday,
        pendingCount: result.pendingCount,
        wavedToday: result.wavedToday,
        criticalDeliveries: result.criticalDeliveries,
        picksAvailable: result.picksAvailable,
        packingAvailable: result.packingAvailable,
        shippedToday: result.shippedToday,
        shippedAvailable: result.shippedAvailable,
      })

      return result
    } catch (error) {
      logger.error('Error getting statistics:', error)
      return {
        total: 0,
        todayCount: 0,
        thisWeekCount: 0,
        uniqueTransferOrders: 0,
        uniqueMaterials: 0,
        statusBreakdown: {},
        pickedToday: 0,
        packedToday: 0,
        finalPackedToday: 0,
        pendingCount: 0,
        wavedToday: 0,
        criticalDeliveries: 0,
        // New fields (December 16, 2025)
        picksAvailable: 0,
        packingAvailable: 0,
        shippedToday: 0,
        shippedAvailable: 0,
      }
    }
  }

  /**
   * Fetch critical deliveries (matches stat card logic)
   * Critical: not final_packed AND priority is 10, 12, or 13 AND creation_date > 2025-11-12
   */
  async fetchCriticalDeliveries(): Promise<OutboundTOData[]> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      logger.log(
        '🔍 Fetching critical deliveries (priority 10, 12, 13, creation_date > 2025-11-12, not final_packed)'
      )

      const { data, error } = await supabaseRead
        .from('outbound_to_data')
        .select('*')
        .eq('organization_id', userProfile.organization_id)
        .neq('status', 'final_packed')
        .in('transfer_order_priority', ['10', '12', '13'])
        .gt('creation_date', '2025-11-12')
        .order('creation_date', { ascending: false })

      if (error) {
        logger.error('Fetch critical deliveries error:', error)
        throw error
      }

      logger.log(`✅ Found ${data?.length || 0} critical deliveries`)
      return data || []
    } catch (error) {
      logger.error('Error fetching critical deliveries:', error)
      throw error
    }
  }

  /**
   * Fetch outbound data filtered by status(es) with date cutoff (matches stat card logic)
   * Used for status filter buttons in the data manager
   * @param statuses - Array of status values to include
   * @param cutoffDate - Only include records created on or after this date (default: 2026-01-01)
   */
  async fetchByStatuses(
    statuses: Database['public']['Enums']['outbound_status'][],
    cutoffDate: string = '2026-01-01'
  ): Promise<OutboundTOData[]> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      logger.log(
        `🔍 Fetching outbound data by statuses: ${statuses.join(', ')} (cutoff: ${cutoffDate})`
      )

      const { data, error } = await supabaseRead
        .from('outbound_to_data')
        .select('*')
        .eq('organization_id', userProfile.organization_id)
        .in('status', statuses)
        .gte('created_at', cutoffDate)
        .order('created_at', { ascending: false })

      if (error) {
        logger.error('Fetch by statuses error:', error)
        throw error
      }

      logger.log(
        `✅ Found ${data?.length || 0} records with statuses: ${statuses.join(', ')}`
      )
      return data || []
    } catch (error) {
      logger.error('Error fetching outbound data by statuses:', error)
      throw error
    }
  }

  /**
   * Search outbound data using database query (searches entire dataset)
   * @param query - Search query string
   * @param limit - Maximum number of results to return (default: 1000)
   */
  async searchOutboundData(
    query: string,
    limit: number = 1000
  ): Promise<OutboundTOData[]> {
    // 🦀 Use Rust-optimized service when enabled
    if (RUST_CORE_ENABLED) {
      try {
        logger.log('🦀 Using Rust-optimized outbound TO search...')
        return await rustOutboundTODataService.searchOutboundData(query, limit)
      } catch (error) {
        logger.warn('⚠️ Rust search error, falling back to Supabase:', error)
        // Fall through to Supabase implementation
      }
    }

    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      if (!query.trim()) {
        // If no query, return limited initial data
        return await this.fetchOutboundData(limit)
      }

      // Remove all whitespace from search term for whitespace-insensitive search
      const searchTerm = query.toLowerCase().replace(/\s+/g, '')
      const originalQuery = query.toLowerCase()
      logger.log(
        `🔍 Searching outbound data for: "${searchTerm}" (whitespace removed)`
      )

      // Detect status keywords for special handling
      const statusKeywords: Record<
        string,
        Database['public']['Enums']['outbound_status']
      > = {
        pending: 'pending',
        processing: 'processing',
        waved: 'processing',
        picked: 'picked',
        pickedshort: 'picked_short',
        picked_short: 'picked_short',
        pickedbulk: 'picked_bulk',
        picked_bulk: 'picked_bulk',
        packed: 'packed',
        shipped: 'shipped',
        finalpack: 'final_packed',
        finalpacked: 'final_packed',
        final_packed: 'final_packed',
        completed: 'completed',
        cancelled: 'cancelled',
        onhold: 'on_hold',
        on_hold: 'on_hold',
      }

      // Check if search query matches a status keyword
      let matchedStatus: Database['public']['Enums']['outbound_status'] | null =
        null
      for (const [keyword, status] of Object.entries(statusKeywords)) {
        if (
          searchTerm.includes(keyword) ||
          originalQuery.includes(keyword.replace('_', ' '))
        ) {
          matchedStatus = status
          logger.log(
            `🎯 Detected status keyword search: "${keyword}" → status: "${status}"`
          )
          break
        }
      }

      // Build base query (search is read-only; replica is safe).
      let searchQuery = supabaseRead
        .from('outbound_to_data')
        .select('*')
        .eq('organization_id', userProfile.organization_id)

      // If status keyword detected, add status filter
      if (matchedStatus) {
        searchQuery = searchQuery.eq('status', matchedStatus)
      } else {
        // Otherwise, search text columns
        searchQuery = searchQuery.or(
          `transfer_order_number.ilike.%${searchTerm}%,` +
            `material.ilike.%${searchTerm}%,` +
            `material_description.ilike.%${searchTerm}%,` +
            `delivery.ilike.%${searchTerm}%,` +
            `user_name.ilike.%${searchTerm}%,` +
            `plant.ilike.%${searchTerm}%,` +
            `storage_location.ilike.%${searchTerm}%,` +
            `batch.ilike.%${searchTerm}%,` +
            `source_storage_bin.ilike.%${searchTerm}%,` +
            `source_storage_type.ilike.%${searchTerm}%,` +
            `dest_storage_type.ilike.%${searchTerm}%,` +
            `warehouse_number.ilike.%${searchTerm}%,` +
            `movement_type_im.ilike.%${searchTerm}%,` +
            `movement_type_wm.ilike.%${searchTerm}%,` +
            `printer.ilike.%${searchTerm}%,` +
            `tracking_number.ilike.%${searchTerm}%,` +
            `shipper_type.ilike.%${searchTerm}%`
        )
      }

      const { data, error } = await searchQuery
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) {
        logger.error('Search query error:', error)
        throw error
      }

      logger.log(`✅ Found ${data?.length || 0} matching outbound records`)
      return data || []
    } catch (error) {
      logger.error('Error searching outbound data:', error)
      throw error
    }
  }

  // ==================== FINAL PACK TOOL SPECIFIC METHODS ====================

  /**
   * Verify if a delivery exists and is packed or shipped (ready for final packing)
   */
  async verifyDeliveryForFinalPack(deliveryId: string): Promise<{
    exists: boolean
    deliveryData?: OutboundTOData[]
  }> {
    try {
      const authState = singletonAuthManager.getAuthState()
      const userProfile = authState.profile

      logger.log('=== FINAL PACK TOOL DEBUG ===')
      logger.log('Delivery ID being searched:', deliveryId)
      logger.log('Auth state:', {
        isAuthenticated: authState.isAuthenticated,
        userId: authState.user?.id,
        profileExists: !!userProfile,
        organizationId: userProfile?.organization_id,
      })

      if (!userProfile?.organization_id) {
        logger.error('User profile or organization_id missing:', {
          userProfile,
        })
        throw new Error(
          `User organization not found. Profile: ${JSON.stringify(userProfile)}`
        )
      }

      logger.log('Searching with filters:', {
        delivery: deliveryId,
        organization_id: userProfile.organization_id,
        status: ['packed', 'shipped'], // Packed or shipped deliveries can be final packed
      })

      const { data, error } = await supabase
        .from('outbound_to_data')
        .select('*')
        .eq('delivery', deliveryId)
        .eq('organization_id', userProfile.organization_id)
        .in('status', ['packed', 'shipped']) // Allow both packed and shipped deliveries

      if (error) {
        logger.error('Supabase query error:', error)
        throw error
      }

      logger.log('Query result:', { dataCount: data?.length, data })
      logger.log('=== END DEBUG ===')

      return {
        exists: data && data.length > 0,
        deliveryData: data || undefined,
      }
    } catch (error) {
      logger.error('Error verifying delivery for final pack:', error)
      throw error
    }
  }

  /**
   * Update final pack information
   */
  async updateFinalPackInfo(
    deliveryId: string,
    finalPackData: {
      tracking_number: string
      requires_8130_3: boolean
      has_8130_3: boolean
      is_8130_3_signed: boolean
    }
  ): Promise<OutboundTOData[]> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.id || !userProfile?.organization_id) {
        throw new Error('User not authenticated')
      }

      const { data, error } = await supabase
        .from('outbound_to_data')
        .update({
          ...finalPackData,
          final_packed_by: userProfile.id,
          final_packed_at: new Date().toISOString(), // UTC OK for operational timestamps
        })
        .eq('delivery', deliveryId)
        .eq('organization_id', userProfile.organization_id)
        .eq('status', 'packed') // Only update packed deliveries
        .select()

      if (error) throw error
      return data || []
    } catch (error) {
      logger.error('Error updating final pack info:', error)
      throw error
    }
  }

  /**
   * Complete final packing - set status to 'final_packed' AND record user/timestamp
   */
  async completeFinalPacking(deliveryId: string): Promise<OutboundTOData[]> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      // Get current user for tracking
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        throw new Error('User not authenticated')
      }

      const now = new Date().toISOString()

      const { data, error } = await supabase
        .from('outbound_to_data')
        .update({
          status: 'final_packed',
          final_packed_by: user.id, // ✅ FIXED: Record who final packed
          final_packed_at: now, // ✅ FIXED: Record when final packed
          updated_at: now,
        })
        .eq('delivery', deliveryId)
        .eq('organization_id', userProfile.organization_id)
        .select()

      if (error) throw error

      logger.log(
        '✅ Final Pack Service: Recorded final_packed_by:',
        user.id,
        'at:',
        now
      )

      return data || []
    } catch (error) {
      logger.error('Error completing final packing:', error)
      throw error
    }
  }

  /**
   * Get final pack tool statistics
   */
  async getFinalPackToolStats(): Promise<{
    totalDeliveries: number
    packedDeliveries: number
    finalPackedDeliveries: number
    todayFinalPacked: number
  }> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      // Get all delivery counts
      const { data: totalData, error: totalError } = await supabase
        .from('outbound_to_data')
        .select('delivery', { count: 'exact' })
        .eq('organization_id', userProfile.organization_id)

      if (totalError) throw totalError

      // Get packed deliveries (ready for final pack)
      const { data: packedData, error: packedError } = await supabase
        .from('outbound_to_data')
        .select('delivery', { count: 'exact' })
        .eq('organization_id', userProfile.organization_id)
        .eq('status', 'packed')

      if (packedError) throw packedError

      // Get final packed deliveries
      const { data: finalPackedData, error: finalPackedError } = await supabase
        .from('outbound_to_data')
        .select('delivery', { count: 'exact' })
        .eq('organization_id', userProfile.organization_id)
        .eq('status', 'final_packed')

      if (finalPackedError) throw finalPackedError

      // Get today's final packed deliveries using EST timezone
      const startOfToday = getStartOfTodayEST()
      const endOfToday = getEndOfTodayEST()
      const { data: todayData, error: todayError } = await supabase
        .from('outbound_to_data')
        .select('delivery', { count: 'exact' })
        .eq('organization_id', userProfile.organization_id)
        .eq('status', 'final_packed')
        .gte('final_packed_at', startOfToday)
        .lte('final_packed_at', endOfToday)

      if (todayError) throw todayError

      return {
        totalDeliveries: totalData?.length || 0,
        packedDeliveries: packedData?.length || 0,
        finalPackedDeliveries: finalPackedData?.length || 0,
        todayFinalPacked: todayData?.length || 0,
      }
    } catch (error) {
      logger.error('Error fetching final pack tool stats:', error)
      throw error
    }
  }

  // ==================== SHIPPER TOOL SPECIFIC METHODS ====================

  /**
   * Verify if a delivery exists and is packed (ready for shipping)
   */
  async verifyDeliveryForShipping(deliveryId: string): Promise<{
    exists: boolean
    deliveryData?: OutboundTOData[]
  }> {
    try {
      const authState = singletonAuthManager.getAuthState()
      const userProfile = authState.profile

      logger.log('=== SHIPPER TOOL DEBUG ===')
      logger.log('Delivery ID being searched:', deliveryId)
      logger.log('Auth state:', {
        isAuthenticated: authState.isAuthenticated,
        userId: authState.user?.id,
        profileExists: !!userProfile,
        organizationId: userProfile?.organization_id,
      })

      if (!userProfile?.organization_id) {
        logger.error('User profile or organization_id missing:', {
          userProfile,
        })
        throw new Error(
          `User organization not found. Profile: ${JSON.stringify(userProfile)}`
        )
      }

      logger.log('Searching with filters:', {
        delivery: deliveryId,
        organization_id: userProfile.organization_id,
        status: 'packed', // Only packed deliveries can be shipped
      })

      const { data, error } = await supabase
        .from('outbound_to_data')
        .select('*')
        .eq('delivery', deliveryId)
        .eq('organization_id', userProfile.organization_id)
        .eq('status', 'packed') // Only packed deliveries

      if (error) {
        logger.error('Supabase query error:', error)
        throw error
      }

      logger.log('Query result:', { dataCount: data?.length, data })
      logger.log('=== END DEBUG ===')

      return {
        exists: data && data.length > 0,
        deliveryData: data || undefined,
      }
    } catch (error) {
      logger.error('Error verifying delivery for shipping:', error)
      throw error
    }
  }

  /**
   * Update shipping information
   */
  async updateShippingInfo(
    deliveryId: string,
    shippingData: {
      shipper_type: 'domestic' | 'international' | 'wawf'
    }
  ): Promise<OutboundTOData[]> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.id || !userProfile?.organization_id) {
        throw new Error('User not authenticated')
      }

      const { data, error } = await supabase
        .from('outbound_to_data')
        .update({
          ...shippingData,
          shipped_by: userProfile.id,
          shipped_at: new Date().toISOString(), // UTC OK for operational timestamps
        })
        .eq('delivery', deliveryId)
        .eq('organization_id', userProfile.organization_id)
        .eq('status', 'packed') // Only update packed deliveries
        .select()

      if (error) throw error
      return data || []
    } catch (error) {
      logger.error('Error updating shipping info:', error)
      throw error
    }
  }

  /**
   * Complete shipping - set status to 'shipped'
   */
  async completeShipping(deliveryId: string): Promise<OutboundTOData[]> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      const { data, error } = await supabase
        .from('outbound_to_data')
        .update({
          status: 'shipped',
        })
        .eq('delivery', deliveryId)
        .eq('organization_id', userProfile.organization_id)
        .select()

      if (error) throw error
      return data || []
    } catch (error) {
      logger.error('Error completing shipping:', error)
      throw error
    }
  }

  /**
   * Get shipper tool statistics
   */
  async getShipperToolStats(): Promise<{
    totalDeliveries: number
    packedDeliveries: number
    shippedDeliveries: number
    todayShipped: number
    domesticShipped: number
    internationalShipped: number
    wawfShipped: number
  }> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      // Get all delivery counts
      const { data: totalData, error: totalError } = await supabase
        .from('outbound_to_data')
        .select('delivery', { count: 'exact' })
        .eq('organization_id', userProfile.organization_id)

      if (totalError) throw totalError

      // Get packed deliveries (ready for shipping)
      const { data: packedData, error: packedError } = await supabase
        .from('outbound_to_data')
        .select('delivery', { count: 'exact' })
        .eq('organization_id', userProfile.organization_id)
        .eq('status', 'packed')

      if (packedError) throw packedError

      // Get shipped deliveries
      const { data: shippedData, error: shippedError } = await supabase
        .from('outbound_to_data')
        .select('delivery', { count: 'exact' })
        .eq('organization_id', userProfile.organization_id)
        .eq('status', 'shipped')

      if (shippedError) throw shippedError

      // Get today's shipped deliveries using EST timezone
      const startOfToday = getStartOfTodayEST()
      const endOfToday = getEndOfTodayEST()
      const { data: todayData, error: todayError } = await supabase
        .from('outbound_to_data')
        .select('delivery', { count: 'exact' })
        .eq('organization_id', userProfile.organization_id)
        .eq('status', 'shipped')
        .gte('shipped_at', startOfToday)
        .lte('shipped_at', endOfToday)

      if (todayError) throw todayError

      // Get domestic shipped count
      const { data: domesticData, error: domesticError } = await supabase
        .from('outbound_to_data')
        .select('delivery', { count: 'exact' })
        .eq('organization_id', userProfile.organization_id)
        .eq('status', 'shipped')
        .eq('shipper_type', 'domestic')

      if (domesticError) throw domesticError

      // Get international shipped count
      const { data: internationalData, error: internationalError } =
        await supabase
          .from('outbound_to_data')
          .select('delivery', { count: 'exact' })
          .eq('organization_id', userProfile.organization_id)
          .eq('status', 'shipped')
          .eq('shipper_type', 'international')

      if (internationalError) throw internationalError

      // Get WAWF shipped count
      const { data: wawfData, error: wawfError } = await supabase
        .from('outbound_to_data')
        .select('delivery', { count: 'exact' })
        .eq('organization_id', userProfile.organization_id)
        .eq('shipper_type', 'wawf')

      if (wawfError) throw wawfError

      return {
        totalDeliveries: totalData?.length || 0,
        packedDeliveries: packedData?.length || 0,
        shippedDeliveries: shippedData?.length || 0,
        todayShipped: todayData?.length || 0,
        domesticShipped: domesticData?.length || 0,
        internationalShipped: internationalData?.length || 0,
        wawfShipped: wawfData?.length || 0,
      }
    } catch (error) {
      logger.error('Error fetching shipper tool stats:', error)
      throw error
    }
  }

  // ==================== WAWF SHIPPING SPECIFIC METHODS ====================

  /**
   * Verify delivery is eligible for WAWF processing.
   * Accepts 'packed' deliveries (first pass) or deliveries already in WAWF
   * intermediate status (second pass to complete TKA).
   */
  async verifyDeliveryForWAWF(deliveryId: string): Promise<{
    exists: boolean
    deliveryData?: OutboundTOData[]
  }> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      const { data, error } = await supabase
        .from('outbound_to_data')
        .select('*')
        .eq('delivery', deliveryId)
        .eq('organization_id', userProfile.organization_id)
        .in('status', ['packed', 'shipped'])

      if (error) throw error

      const eligibleData = data?.filter(
        (row) =>
          row.status === 'packed' ||
          (row.shipper_type === 'wawf' &&
            row.wawf_status &&
            row.wawf_status !== 'complete_tka_process')
      )

      return {
        exists: eligibleData !== undefined && eligibleData.length > 0,
        deliveryData: eligibleData?.length ? eligibleData : undefined,
      }
    } catch (error) {
      logger.error('Error verifying delivery for WAWF:', error)
      throw error
    }
  }

  /**
   * Update WAWF status for a delivery (options 1 & 2: intermediate statuses).
   * Sets wawf_status, wawf_placed_by, wawf_placed_at and shipper_type.
   * Does NOT change the outbound_status — delivery remains 'packed'.
   */
  async updateWAWFStatus(
    deliveryId: string,
    wawfStatus: 'ready_for_nefab' | 'staged_to_nefab'
  ): Promise<OutboundTOData[]> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.id || !userProfile?.organization_id) {
        throw new Error('User not authenticated')
      }

      const { data, error } = await supabase
        .from('outbound_to_data')
        .update({
          shipper_type: 'wawf',
          wawf_status: wawfStatus,
          wawf_placed_by: userProfile.id,
          wawf_placed_at: new Date().toISOString(),
        })
        .eq('delivery', deliveryId)
        .eq('organization_id', userProfile.organization_id)
        .select()

      if (error) throw error
      return data || []
    } catch (error) {
      logger.error('Error updating WAWF status:', error)
      throw error
    }
  }

  /**
   * Complete WAWF TKA process (option 3).
   * Sets wawf_status to 'complete_tka_process' and pushes outbound_status to 'shipped'.
   */
  async completeWAWFShipping(deliveryId: string): Promise<OutboundTOData[]> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.id || !userProfile?.organization_id) {
        throw new Error('User not authenticated')
      }

      const { data, error } = await supabase
        .from('outbound_to_data')
        .update({
          status: 'shipped',
          shipper_type: 'wawf',
          wawf_status: 'complete_tka_process',
          wawf_placed_by: userProfile.id,
          wawf_placed_at: new Date().toISOString(),
          shipped_by: userProfile.id,
          shipped_at: new Date().toISOString(),
        })
        .eq('delivery', deliveryId)
        .eq('organization_id', userProfile.organization_id)
        .select()

      if (error) throw error
      return data || []
    } catch (error) {
      logger.error('Error completing WAWF shipping:', error)
      throw error
    }
  }

  // ==================== PUTBACK TOOL SPECIFIC METHODS ====================

  /**
   * Validate delivery exists and get materials for putback
   * Note: This method does NOT filter by status - putbacks can be created for ANY delivery
   */
  async validateDeliveryForPutback(deliveryId: string): Promise<{
    exists: boolean
    deliveryData?: OutboundTOData[]
    materials?: Array<{
      material: string
      material_description: string
      source_storage_bin: string
      batch?: string
      quantity: number
    }>
  }> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      logger.log(
        '🔍 Putback Tool: Searching for delivery (any status):',
        deliveryId
      )

      const { data, error } = await supabase
        .from('outbound_to_data')
        .select('*')
        .eq('delivery', deliveryId)
        .eq('organization_id', userProfile.organization_id)
      // NO status filter - allow putback for any delivery status

      if (error) throw error

      if (!data || data.length === 0) {
        return { exists: false }
      }

      // Group materials by material number and sum quantities
      const materialGroups: Record<
        string,
        {
          material: string
          material_description: string
          source_storage_bin: string
          batch?: string
          quantity: number
        }
      > = {}

      data.forEach((item) => {
        if (item.material && item.source_target_qty) {
          const key = `${item.material}-${item.source_storage_bin || ''}-${item.batch || ''}`
          if (!materialGroups[key]) {
            materialGroups[key] = {
              material: item.material,
              material_description: item.material_description || '',
              source_storage_bin: item.source_storage_bin || '',
              batch: item.batch || undefined,
              quantity: 0,
            }
          }
          materialGroups[key].quantity += item.source_target_qty
        }
      })

      return {
        exists: true,
        deliveryData: data,
        materials: Object.values(materialGroups),
      }
    } catch (error) {
      logger.error('Error validating delivery for putback:', error)
      throw error
    }
  }

  /**
   * Generate next putback number for organization
   */
  async generatePutbackNumber(): Promise<string> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      // Simple putback number generation using timestamp
      const timestamp = Date.now().toString().slice(-5)
      return `Putback-${timestamp}`
    } catch (error) {
      logger.error('Error generating putback number:', error)
      // Fallback to client-side generation if function fails
      return await this.generatePutbackNumberFallback()
    }
  }

  /**
   * Fallback putback number generation
   */
  private async generatePutbackNumberFallback(): Promise<string> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      const { data, error } = await supabase
        .from('putback_tickets')
        .select('putback_number')
        .eq('organization_id', userProfile.organization_id)
        .order('created_at', { ascending: false })
        .limit(1)

      if (error) throw error

      let nextNumber = 1
      if (data && data.length > 0) {
        const lastNumber = data[0].putback_number
        const match = lastNumber.match(/Putback-(\d+)/)
        if (match) {
          nextNumber = parseInt(match[1], 10) + 1
        }
      }

      return `Putback-${nextNumber.toString().padStart(5, '0')}`
    } catch (error) {
      logger.error('Error in fallback putback number generation:', error)
      return 'Putback-00001'
    }
  }

  /**
   * Create new putback ticket
   */
  async createPutbackTicket(putbackData: {
    deliveryId: string
    materialNumber: string
    materialDescription?: string
    quantityReturned: number
    originalStorageBin?: string
    originalDeliveryData?: any
  }): Promise<PutbackTicket> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.id || !userProfile?.organization_id) {
        throw new Error('User not authenticated')
      }

      // Generate putback number
      const putbackNumber = await this.generatePutbackNumber()

      const insertData: PutbackTicketInsert = {
        putback_number: putbackNumber,
        delivery_id: putbackData.deliveryId,
        material_number: putbackData.materialNumber,
        material_description: putbackData.materialDescription,
        quantity_returned: putbackData.quantityReturned,
        original_storage_bin: putbackData.originalStorageBin,
        original_delivery_data: putbackData.originalDeliveryData,
        status: 'open',
        created_by: userProfile.id,
        organization_id: userProfile.organization_id,
      }

      logger.log(
        '🎫 Attempting to create putback ticket with data:',
        JSON.stringify(insertData, null, 2)
      )

      const { data, error } = await supabase
        .from('putback_tickets')
        .insert(insertData)
        .select()
        .single()

      if (error) {
        logger.error('❌ Database error creating putback ticket:', {
          error,
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
          insertData,
        })

        // Create a more descriptive error
        const enhancedError = new Error(
          `Database error: ${error.message}`
        ) as any
        enhancedError.code = error.code
        enhancedError.details = error.details
        enhancedError.hint = error.hint
        throw enhancedError
      }

      logger.log('✅ Putback ticket created successfully:', data)
      return data
    } catch (error) {
      logger.error('❌ Service error creating putback ticket:', error)

      // If it's already an enhanced error, re-throw it
      if ((error as any)?.code || (error as any)?.details) {
        throw error
      }

      // Otherwise create a generic enhanced error
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      const enhancedError = new Error(`Service error: ${errorMessage}`) as any
      enhancedError.originalError = error
      throw enhancedError
    }
  }

  /**
   * Get all putback tickets for organization
   */
  async getPutbackTickets(): Promise<PutbackTicket[]> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      const { data, error } = await supabase
        .from('putback_tickets')
        .select('*')
        .eq('organization_id', userProfile.organization_id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data || []
    } catch (error) {
      logger.error('Error fetching putback tickets:', error)
      throw error
    }
  }

  /**
   * Update putback ticket status
   */
  async updatePutbackTicketStatus(
    ticketId: string,
    status: Database['public']['Enums']['putback_status']
  ): Promise<PutbackTicket> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.id) {
        throw new Error('User not authenticated')
      }

      const updateData: PutbackTicketUpdate = {
        status,
        ...(status === 'completed'
          ? {
              processed_at: new Date().toISOString(), // UTC OK for operational timestamps
              processed_by: userProfile.id,
            }
          : {}),
      }

      const { data, error } = await supabase
        .from('putback_tickets')
        .update(updateData)
        .eq('id', ticketId)
        .select()
        .single()

      if (error) throw error
      return data
    } catch (error) {
      logger.error('Error updating putback ticket status:', error)
      throw error
    }
  }

  /**
   * Get putback ticket by ID
   */
  async getPutbackTicket(ticketId: string): Promise<PutbackTicket | null> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      const { data, error } = await supabase
        .from('putback_tickets')
        .select('*')
        .eq('id', ticketId)
        .eq('organization_id', userProfile.organization_id)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return null // No rows returned
        }
        throw error
      }
      return data
    } catch (error) {
      logger.error('Error fetching putback ticket:', error)
      throw error
    }
  }

  /**
   * Get putback statistics for dashboard
   */
  async getPutbackStats(): Promise<{
    totalTickets: number
    openTickets: number
    completedTickets: number
    todayTickets: number
  }> {
    try {
      const userProfile = singletonAuthManager.getAuthState().profile
      if (!userProfile?.organization_id) {
        throw new Error('User organization not found')
      }

      const { data, error } = await supabase
        .from('putback_tickets')
        .select('*')
        .eq('organization_id', userProfile.organization_id)

      if (error) throw error

      const tickets = data || []
      const today = getTodayEST()

      return {
        totalTickets: tickets.length,
        openTickets: tickets.filter((t) => t.status === 'open').length,
        completedTickets: tickets.filter((t) => t.status === 'completed')
          .length,
        todayTickets: tickets.filter((t) => t.created_at.startsWith(today))
          .length,
      }
    } catch (error) {
      logger.error('Error fetching putback stats:', error)
      return {
        totalTickets: 0,
        openTickets: 0,
        completedTickets: 0,
        todayTickets: 0,
      }
    }
  }
}

// Export singleton instance
export const outboundTODataService = OutboundTODataService.getInstance()

// Created and developed by Jai Singh
