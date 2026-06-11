// Created and developed by Jai Singh
import { writeAuditLog } from '@/lib/audit/audit-log-writer'
import type { PermissionCheckContext } from '@/lib/auth/types'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

export interface ServerPermissionResult {
  granted: boolean
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  requires_2fa: boolean
  audit_status: 'written' | 'failed' | 'skipped'
  audit_id: string | null
  audit_error_code?: string
  response_time_ms: number
}

export class ServerPermissionValidator {
  static async validatePermission(
    userId: string,
    resource: string,
    action: string,
    context: PermissionCheckContext = {}
  ): Promise<ServerPermissionResult> {
    const startTime = Date.now()

    try {
      // 1. Validate user exists and is active
      const { data: userProfile, error: userError } = await supabase
        .from('user_profiles')
        .select('id, role_id, status')
        .eq('id', userId)
        .eq('status', 'active')
        .single()

      if (userError || !userProfile) {
        return await this.createAuditResult(false, 'user_not_found', startTime)
      }

      // 2. Check direct user permissions (highest priority)
      const directPermission = await this.checkDirectUserPermissions(
        userId,
        resource,
        action,
        context
      )
      if (directPermission !== null) {
        return await this.createAuditResult(
          directPermission,
          'direct_permission',
          startTime,
          userId
        )
      }

      // 3. Check role-based permissions
      const rolePermission = await this.checkRolePermissions(
        userProfile.role_id,
        resource,
        action,
        context
      )
      if (rolePermission !== null) {
        return await this.createAuditResult(
          rolePermission,
          'role_permission',
          startTime,
          userId
        )
      }

      // 4. Check inherited permissions (role hierarchy)
      const inheritedPermission = await this.checkInheritedPermissions(
        userProfile.role_id,
        resource,
        action,
        context
      )
      if (inheritedPermission !== null) {
        return await this.createAuditResult(
          inheritedPermission,
          'inherited_permission',
          startTime,
          userId
        )
      }

      // 5. Default deny with audit
      return await this.createAuditResult(
        false,
        'permission_denied',
        startTime,
        userId
      )
    } catch (error) {
      logger.error('Server permission validation error:', error)
      return await this.createAuditResult(
        false,
        'validation_error',
        startTime,
        userId,
        error
      )
    }
  }

  private static async checkDirectUserPermissions(
    userId: string,
    resource: string,
    action: string,
    _context: PermissionCheckContext
  ): Promise<boolean | null> {
    const { data: permissions, error } = await supabase
      .from('user_permissions')
      .select('permission_id, permissions(*)')
      .eq('user_id', userId)
      .eq('granted', true)
      .or('expires_at.is.null,expires_at.gt.now()')

    if (error || !permissions) return null

    const hasPermission = permissions.some((up) => {
      const perm = up.permissions
      return (
        perm &&
        (perm.resource === resource || perm.resource === '*') &&
        (perm.action === action || perm.action === '*')
      )
    })

    return hasPermission ? true : null
  }

  private static async checkRolePermissions(
    roleId: string,
    resource: string,
    action: string,
    _context: PermissionCheckContext
  ): Promise<boolean | null> {
    const { data: rolePermissions, error } = await supabase
      .from('role_permissions')
      .select('permission_id, permissions(*)')
      .eq('role_id', roleId)

    if (error || !rolePermissions) return null

    const hasPermission = rolePermissions.some((rp) => {
      const perm = rp.permissions
      return (
        perm &&
        (perm.resource === resource || perm.resource === '*') &&
        (perm.action === action || perm.action === '*')
      )
    })

    return hasPermission ? true : null
  }

  private static async checkInheritedPermissions(
    _roleId: string,
    _resource: string,
    _action: string,
    _context: PermissionCheckContext
  ): Promise<boolean | null> {
    // TODO: Implement role hierarchy traversal
    // For now, return null to continue to next check
    return null
  }

  private static async createAuditResult(
    granted: boolean,
    reason: string,
    startTime: number,
    userId?: string,
    error?: unknown
  ): Promise<ServerPermissionResult> {
    const responseTime = Date.now() - startTime

    const auditResult = await writeAuditLog(supabase, {
      user_id: userId ?? 'unknown',
      action: 'view',
      resource_type: 'permission_check',
      resource_id: `${Date.now()}`,
      changes: { granted, reason },
      metadata: {
        permission_action: granted ? 'permission_granted' : 'permission_denied',
        granted,
        reason,
        response_time_ms: responseTime,
        execution_time_ms: responseTime,
        success: !error,
        error_message: error instanceof Error ? error.message : undefined,
        severity: granted ? 'info' : 'warning',
      },
    })

    if (auditResult.audit_status === 'failed') {
      return {
        granted,
        risk_level: 'high',
        requires_2fa: false,
        audit_status: auditResult.audit_status,
        audit_id: auditResult.audit_id,
        audit_error_code: auditResult.audit_error_code,
        response_time_ms: responseTime,
      }
    }

    return {
      granted,
      risk_level: this.calculateRiskLevel(reason),
      requires_2fa: this.requiresTwoFactor(reason),
      audit_status: auditResult.audit_status,
      audit_id: auditResult.audit_id,
      response_time_ms: responseTime,
    }
  }

  private static calculateRiskLevel(
    reason: string
  ): 'low' | 'medium' | 'high' | 'critical' {
    const riskMap: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
      user_not_found: 'critical',
      validation_error: 'critical',
      direct_permission: 'low',
      role_permission: 'medium',
      inherited_permission: 'medium',
      permission_denied: 'high',
    }
    return riskMap[reason] || 'medium'
  }

  private static requiresTwoFactor(reason: string): boolean {
    return reason === 'direct_permission' || reason === 'inherited_permission'
  }
}

// Created and developed by Jai Singh
