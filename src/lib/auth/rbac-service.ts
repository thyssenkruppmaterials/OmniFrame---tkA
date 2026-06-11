// Created and developed by Jai Singh
/**
 * Streamlined RBAC Service
 * High-performance role-based access control with unified caching
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { rbacCacheManager } from '@/lib/auth/cache-manager'
import { singletonAuthManager } from '@/lib/auth/singleton-auth-manager'
import { authCache } from '@/lib/cache/auth-cache'
import type { SupabaseSingleResult } from '@/lib/supabase/rpc-types'
import { logger } from '@/lib/utils/logger'
// import { authService } from './auth-service' // Not needed for now
import type {
  Permission,
  PermissionCheckContext,
  PermissionCheckResult,
  PermissionWithCategory,
  Role,
  RoleWithHierarchy,
  UserRole,
  // UserPermission,
  // RolePermission
} from './types'

// ── Local interfaces for Supabase query result typing ──

/** Permission fields from join queries (superset of all accessed fields) */
interface PermissionFields {
  id?: string
  resource: string
  action: string
  description?: string | null
  is_active?: boolean
  is_critical?: boolean
  requires_2fa?: boolean
  risk_level?: string
  scope?: string
  name?: string
  created_at?: string
  updated_at?: string
}

/** Row with a permission join (from role_permissions / user_permissions selects) */
interface PermissionJoinEntry {
  permission: PermissionFields | null
}

/** Role row from the roles table */
interface RoleRow {
  id: string
  name: string
  display_name: string
  description?: string | null
  is_system?: boolean
  is_active?: boolean
  features?: Record<string, boolean>
  metadata?: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

/** Role permission row with conditional fields */
interface ConditionalPermissionEntry {
  conditions: Record<string, unknown> | null
  requires_conditions?: boolean
  condition_logic?: string | null
  valid_from?: string | null
  valid_to?: string | null
  permission: { resource: string; action: string } | null
}

/** Audit log entry from the audit_logs table */
interface AuditLogEntry {
  id?: string | null
  user_id?: string | null
  resource_type?: string | null
  resource_id?: string | null
  action?: string | null
  details?: Record<string, unknown>
  created_at?: string | null
  ip_address?: unknown
  user_agent?: string | null
  organization_id?: string | null
  metadata?: unknown
  changes?: unknown
  [key: string]: unknown
}

/** Tab permission entry from RPC results */
interface TabPermissionEntry {
  tab_definition_id: string
  page_resource: string
  tab_id: string
  tab_label: string
  granted: boolean
  source: 'role' | 'direct'
}

/** Tab definition entry */
interface TabDefinitionEntry {
  id: string
  page_resource: string
  tab_id: string
  tab_label: string
  description?: string
  display_order: number
  is_active: boolean
}

/** Inherited role entry from get_inherited_roles RPC */
interface InheritedRoleEntry {
  inherited_role_id: string
  [key: string]: unknown
}

/** Permission dependency row */
interface PermissionDependencyRow {
  required_permission_id: string
  permissions: { resource: string; action: string } | null
}

/** Permission conflict row */
interface PermissionConflictRow {
  conflicting_permission_id: string
  permissions: { resource: string; action: string } | null
}

export class RBACService {
  private static instance: RBACService

  private constructor() {}

  static getInstance(): RBACService {
    if (!RBACService.instance) {
      RBACService.instance = new RBACService()
    }
    return RBACService.instance
  }

  /**
   * Check if user has specific permission
   */
  async checkPermission(
    userId: string,
    resource: string,
    action: string,
    _context: PermissionCheckContext = {}
  ): Promise<PermissionCheckResult> {
    const startTime = Date.now()
    const cacheKey = `perm:${userId}:${resource}:${action}`

    // Check cache first
    const cached = authCache.get<PermissionCheckResult>(cacheKey)
    if (cached && Date.now() < (cached.expires_at || 0)) {
      return { ...cached, source: 'cached' }
    }

    try {
      // Check role-based permissions using role_id
      const { data: userProfile, error: profileError } =
        (await singletonAuthManager.executeRead(
          async (client) =>
            await client
              .from('user_profiles')
              .select('role_id')
              .eq('id', userId)
              .single()
        )) as SupabaseSingleResult<{ role_id?: string }>

      if (profileError) throw profileError

      let granted = false
      if (userProfile?.role_id) {
        // Check role permissions using role_id
        const { data: rolePerms, error: roleError } =
          await singletonAuthManager.executeRead(
            async (client) =>
              await client
                .from('role_permissions')
                .select(
                  `
              permission:permissions(resource, action)
            `
                )
                .eq('role_id', userProfile?.role_id || '')
          )

        if (!roleError && rolePerms) {
          const matchingPerm = (rolePerms as PermissionJoinEntry[]).find(
            (rp) => {
              const perm = rp.permission
              return (
                perm &&
                (perm.resource === resource || perm.resource === '*') &&
                (perm.action === action || perm.action === '*')
              )
            }
          )
          granted = !!matchingPerm
        }
      }

      // If not found in role permissions, check direct user permissions
      if (!granted) {
        const { data: userPerms, error: userError } =
          await singletonAuthManager.executeRead(
            async (client) =>
              await client
                .from('user_permissions')
                .select(
                  `
              permission:permissions(resource, action, requires_2fa, risk_level)
            `
                )
                .eq('user_id', userId)
                .eq('granted', true)
          )

        if (!userError && userPerms) {
          const matchingPerm = (
            userPerms as unknown as PermissionJoinEntry[]
          ).find((up) => {
            const perm = up.permission
            return (
              perm &&
              (perm.resource === resource || perm.resource === '*') &&
              (perm.action === action || perm.action === '*')
            )
          })
          granted = !!matchingPerm
        }
      }

      // If basic permission granted, evaluate conditional permissions (time-based)
      if (granted) {
        const conditionsMet = await this.evaluateConditionalPermissions(
          userId,
          resource,
          action
        )
        if (!conditionsMet) {
          granted = false
        }
      }

      const result: PermissionCheckResult = {
        granted,
        source: 'direct',
        role_sources: [],
        check_time_ms: Date.now() - startTime,
      }

      // Get permission details for additional metadata
      const permission = await this.getPermissionByResourceAction(
        resource,
        action
      )
      if (permission) {
        result.requires_2fa = false // Simplified for now
        result.risk_level = 'low' // Simplified for now
      }

      // Cache the result for 2 minutes
      const cacheExpiry = Date.now() + 2 * 60 * 1000
      authCache.set(
        cacheKey,
        { ...result, expires_at: cacheExpiry },
        2 * 60 * 1000,
        [`user:${userId}`, `permission:${resource}:${action}`]
      )

      return result
    } catch (error) {
      logger.error('Error checking permission:', error)
      return {
        granted: false,
        source: 'direct',
        role_sources: [],
        check_time_ms: Date.now() - startTime,
      }
    }
  }

  /**
   * Get all user permissions as strings
   */
  async getUserPermissions(userId: string): Promise<string[]> {
    const cacheKey = `permissions:${userId}`

    // Check cache first
    const cached = authCache.get<string[]>(cacheKey)
    if (cached) return cached

    try {
      // Get permissions from role-based access using role_id
      const { data: userProfile, error: profileError } =
        (await singletonAuthManager.executeRead(
          async (client) =>
            await client
              .from('user_profiles')
              .select('role_id')
              .eq('id', userId)
              .single()
        )) as SupabaseSingleResult<{ role_id?: string }>

      if (profileError) throw profileError

      let permissions: string[] = []
      if (userProfile?.role_id) {
        const { data: rolePerms, error: roleError } =
          await singletonAuthManager.executeRead(
            async (client) =>
              await client
                .from('role_permissions')
                .select(
                  `
              permission:permissions(resource, action)
            `
                )
                .eq('role_id', userProfile?.role_id || '')
          )

        if (!roleError && rolePerms) {
          permissions = (rolePerms as PermissionJoinEntry[])
            .map((rp) => rp.permission)
            .filter((p): p is PermissionFields => p != null)
            .map((p) => `${p.resource}:${p.action}`)
        }
      }

      // Get direct user permissions
      const { data: userPerms, error: userError } =
        await singletonAuthManager.executeRead(
          async (client) =>
            await client
              .from('user_permissions')
              .select(
                `
            permission:permissions(resource, action)
          `
              )
              .eq('user_id', userId)
              .eq('granted', true)
        )

      if (!userError && userPerms) {
        const directPerms = (userPerms as PermissionJoinEntry[])
          .map((up) => up.permission)
          .filter((p): p is PermissionFields => p != null)
          .map((p) => `${p.resource}:${p.action}`)
        permissions = [...permissions, ...directPerms]
      }

      // Cache the result
      authCache.set(cacheKey, permissions, 5 * 60 * 1000, [
        `user:${userId}`,
        'permissions',
      ])
      return permissions
    } catch (error) {
      logger.error('Error fetching user permissions:', error)
      return []
    }
  }

  /**
   * Get user permissions with full details
   */
  async getUserPermissionsDetailed(
    userId: string
  ): Promise<PermissionWithCategory[]> {
    const cacheKey = `permissions_detailed:${userId}`

    // Check cache first
    const cached = authCache.get<PermissionWithCategory[]>(cacheKey)
    if (cached) return cached

    try {
      // Get user's role_id and permissions
      const { data: userProfile, error: profileError } =
        (await singletonAuthManager.executeRead(
          async (client) =>
            await client
              .from('user_profiles')
              .select('role_id')
              .eq('id', userId)
              .single()
        )) as SupabaseSingleResult<{ role_id?: string }>

      if (profileError) throw profileError

      const permissions: PermissionWithCategory[] = []
      if (userProfile?.role_id) {
        const { data: rolePerms, error: roleError } =
          await singletonAuthManager.executeRead(
            async (client) =>
              await client
                .from('role_permissions')
                .select(
                  `
            permission:permissions(id, resource, action, description, created_at)
          `
                )
                .eq('role_id', userProfile?.role_id || '')
          )

        if (!roleError && rolePerms) {
          ;(rolePerms as unknown as PermissionJoinEntry[]).forEach((rp) => {
            if (rp.permission) {
              permissions.push({
                ...rp.permission,
                id: rp.permission.id ?? '',
                name:
                  rp.permission.name ??
                  `${rp.permission.resource}:${rp.permission.action}`,
                scope: 'application' as const,
                category_name: null,
                category_display_name: null,
                category_icon: null,
                required_dependencies_count: 0,
                optional_dependencies_count: 0,
                conflicts_count: 0,
                tags: [],
              } as PermissionWithCategory)
            }
          })
        }
      }

      // Get direct user permissions
      const { data: userPerms, error: userError } =
        await singletonAuthManager.executeRead(
          async (client) =>
            await client
              .from('user_permissions')
              .select(
                `
          permission:permissions(id, resource, action, description, is_critical, requires_2fa, risk_level, created_at)
        `
              )
              .eq('user_id', userId)
              .eq('granted', true)
        )

      if (!userError && userPerms) {
        ;(userPerms as unknown as PermissionJoinEntry[]).forEach((up) => {
          if (up.permission) {
            permissions.push({
              ...up.permission,
              id: up.permission.id ?? '',
              name:
                up.permission.name ??
                `${up.permission.resource}:${up.permission.action}`,
              scope: 'application' as const,
              category_name: null,
              category_display_name: null,
              category_icon: null,
              required_dependencies_count: 0,
              optional_dependencies_count: 0,
              conflicts_count: 0,
              tags: [],
            } as PermissionWithCategory)
          }
        })
      }

      // Cache the result
      authCache.set(cacheKey, permissions, 5 * 60 * 1000, [
        `user:${userId}`,
        'permissions',
      ])
      return permissions
    } catch (error) {
      logger.error('Error fetching user permissions detailed:', error)
      return []
    }
  }

  /**
   * Get user roles with hierarchy
   */
  async getUserRoles(userId: string): Promise<RoleWithHierarchy[]> {
    const cacheKey = `roles:${userId}`

    // Check cache first
    const cached = authCache.get<RoleWithHierarchy[]>(cacheKey)
    if (cached) return cached

    try {
      // Get user's role from profile via role_id
      const { data: userProfile, error: profileError } =
        (await singletonAuthManager.executeRead(
          async (client) =>
            await client
              .from('user_profiles')
              .select('role_id')
              .eq('id', userId)
              .single()
        )) as SupabaseSingleResult<{ role_id?: string }>

      if (profileError) throw profileError

      if (!userProfile?.role_id) {
        return []
      }

      // Get role details using role_id directly
      const { data: roleData, error: roleError } =
        (await singletonAuthManager.executeRead(
          async (client) =>
            await client
              .from('roles')
              .select('*')
              .eq('id', userProfile?.role_id || '')
              .single()
        )) as SupabaseSingleResult<RoleRow>

      const roles: RoleWithHierarchy[] = []
      if (!roleError && roleData) {
        roles.push({
          id: roleData.id,
          name: roleData.name,
          display_name: roleData.display_name,
          description: roleData.description || null,
          parent_role_id: null, // Not in current schema
          priority: 0,
          max_users: null, // Not in current schema
          is_system: roleData.is_system || false,
          is_active: roleData.is_active || true,
          features: {}, // Not in current schema
          metadata: {}, // Not in current schema
          created_at: roleData.created_at,
          updated_at: roleData.updated_at,
          level: 0,
          path: [roleData.id],
          name_path: [roleData.name],
          depth: 1,
          permissions_count: 0,
        })
      }

      // Cache the result
      authCache.set(cacheKey, roles, 10 * 60 * 1000, [
        `user:${userId}`,
        'roles',
      ])
      return roles
    } catch (error) {
      logger.error('Error fetching user roles:', error)
      return []
    }
  }

  /**
   * Check if user has any of the specified permissions
   */
  async hasAnyPermission(
    userId: string,
    permissions: string[]
  ): Promise<boolean> {
    if (permissions.length === 0) return false

    // Get user's permissions once
    const userPermissions = await this.getUserPermissions(userId)

    // Check if any requested permission matches
    return permissions.some((perm) => {
      const [resource] = perm.split(':')
      return (
        userPermissions.includes(perm) ||
        userPermissions.includes(`${resource}:*`) ||
        userPermissions.includes(`*:*`)
      )
    })
  }

  /**
   * Check if user has all of the specified permissions
   */
  async hasAllPermissions(
    userId: string,
    permissions: string[]
  ): Promise<boolean> {
    if (permissions.length === 0) return true

    // Get user's permissions once
    const userPermissions = await this.getUserPermissions(userId)

    // Check if all requested permissions match
    return permissions.every((perm) => {
      const [resource] = perm.split(':')
      return (
        userPermissions.includes(perm) ||
        userPermissions.includes(`${resource}:*`) ||
        userPermissions.includes(`*:*`)
      )
    })
  }

  /**
   * Check if user's role has a specific feature
   */
  async checkRoleFeature(
    userId: string,
    featureName: string
  ): Promise<boolean> {
    const cacheKey = `role_feature:${userId}:${featureName}`

    // Check cache first
    const cached = authCache.get<boolean>(cacheKey)
    if (cached !== null) return cached

    try {
      const roles = await this.getUserRoles(userId)
      const hasFeature = roles.some(
        (role) => role.features?.[featureName] === true
      )

      // Cache the result
      authCache.set(cacheKey, hasFeature, 5 * 60 * 1000, [
        `user:${userId}`,
        'role_features',
      ])
      return hasFeature
    } catch (error) {
      logger.error('Error checking role feature:', error)
      return false
    }
  }

  /**
   * Get permissions with full metadata including categories and dependencies.
   * Returns PermissionWithCategory[] with default category values.
   * Backwards-compatible replacement for rbac-enhanced.getPermissionsWithMetadata()
   */
  async getPermissionsWithMetadata(
    permissionIds: string[] = []
  ): Promise<PermissionWithCategory[]> {
    const cacheKey = `permissions_metadata:${permissionIds.join(',') || 'all'}`

    const cached = authCache.get<PermissionWithCategory[]>(cacheKey)
    if (cached) return cached

    try {
      const query = singletonAuthManager.executeRead(async (client) => {
        let q = client.from('permissions').select('*')
        if (permissionIds.length > 0) {
          q = q.in('id', permissionIds)
        }
        return await q.order('resource', { ascending: true })
      })

      const { data, error } = (await query) as {
        data: Permission[] | null
        error: { message: string } | null
      }
      if (error) throw error

      const enhancedPermissions: PermissionWithCategory[] = (data || []).map(
        (perm: Permission) => ({
          id: perm.id,
          name: perm.name || `${perm.resource}:${perm.action}`,
          resource: perm.resource,
          action: perm.action,
          description: perm.description,
          is_active: perm.is_active,
          is_critical: perm.is_critical || false,
          requires_2fa: perm.requires_2fa || false,
          risk_level: perm.risk_level || ('low' as const),
          scope: perm.scope || ('application' as const),
          created_at: perm.created_at,
          updated_at: perm.updated_at,
          category_name: null,
          category_display_name: null,
          category_icon: null,
          required_dependencies_count: 0,
          optional_dependencies_count: 0,
          conflicts_count: 0,
          tags: [],
        })
      )

      authCache.set(cacheKey, enhancedPermissions, 15 * 60 * 1000, [
        'system',
        'permissions_metadata',
      ])
      return enhancedPermissions
    } catch (error) {
      logger.error('Error fetching permissions with metadata:', error)
      return []
    }
  }

  /**
   * Get all available permissions
   */
  async getAllPermissions(): Promise<Permission[]> {
    const cacheKey = 'all_permissions'

    // Check cache first
    const cached = authCache.get<Permission[]>(cacheKey)
    if (cached) return cached

    try {
      // NOTE: `permissions.is_active` column does not exist in the live
      // schema. Treat every row in the permissions table as active.
      // See: memorybank/OmniFrame/Debug/Performance-Review-2026-05-19-Production-Slowness.md
      const { data, error } = await singletonAuthManager.executeRead(
        async (client) => await client.from('permissions').select('*')
      )

      if (error) throw error

      authCache.set(cacheKey, data, 15 * 60 * 1000, ['system', 'permissions'])
      return (data ?? []) as unknown as Permission[]
    } catch (error) {
      logger.error('Error fetching all permissions:', error)
      return []
    }
  }

  /**
   * Get all available roles
   */
  async getAllRoles(): Promise<Role[]> {
    const cacheKey = 'all_roles'

    // Check cache first
    const cached = authCache.get<Role[]>(cacheKey)
    if (cached) return cached

    try {
      const { data, error } = await singletonAuthManager.executeRead(
        async (client) =>
          await client.from('roles').select('*').eq('is_active', true)
      )

      if (error) throw error

      // Cache the result
      authCache.set(cacheKey, data, 15 * 60 * 1000, ['system', 'roles'])
      return data || []
    } catch (error) {
      logger.error('Error fetching all roles:', error)
      return []
    }
  }

  /**
   * Create a new role (requires admin)
   */
  async createRole(roleData: {
    name: string
    display_name: string
    description?: string
    parent_role_id?: string
    features?: Record<string, boolean>
    max_users?: number
    metadata?: Record<string, unknown>
  }): Promise<Role> {
    // Using SingletonAuthManager for admin operations

    try {
      const { data, error } = await singletonAuthManager.executeWrite(
        async (client) =>
          await client
            .from('roles')
            .insert({
              name: roleData.name,
              display_name: roleData.display_name,
              description: roleData.description,
              parent_role_id: roleData.parent_role_id || null,
              features: roleData.features || {},
              max_users: roleData.max_users || null,
              metadata: roleData.metadata || {},
              is_system: false,
              is_active: true,
            })
            .select()
            .single()
      )

      if (error) throw error

      // Invalidate role cache
      authCache.invalidateByTags(['system', 'roles'])

      return data as unknown as Role
    } catch (error) {
      logger.error('Error creating role:', error)
      throw error
    }
  }

  /**
   * Assign permissions to a role
   */
  async assignPermissionsToRole(
    roleId: string,
    permissionIds: string[]
  ): Promise<void> {
    // Using SingletonAuthManager for admin operations

    try {
      // Remove existing permissions
      await singletonAuthManager.executeWrite(
        async (client) =>
          await client.from('role_permissions').delete().eq('role_id', roleId)
      )

      // Add new permissions
      if (permissionIds.length > 0) {
        // First get the role name
        const { data: roleData, error: roleError } =
          (await singletonAuthManager.executeRead(
            async (client) =>
              await client
                .from('roles')
                .select('name')
                .eq('id', roleId)
                .single()
          )) as SupabaseSingleResult<{ name?: string }>

        if (roleError) throw roleError

        const rolePermissions = permissionIds.map((permissionId) => ({
          role_id: roleId,
          permission_id: permissionId,
          role: roleData?.name as UserRole,
          created_at: new Date().toISOString(),
        }))

        const { error } = await singletonAuthManager.executeWrite(
          async (client) =>
            await client.from('role_permissions').insert(rolePermissions)
        )

        if (error) throw error
      }

      // Invalidate caches
      authCache.invalidateByTags([`role:${roleId}`, 'permissions'])
    } catch (error) {
      logger.error('Error assigning permissions to role:', error)
      throw error
    }
  }

  /**
   * Assign role to user
   */
  async assignRoleToUser(userId: string, roleId: string): Promise<void> {
    // Using SingletonAuthManager for admin operations

    try {
      const { error } = await singletonAuthManager.executeWrite(
        async (client) =>
          await client
            .from('user_profiles')
            .update({ role_id: roleId })
            .eq('id', userId)
      )

      if (error) throw error

      // Invalidate user caches
      authCache.invalidateUser(userId)
    } catch (error) {
      logger.error('Error assigning role to user:', error)
      throw error
    }
  }

  /**
   * Grant temporary permission to user
   */
  async grantTemporaryPermission(
    userId: string,
    permissionId: string,
    durationHours: number,
    reason: string
  ): Promise<void> {
    // Using SingletonAuthManager for admin operations

    try {
      const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000)

      const { error } = await singletonAuthManager.executeWrite(
        async (client) =>
          await client.from('user_permissions').insert({
            user_id: userId,
            permission_id: permissionId,
            granted: true,
            expires_at: expiresAt.toISOString(),
            metadata: { reason, temporary: true },
          })
      )

      if (error) throw error

      // Invalidate user permission cache
      authCache.invalidateUser(userId)

      // Log the action
      await this.logRBACChange('grant_temporary_permission', userId, {
        permission_id: permissionId,
        duration_hours: durationHours,
        reason,
      })
    } catch (error) {
      logger.error('Error granting temporary permission:', error)
      throw error
    }
  }

  /**
   * Revoke temporary permission from user
   */
  async revokeTemporaryPermission(
    userId: string,
    permissionId: string
  ): Promise<void> {
    // Using SingletonAuthManager for admin operations

    try {
      const { error } = await singletonAuthManager.executeWrite(
        async (client) =>
          await client
            .from('user_permissions')
            .delete()
            .eq('user_id', userId)
            .eq('permission_id', permissionId)
            .eq('granted', true)
      )

      if (error) throw error

      // Invalidate user permission cache
      authCache.invalidateUser(userId)

      // Log the action
      await this.logRBACChange('revoke_temporary_permission', userId, {
        permission_id: permissionId,
      })
    } catch (error) {
      logger.error('Error revoking temporary permission:', error)
      throw error
    }
  }

  /**
   * Get user's permission audit trail
   */
  async getUserPermissionAudit(
    userId: string,
    limit = 50
  ): Promise<AuditLogEntry[]> {
    try {
      const { data, error } = await singletonAuthManager.executeRead(
        async (client) =>
          await client
            .from('audit_logs')
            .select('*')
            .eq('user_id', userId)
            .eq('resource_type', 'permission')
            .order('created_at', { ascending: false })
            .limit(limit)
      )

      if (error) throw error
      return data || []
    } catch (error) {
      logger.error('Error fetching permission audit:', error)
      return []
    }
  }

  // ===================================================================
  // CONDITIONAL PERMISSIONS (Step 13 - Time-based condition evaluation)
  // ===================================================================

  /**
   * Evaluate conditional permissions for a user's permission grant.
   * Checks if role_permissions conditions (time-of-day, day-of-week) are met.
   * Called after basic permission check passes to enforce time-based restrictions.
   *
   * Condition JSONB shape (from role_permissions.conditions):
   *   { time: { allowed_days: ["1","2","3","4","5"], start_time: "08:00", end_time: "17:00" } }
   *   DOW: 0=Sunday, 1=Monday, ..., 6=Saturday
   *
   * @returns true if no conditions exist or all conditions are met
   */
  private async evaluateConditionalPermissions(
    userId: string,
    resource: string,
    action: string
  ): Promise<boolean> {
    try {
      // Get user's role_id
      const { data: userProfile, error: profileError } =
        (await singletonAuthManager.executeRead(
          async (client) =>
            await client
              .from('user_profiles')
              .select('role_id')
              .eq('id', userId)
              .single()
        )) as SupabaseSingleResult<{ role_id?: string }>

      if (profileError || !userProfile?.role_id) {
        // No role = no conditional restrictions (user_permissions don't have conditions)
        return true
      }

      // Fetch the matching role_permission with condition columns
      const { data: rolePerms, error: roleError } =
        await singletonAuthManager.executeRead(
          async (client) =>
            await client
              .from('role_permissions')
              .select(
                `
            conditions,
            requires_conditions,
            condition_logic,
            valid_from,
            valid_to,
            permission:permissions(resource, action)
          `
              )
              .eq('role_id', userProfile.role_id || '')
        )

      if (roleError || !rolePerms) return true

      // Find the matching permission entry
      const matchingEntry = (rolePerms as ConditionalPermissionEntry[]).find(
        (rp) => {
          const perm = rp.permission
          return (
            perm &&
            (perm.resource === resource || perm.resource === '*') &&
            (perm.action === action || perm.action === '*')
          )
        }
      )

      if (!matchingEntry) return true

      // Check temporal bounds (valid_from / valid_to)
      const now = new Date()
      if (
        matchingEntry.valid_from &&
        now < new Date(matchingEntry.valid_from)
      ) {
        return false
      }
      if (matchingEntry.valid_to && now > new Date(matchingEntry.valid_to)) {
        return false
      }

      // If conditions are not required, permission is granted
      if (!matchingEntry.requires_conditions) return true

      const conditions = matchingEntry.conditions as {
        time?: {
          allowed_days?: string[]
          start_time?: string
          end_time?: string
        }
      } | null
      if (!conditions || Object.keys(conditions).length === 0) {
        // requires_conditions=true but no conditions defined = deny (fail-safe)
        return false
      }

      // Evaluate time-based conditions
      const timeConditions = conditions.time
      let dayOk = true
      let timeOk = true

      if (timeConditions) {
        // Check day-of-week: JS getDay() returns 0=Sunday, 1=Monday, ..., 6=Saturday
        if (
          timeConditions.allowed_days &&
          Array.isArray(timeConditions.allowed_days)
        ) {
          const currentDay = now.getDay().toString()
          dayOk = timeConditions.allowed_days.includes(currentDay)
        }

        // Check time-of-day window (HH:MM format)
        if (timeConditions.start_time && timeConditions.end_time) {
          const currentMinutes = now.getHours() * 60 + now.getMinutes()
          const [startH, startM] = timeConditions.start_time
            .split(':')
            .map(Number)
          const [endH, endM] = timeConditions.end_time.split(':').map(Number)
          const startMinutes = startH * 60 + startM
          const endMinutes = endH * 60 + endM
          timeOk =
            currentMinutes >= startMinutes && currentMinutes <= endMinutes
        }
      }

      // TODO: IP-based condition checks are server-side only (Rust Core Service).
      //       The frontend cannot reliably determine client IP. The Rust service
      //       calls check_permission_conditions() from migration 031 for full
      //       IP/geo restriction evaluation before forwarding requests.

      // TODO: Location/geo-restriction checks are server-side only (Rust Core Service).
      //       Geo-IP resolution and country-level restrictions are evaluated in the
      //       Rust middleware layer using the ip_restrictions and geo_restrictions
      //       columns from role_permissions.

      // Apply condition logic (AND = all must pass, OR = any can pass)
      const logic = matchingEntry.condition_logic || 'AND'
      if (logic === 'AND') {
        return dayOk && timeOk
      } else {
        return dayOk || timeOk
      }
    } catch (error) {
      logger.error('Error evaluating conditional permissions:', error)
      // Fail-open: if condition evaluation fails, don't block the user
      return true
    }
  }

  /**
   * Check conditional permission via database RPC function.
   * Calls check_conditional_permission() which evaluates basic permission
   * AND time-based conditions server-side in a single atomic operation.
   *
   * Use this when you need a definitive server-side check (e.g., before
   * sensitive operations). For regular UI permission gating, the standard
   * checkPermission() method (which includes client-side condition evaluation)
   * is preferred for performance.
   *
   * @param userId - User UUID
   * @param resource - Permission resource (e.g., 'inventory', 'admin')
   * @param action - Permission action (e.g., 'read', 'write', 'delete')
   * @returns true if user has the permission and all conditions are met
   */
  async checkConditionalPermission(
    userId: string,
    resource: string,
    action: string
  ): Promise<boolean> {
    const cacheKey = `cond_perm:${userId}:${resource}:${action}`

    // Check cache first (shorter TTL than basic permissions due to time sensitivity)
    const cached = authCache.get<boolean>(cacheKey)
    if (cached !== null) return cached

    try {
      const { data, error } = await singletonAuthManager.executeRead(
        async (client) =>
          await (client as SupabaseClient).rpc('check_conditional_permission', {
            p_user_id: userId,
            p_resource: resource,
            p_action: action,
          })
      )

      if (error) {
        logger.error('Error calling check_conditional_permission RPC:', error)
        // Fall back to basic permission check if RPC fails
        const basicResult = await this.checkPermission(userId, resource, action)
        return basicResult.granted
      }

      const granted = data as boolean

      // Cache for 1 minute (shorter TTL because conditions are time-sensitive)
      authCache.set(cacheKey, granted, 60 * 1000, [
        `user:${userId}`,
        `conditional_permission:${resource}:${action}`,
      ])

      // TODO: For operations requiring IP/location validation, the Rust Core Service
      //       should be called instead. It uses check_permission_conditions() from
      //       migration 031 with the full context (IP address, geo-location).
      //       Frontend should call: POST /api/auth/check-permission
      //       with { user_id, resource, action } and the server adds IP/location context.

      return granted
    } catch (error) {
      logger.error('Error checking conditional permission:', error)
      return false
    }
  }

  /**
   * Get permission by resource and action
   */
  private async getPermissionByResourceAction(
    resource: string,
    action: string
  ): Promise<Permission | null> {
    const cacheKey = `perm_details:${resource}:${action}`

    // Check cache first
    const cached = authCache.get<Permission>(cacheKey)
    if (cached) return cached

    try {
      // NOTE: `permissions.is_active` column does not exist in the live schema.
      const { data, error } = await singletonAuthManager.executeRead(
        async (client) =>
          await client
            .from('permissions')
            .select('*')
            .eq('resource', resource)
            .eq('action', action)
            .single()
      )

      if (error) return null

      // Cache the result
      authCache.set(cacheKey, data, 10 * 60 * 1000, [
        'system',
        'permission_details',
      ])
      return data as unknown as Permission
    } catch (error) {
      logger.error('Error fetching permission details:', error)
      return null
    }
  }

  /**
   * Log RBAC changes for audit
   */
  private async logRBACChange(
    action: string,
    userId: string,
    details: Record<string, unknown>
  ): Promise<void> {
    try {
      // Log RBAC change - simplified implementation
      logger.log(`RBAC change: ${action} for user ${userId}`, details)
    } catch (error) {
      // Don't fail the operation if logging fails
      logger.warn('RBAC logging failed:', error)
    }
  }

  /**
   * Clear user permission cache
   */
  clearUserCache(userId: string): void {
    authCache.invalidateUser(userId)
  }

  /**
   * Clear all caches
   */
  clearAllCache(): void {
    authCache.clear()
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return authCache.getStats()
  }

  // === TAB PERMISSION METHODS ===

  /**
   * Check if user has access to a specific tab
   */
  async checkTabPermission(
    userId: string,
    pageResource: string,
    tabId: string
  ): Promise<boolean> {
    const cacheKey = `tab_perm:${userId}:${pageResource}:${tabId}`

    // Check cache first
    const cached = authCache.get<boolean>(cacheKey)
    if (cached !== null) return cached

    try {
      // Use the database function for efficient permission resolution
      const { data, error } = await singletonAuthManager.executeRead(
        async (client) =>
          await (client as SupabaseClient).rpc('check_user_tab_permission', {
            p_user_id: userId,
            p_page_resource: pageResource,
            p_tab_id: tabId,
          })
      )

      if (error) {
        logger.error('Error checking tab permission:', error)
        return false
      }

      const hasPermission = data as boolean

      // Cache the result for 2 minutes
      authCache.set(cacheKey, hasPermission, 2 * 60 * 1000, [
        `user:${userId}`,
        `tab:${pageResource}:${tabId}`,
      ])

      return hasPermission
    } catch (error) {
      logger.error('Error checking tab permission:', error)
      return false
    }
  }

  /**
   * Get all tab permissions for a user's page resource
   */
  async getUserTabPermissions(
    userId: string,
    pageResource?: string
  ): Promise<
    Array<{
      tab_definition_id: string
      page_resource: string
      tab_id: string
      tab_label: string
      granted: boolean
      source: 'role' | 'direct'
    }>
  > {
    const cacheKey = `tab_perms:${userId}:${pageResource || 'all'}`

    // Check cache first
    const cached = authCache.get<TabPermissionEntry[]>(cacheKey)
    if (cached) return cached

    try {
      // Use the database function for efficient permission resolution
      const { data, error } = await singletonAuthManager.executeRead(
        async (client) =>
          await (client as SupabaseClient).rpc('get_user_tab_permissions', {
            p_user_id: userId,
            p_page_resource: pageResource || null,
          })
      )

      if (error) {
        logger.error('Error fetching user tab permissions:', error)
        return []
      }

      // Cache the result for 5 minutes
      const typedData = (data || []) as Array<{
        tab_definition_id: string
        page_resource: string
        tab_id: string
        tab_label: string
        granted: boolean
        source: 'role' | 'direct'
      }>

      authCache.set(cacheKey, typedData, 5 * 60 * 1000, [
        `user:${userId}`,
        'tab_permissions',
      ])

      return typedData
    } catch (error) {
      logger.error('Error fetching user tab permissions:', error)
      return []
    }
  }

  /**
   * Get allowed tabs for a user's page resource
   */
  async getAllowedTabs(
    userId: string,
    pageResource: string
  ): Promise<
    Array<{
      tab_id: string
      tab_label: string
      description?: string
      display_order: number
    }>
  > {
    try {
      const permissions = await this.getUserTabPermissions(userId, pageResource)

      return permissions
        .filter((p) => p.granted && p.page_resource === pageResource)
        .map((p) => ({
          tab_id: p.tab_id,
          tab_label: p.tab_label,
          display_order: 0, // Will be enhanced later
        }))
        .sort((a, b) => a.display_order - b.display_order)
    } catch (error) {
      logger.error('Error getting allowed tabs:', error)
      return []
    }
  }

  /**
   * Assign tab permissions to a role
   */
  async assignTabPermissionsToRole(
    roleId: string,
    tabDefinitionIds: string[]
  ): Promise<void> {
    try {
      // Get the current user's auth token
      const {
        data: { session },
      } = await singletonAuthManager.getSupabaseClient().auth.getSession()
      if (!session) {
        throw new Error('No authenticated session')
      }

      // Call the backend API endpoint instead of using supabaseAdmin
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api/admin/roles/${roleId}/tab-permissions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            role_id: roleId,
            tab_definition_ids: tabDefinitionIds,
          }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Failed to update tab permissions')
      }

      const result = await response.json()
      if (!result.success) {
        throw new Error(result.message || 'Failed to update tab permissions')
      }

      // Invalidate caches
      authCache.invalidateByTags([`role:${roleId}`, 'tab_permissions'])
    } catch (error) {
      logger.error('Error assigning tab permissions to role:', error)
      throw error
    }
  }

  /**
   * Assign navigation permissions to a role
   * Uses the backend API to bypass RLS policies (added January 27, 2026)
   */
  async assignNavigationPermissionsToRole(
    roleId: string,
    navigationItemIds: string[]
  ): Promise<{ success: boolean; affectedRows: number; errors?: string[] }> {
    try {
      // Get the current user's auth token
      const {
        data: { session },
      } = await singletonAuthManager.getSupabaseClient().auth.getSession()
      if (!session) {
        throw new Error('No authenticated session')
      }

      // Call the backend API endpoint to bypass RLS
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api/admin/roles/${roleId}/navigation-permissions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            navigation_item_ids: navigationItemIds,
          }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(
          errorData.detail || 'Failed to update navigation permissions'
        )
      }

      const result = await response.json()

      // Invalidate caches
      authCache.invalidateByTags([`role:${roleId}`, 'navigation_permissions'])

      return {
        success: result.success,
        affectedRows: result.affected_rows || 0,
        errors: result.errors || undefined,
      }
    } catch (error) {
      logger.error('Error assigning navigation permissions to role:', error)
      throw error
    }
  }

  /**
   * Grant temporary tab permission to user
   */
  async grantTemporaryTabPermission(
    userId: string,
    tabDefinitionId: string,
    durationHours: number,
    reason: string
  ): Promise<void> {
    // Using SingletonAuthManager for admin operations

    try {
      const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000)

      const { error } = await singletonAuthManager.executeWrite(
        async (client) =>
          await (client as SupabaseClient).from('user_tab_permissions').upsert({
            user_id: userId,
            tab_definition_id: tabDefinitionId,
            granted: true,
            expires_at: expiresAt.toISOString(),
          })
      )

      if (error) throw error

      // Invalidate user tab permission cache
      authCache.invalidateByTags([`user:${userId}`, 'tab_permissions'])

      // Log the action
      await this.logRBACChange('grant_temporary_tab_permission', userId, {
        tab_definition_id: tabDefinitionId,
        duration_hours: durationHours,
        reason,
      })
    } catch (error) {
      logger.error('Error granting temporary tab permission:', error)
      throw error
    }
  }

  /**
   * Revoke tab permission from user
   */
  async revokeTabPermission(
    userId: string,
    tabDefinitionId: string
  ): Promise<void> {
    // Using SingletonAuthManager for admin operations

    try {
      const { error } = await singletonAuthManager.executeWrite(
        async (client) =>
          await (client as SupabaseClient)
            .from('user_tab_permissions')
            .delete()
            .eq('user_id', userId)
            .eq('tab_definition_id', tabDefinitionId)
      )

      if (error) throw error

      // Invalidate user tab permission cache
      authCache.invalidateByTags([`user:${userId}`, 'tab_permissions'])

      // Log the action
      await this.logRBACChange('revoke_tab_permission', userId, {
        tab_definition_id: tabDefinitionId,
      })
    } catch (error) {
      logger.error('Error revoking tab permission:', error)
      throw error
    }
  }

  /**
   * Get all available tab definitions
   */
  async getAllTabDefinitions(): Promise<
    Array<{
      id: string
      page_resource: string
      tab_id: string
      tab_label: string
      description?: string
      display_order: number
      is_active: boolean
    }>
  > {
    const cacheKey = 'all_tab_definitions'

    // Check cache first
    const cached = authCache.get<TabDefinitionEntry[]>(cacheKey)
    if (cached) return cached

    try {
      const { data, error } = await singletonAuthManager.executeRead(
        async (client) =>
          await (client as SupabaseClient)
            .from('tab_definitions')
            .select('*')
            .eq('is_active', true)
            .order('page_resource')
            .order('display_order')
      )

      if (error) throw error

      // Cache the result
      const typedData = (data || []) as Array<{
        id: string
        page_resource: string
        tab_id: string
        tab_label: string
        description?: string
        display_order: number
        is_active: boolean
      }>

      authCache.set(cacheKey, typedData, 15 * 60 * 1000, [
        'system',
        'tab_definitions',
      ])
      return typedData
    } catch (error) {
      logger.error('Error fetching tab definitions:', error)
      return []
    }
  }

  /**
   * Clear tab permission cache for user
   */
  clearUserTabPermissionCache(userId: string): void {
    authCache.invalidateByTags([`user:${userId}`, 'tab_permissions'])
  }

  // === ENHANCED FEATURES (Merged from rbac-enhanced.ts) ===

  /**
   * Get user's effective permissions including role hierarchy inheritance
   * Merged from rbac-enhanced.ts for Phase 6 consolidation
   *
   * @param userId - The user's UUID
   * @returns Array of permissions including inherited ones from role hierarchy
   */
  async getUserEffectivePermissionsWithHierarchy(
    userId: string
  ): Promise<PermissionWithCategory[]> {
    const cacheKey = `effective_perms_hierarchy:${userId}`

    const cached = authCache.get<PermissionWithCategory[]>(cacheKey)
    if (cached) return cached

    try {
      // Get user's role_id
      const { data: userProfile, error: profileError } =
        (await singletonAuthManager.executeRead(
          async (client) =>
            await client
              .from('user_profiles')
              .select('role_id')
              .eq('id', userId)
              .single()
        )) as SupabaseSingleResult<{ role_id?: string }>

      if (profileError) throw profileError
      if (!userProfile?.role_id) return []

      // Try to get role hierarchy (inherited permissions)
      let roleIds: string[] = [userProfile.role_id]

      try {
        const { data: hierarchy, error: hierarchyError } =
          await singletonAuthManager.executeRead(
            async (client) =>
              await (client as SupabaseClient).rpc('get_inherited_roles', {
                role_id: userProfile.role_id,
              })
          )

        if (!hierarchyError && hierarchy && Array.isArray(hierarchy)) {
          // Collect all role IDs in hierarchy
          const inheritedRoleIds = (hierarchy as InheritedRoleEntry[])
            .map((r) => r.inherited_role_id)
            .filter(Boolean)
          if (inheritedRoleIds.length > 0) {
            roleIds = [...new Set([...inheritedRoleIds, userProfile.role_id])]
          }
        }
      } catch (_hierarchyErr) {
        // Role hierarchy function may not be available - continue with direct role only
        logger.debug(
          'Role hierarchy function not available, using direct role permissions only'
        )
      }

      // Get permissions for all roles in hierarchy
      const allPermissions: PermissionWithCategory[] = []
      const seenPermissionIds = new Set<string>()

      for (const roleId of roleIds) {
        const { data: rolePerms } = await singletonAuthManager.executeRead(
          async (client) =>
            await client
              .from('role_permissions')
              .select(
                'permission:permissions(id, resource, action, description, created_at)'
              )
              .eq('role_id', roleId)
        )

        if (rolePerms) {
          ;(rolePerms as PermissionJoinEntry[]).forEach((rp) => {
            if (
              rp.permission &&
              rp.permission.id &&
              !seenPermissionIds.has(rp.permission.id)
            ) {
              seenPermissionIds.add(rp.permission.id)
              allPermissions.push({
                ...rp.permission,
                id: rp.permission.id ?? '',
                name:
                  rp.permission.name ??
                  `${rp.permission.resource}:${rp.permission.action}`,
                scope: 'application' as const,
                category_name: null,
                category_display_name: null,
                category_icon: null,
                required_dependencies_count: 0,
                optional_dependencies_count: 0,
                conflicts_count: 0,
                tags: [],
              } as PermissionWithCategory)
            }
          })
        }
      }

      // Add direct user permissions
      const directPerms = await this.getUserPermissionsDetailed(userId)
      for (const perm of directPerms) {
        if (!seenPermissionIds.has(perm.id)) {
          seenPermissionIds.add(perm.id)
          allPermissions.push(perm)
        }
      }

      // Cache result for 5 minutes
      authCache.set(cacheKey, allPermissions, 5 * 60 * 1000, [
        `user:${userId}`,
        'permissions',
      ])

      return allPermissions
    } catch (error) {
      logger.error(
        'Error fetching effective permissions with hierarchy:',
        error
      )
      return []
    }
  }

  /**
   * Validate permission assignment (check dependencies and conflicts)
   * Merged from rbac-enhanced.ts for Phase 6 consolidation
   *
   * @param userId - The user's UUID
   * @param permissionId - The permission UUID to validate
   * @returns Validation result with missing dependencies and conflicts
   */
  async validatePermissionAssignment(
    userId: string,
    permissionId: string
  ): Promise<{
    is_valid: boolean
    missing_dependencies: string[]
    conflicting_permissions: string[]
  }> {
    try {
      // Get the permission being assigned
      const { data: permission, error: permError } =
        await singletonAuthManager.executeRead(
          async (client) =>
            await client
              .from('permissions')
              .select('*')
              .eq('id', permissionId)
              .single()
        )

      if (permError || !permission) {
        return {
          is_valid: false,
          missing_dependencies: ['permission-not-found'],
          conflicting_permissions: [],
        }
      }

      // Get user's current permissions for conflict checking
      const userPerms = await this.getUserPermissions(userId)

      // Try to check permission dependencies if the table exists
      const missingDependencies: string[] = []
      const conflictingPermissions: string[] = []

      try {
        // Check for required dependencies (using any cast as tables may not exist in schema yet)
        const { data: dependencies } = await singletonAuthManager.executeRead(
          async (client) =>
            await (client as SupabaseClient)
              .from('permission_dependencies')
              .select(
                'required_permission_id, permissions!permission_dependencies_required_permission_id_fkey(resource, action)'
              )
              .eq('permission_id', permissionId)
              .eq('dependency_type', 'required')
        )

        if (dependencies && Array.isArray(dependencies)) {
          for (const dep of dependencies as unknown as PermissionDependencyRow[]) {
            const requiredPerm = dep.permissions
            if (requiredPerm) {
              const permString = `${requiredPerm.resource}:${requiredPerm.action}`
              if (!userPerms.includes(permString)) {
                missingDependencies.push(permString)
              }
            }
          }
        }

        // Check for conflicts (using any cast as tables may not exist in schema yet)
        const { data: conflicts } = await singletonAuthManager.executeRead(
          async (client) =>
            await (client as SupabaseClient)
              .from('permission_conflicts')
              .select(
                'conflicting_permission_id, permissions!permission_conflicts_conflicting_permission_id_fkey(resource, action)'
              )
              .eq('permission_id', permissionId)
        )

        if (conflicts && Array.isArray(conflicts)) {
          for (const conflict of conflicts as unknown as PermissionConflictRow[]) {
            const conflictPerm = conflict.permissions
            if (conflictPerm) {
              const permString = `${conflictPerm.resource}:${conflictPerm.action}`
              if (userPerms.includes(permString)) {
                conflictingPermissions.push(permString)
              }
            }
          }
        }
      } catch (_depError) {
        // Permission dependencies table may not exist yet - continue with basic validation
        logger.debug(
          'Permission dependencies table not available, using basic validation'
        )
      }

      const isValid =
        missingDependencies.length === 0 && conflictingPermissions.length === 0

      return {
        is_valid: isValid,
        missing_dependencies: missingDependencies,
        conflicting_permissions: conflictingPermissions,
      }
    } catch (error) {
      logger.error('Error validating permission assignment:', error)
      return {
        is_valid: false,
        missing_dependencies: [],
        conflicting_permissions: [],
      }
    }
  }
}

// Export singleton instance
export const rbacService = RBACService.getInstance()

// Register authCache with the unified cache manager (Step 14)
rbacCacheManager.registerCacheLayer('rbac-service', () => {
  authCache.clear()
})

// === BACKWARDS COMPATIBILITY EXPORTS ===
// Re-export types from types.ts for consumers who imported from rbac-service
export type {
  Permission,
  PermissionCheckContext,
  PermissionCheckResult,
  PermissionWithCategory,
  Role,
  RoleWithHierarchy,
  UserRole,
  UserPermission,
  RolePermission,
} from './types'

// Created and developed by Jai Singh
