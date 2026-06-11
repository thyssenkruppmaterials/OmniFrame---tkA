// Created and developed by Jai Singh
import { useState, useEffect } from 'react'
import type { User } from '@supabase/supabase-js'
import { rbacService } from '@/lib/auth/rbac-service'
import type { Permission, UserPermission } from '@/lib/auth/types'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

interface UseRBACReturn {
  permissions: Permission[]
  userPermissions: UserPermission[]
  hasPermission: (action: string, resource: string) => boolean
  checkPermission: (action: string, resource: string) => Promise<boolean>
  isLoading: boolean
  error: string | null
}

export function useRBAC(): UseRBACReturn {
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [userPermissions, setUserPermissions] = useState<UserPermission[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<User | null>(null)

  // Load current user and permissions on mount
  useEffect(() => {
    const loadCurrentUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      setCurrentUser(user)
      if (user?.id) {
        loadUserPermissions(user.id)
      }
    }
    loadCurrentUser()
  }, [])

  const loadUserPermissions = async (userId: string) => {
    setIsLoading(true)
    setError(null)

    try {
      // Use the new rbacService for permission loading
      const detailedPerms = await rbacService.getUserPermissionsDetailed(userId)
      setPermissions(detailedPerms as Permission[])
      setUserPermissions([])
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load permissions'
      )
      logger.error('Error loading permissions:', err)
    } finally {
      setIsLoading(false)
    }
  }

  // Check if user has a specific permission (from loaded permissions)
  const hasPermission = (action: string, resource: string): boolean => {
    if (!currentUser?.id) return false

    // Check role permissions first (most common)
    const hasRolePermission = permissions.some(
      (p) =>
        (p.action === action || p.action === '*') &&
        (p.resource === resource || p.resource === '*')
    )

    if (hasRolePermission) return true

    return false
  }

  // Async permission check (hits database via rbacService)
  const checkPermission = async (
    action: string,
    resource: string
  ): Promise<boolean> => {
    if (!currentUser?.id) return false

    try {
      const result = await rbacService.checkPermission(
        currentUser.id,
        resource,
        action
      )
      return result.granted
    } catch (err) {
      logger.error('Error checking permission:', err)
      return false
    }
  }

  return {
    permissions,
    userPermissions,
    hasPermission,
    checkPermission,
    isLoading,
    error,
  }
}

// Hook for checking specific permission
export function usePermission(action: string, resource: string) {
  const { hasPermission, checkPermission, isLoading } = useRBAC()
  const [hasAccess, setHasAccess] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    // First check from loaded permissions (fast)
    const quickCheck = hasPermission(action, resource)
    setHasAccess(quickCheck)

    // If no quick access, do async check (accurate)
    if (!quickCheck) {
      setChecking(true)
      checkPermission(action, resource)
        .then(setHasAccess)
        .finally(() => setChecking(false))
    }
  }, [action, resource, hasPermission, checkPermission])

  return {
    hasPermission: hasAccess,
    isLoading: isLoading || checking,
  }
}

// Component for conditional rendering based on permissions
interface CanAccessProps {
  action: string
  resource: string
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function CanAccess({
  action,
  resource,
  children,
  fallback = null,
}: CanAccessProps) {
  const { hasPermission } = usePermission(action, resource)

  if (hasPermission === null) {
    // Still checking permissions
    return null
  }

  return hasPermission ? <>{children}</> : <>{fallback}</>
}

// Created and developed by Jai Singh
