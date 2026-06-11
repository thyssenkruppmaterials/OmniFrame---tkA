// Created and developed by Jai Singh
import { useEffect, useState } from 'react'
import { Loader2, Shield, AlertTriangle } from 'lucide-react'
import { rbacService } from '@/lib/auth/rbac-service'
import { singletonAuthManager } from '@/lib/auth/singleton-auth-manager'
import type { UserRole, Permission } from '@/lib/auth/types'
import { logger } from '@/lib/utils/logger'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'

interface RBACAccessControlProps {
  userId?: string
  currentRole?: UserRole
  onPermissionsChange?: (permissions: string[]) => void
}

export function RBACAccessControl({
  currentRole,
  onPermissionsChange,
}: RBACAccessControlProps) {
  const [allPermissions, setAllPermissions] = useState<Permission[]>([])
  const [rolePermissions, setRolePermissions] = useState<string[]>([])
  const [customPermissions, setCustomPermissions] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadPermissions = async () => {
    setIsLoading(true)
    try {
      // Load all available permissions via rbacService
      const permissions = await rbacService.getAllPermissions()
      setAllPermissions(permissions)

      // Load role permissions if role is specified
      if (currentRole) {
        const { data: rolePermsData } = (await singletonAuthManager.executeRead(
          async (client) =>
            await client
              .from('role_permissions')
              .select('permission:permissions(*)')
              .eq('role', currentRole)
        )) as {
          data:
            | {
                permission: {
                  id: string
                  resource: string
                  action: string
                } | null
              }[]
            | null
          error: { message: string } | null
        }
        const rolePerms = (rolePermsData || [])
          .map(
            (rp: {
              permission: {
                id: string
                resource: string
                action: string
              } | null
            }) => rp.permission
          )
          .filter(Boolean)
        setRolePermissions(rolePerms.map((p) => (p as { id: string }).id))
      }

      // Load user-specific permissions (simplified for now)
      setCustomPermissions([])
    } catch (error) {
      logger.error('Error loading permissions:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadPermissions()
  }, [currentRole]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePermissionToggle = (permissionId: string, checked: boolean) => {
    const newCustomPermissions = checked
      ? [...customPermissions, permissionId]
      : customPermissions.filter((id) => id !== permissionId)

    setCustomPermissions(newCustomPermissions)
    onPermissionsChange?.(newCustomPermissions)
  }

  const getEffectivePermissions = () => {
    return [...new Set([...rolePermissions, ...customPermissions])]
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className='flex items-center justify-center p-6'>
          <Loader2 className='h-6 w-6 animate-spin' />
          <span className='ml-2'>Loading permissions...</span>
        </CardContent>
      </Card>
    )
  }

  const effectivePermissions = getEffectivePermissions()
  const groupedPermissions = allPermissions.reduce(
    (groups, permission) => {
      const { resource } = permission
      if (!groups[resource]) {
        groups[resource] = []
      }
      groups[resource].push(permission)
      return groups
    },
    {} as Record<string, Permission[]>
  )

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Shield className='h-5 w-5' />
            Access Control
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className='space-y-4'>
            {currentRole && (
              <Alert>
                <Shield className='h-4 w-4' />
                <AlertDescription>
                  Role <Badge variant='outline'>{currentRole}</Badge> provides{' '}
                  {rolePermissions.length} base permissions. Additional custom
                  permissions can be granted below.
                </AlertDescription>
              </Alert>
            )}

            <div className='grid gap-4'>
              {Object.entries(groupedPermissions).map(
                ([resource, permissions]) => (
                  <Card key={resource} className='border-2'>
                    <CardHeader className='pb-3'>
                      <CardTitle className='flex items-center justify-between text-base capitalize'>
                        <span>{resource} Permissions</span>
                        <Badge variant='secondary'>
                          {
                            permissions.filter((p) =>
                              effectivePermissions.includes(p.id)
                            ).length
                          }{' '}
                          / {permissions.length}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className='space-y-2'>
                      {permissions.map((permission) => {
                        const isRolePermission = rolePermissions.includes(
                          permission.id
                        )
                        const isCustomPermission = customPermissions.includes(
                          permission.id
                        )
                        // const isEffective = effectivePermissions.includes(permission.id)

                        return (
                          <div
                            key={permission.id}
                            className='flex items-center space-x-3 rounded border p-2'
                          >
                            <Checkbox
                              id={permission.id}
                              checked={isCustomPermission}
                              onCheckedChange={(checked) =>
                                handlePermissionToggle(permission.id, !!checked)
                              }
                              disabled={isRolePermission}
                            />
                            <div className='flex-1'>
                              <div className='flex items-center gap-2'>
                                <label
                                  htmlFor={permission.id}
                                  className='cursor-pointer text-sm leading-none font-medium'
                                >
                                  {permission.action}
                                </label>
                                {isRolePermission && (
                                  <Badge variant='outline' className='text-xs'>
                                    Role
                                  </Badge>
                                )}
                                {isCustomPermission && (
                                  <Badge
                                    variant='secondary'
                                    className='text-xs'
                                  >
                                    Custom
                                  </Badge>
                                )}
                              </div>
                              {permission.description && (
                                <p className='text-muted-foreground mt-1 text-xs'>
                                  {permission.description}
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </CardContent>
                  </Card>
                )
              )}
            </div>

            <Alert>
              <AlertTriangle className='h-4 w-4' />
              <AlertDescription>
                Total effective permissions: {effectivePermissions.length}(
                {rolePermissions.length} from role, {customPermissions.length}{' '}
                custom)
              </AlertDescription>
            </Alert>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Created and developed by Jai Singh
