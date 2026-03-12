import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import { getRoleIdFromName } from '../../admin/roles/services/role.service'
import type {
  BulkActionData,
  CreateUserFormData,
  InviteUserFormData,
  PasswordResetFormData,
  StatusChangeData,
  UpdateUserFormData,
  UserActivity,
  UserFilters,
  UserPermission,
  UserProfile,
  UserRole,
  UserStats,
  UserStatus,
  UserStatusHistory,
} from '../types'

export class UserManagementService {
  /**
   * Fetch all users with optional filtering
   * ENHANCED January 4, 2026: Improved to fetch all users without hidden limits
   * ENHANCED January 4, 2026: Added include_deleted option to view soft-deleted users
   */
  static async getUsers(filters: UserFilters = {}): Promise<UserProfile[]> {
    try {
      // CRITICAL FIX (Dec 20, 2025): Join with roles table to get proper role display name
      // This allows custom roles (not in enum) to be displayed correctly
      let query = supabase
        .from('user_profiles')
        .select(
          `
          *,
          organization:organizations(id, name),
          role_details:roles(id, name, display_name)
        `
        )
        .order('created_at', { ascending: false })

      // Handle deleted users filter - ADDED January 4, 2026
      if (filters.include_deleted) {
        // Show ONLY deleted users
        query = query.not('deleted_at', 'is', null)
      } else {
        // Default: exclude deleted users
        query = query.is('deleted_at', null)
      }

      // Apply filters
      if (filters.search) {
        // CRITICAL FIX (Jan 29, 2026): PostgREST requires or() filter to be on a single line
        // without any newlines or extra whitespace, otherwise it returns PGRST100 parsing error
        const searchTerm = filters.search.trim()
        query = query.or(
          `first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%,username.ilike.%${searchTerm}%`
        )
      }

      if (filters.role && filters.role.length > 0) {
        query = query.in('role', filters.role as any[]) // Supabase role union is stricter than app's dynamic role values
      }

      if (filters.status && filters.status.length > 0) {
        // Type assertion needed as database types may not include new status values yet
        query = query.in('status', filters.status as any[]) // DB types lag behind app status values
      }

      if (filters.organization_id) {
        query = query.eq('organization_id', filters.organization_id)
      }

      if (typeof filters.email_verified === 'boolean') {
        query = query.eq('email_verified', filters.email_verified)
      }

      if (typeof filters.two_factor_enabled === 'boolean') {
        query = query.eq('two_factor_enabled', filters.two_factor_enabled)
      }

      if (filters.created_after) {
        query = query.gte('created_at', filters.created_after)
      }

      if (filters.created_before) {
        query = query.lte('created_at', filters.created_before)
      }

      const { data, error } = await query

      if (error) throw error
      return (data || []).map((user) => {
        // Use role from role_details (roles table join via role_id) instead of legacy role enum
        const roleDetails = (user as Record<string, unknown>).role_details as {
          name?: string
          display_name?: string
        } | null
        const roleFromDetails = roleDetails?.name || roleDetails?.display_name
        const effectiveRole = roleFromDetails || 'unknown'

        return {
          ...user,
          // Override the role field with the actual role from the joined roles table
          role: effectiveRole,
          role_display_name: roleDetails?.display_name || effectiveRole,
          preferences: user.preferences || {},
          metadata: user.metadata || {},
          status: user.status || 'active',
          email_verified: user.email_verified || false,
          two_factor_enabled: user.two_factor_enabled || false,
        } as UserProfile
      })
    } catch (error) {
      logger.error('Error fetching users:', error)
      throw error
    }
  }

  /**
   * Get user by ID
   */
  static async getUserById(userId: string): Promise<UserProfile> {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select(
          `
          *,
          organization:organizations(id, name)
        `
        )
        .eq('id', userId)
        .is('deleted_at', null)
        .single()

      if (error) throw error
      return {
        ...data,
        preferences: data.preferences || {},
        metadata: data.metadata || {},
        status: data.status || 'active',
        email_verified: data.email_verified || false,
        two_factor_enabled: data.two_factor_enabled || false,
      } as UserProfile
    } catch (error) {
      logger.error('Error fetching user:', error)
      throw error
    }
  }

  /**
   * Create a new user
   * UPDATED January 31, 2026: Now calls backend API instead of using supabaseAdmin directly
   * This is required because the admin client is not available in the browser for security reasons
   */
  static async createUser(userData: CreateUserFormData): Promise<UserProfile> {
    try {
      // Get auth token for backend API call
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (sessionError || !session) {
        throw new Error('Authentication required to create users')
      }

      // Determine API base URL (same pattern as other API calls in the codebase)
      const API_BASE_URL = (() => {
        if (typeof window !== 'undefined') {
          const currentOrigin = window.location.origin
          if (currentOrigin === 'http://localhost:5173') {
            return 'http://localhost:8000'
          }
          return currentOrigin // Production: use same origin
        }
        return import.meta.env.VITE_API_URL || 'http://localhost:8000'
      })()

      // Call backend API to create user using admin privileges
      const response = await fetch(`${API_BASE_URL}/api/admin/users/create`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: userData.email,
          password: userData.password,
          username: userData.username,
          first_name: userData.first_name,
          last_name: userData.last_name,
          phone_number: userData.phone_number,
          role: userData.role,
          send_invite: userData.send_invite,
        }),
      })

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: 'Failed to create user' }))
        throw new Error(
          errorData.detail || `HTTP ${response.status}: ${response.statusText}`
        )
      }

      const result = await response.json()

      if (!result.success || !result.user) {
        throw new Error('Failed to create user - invalid response from server')
      }

      logger.log('User created successfully:', result.user.email)

      return {
        ...result.user,
        preferences: result.user.preferences || {},
        metadata: result.user.metadata || {},
        status: result.user.status || 'active',
        email_verified: result.user.email_verified || false,
        two_factor_enabled: result.user.two_factor_enabled || false,
      } as UserProfile
    } catch (error) {
      logger.error('Error creating user:', error)
      throw error
    }
  }

  /**
   * Update user profile
   */
  static async updateUser(
    userId: string,
    updates: UpdateUserFormData
  ): Promise<UserProfile> {
    try {
      // Convert empty strings to null for nullable fields to avoid unique constraint violations
      const sanitizedUpdates = {
        ...updates,
        username: updates.username?.trim() || undefined,
        first_name: updates.first_name?.trim() || undefined,
        last_name: updates.last_name?.trim() || undefined,
        phone_number: updates.phone_number?.trim() || undefined,
        metadata: updates.metadata as Record<string, unknown>,
        preferences: updates.preferences as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      }

      const { data, error } = await supabase
        .from('user_profiles')
        .update(sanitizedUpdates as Record<string, unknown>) // Type assertion for custom roles support
        .eq('id', userId)
        .select()
        .single()

      if (error) throw error

      // TODO: Needs backend endpoint to sync auth metadata (role, name) after profile update
      // Previously used supabaseAdmin?.auth.admin.updateUserById which is unavailable in browser

      return {
        ...data,
        preferences: data.preferences || {},
        metadata: data.metadata || {},
        status: data.status || 'active',
        email_verified: data.email_verified || false,
        two_factor_enabled: data.two_factor_enabled || false,
      } as UserProfile
    } catch (error) {
      logger.error('Error updating user:', error)
      throw error
    }
  }

  /**
   * Soft delete a user
   */
  static async deleteUser(userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({
          status: 'inactive',
          deleted_at: new Date().toISOString(),
        })
        .eq('id', userId)

      if (error) throw error

      // TODO: Needs backend endpoint to ban auth user on soft-delete (POST /api/admin/users/:id/ban)
      // Previously used supabaseAdmin?.auth.admin.updateUserById which is unavailable in browser

      // Log the activity
      await UserManagementService.logUserActivity(userId, 'delete', 'user', {
        soft_delete: true,
      })
    } catch (error) {
      logger.error('Error deleting user:', error)
      throw error
    }
  }

  /**
   * Restore a soft-deleted user
   * ADDED January 4, 2026
   */
  static async restoreUser(userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({
          status: 'inactive', // Restore to inactive - admin should manually activate
          deleted_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)

      if (error) throw error

      // TODO: Needs backend endpoint to unban auth user on restore (POST /api/admin/users/:id/unban)
      // Previously used supabaseAdmin?.auth.admin.updateUserById which is unavailable in browser

      // Log the activity
      await UserManagementService.logUserActivity(userId, 'update', 'user', {
        action: 'restore',
        restored_status: 'inactive',
      })

      logger.log(`✅ User ${userId} restored successfully`)
    } catch (error) {
      logger.error('Error restoring user:', error)
      throw error
    }
  }

  /**
   * Permanently delete a user from the database
   * ADDED January 4, 2026: For cleanup of test employees
   * WARNING: This is irreversible!
   */
  static async permanentlyDeleteUser(userId: string): Promise<void> {
    try {
      // Get user info for logging before deletion
      const { data: user, error: fetchError } = await supabase
        .from('user_profiles')
        .select('email, first_name, last_name')
        .eq('id', userId)
        .single()

      if (fetchError) {
        logger.warn(
          'Could not fetch user before permanent deletion:',
          fetchError
        )
      }

      const userInfo = user
        ? `${user.email} (${user.first_name} ${user.last_name})`
        : userId

      // Delete from user_profiles first (this will cascade to related tables)
      const { error: profileError } = await supabase
        .from('user_profiles')
        .delete()
        .eq('id', userId)

      if (profileError) throw profileError

      // TODO: Needs backend endpoint to delete auth user (DELETE /api/admin/users/:id/auth)
      // Previously used supabaseAdmin?.auth.admin.deleteUser which is unavailable in browser

      // Clean up related data
      try {
        // Delete user permissions
        await supabase.from('user_permissions').delete().eq('user_id', userId)

        // Delete status history
        await (supabase as any)
          .from('user_status_history')
          .delete()
          .eq('user_id', userId)
      } catch (cleanupError) {
        logger.warn('Some related data cleanup failed:', cleanupError)
      }

      logger.log(`🗑️ User ${userInfo} permanently deleted`)
    } catch (error) {
      logger.error('Error permanently deleting user:', error)
      throw error
    }
  }

  /**
   * Invite a user
   * UPDATED January 31, 2026: Now calls backend API instead of using supabaseAdmin directly
   */
  static async inviteUser(inviteData: InviteUserFormData): Promise<void> {
    try {
      // Get auth token for backend API call
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (sessionError || !session) {
        throw new Error('Authentication required to invite users')
      }

      // Determine API base URL
      const API_BASE_URL = (() => {
        if (typeof window !== 'undefined') {
          const currentOrigin = window.location.origin
          if (currentOrigin === 'http://localhost:5173') {
            return 'http://localhost:8000'
          }
          return currentOrigin
        }
        return import.meta.env.VITE_API_URL || 'http://localhost:8000'
      })()

      // Call backend API to invite user
      const response = await fetch(`${API_BASE_URL}/api/admin/users/invite`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: inviteData.email,
          first_name: inviteData.first_name,
          last_name: inviteData.last_name,
          role: inviteData.role,
        }),
      })

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: 'Failed to invite user' }))
        throw new Error(
          errorData.detail || `HTTP ${response.status}: ${response.statusText}`
        )
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error('Failed to invite user - invalid response from server')
      }

      logger.log('User invited successfully:', inviteData.email)
    } catch (error) {
      logger.error('Error inviting user:', error)
      throw error
    }
  }

  /**
   * Reset user password
   */
  static async resetPassword(
    userId: string,
    resetData: PasswordResetFormData
  ): Promise<void> {
    try {
      // Get auth token for backend API call
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (sessionError || !session) {
        throw new Error('Authentication required for password reset')
      }

      // Determine API base URL (same pattern as other API calls in the codebase)
      const API_BASE_URL = (() => {
        if (typeof window !== 'undefined') {
          const currentOrigin = window.location.origin
          if (currentOrigin === 'http://localhost:5173') {
            return 'http://localhost:8000'
          }
          return currentOrigin // Production: use same origin
        }
        return import.meta.env.VITE_API_URL || 'http://localhost:8000'
      })()

      // Call backend API to reset password using admin privileges
      const response = await fetch(
        `${API_BASE_URL}/api/admin/users/${userId}/reset-password`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            new_password: resetData.new_password,
            send_email: resetData.send_email,
          }),
        }
      )

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: 'Failed to reset password' }))
        throw new Error(
          errorData.detail || `HTTP ${response.status}: ${response.statusText}`
        )
      }

      const result = await response.json()
      logger.log('Password reset successful:', result)

      // Log the activity
      await UserManagementService.logUserActivity(
        userId,
        'password_reset',
        'auth',
        {
          reset_by_admin: true,
          email_sent: resetData.send_email,
        }
      )
    } catch (error) {
      logger.error('Error resetting password:', error)
      throw error
    }
  }

  /**
   * Update user role
   */
  static async updateUserRole(userId: string, role: UserRole): Promise<void> {
    try {
      // CRITICAL FIX: Get role_id from role name to update foreign key relationship
      const roleId = await getRoleIdFromName(role)
      if (!roleId) {
        throw new Error(
          `Role not found: ${role}. Please ensure the role exists in the database.`
        )
      }

      logger.log(
        `🔄 Updating user ${userId} role: ${role} (role_id: ${roleId})`
      )

      // ENHANCED FIX (Dec 20, 2025): Check if role is a system role or custom role
      // System roles can be set in both 'role' and 'role_id' fields
      // Custom roles only use 'role_id' because they're not in the database enum
      const systemRoles = [
        'superadmin',
        'admin',
        'manager',
        'cashier',
        'viewer',
        'tka_associate',
        'inventory_specialist',
        'logistics_coordinator',
        'quality_specialist',
      ]
      const isSystemRole = systemRoles.includes(role)

      const updateData: Record<string, unknown> = {
        role_id: roleId, // Always update the foreign key field
        updated_at: new Date().toISOString(),
      }

      // Only set the enum 'role' field for system roles
      if (isSystemRole) {
        updateData.role = role
      }

      const { error } = await supabase
        .from('user_profiles')
        .update(updateData)
        .eq('id', userId)

      if (error) throw error

      // TODO: Needs backend endpoint to sync auth metadata after role change (POST /api/admin/users/:id/sync-role)
      // Previously used supabaseAdmin?.auth.admin.updateUserById which is unavailable in browser

      // CRITICAL SYSTEM-WIDE FIX: Invalidate all permission caches for this user
      logger.log(
        `🔄 Invalidating permission caches for user ${userId} after role change`
      )

      // Clear permission store cache for this user
      if (typeof window !== 'undefined') {
        // Get permission store and force cache invalidation
        const { usePermissionStore } = await import('@/stores/permissionStore')
        const store = usePermissionStore.getState()

        if (store.currentUserId === userId) {
          logger.log(
            '🧹 Clearing current user permission cache after role change'
          )
          store.clearPermissions()

          // Force immediate reload of permissions with new role
          setTimeout(async () => {
            logger.log('🔄 Reloading permissions with new role:', role)
            await store.loadPermissions(userId, false) // Force fresh fetch
          }, 100)
        }

        // Clear navigation store cache for new role
        const { useNavigationStore } = await import('@/stores/navigationStore')
        const navStore = useNavigationStore.getState()

        logger.log('🧹 Clearing navigation permission cache after role change')
        navStore.clearNavigationPermissions()

        // Force immediate reload of navigation permissions with new role
        setTimeout(async () => {
          logger.log('🔄 Reloading navigation permissions with new role:', role)
          await navStore.loadNavigationPermissions(role, false) // Force fresh fetch
        }, 200)

        // Clear unified auth store cache if available
        try {
          const { useUnifiedAuth } = await import('@/stores/unifiedAuthStore')
          const unifiedStore = useUnifiedAuth.getState()

          if (unifiedStore.currentUserId === userId) {
            logger.log('🧹 Clearing unified auth store cache after role change')
            await unifiedStore.clearCache()

            // Force immediate reload with new role
            setTimeout(async () => {
              logger.log('🔄 Reloading unified auth data with new role:', role)
              await Promise.all([
                unifiedStore.loadPermissions(userId, false),
                unifiedStore.loadNavigationPermissions(role, false),
                unifiedStore.loadTabPermissions(userId, undefined, false),
              ])
            }, 300)
          }
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (unifiedError) {
          // Unified store might not be available in all contexts
          logger.log(
            'ℹ️ Unified auth store not available for cache invalidation'
          )
        }

        // Also trigger a browser storage clear for cached permission data
        try {
          localStorage.removeItem('permission-store')
          localStorage.removeItem('navigation-store')
          localStorage.removeItem('unified-auth-store')
          logger.log(
            '🧹 Cleared localStorage permission data after role change'
          )
        } catch (storageError) {
          logger.warn('Could not clear localStorage:', storageError)
        }
      }

      // Log the activity
      await UserManagementService.logUserActivity(
        userId,
        'role_updated',
        'user',
        {
          new_role: role,
          role_id: roleId,
          cache_invalidated: true,
        }
      )

      logger.log(
        `✅ User role updated successfully: ${role} (ID: ${roleId}) with cache invalidation`
      )
    } catch (error) {
      logger.error('Error updating user role:', error)
      throw error
    }
  }

  /**
   * Update user status (simple version without reason tracking)
   */
  static async updateUserStatus(
    userId: string,
    status: UserStatus
  ): Promise<void> {
    try {
      // Type assertion needed as database types may not include new status values yet
      const { error } = await supabase
        .from('user_profiles')
        .update({
          status: status as any, // DB types lag behind app status values
          status_changed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)

      if (error) throw error

      // TODO: Needs backend endpoint to ban/unban auth user on status change
      // POST /api/admin/users/:id/ban (for suspended/terminated)
      // POST /api/admin/users/:id/unban (for active)
      // Previously used supabaseAdmin?.auth.admin.updateUserById which is unavailable in browser

      // Log the activity
      await UserManagementService.logUserActivity(
        userId,
        'status_updated',
        'user',
        { new_status: status }
      )
    } catch (error) {
      logger.error('Error updating user status:', error)
      throw error
    }
  }

  /**
   * Update user status with reason tracking
   * ADDED January 4, 2026: Full HR workflow support
   */
  static async updateUserStatusWithReason(
    userId: string,
    data: StatusChangeData
  ): Promise<void> {
    try {
      // Get current user's status for validation
      const { data: currentUser, error: fetchError } = await supabase
        .from('user_profiles')
        .select('status')
        .eq('id', userId)
        .single()

      if (fetchError) throw fetchError

      // Validate status transition - use string comparison as DB types may not include new statuses
      if ((currentUser.status as string) === 'terminated') {
        throw new Error(
          'Cannot change status of terminated users. Please create a new user account.'
        )
      }

      // Prepare update data
      const updateData: Record<string, unknown> = {
        status: data.new_status,
        status_change_reason: data.reason,
        status_changed_at: data.effective_date || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      // Handle leave-specific fields
      if (data.new_status === 'on_leave') {
        updateData.leave_start_date = new Date().toISOString().split('T')[0]
        if (data.leave_return_date) {
          updateData.leave_return_date = data.leave_return_date
        }
      } else {
        // Clear leave fields when not on leave
        updateData.leave_start_date = null
        updateData.leave_return_date = null
      }

      // Handle termination-specific fields
      if (data.new_status === 'terminated') {
        updateData.termination_date =
          data.effective_date || new Date().toISOString()
        updateData.termination_reason = data.reason
      }

      // Update user profile - Type assertion needed for new status values
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update(updateData as Record<string, unknown>)
        .eq('id', userId)

      if (updateError) throw updateError

      // Insert status history record
      // Note: user_status_history table needs to be created via migration
      // Using try-catch as the table may not exist in all environments yet
      try {
        const { error: historyError } = await (supabase as any)
          .from('user_status_history')
          .insert({
            user_id: userId,
            previous_status: currentUser.status,
            new_status: data.new_status,
            reason: data.reason,
            notes: data.notes,
            effective_date: data.effective_date || new Date().toISOString(),
            metadata: {
              leave_return_date: data.leave_return_date,
            },
          })
        if (historyError) {
          logger.warn('Failed to record status history:', historyError)
        }
      } catch (err) {
        logger.warn('Status history table may not exist yet:', err)
      }

      // TODO: Needs backend endpoint to ban/unban auth user on status change
      // POST /api/admin/users/:id/ban (for suspended/terminated)
      // POST /api/admin/users/:id/unban (for active)
      // Previously used supabaseAdmin?.auth.admin.updateUserById which is unavailable in browser

      // Log the activity
      await UserManagementService.logUserActivity(
        userId,
        'status_updated',
        'user',
        {
          previous_status: currentUser.status,
          new_status: data.new_status,
          reason: data.reason,
          notes: data.notes,
          leave_return_date: data.leave_return_date,
        }
      )

      logger.log(
        `✅ User status updated: ${currentUser.status} → ${data.new_status}`
      )
    } catch (error) {
      logger.error('Error updating user status with reason:', error)
      throw error
    }
  }

  /**
   * Get user status history
   * ADDED January 4, 2026
   */
  static async getUserStatusHistory(
    userId: string
  ): Promise<UserStatusHistory[]> {
    try {
      // Note: user_status_history table needs to be created via migration
      const { data, error } = await (supabase as any)
        .from('user_status_history')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (error) {
        logger.warn('Could not fetch status history:', error)
        return []
      }

      return (data || []) as UserStatusHistory[]
    } catch (error) {
      logger.error('Error fetching user status history:', error)
      // Return empty array if table doesn't exist yet
      return []
    }
  }

  /**
   * Resend invitation
   * UPDATED January 31, 2026: Now calls backend API instead of using supabaseAdmin directly
   */
  static async resendInvitation(userId: string): Promise<void> {
    try {
      // Get auth token for backend API call
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (sessionError || !session) {
        throw new Error('Authentication required to resend invitation')
      }

      // Determine API base URL
      const API_BASE_URL = (() => {
        if (typeof window !== 'undefined') {
          const currentOrigin = window.location.origin
          if (currentOrigin === 'http://localhost:5173') {
            return 'http://localhost:8000'
          }
          return currentOrigin
        }
        return import.meta.env.VITE_API_URL || 'http://localhost:8000'
      })()

      // Call backend API to resend invitation
      const response = await fetch(
        `${API_BASE_URL}/api/admin/users/${userId}/resend-invitation`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: 'Failed to resend invitation' }))
        throw new Error(
          errorData.detail || `HTTP ${response.status}: ${response.statusText}`
        )
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(
          'Failed to resend invitation - invalid response from server'
        )
      }

      // Log the activity
      await UserManagementService.logUserActivity(
        userId,
        'invitation_resent',
        'auth',
        {}
      )

      logger.log('Invitation resent successfully to:', result.email)
    } catch (error) {
      logger.error('Error resending invitation:', error)
      throw error
    }
  }

  /**
   * Bulk update users
   * ENHANCED January 4, 2026: Support for new status types
   */
  static async bulkUpdateUsers(bulkData: BulkActionData): Promise<void> {
    try {
      const { action, user_ids, role, reason, leave_return_date } = bulkData

      switch (action) {
        case 'activate':
          await Promise.all(
            user_ids.map((id) =>
              this.updateUserStatusWithReason(id, {
                new_status: 'active',
                reason: reason || 'Bulk activation',
              })
            )
          )
          break
        case 'deactivate':
          await Promise.all(
            user_ids.map((id) =>
              this.updateUserStatusWithReason(id, {
                new_status: 'inactive',
                reason: reason || 'Bulk deactivation',
              })
            )
          )
          break
        case 'suspend':
          if (!reason) throw new Error('Reason is required for suspend action')
          await Promise.all(
            user_ids.map((id) =>
              this.updateUserStatusWithReason(id, {
                new_status: 'suspended',
                reason,
              })
            )
          )
          break
        case 'terminate':
          if (!reason)
            throw new Error('Reason is required for terminate action')
          await Promise.all(
            user_ids.map((id) =>
              this.updateUserStatusWithReason(id, {
                new_status: 'terminated',
                reason,
              })
            )
          )
          break
        case 'set_on_leave':
          if (!reason) throw new Error('Reason is required for on leave action')
          await Promise.all(
            user_ids.map((id) =>
              this.updateUserStatusWithReason(id, {
                new_status: 'on_leave',
                reason,
                leave_return_date,
              })
            )
          )
          break
        case 'delete':
          await Promise.all(user_ids.map((id) => this.deleteUser(id)))
          break
        case 'change_role':
          if (!role) throw new Error('Role is required for change_role action')
          await Promise.all(user_ids.map((id) => this.updateUserRole(id, role)))
          break
        case 'send_invitation':
          await Promise.all(user_ids.map((id) => this.resendInvitation(id)))
          break
        case 'export':
          // Export is handled client-side
          break
        default:
          throw new Error(`Unknown bulk action: ${action}`)
      }

      // Log bulk activity
      for (const userId of user_ids) {
        await UserManagementService.logUserActivity(
          userId,
          `bulk_${action}`,
          'user',
          {
            bulk_action: true,
            reason,
            ...(role && { role }),
            ...(leave_return_date && { leave_return_date }),
          }
        )
      }
    } catch (error) {
      logger.error('Error performing bulk action:', error)
      throw error
    }
  }

  /**
   * Get user statistics
   * ENHANCED January 4, 2026: Include new status counts and deleted users count
   */
  static async getUserStats(): Promise<UserStats> {
    try {
      // Get both active and deleted users for complete stats (use role_id join for role name)
      const { data: allUsers, error } = await supabase
        .from('user_profiles')
        .select('status, role_id, roles(name), created_at, deleted_at')

      if (error) throw error

      const now = new Date()
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)

      const stats = allUsers?.reduce(
        (acc, user) => {
          // Count deleted users separately
          if (user.deleted_at) {
            acc.deleted++
            return acc // Don't count deleted users in other stats
          }

          acc.total++

          // Count by status - ENHANCED with new statuses
          // Using string comparison to handle new statuses not in DB types yet
          const status = user.status as string
          if (status === 'active') acc.active++
          else if (status === 'inactive') acc.inactive++
          else if (status === 'invited') acc.invited++
          else if (status === 'suspended') acc.suspended++
          else if (status === 'terminated') acc.terminated++
          else if (status === 'on_leave') acc.on_leave++

          // Count admins (use role name from roles table join)
          const roleName = (
            (user as Record<string, unknown>).roles as { name?: string } | null
          )?.name
          if (roleName && ['admin', 'superadmin'].includes(roleName))
            acc.admins++

          // Count new this month
          if (user.created_at && new Date(user.created_at) >= thisMonth)
            acc.newThisMonth++

          return acc
        },
        {
          total: 0,
          active: 0,
          inactive: 0,
          invited: 0,
          suspended: 0,
          terminated: 0,
          on_leave: 0,
          pending: 0, // Will be calculated
          admins: 0,
          newThisMonth: 0,
          activePercentage: 0,
          deleted: 0, // Soft-deleted users
        }
      )

      if (stats) {
        stats.pending = stats.invited
        stats.activePercentage =
          stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0
      }

      return (
        stats || {
          total: 0,
          active: 0,
          inactive: 0,
          invited: 0,
          suspended: 0,
          terminated: 0,
          on_leave: 0,
          pending: 0,
          admins: 0,
          newThisMonth: 0,
          activePercentage: 0,
          deleted: 0,
        }
      )
    } catch (error) {
      logger.error('Error fetching user stats:', error)
      throw error
    }
  }

  /**
   * Get user permissions
   */
  static async getUserPermissions(userId: string): Promise<UserPermission[]> {
    try {
      // Get role-based permissions using role_id
      const user = await this.getUserById(userId)

      const { data: rolePermissions, error: roleError } = user.role_id
        ? await supabase
            .from('role_permissions')
            .select(
              `
              permission:permissions(*)
            `
            )
            .eq('role_id', user.role_id)
        : { data: [], error: null }

      if (roleError) throw roleError

      // Get user-specific permissions
      const { data: userPermissions, error: userError } = await supabase
        .from('user_permissions')
        .select(
          `
          granted,
          expires_at,
          permission:permissions(*)
        `
        )
        .eq('user_id', userId)
        .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())

      if (userError) throw userError

      // Combine and format permissions
      const permissions: UserPermission[] = []

      // Add role permissions
      rolePermissions?.forEach((rp) => {
        if (rp.permission) {
          permissions.push({
            id: rp.permission.id,
            name: rp.permission.name,
            resource: rp.permission.resource,
            action: rp.permission.action,
            description: rp.permission.description || undefined,
            granted: true,
          })
        }
      })

      // Add/override with user-specific permissions
      userPermissions?.forEach((up) => {
        if (up.permission) {
          const existingIndex = permissions.findIndex(
            (p) => p.id === up.permission.id
          )
          if (existingIndex >= 0) {
            permissions[existingIndex].granted = up.granted || false
            permissions[existingIndex].expires_at = up.expires_at || undefined
          } else {
            permissions.push({
              id: up.permission.id,
              name: up.permission.name,
              resource: up.permission.resource,
              action: up.permission.action,
              description: up.permission.description || undefined,
              granted: up.granted || false,
              expires_at: up.expires_at || undefined,
            })
          }
        }
      })

      return permissions
    } catch (error) {
      logger.error('Error fetching user permissions:', error)
      throw error
    }
  }

  /**
   * Update user permissions
   */
  static async updateUserPermissions(
    userId: string,
    permissions: UserPermission[]
  ): Promise<void> {
    try {
      // Clear existing user permissions
      await supabase.from('user_permissions').delete().eq('user_id', userId)

      // Insert new permissions
      const permissionData = permissions.map((p) => ({
        user_id: userId,
        permission_id: p.id,
        granted: p.granted,
        expires_at: p.expires_at || null,
      }))

      if (permissionData.length > 0) {
        const { error } = await supabase
          .from('user_permissions')
          .insert(permissionData)

        if (error) throw error
      }

      // Log the activity
      await UserManagementService.logUserActivity(
        userId,
        'permissions_updated',
        'user',
        {
          permissions_count: permissions.length,
        }
      )
    } catch (error) {
      logger.error('Error updating user permissions:', error)
      throw error
    }
  }

  /**
   * Get user activity log
   */
  static async getUserActivity(userId: string): Promise<UserActivity[]> {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) throw error

      // Map audit logs to UserActivity format
      const activities: UserActivity[] = (data || []).map((log) => ({
        id: log.id,
        user_id: log.user_id || '',
        action: log.action,
        resource: log.resource_type || '',
        details: (log.changes as Record<string, unknown>) || {},
        ip_address: log.ip_address as string,
        user_agent: log.user_agent || undefined,
        created_at: log.created_at || new Date().toISOString(),
      }))

      return activities
    } catch (error) {
      logger.error('Error fetching user activity:', error)
      throw error
    }
  }

  /**
   * Export users to CSV format
   * ADDED January 4, 2026
   */
  static exportUsersToCSV(users: UserProfile[]): string {
    const headers = [
      'ID',
      'Email',
      'First Name',
      'Last Name',
      'Username',
      'Role',
      'Status',
      'Email Verified',
      'Phone Number',
      'Created At',
      'Last Seen',
    ]

    const rows = users.map((user) => [
      user.id,
      user.email,
      user.first_name || '',
      user.last_name || '',
      user.username || '',
      ((user as Record<string, unknown>).roles as { name?: string } | null)
        ?.name ||
        user.role_id ||
        '',
      user.status || '',
      user.email_verified ? 'Yes' : 'No',
      user.phone_number || '',
      user.created_at,
      user.last_seen || '',
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n')

    return csvContent
  }

  /**
   * Log user activity
   */
  private static async logUserActivity(
    userId: string,
    action: string,
    resource: string,
    details: Record<string, unknown>
  ): Promise<void> {
    try {
      // Map custom actions to allowed audit_action enum values
      const auditAction = [
        'create',
        'update',
        'delete',
        'view',
        'login',
        'logout',
      ].includes(action)
        ? (action as
            | 'create'
            | 'update'
            | 'delete'
            | 'view'
            | 'login'
            | 'logout')
        : 'update' // Default to 'update' for custom actions

      await supabase.from('audit_logs').insert({
        user_id: userId,
        action: auditAction,
        resource_type: resource,
        changes: details as any, // Supabase Json column
        metadata: { custom_action: action } as any, // Supabase Json column
        ip_address: null,
        user_agent:
          typeof navigator !== 'undefined'
            ? navigator?.userAgent || null
            : null,
      })
    } catch (error) {
      logger.error('Error logging user activity:', error)
      // Don't throw - logging shouldn't break main functionality
    }
  }
}
