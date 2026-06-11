// Created and developed by Jai Singh
/**
 * @deprecated This service is deprecated and will be removed in a future release.
 * Use the rust-work-service API via src/lib/work-service/client.ts instead.
 *
 * Migration guide:
 * - assignNextCycleCount() -> workServiceClient.claimNext()
 * - completeCycleCount() -> workServiceClient.completeTask()
 * - releaseMyCount() -> workServiceClient.releaseTask()
 * - startCycleCount() -> workServiceClient.startTask()
 *
 * The new unified cycle count workflow uses src/hooks/use-unified-cycle-count.ts
 *
 * ---
 * Original description:
 * Restored RF Cycle Count Service
 *
 * Production version with full database function integration for proper task assignment and abandonment handling
 */
import { toast } from 'sonner'
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

export interface RFCycleCountOperation {
  id: string
  count_number: string
  material_number: string
  material_description: string
  location: string
  system_quantity: number
  unit_of_measure: string
  warehouse?: string
  count_type?: string // Added: cycle_count, quantity_check, empty_location_check, etc.
  status: string
  assigned_to?: string
  assigned_at?: string
  created_at: string
  updated_at: string
  counted_quantity?: number | null
  requires_recount?: boolean
  recount_completed?: boolean
}

export interface AutoAssignmentResponse {
  success: boolean
  message: string
  data: RFCycleCountOperation | null
}

export interface PendingCountsCheckResponse {
  success: boolean
  pending_counts: number
  has_pending: boolean
}

export interface AbandonedCountInfo {
  id: string
  count_number: string
  material_number: string
  location: string
  assigned_at: string
  minutes_since_assignment: number
}

export interface AbandonedCountsResponse {
  success: boolean
  abandonment_threshold_minutes: number
  abandoned_counts: AbandonedCountInfo[]
  total_abandoned: number
}

export interface AbandonmentReleaseResponse {
  success: boolean
  released_count: number
  released_counts: string[]
  message: string
}

export interface ManualReleaseResponse {
  success: boolean
  message: string
  count_number?: string
}

export interface RFCycleCountValidation {
  isValid: boolean
  errorMessage?: string
  warnings?: string[]
  varianceCalculation?: {
    variance: number
    variancePercentage: number
    requiresReview: boolean
  }
}

/**
 * @deprecated This service class is deprecated. Use workServiceClient from src/lib/work-service/client.ts instead.
 * Simplified RF Cycle Count Service Class
 */
class RFCycleCountService {
  /**
   * @deprecated Use workServiceClient.claimNext() instead.
   * Assign next available cycle count to user
   */
  async assignNextCycleCount(): Promise<{
    data: RFCycleCountOperation | null
    error: string | null
  }> {
    try {
      logger.log(
        '🚀 RF Cycle Count Service: Attempting to assign next cycle count'
      )

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: null, error: 'User not authenticated' }
      }

      // Call the database function to assign next cycle count
      const { data: functionResult, error: rpcError } = await (
        supabase as any
      ).rpc('assign_next_cycle_count', { p_user_id: user.id })

      if (rpcError) {
        logger.error('❌ RF Cycle Count Service: RPC error:', rpcError)
        return {
          data: null,
          error: rpcError.message || 'Database assignment failed',
        }
      }

      if (
        !functionResult ||
        (typeof functionResult === 'object' && !(functionResult as any).success)
      ) {
        const message =
          (functionResult as any)?.message ||
          (functionResult as any)?.error ||
          'No cycle counts available'
        logger.log('ℹ️ RF Cycle Count Service:', message)
        return { data: null, error: message }
      }

      const assignedCount = (functionResult as any)?.data
      if (!assignedCount) {
        return { data: null, error: 'No assignment data returned' }
      }

      logger.log(
        '✅ RF Cycle Count Service: Successfully assigned count:',
        assignedCount.count_number
      )

      return {
        data: {
          id: assignedCount.id,
          count_number: assignedCount.count_number,
          material_number: assignedCount.material_number,
          material_description: assignedCount.material_description || '',
          location: assignedCount.location,
          system_quantity: assignedCount.system_quantity,
          unit_of_measure: assignedCount.unit_of_measure,
          warehouse: assignedCount.warehouse,
          count_type: assignedCount.count_type, // Added: pass through count_type from database
          status: assignedCount.status,
          assigned_to: assignedCount.assigned_to,
          assigned_at: assignedCount.assigned_at,
          created_at: assignedCount.created_at || new Date().toISOString(),
          updated_at: assignedCount.updated_at || new Date().toISOString(),
          counted_quantity: assignedCount.counted_quantity,
          requires_recount: assignedCount.requires_recount,
          recount_completed: assignedCount.recount_completed,
        },
        error: null,
      }
    } catch (error: unknown) {
      logger.error(
        '❌ RF Cycle Count Service: Unexpected assignment error:',
        error
      )
      return {
        data: null,
        error:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to assign cycle count',
      }
    }
  }

  /**
   * @deprecated Use workServiceClient queue stats endpoint instead.
   * Check if pending cycle counts are available
   */
  async checkPendingCountsAvailable(): Promise<{
    data: PendingCountsCheckResponse | null
    error: string | null
  }> {
    try {
      logger.log(
        '🔍 RF Cycle Count Service: Checking pending counts availability'
      )

      const { data: functionResult, error: rpcError } = await (
        supabase as any
      ).rpc('check_pending_counts_available')

      logger.log('🔍 DEBUG: Raw pending counts result:', functionResult)

      if (rpcError) {
        logger.error(
          '❌ RF Cycle Count Service: RPC error checking pending counts:',
          rpcError
        )
        return {
          data: null,
          error: rpcError.message || 'Database check failed',
        }
      }

      if (
        !functionResult ||
        (typeof functionResult === 'object' && !(functionResult as any).success)
      ) {
        const error =
          (functionResult as any)?.error || 'Failed to check pending counts'
        logger.error('❌ RF Cycle Count Service: Function error:', error)
        return { data: null, error }
      }

      logger.log('✅ RF Cycle Count Service: Pending counts check completed', {
        pending_counts: functionResult.pending_counts,
        has_pending: functionResult.has_pending,
      })

      return {
        data: {
          success: true,
          pending_counts: functionResult.pending_counts || 0,
          has_pending: functionResult.has_pending || false,
        },
        error: null,
      }
    } catch (error: unknown) {
      logger.error(
        '❌ RF Cycle Count Service: Unexpected error checking pending counts:',
        error
      )
      return {
        data: null,
        error:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to check pending counts',
      }
    }
  }

  /**
   * @deprecated Use workServiceClient.getAssignedTasks() instead.
   * Get user assigned counts
   */
  async getUserAssignedCounts(): Promise<{
    data: RFCycleCountOperation[] | null
    error: string | null
  }> {
    try {
      logger.log('📋 RF Cycle Count Service: Getting user assigned counts')

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: null, error: 'User not authenticated' }
      }

      const { data: functionResult, error: rpcError } = await (
        supabase as any
      ).rpc('get_user_assigned_counts', { p_user_id: user.id })

      if (rpcError) {
        logger.error(
          '❌ RF Cycle Count Service: RPC error getting assigned counts:',
          rpcError
        )
        return {
          data: null,
          error: rpcError.message || 'Database query failed',
        }
      }

      if (!functionResult || !(functionResult as any).success) {
        logger.log('ℹ️ RF Cycle Count Service: No assigned counts for user')
        return { data: [], error: null }
      }

      const assignedCounts = (functionResult as any).data || []
      logger.log(
        `✅ RF Cycle Count Service: Found ${assignedCounts.length} assigned counts`
      )

      return {
        data: assignedCounts.map((count: any) => ({
          id: count.id,
          count_number: count.count_number,
          material_number: count.material_number,
          material_description: count.material_description || '',
          location: count.location,
          system_quantity: count.system_quantity,
          unit_of_measure: count.unit_of_measure,
          warehouse: count.warehouse,
          count_type: count.count_type, // Added: pass through count_type from database
          status: count.status,
          assigned_to: count.assigned_to,
          assigned_at: count.assigned_at,
          created_at: count.created_at || new Date().toISOString(),
          updated_at: count.updated_at || new Date().toISOString(),
          counted_quantity: count.counted_quantity,
          requires_recount: count.requires_recount,
          recount_completed: count.recount_completed,
        })),
        error: null,
      }
    } catch (error: unknown) {
      logger.error(
        '❌ RF Cycle Count Service: Unexpected error getting assigned counts:',
        error
      )
      return {
        data: null,
        error:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to get assigned counts',
      }
    }
  }

  /**
   * @deprecated Use workServiceClient.startTask() instead.
   * Start cycle count (marks as in_progress)
   */
  async startCycleCount(
    countId: string,
    userDisplayName?: string
  ): Promise<{
    data: any
    error: string | null
  }> {
    try {
      logger.log('🚀 RF Cycle Count Service: Starting cycle count:', countId)

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: null, error: 'User not authenticated' }
      }

      // Update the count status to in_progress and set counter name
      const { error: updateError } = await supabase
        .from('rr_cyclecount_data')
        .update({
          status: 'in_progress',
          counter_name: userDisplayName || 'RF User',
          updated_at: new Date().toISOString(),
        })
        .eq('id', countId)
        .eq('assigned_to', user.id)

      if (updateError) {
        logger.error(
          '❌ RF Cycle Count Service: Error starting count:',
          updateError
        )
        return {
          data: null,
          error: updateError.message || 'Failed to start count',
        }
      }

      logger.log('✅ RF Cycle Count Service: Count started successfully')
      return {
        data: { success: true, message: 'Count started successfully' },
        error: null,
      }
    } catch (error: unknown) {
      logger.error(
        '❌ RF Cycle Count Service: Unexpected error starting count:',
        error
      )
      return {
        data: null,
        error:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to start count',
      }
    }
  }

  /**
   * @deprecated Validation is handled internally by the unified cycle count hook.
   * Validate cycle count data
   * Enhanced to handle zero system quantity edge cases
   */
  validateCycleCount(
    systemQuantity: number,
    countedQuantity: number,
    _materialNumber?: string
  ): RFCycleCountValidation {
    try {
      const variance = countedQuantity - systemQuantity

      // Enhanced variance percentage calculation
      // Handle zero system quantity case properly
      let variancePercentage: number
      let requiresReview: boolean
      const warnings: string[] = []

      if (systemQuantity === 0) {
        // Special handling for zero system quantity
        if (countedQuantity === 0) {
          // Both zero - perfect match
          variancePercentage = 0
          requiresReview = false
        } else {
          // System is zero but count is not - always requires review
          // Use Infinity to indicate undefined percentage
          variancePercentage = Infinity
          requiresReview = true
          warnings.push(
            `Zero system quantity but ${countedQuantity} units counted - requires review`
          )
        }
      } else {
        // Normal calculation when system quantity > 0
        variancePercentage = (variance / systemQuantity) * 100
        requiresReview = Math.abs(variancePercentage) > 10

        if (Math.abs(variancePercentage) > 5) {
          warnings.push(
            `Variance of ${variancePercentage.toFixed(2)}% exceeds threshold`
          )
        }
      }

      return {
        isValid: true,
        warnings,
        varianceCalculation: {
          variance,
          variancePercentage,
          requiresReview,
        },
      }
    } catch (error: unknown) {
      return {
        isValid: false,
        errorMessage:
          (error instanceof Error ? error.message : String(error)) ||
          'Validation failed',
      }
    }
  }

  /**
   * @deprecated Use workServiceClient.releaseTask() instead.
   * Release cycle count assignment
   */
  async releaseCycleCountAssignment(countId: string): Promise<{
    data: any
    error: string | null
  }> {
    try {
      logger.log(
        '🔄 RF Cycle Count Service: Releasing cycle count assignment:',
        countId
      )

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: null, error: 'User not authenticated' }
      }

      // Call the database function to release assignment
      const { data: functionResult, error: rpcError } = await (
        supabase as any
      ).rpc('release_cycle_count_assignment', {
        p_count_id: countId,
        p_user_id: user.id,
      })

      if (rpcError) {
        logger.error(
          '❌ RF Cycle Count Service: RPC error releasing assignment:',
          rpcError
        )
        return {
          data: null,
          error: rpcError.message || 'Database release failed',
        }
      }

      if (
        !functionResult ||
        (typeof functionResult === 'object' && !(functionResult as any).success)
      ) {
        const error =
          (functionResult as any)?.error || 'Failed to release assignment'
        logger.error('❌ RF Cycle Count Service: Function error:', error)
        return { data: null, error }
      }

      logger.log('✅ RF Cycle Count Service: Assignment released successfully')
      toast.success('Cycle count released and made available to other workers')

      return {
        data: functionResult,
        error: null,
      }
    } catch (error: unknown) {
      logger.error(
        '❌ RF Cycle Count Service: Unexpected error releasing assignment:',
        error
      )
      return {
        data: null,
        error:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to release assignment',
      }
    }
  }

  /**
   * @deprecated Abandonment detection is handled by rust-work-service.
   * Detect abandoned cycle counts
   */
  async getAbandonedCycleCounts(thresholdMinutes: number = 30): Promise<{
    data: AbandonedCountsResponse | null
    error: string | null
  }> {
    try {
      logger.log(
        `🔍 RF Cycle Count Service: Detecting abandoned counts (threshold: ${thresholdMinutes} minutes)`
      )

      const { data: functionResult, error: rpcError } = await (
        supabase as any
      ).rpc('detect_abandoned_cycle_counts', {
        p_abandonment_threshold_minutes: thresholdMinutes,
      })

      if (rpcError) {
        logger.error(
          '❌ RF Cycle Count Service: RPC error detecting abandoned counts:',
          rpcError
        )
        return {
          data: null,
          error: rpcError.message || 'Database detection failed',
        }
      }

      if (
        !functionResult ||
        (typeof functionResult === 'object' && !(functionResult as any).success)
      ) {
        const error =
          (functionResult as any)?.error || 'Failed to detect abandoned counts'
        logger.error('❌ RF Cycle Count Service: Function error:', error)
        return { data: null, error }
      }

      const abandonedCounts = (functionResult as any)?.abandoned_counts || []
      logger.log(
        `✅ RF Cycle Count Service: Found ${abandonedCounts.length} abandoned counts`
      )

      return {
        data: {
          success: true,
          abandonment_threshold_minutes: thresholdMinutes,
          abandoned_counts: abandonedCounts.map((count: any) => ({
            id: count.id,
            count_number: count.count_number,
            material_number: count.material_number,
            location: count.location,
            assigned_at: count.assigned_at,
            minutes_since_assignment: count.minutes_since_assignment,
          })),
          total_abandoned: (functionResult as any)?.total_abandoned || 0,
        },
        error: null,
      }
    } catch (error: unknown) {
      logger.error(
        '❌ RF Cycle Count Service: Unexpected error detecting abandoned counts:',
        error
      )
      return {
        data: null,
        error:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to detect abandoned counts',
      }
    }
  }

  /**
   * @deprecated Abandonment release is handled by rust-work-service.
   * Release abandoned cycle counts
   */
  async releaseAbandonedCycleCounts(thresholdMinutes: number = 30): Promise<{
    data: AbandonmentReleaseResponse | null
    error: string | null
  }> {
    try {
      logger.log(
        `🧹 RF Cycle Count Service: Releasing abandoned counts (threshold: ${thresholdMinutes} minutes)`
      )

      const { data: functionResult, error: rpcError } = await (
        supabase as any
      ).rpc('release_abandoned_cycle_counts', {
        p_abandonment_threshold_minutes: thresholdMinutes,
        p_max_releases: 50, // Prevent releasing too many at once
      })

      if (rpcError) {
        logger.error(
          '❌ RF Cycle Count Service: RPC error releasing abandoned counts:',
          rpcError
        )
        return {
          data: null,
          error: rpcError.message || 'Database release failed',
        }
      }

      if (
        !functionResult ||
        (typeof functionResult === 'object' && !(functionResult as any).success)
      ) {
        const error =
          (functionResult as any)?.error || 'Failed to release abandoned counts'
        logger.error('❌ RF Cycle Count Service: Function error:', error)
        return { data: null, error }
      }

      const releasedCount = (functionResult as any)?.released_count || 0
      const releasedCounts = (functionResult as any)?.released_counts || []

      logger.log(
        `✅ RF Cycle Count Service: Successfully released ${releasedCount} abandoned counts`
      )

      if (releasedCount > 0) {
        toast.success(
          `Released ${releasedCount} abandoned cycle counts - now available for assignment`
        )
      }

      return {
        data: {
          success: true,
          released_count: releasedCount,
          released_counts: releasedCounts,
          message:
            (functionResult as any)?.message ||
            `Released ${releasedCount} abandoned counts`,
        },
        error: null,
      }
    } catch (error: unknown) {
      logger.error(
        '❌ RF Cycle Count Service: Unexpected error releasing abandoned counts:',
        error
      )
      return {
        data: null,
        error:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to release abandoned counts',
      }
    }
  }

  /**
   * @deprecated Abandonment warnings are handled by the unified cycle count hook.
   * Get user potentially abandoned counts (for warnings)
   */
  async getUserPotentiallyAbandonedCounts(
    thresholdMinutes: number = 20
  ): Promise<{
    data: AbandonedCountInfo[] | null
    error: string | null
  }> {
    try {
      logger.log(
        `⚠️ RF Cycle Count Service: Checking user's potentially abandoned counts (threshold: ${thresholdMinutes} minutes)`
      )

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: null, error: 'User not authenticated' }
      }

      // Get user's assigned counts that are potentially abandoned (but not yet released)
      const { data: functionResult, error: rpcError } = await (
        supabase as any
      ).rpc('get_user_assigned_counts', { p_user_id: user.id })

      if (rpcError) {
        logger.error(
          '❌ RF Cycle Count Service: RPC error getting user counts:',
          rpcError
        )
        return {
          data: null,
          error: rpcError.message || 'Database query failed',
        }
      }

      if (!functionResult || !(functionResult as any).success) {
        logger.log('ℹ️ RF Cycle Count Service: No assigned counts for user')
        return { data: [], error: null }
      }

      const assignedCounts = (functionResult as any).data || []
      const potentiallyAbandoned: AbandonedCountInfo[] = []

      // Filter counts that exceed the warning threshold but haven't been auto-released yet
      for (const count of assignedCounts) {
        if (count.assigned_at) {
          const assignedAt = new Date(count.assigned_at)
          const minutesSince = (Date.now() - assignedAt.getTime()) / (1000 * 60)

          if (minutesSince >= thresholdMinutes) {
            potentiallyAbandoned.push({
              id: count.id,
              count_number: count.count_number,
              material_number: count.material_number,
              location: count.location,
              assigned_at: count.assigned_at,
              minutes_since_assignment: minutesSince,
            })
          }
        }
      }

      logger.log(
        `✅ RF Cycle Count Service: Found ${potentiallyAbandoned.length} potentially abandoned counts for user`
      )

      return {
        data: potentiallyAbandoned,
        error: null,
      }
    } catch (error: unknown) {
      logger.error(
        '❌ RF Cycle Count Service: Unexpected error getting user abandoned counts:',
        error
      )
      return {
        data: null,
        error:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to get potentially abandoned counts',
      }
    }
  }

  /**
   * @deprecated Use workServiceClient.releaseTask() instead.
   * Release user's current cycle count assignment
   */
  async releaseMyAssignment(countId: string): Promise<{
    data: ManualReleaseResponse | null
    error: string | null
  }> {
    try {
      logger.log(
        '🔄 RF Cycle Count Service: Releasing user assignment:',
        countId
      )

      const releaseResult = await this.releaseCycleCountAssignment(countId)

      if (releaseResult.error) {
        return { data: null, error: releaseResult.error }
      }

      return {
        data: {
          success: true,
          message:
            releaseResult.data?.message || 'Assignment released successfully',
          count_number: countId, // Simple ID for now, could be enhanced to return actual count number
        },
        error: null,
      }
    } catch (error: unknown) {
      logger.error(
        '❌ RF Cycle Count Service: Error in releaseMyAssignment:',
        error
      )
      return {
        data: null,
        error:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to release assignment',
      }
    }
  }

  /**
   * @deprecated Abandonment cleanup is handled by rust-work-service.
   * Run abandonment cleanup (releases counts abandoned for 30+ minutes)
   */
  async runAbandonmentCleanup(): Promise<{
    data: AbandonmentReleaseResponse | null
    error: string | null
  }> {
    try {
      logger.log('🧹 RF Cycle Count Service: Running abandonment cleanup...')

      // Use 30-minute threshold for automatic cleanup
      return await this.releaseAbandonedCycleCounts(30)
    } catch (error: unknown) {
      logger.error(
        '❌ RF Cycle Count Service: Error in abandonment cleanup:',
        error
      )
      return {
        data: null,
        error:
          (error instanceof Error ? error.message : String(error)) ||
          'Cleanup failed',
      }
    }
  }

  /**
   * @deprecated Use workServiceClient.releaseTask() instead.
   * Alias for releaseMyAssignment (for compatibility)
   */
  async releaseMyCount(
    countId: string,
    reason?: string
  ): Promise<{
    data: ManualReleaseResponse | null
    error: string | null
  }> {
    logger.log(
      `🔄 RF Cycle Count Service: Releasing count with reason: ${reason || 'Manual release'}`
    )
    return this.releaseMyAssignment(countId)
  }

  /**
   * @deprecated Use workServiceClient.completeTask() instead.
   * Complete cycle count
   */
  async completeCycleCount(
    countId: string,
    countedQuantity: number,
    notes?: string
  ): Promise<{
    data: any
    error: string | null
  }> {
    try {
      logger.log('✅ RF Cycle Count Service: Completing cycle count:', {
        countId,
        countedQuantity,
        notes,
      })

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        return { data: null, error: 'User not authenticated' }
      }

      // Update the count with completion data
      const { error: updateError } = await supabase
        .from('rr_cyclecount_data')
        .update({
          counted_quantity: countedQuantity,
          status: 'completed',
          notes: notes || null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', countId)
        .eq('assigned_to', user.id)

      if (updateError) {
        logger.error(
          '❌ RF Cycle Count Service: Error completing count:',
          updateError
        )
        return {
          data: null,
          error: updateError.message || 'Failed to complete count',
        }
      }

      logger.log('✅ RF Cycle Count Service: Count completed successfully')
      return {
        data: {
          success: true,
          message: 'Count completed successfully',
          counted_quantity: countedQuantity,
        },
        error: null,
      }
    } catch (error: unknown) {
      logger.error(
        '❌ RF Cycle Count Service: Unexpected error completing count:',
        error
      )
      return {
        data: null,
        error:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to complete count',
      }
    }
  }
}

// Export singleton instance
export const rfCycleCountService = new RFCycleCountService()

// Created and developed by Jai Singh
