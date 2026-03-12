import { rbacService } from '@/lib/auth/rbac-service'
import { supabase } from '@/lib/supabase/client'
import type {
  Permission,
  RoleInsert,
  RoleUpdate,
  UserRole,
} from '@/lib/supabase/database.types'
import { logger } from '@/lib/utils/logger'
import { SYSTEM_ROLES } from '@/features/user-management/types'

// Helper function to get role enum value from role ID (Updated Dec 20, 2025 to support custom roles)
const getRoleEnumFromId = async (roleId: string): Promise<UserRole> => {
  try {
    const { data, error } = await supabase
      .from('roles')
      .select('name')
      .eq('id', roleId)
      .single()

    if (error) throw error

    // Return the actual role name (custom or system)
    // The database will use role_id for validation, not the role enum
    const roleName = data?.name?.toLowerCase()
    return (roleName || 'viewer') as UserRole
  } catch (error) {
    logger.error('Error getting role enum from ID:', error)
    return 'viewer' // Default fallback
  }
}

export interface RoleData {
  id: string
  name: string
  displayName: string
  description: string
  isSystem: boolean
  isActive: boolean
  userCount: number
  permissions: Permission[]
  createdAt: Date
  updatedAt: Date
}

// Get all available roles with user counts and permissions
export const getRoles = async (): Promise<RoleData[]> => {
  try {
    // Get all roles from the database
    const { data: roles, error: rolesError } = await supabase
      .from('roles')
      .select('*')
      .order('is_system', { ascending: false })
      .order('name', { ascending: true })

    if (rolesError) throw rolesError

    if (!roles) return []

    // Get user counts for each role
    const { data: userProfiles, error: profilesError } = await supabase
      .from('user_profiles')
      .select('role_id')

    if (profilesError) throw profilesError

    // Count users by role
    const roleCounts = (userProfiles || []).reduce(
      (acc, user) => {
        if (user.role_id) {
          acc[user.role_id] = (acc[user.role_id] || 0) + 1
        }
        return acc
      },
      {} as Record<string, number>
    )

    // Get permissions for each role
    const roleData: RoleData[] = []

    for (const role of roles) {
      // Get role permissions
      const { data: rolePermissions, error: permError } = await supabase
        .from('role_permissions')
        .select(
          `
          permission:permissions(*)
        `
        )
        .eq('role_id', role.id)

      if (permError) {
        logger.error(
          `Error fetching permissions for role ${role.name}:`,
          permError
        )
      }

      const permissions =
        rolePermissions?.map((rp) => rp.permission).filter(Boolean) || []

      roleData.push({
        id: role.id,
        name: role.name,
        displayName: role.display_name,
        description: role.description || '',
        isSystem: role.is_system || false,
        isActive: role.is_active || true,
        userCount: roleCounts[role.id] || 0,
        permissions: permissions as Permission[],
        createdAt: new Date(role.created_at || ''),
        updatedAt: new Date(role.updated_at || ''),
      })
    }

    return roleData
  } catch (error) {
    logger.error('Error fetching roles:', error)
    throw error
  }
}

// Create a new custom role with enhanced error handling
export const createRole = async (
  roleData: Omit<RoleInsert, 'id' | 'created_at' | 'updated_at'>
) => {
  try {
    // Pre-validate role name to provide better error messages
    const nameCheck = await isRoleNameTaken(roleData.name)
    if (nameCheck.taken) {
      const conflictingRole = nameCheck.conflictingRole
      const suggestions = nameCheck.suggestions || []

      const errorMessage = conflictingRole
        ? `A role similar to "${roleData.name}" already exists: "${conflictingRole.name}" (${conflictingRole.display_name})`
        : `Role name "${roleData.name}" is already taken`

      const suggestionsMessage =
        suggestions.length > 0 ? ` Suggestions: ${suggestions.join(', ')}` : ''

      throw new Error(`${errorMessage}.${suggestionsMessage}`)
    }

    const { data, error } = await supabase
      .from('roles')
      .insert({
        ...roleData,
        is_system: false, // Custom roles are never system roles
        is_active: true,
      } as RoleInsert)
      .select()
      .single()

    if (error) {
      // Handle specific PostgreSQL errors
      if (error.code === '23505') {
        // Unique constraint violation
        if (error.message.includes('roles_name_key')) {
          throw new Error(
            `Role name "${roleData.name}" already exists. Please choose a different name.`
          )
        }
        throw new Error(`Duplicate value error: ${error.message}`)
      }
      throw error
    }
    return data
  } catch (error) {
    logger.error('Error creating role:', error)
    throw error
  }
}

// Update an existing role
export const updateRole = async (
  roleId: string,
  updates: Partial<RoleUpdate>
) => {
  try {
    // Don't allow updating system flag
    const { is_system, ...safeUpdates } = updates as any

    const { data, error } = await supabase
      .from('roles')
      .update(safeUpdates)
      .eq('id', roleId)
      .select()
      .single()

    if (error) throw error
    return data
  } catch (error) {
    logger.error('Error updating role:', error)
    throw error
  }
}

// Delete a custom role (only non-system roles can be deleted)
export const deleteRole = async (roleId: string) => {
  try {
    // First check if it's a system role
    const { data: role, error: checkError } = await supabase
      .from('roles')
      .select('is_system')
      .eq('id', roleId)
      .single()

    if (checkError) throw checkError

    if (role?.is_system) {
      throw new Error('System roles cannot be deleted')
    }

    const { error } = await supabase.from('roles').delete().eq('id', roleId)

    if (error) throw error
    return { success: true }
  } catch (error) {
    logger.error('Error deleting role:', error)
    throw error
  }
}

// Update permissions for a role (Updated Jan 6, 2026 - PK now uses role_id)
export const updateRolePermissions = async (
  roleId: string,
  permissionIds: string[]
) => {
  try {
    // Get the role name (can be custom or system role)
    const roleName = await getRoleEnumFromId(roleId)

    // Delete existing role permissions by role_id
    const { error: deleteError } = await supabase
      .from('role_permissions')
      .delete()
      .eq('role_id', roleId)

    if (deleteError) throw deleteError

    // Insert new role permissions
    if (permissionIds.length > 0) {
      const rolePermissions = permissionIds.map((permissionId) => {
        const permissionRecord: any = {
          role_id: roleId,
          permission_id: permissionId,
        }

        // Set the role enum field: use actual name for system roles, 'viewer' for custom roles
        // Note: The role column is still NOT NULL, so we need a valid enum value
        // The primary key is now (role_id, permission_id) so custom roles work properly
        if (SYSTEM_ROLES.includes(roleName as (typeof SYSTEM_ROLES)[number])) {
          permissionRecord.role = roleName
        } else {
          // For custom roles, use 'viewer' as the enum fallback
          permissionRecord.role = 'viewer'
        }

        return permissionRecord
      })

      const { error: insertError } = await supabase
        .from('role_permissions')
        .insert(rolePermissions)

      if (insertError) throw insertError
    }

    return { success: true }
  } catch (error) {
    logger.error('Error updating role permissions:', error)
    throw error
  }
}

// Get all available permissions
export const getAllPermissions = async () => {
  try {
    const { data, error } = await supabase
      .from('permissions')
      .select('*')
      .order('resource', { ascending: true })
      .order('action', { ascending: true })

    if (error) throw error
    return data || []
  } catch (error) {
    logger.error('Error fetching permissions:', error)
    throw error
  }
}

// Update user role assignment
export const updateUserRole = async (userId: string, newRoleId: string) => {
  try {
    const { error } = await supabase
      .from('user_profiles')
      .update({
        role_id: newRoleId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)

    if (error) throw error
    return { success: true }
  } catch (error) {
    logger.error('Error updating user role:', error)
    throw error
  }
}

// Check if role can be deleted (only non-system roles can be deleted)
export const canDeleteRole = async (roleId: string): Promise<boolean> => {
  try {
    // Validate that roleId looks like a UUID
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(roleId)) {
      logger.error('Invalid role ID format:', roleId)
      return false
    }

    const { data, error } = await supabase
      .from('roles')
      .select('is_system')
      .eq('id', roleId)
      .single()

    if (error) throw error
    return !data?.is_system
  } catch (error) {
    logger.error('Error checking if role can be deleted:', error)
    return false
  }
}

// Get users assigned to a specific role
export const getUsersByRole = async (roleId: string) => {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, email, first_name, last_name, created_at')
      .eq('role_id', roleId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  } catch (error) {
    logger.error('Error fetching users by role:', error)
    throw error
  }
}

// Check if a role name is already taken (with fuzzy matching for similar names)
export const isRoleNameTaken = async (
  name: string,
  excludeId?: string
): Promise<{
  taken: boolean
  suggestions?: string[]
  conflictingRole?: any
}> => {
  try {
    // Check exact match first
    let query = supabase
      .from('roles')
      .select('id, name, display_name')
      .ilike('name', name)

    if (excludeId) {
      query = query.neq('id', excludeId)
    }

    const { data: exactMatch, error } = await query

    if (error) throw error

    if ((exactMatch?.length || 0) > 0) {
      return {
        taken: true,
        conflictingRole: exactMatch[0],
        suggestions: [],
      }
    }

    // Check for similar names (normalize underscores/spaces)
    const normalizedName = name.toLowerCase().replace(/[\s_-]+/g, '')
    const { data: allRoles, error: allError } = await supabase
      .from('roles')
      .select('id, name, display_name')

    if (allError) throw allError

    const similarRoles =
      allRoles?.filter((role) => {
        const normalizedRoleName = role.name
          .toLowerCase()
          .replace(/[\s_-]+/g, '')
        return normalizedRoleName === normalizedName && role.id !== excludeId
      }) || []

    if (similarRoles.length > 0) {
      // Generate suggestions for alternative names
      const suggestions = [
        `${name}_v2`,
        `${name}_new`,
        `enhanced_${name}`,
        `${name}_system`,
      ]

      return {
        taken: true,
        conflictingRole: similarRoles[0],
        suggestions,
      }
    }

    return { taken: false }
  } catch (error) {
    logger.error('Error checking role name:', error)
    return { taken: true } // Assume taken on error to be safe
  }
}

// Get role UUID from role name
export const getRoleIdFromName = async (
  roleName: string
): Promise<string | null> => {
  try {
    const { data, error } = await supabase
      .from('roles')
      .select('id')
      .eq('name', roleName)
      .single()

    if (error) throw error
    return data?.id || null
  } catch (error) {
    logger.error('Error getting role ID from name:', error)
    return null
  }
}

// Get full role details by ID
export const getRoleById = async (roleId: string): Promise<RoleData | null> => {
  try {
    const { data: role, error } = await supabase
      .from('roles')
      .select('*')
      .eq('id', roleId)
      .single()

    if (error) throw error
    if (!role) return null

    // Get permissions
    const { data: rolePermissions } = await supabase
      .from('role_permissions')
      .select(`permission:permissions(*)`)
      .eq('role_id', roleId)

    const permissions =
      rolePermissions?.map((rp) => rp.permission).filter(Boolean) || []

    // Get user count
    const { data: userProfiles } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('role_id', roleId)

    return {
      id: role.id,
      name: role.name,
      displayName: role.display_name,
      description: role.description || '',
      isSystem: role.is_system || false,
      isActive: role.is_active || true,
      userCount: userProfiles?.length || 0,
      permissions: permissions as Permission[],
      createdAt: new Date(role.created_at || ''),
      updatedAt: new Date(role.updated_at || ''),
    }
  } catch (error) {
    logger.error('Error fetching role by ID:', error)
    return null
  }
}

// Get role permissions IDs
export const getRolePermissionIds = async (
  roleId: string
): Promise<string[]> => {
  try {
    const { data, error } = await supabase
      .from('role_permissions')
      .select('permission_id')
      .eq('role_id', roleId)

    if (error) throw error
    return data?.map((p) => p.permission_id) || []
  } catch (error) {
    logger.error('Error fetching role permission IDs:', error)
    return []
  }
}

// Get role navigation permissions
export const getRoleNavigationPermissions = async (
  roleId: string
): Promise<string[]> => {
  try {
    const { data, error } = await supabase
      .from('role_navigation_permissions')
      .select('navigation_item_id')
      .eq('role_id', roleId)
      .eq('visible', true)

    if (error) throw error
    return data?.map((n) => n.navigation_item_id) || []
  } catch (error) {
    logger.error('Error fetching role navigation permissions:', error)
    return []
  }
}

// Get role tab permissions
export const getRoleTabPermissions = async (
  roleId: string
): Promise<string[]> => {
  try {
    const { data, error } = await supabase
      .from('role_tab_permissions')
      .select('tab_definition_id')
      .eq('role_id', roleId)
      .eq('granted', true)

    if (error) throw error
    return data?.map((t) => t.tab_definition_id) || []
  } catch (error) {
    logger.error('Error fetching role tab permissions:', error)
    return []
  }
}

// Compare two roles and return differences
export interface RoleComparisonResult {
  permissions: {
    added: string[]
    removed: string[]
    common: string[]
  }
  navigation: {
    added: string[]
    removed: string[]
    common: string[]
  }
  tabs: {
    added: string[]
    removed: string[]
    common: string[]
  }
}

export const compareRoles = async (
  roleId1: string,
  roleId2: string
): Promise<RoleComparisonResult> => {
  try {
    const [perms1, perms2, nav1, nav2, tabs1, tabs2] = await Promise.all([
      getRolePermissionIds(roleId1),
      getRolePermissionIds(roleId2),
      getRoleNavigationPermissions(roleId1),
      getRoleNavigationPermissions(roleId2),
      getRoleTabPermissions(roleId1),
      getRoleTabPermissions(roleId2),
    ])

    const compareArrays = (arr1: string[], arr2: string[]) => ({
      added: arr1.filter((id) => !arr2.includes(id)),
      removed: arr2.filter((id) => !arr1.includes(id)),
      common: arr1.filter((id) => arr2.includes(id)),
    })

    return {
      permissions: compareArrays(perms1, perms2),
      navigation: compareArrays(nav1, nav2),
      tabs: compareArrays(tabs1, tabs2),
    }
  } catch (error) {
    logger.error('Error comparing roles:', error)
    throw error
  }
}

/**
 * Result of bulk navigation permission update
 */
export interface BulkNavigationUpdateResult {
  success: boolean
  insertedCount: number
  requestedCount: number
  errors: string[]
}

/**
 * Bulk update navigation permissions for a role
 *
 * FIX (Jan 27, 2026 - v3): Rewritten to use backend API endpoint to bypass RLS.
 * The role_navigation_permissions table has RLS policies that block frontend inserts.
 * By calling the backend API (which uses the service role key), we can bypass these restrictions.
 *
 * @param roleId - The role UUID to update permissions for
 * @param navigationItemIds - Array of navigation item IDs to set as visible
 * @param _roleEnumValue - DEPRECATED: No longer needed, backend handles this
 * @returns Result with counts for verification
 */
export const bulkUpdateNavigationPermissions = async (
  roleId: string,
  navigationItemIds: string[],
  _roleEnumValue: UserRole // Kept for backward compatibility but no longer used
): Promise<BulkNavigationUpdateResult> => {
  const errors: string[] = []

  try {
    logger.log(`[bulkUpdateNavigationPermissions] Starting for role ${roleId}`)
    logger.log(
      `[bulkUpdateNavigationPermissions] Setting ${navigationItemIds.length} items as visible`
    )
    logger.log(
      `[bulkUpdateNavigationPermissions] Using backend API to bypass RLS`
    )

    const result = await rbacService.assignNavigationPermissionsToRole(
      roleId,
      navigationItemIds
    )

    logger.log(`[bulkUpdateNavigationPermissions] Backend API result:`, result)

    // Verify by querying the database
    const { data: verifyData } = await supabase
      .from('role_navigation_permissions')
      .select('navigation_item_id')
      .eq('role_id', roleId)
      .eq('visible', true)

    const verifiedCount = verifyData?.length || 0
    logger.log(
      `[bulkUpdateNavigationPermissions] Verified ${verifiedCount} permissions in database`
    )

    if (verifiedCount !== result.affectedRows && result.affectedRows > 0) {
      const warning = `Verification mismatch: API reported ${result.affectedRows}, found ${verifiedCount}`
      logger.warn(`[bulkUpdateNavigationPermissions] ${warning}`)
      errors.push(warning)
    }

    // Add any errors from the API response
    if (result.errors && result.errors.length > 0) {
      errors.push(...result.errors)
    }

    return {
      success: result.success && errors.length === 0,
      insertedCount: verifiedCount,
      requestedCount: navigationItemIds.length,
      errors,
    }
  } catch (error) {
    logger.error('[bulkUpdateNavigationPermissions] Error:', error)
    errors.push(error instanceof Error ? error.message : 'Unknown error')
    return {
      success: false,
      insertedCount: 0,
      requestedCount: navigationItemIds.length,
      errors,
    }
  }
}

/**
 * Result of role duplication with detailed counts for verification
 */
export interface DuplicateRoleResult {
  role: RoleData
  sourcePermissionCount: number
  copiedPermissionCount: number
  sourceNavigationCount: number
  copiedNavigationCount: number
  sourceTabCount: number
  copiedTabCount: number
  warnings: string[]
}

/**
 * Duplicate a role with all its permissions, navigation, and tabs
 *
 * @param sourceRoleId - UUID of the role to duplicate
 * @param newName - System name for the new role (lowercase, underscores)
 * @param newDisplayName - Display name for the new role
 * @returns The newly created role with all permissions copied and verification counts
 *
 * BUG FIX (Jan 27, 2026): Ensured all THREE permission types are copied correctly
 * - Base permissions (from role_permissions)
 * - Navigation permissions (from role_navigation_permissions)
 * - Tab permissions (from role_tab_permissions)
 */
export const duplicateRole = async (
  sourceRoleId: string,
  newName: string,
  newDisplayName: string
): Promise<DuplicateRoleResult | null> => {
  const warnings: string[] = []

  try {
    logger.log(`[duplicateRole] Starting duplication of role ${sourceRoleId}`)
    logger.log(
      `[duplicateRole] New name: "${newName}", Display name: "${newDisplayName}"`
    )

    // Step 1: Get source role data
    const sourceRole = await getRoleById(sourceRoleId)
    if (!sourceRole) {
      throw new Error('Source role not found')
    }
    logger.log(
      `[duplicateRole] Source role: "${sourceRole.name}" (${sourceRole.displayName})`
    )
    logger.log(
      `[duplicateRole] Source role has ${sourceRole.permissions.length} base permissions`
    )

    // Step 2: Get source navigation and tab permissions upfront
    const sourceNavPerms = await getRoleNavigationPermissions(sourceRoleId)
    const sourceTabPerms = await getRoleTabPermissions(sourceRoleId)
    logger.log(
      `[duplicateRole] Source role has ${sourceNavPerms.length} navigation permissions`
    )
    logger.log(
      `[duplicateRole] Source role has ${sourceTabPerms.length} tab permissions`
    )

    // Step 3: Create new role
    logger.log(`[duplicateRole] Creating new role in database...`)
    const { data: newRole, error: createError } = await supabase
      .from('roles')
      .insert({
        name: newName,
        display_name: newDisplayName,
        description: `Copy of ${sourceRole.displayName}: ${sourceRole.description || 'No description'}`,
        is_system: false,
        is_active: true,
      })
      .select()
      .single()

    if (createError) {
      logger.error(`[duplicateRole] Failed to create role:`, createError)
      throw createError
    }
    logger.log(`[duplicateRole] Created new role with ID: ${newRole.id}`)

    // Step 4: Copy base permissions
    const permissionIds = sourceRole.permissions.map((p) => p.id)
    let copiedPermissionCount = 0

    if (permissionIds.length > 0) {
      logger.log(
        `[duplicateRole] Copying ${permissionIds.length} base permissions...`
      )
      try {
        await updateRolePermissions(newRole.id, permissionIds)

        // Verify permissions were copied
        const verifyPerms = await getRolePermissionIds(newRole.id)
        copiedPermissionCount = verifyPerms.length
        logger.log(
          `[duplicateRole] Verified ${copiedPermissionCount} base permissions copied`
        )

        if (copiedPermissionCount !== permissionIds.length) {
          const warning = `Permission count mismatch: expected ${permissionIds.length}, got ${copiedPermissionCount}`
          logger.warn(`[duplicateRole] ${warning}`)
          warnings.push(warning)
        }
      } catch (permError) {
        const warning = `Failed to copy some base permissions: ${permError instanceof Error ? permError.message : 'Unknown error'}`
        logger.error(`[duplicateRole] ${warning}`)
        warnings.push(warning)
      }
    } else {
      logger.log(`[duplicateRole] No base permissions to copy`)
    }

    // Step 5: Copy navigation permissions
    let copiedNavigationCount = 0

    if (sourceNavPerms.length > 0) {
      logger.log(
        `[duplicateRole] Copying ${sourceNavPerms.length} navigation permissions...`
      )
      try {
        const roleEnumValue = await getRoleEnumFromId(newRole.id)
        const navResult = await bulkUpdateNavigationPermissions(
          newRole.id,
          sourceNavPerms,
          roleEnumValue
        )

        // Use the result from the bulk update
        copiedNavigationCount = navResult.insertedCount
        logger.log(
          `[duplicateRole] Bulk update result: ${copiedNavigationCount} inserted`
        )

        // Verify by querying the database
        const verifyNav = await getRoleNavigationPermissions(newRole.id)
        copiedNavigationCount = verifyNav.length
        logger.log(
          `[duplicateRole] Verified ${copiedNavigationCount} navigation permissions in database`
        )

        // Add any errors from bulk update to warnings
        if (navResult.errors.length > 0) {
          navResult.errors.forEach((err) => {
            logger.warn(`[duplicateRole] Navigation error: ${err}`)
            warnings.push(`Navigation: ${err}`)
          })
        }

        if (copiedNavigationCount !== sourceNavPerms.length) {
          const warning = `Navigation permission count mismatch: expected ${sourceNavPerms.length}, got ${copiedNavigationCount}`
          logger.warn(`[duplicateRole] ${warning}`)
          warnings.push(warning)
        }
      } catch (navError) {
        const warning = `Failed to copy navigation permissions: ${navError instanceof Error ? navError.message : 'Unknown error'}`
        logger.error(`[duplicateRole] ${warning}`)
        warnings.push(warning)
      }
    } else {
      logger.log(`[duplicateRole] No navigation permissions to copy`)
    }

    // Step 6: Copy tab permissions with validation
    // FIX (Jan 27, 2026): Validate tab_definition_ids exist before inserting
    // to prevent foreign key constraint failures
    let copiedTabCount = 0

    if (sourceTabPerms.length > 0) {
      logger.log(
        `[duplicateRole] Copying ${sourceTabPerms.length} tab permissions...`
      )
      try {
        // Step 6a: Validate which tab_definition_ids actually exist in tab_definitions
        const { data: validTabs, error: tabValidationError } = await supabase
          .from('tab_definitions')
          .select('id')
          .in('id', sourceTabPerms)
          .eq('is_active', true) // Only copy active tabs

        if (tabValidationError) {
          logger.warn(
            `[duplicateRole] Tab validation query failed:`,
            tabValidationError
          )
          warnings.push(`Tab validation error: ${tabValidationError.message}`)
        }

        const validTabIds = validTabs?.map((t) => t.id) || []
        const invalidTabIds = sourceTabPerms.filter(
          (id) => !validTabIds.includes(id)
        )

        if (invalidTabIds.length > 0) {
          const warning = `Skipped ${invalidTabIds.length} invalid/inactive tab definitions`
          logger.warn(`[duplicateRole] ${warning}:`, invalidTabIds)
          warnings.push(warning)
        }

        logger.log(
          `[duplicateRole] ${validTabIds.length}/${sourceTabPerms.length} tab definitions are valid`
        )

        if (validTabIds.length === 0) {
          logger.warn(`[duplicateRole] No valid tab definitions to copy`)
        } else {
          try {
            await rbacService.assignTabPermissionsToRole(
              newRole.id,
              validTabIds
            )
          } catch (apiError) {
            // If API fails, try direct database insert as fallback
            logger.warn(
              `[duplicateRole] Backend API failed, trying direct insert:`,
              apiError
            )
            warnings.push(
              `Tab API error: ${apiError instanceof Error ? apiError.message : 'Unknown error'}`
            )

            // Fallback: Direct database insert with validated IDs only
            const tabPermissionsToInsert = validTabIds.map((tabDefId) => ({
              role_id: newRole.id,
              tab_definition_id: tabDefId,
              granted: true,
            }))

            // Insert one by one to handle any remaining issues gracefully
            let directInsertCount = 0
            for (const tabPerm of tabPermissionsToInsert) {
              try {
                const { error: insertError } = await supabase
                  .from('role_tab_permissions')
                  .upsert(tabPerm, {
                    onConflict: 'role_id,tab_definition_id',
                    ignoreDuplicates: false,
                  })

                if (!insertError) {
                  directInsertCount++
                } else {
                  logger.warn(
                    `[duplicateRole] Failed to insert tab ${tabPerm.tab_definition_id}:`,
                    insertError
                  )
                }
              } catch (err) {
                logger.error(
                  `[duplicateRole] Exception inserting tab ${tabPerm.tab_definition_id}:`,
                  err
                )
              }
            }

            logger.log(
              `[duplicateRole] Direct insert: ${directInsertCount}/${validTabIds.length} tabs`
            )
          }
        }

        // Step 6c: Verify tab permissions were copied
        const verifyTabs = await getRoleTabPermissions(newRole.id)
        copiedTabCount = verifyTabs.length
        logger.log(
          `[duplicateRole] Verified ${copiedTabCount} tab permissions in database`
        )

        if (copiedTabCount !== validTabIds.length && validTabIds.length > 0) {
          const warning = `Tab permission count mismatch: expected ${validTabIds.length} valid tabs, got ${copiedTabCount}`
          logger.warn(`[duplicateRole] ${warning}`)
          warnings.push(warning)

          // Log which tabs were missing
          const verifyTabIdSet = new Set(verifyTabs)
          const missingTabs = validTabIds.filter(
            (id) => !verifyTabIdSet.has(id)
          )
          if (missingTabs.length > 0) {
            logger.warn(
              `[duplicateRole] Missing tab IDs after copy:`,
              missingTabs
            )
          }
        }
      } catch (tabError) {
        const warning = `Failed to copy tab permissions: ${tabError instanceof Error ? tabError.message : 'Unknown error'}`
        logger.error(`[duplicateRole] ${warning}`)
        warnings.push(warning)
        // Don't fail the whole operation for tab permissions
      }
    } else {
      logger.log(`[duplicateRole] No tab permissions to copy`)
    }

    // Step 7: Return the complete new role with verification data
    const result = await getRoleById(newRole.id)
    if (!result) {
      throw new Error('Failed to retrieve newly created role')
    }

    logger.log(`[duplicateRole] ✅ Duplication complete!`)
    logger.log(`[duplicateRole] Summary:`)
    logger.log(
      `[duplicateRole]   - Base permissions: ${copiedPermissionCount}/${sourceRole.permissions.length}`
    )
    logger.log(
      `[duplicateRole]   - Navigation: ${copiedNavigationCount}/${sourceNavPerms.length}`
    )
    logger.log(
      `[duplicateRole]   - Tabs: ${copiedTabCount}/${sourceTabPerms.length}`
    )
    if (warnings.length > 0) {
      logger.log(`[duplicateRole]   - Warnings: ${warnings.length}`)
    }

    return {
      role: result,
      sourcePermissionCount: sourceRole.permissions.length,
      copiedPermissionCount,
      sourceNavigationCount: sourceNavPerms.length,
      copiedNavigationCount,
      sourceTabCount: sourceTabPerms.length,
      copiedTabCount,
      warnings,
    }
  } catch (error) {
    logger.error('[duplicateRole] Error duplicating role:', error)
    throw error
  }
}

// Export role configuration
export interface RoleExportData {
  name: string
  displayName: string
  description: string
  permissions: Array<{ resource: string; action: string }>
  navigationItems: string[]
  tabPermissions: string[]
  exportedAt: string
  version: string
}

export const exportRoleConfiguration = async (
  roleId: string
): Promise<RoleExportData | null> => {
  try {
    const role = await getRoleById(roleId)
    if (!role) return null

    const [navPerms, tabPerms] = await Promise.all([
      getRoleNavigationPermissions(roleId),
      getRoleTabPermissions(roleId),
    ])

    return {
      name: role.name,
      displayName: role.displayName,
      description: role.description,
      permissions: role.permissions.map((p) => ({
        resource: p.resource,
        action: p.action,
      })),
      navigationItems: navPerms,
      tabPermissions: tabPerms,
      exportedAt: new Date().toISOString(),
      version: '1.0',
    }
  } catch (error) {
    logger.error('Error exporting role configuration:', error)
    return null
  }
}
