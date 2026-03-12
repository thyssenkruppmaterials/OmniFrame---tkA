import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import {
  Shield,
  Check,
  X,
  Calendar,
  Loader2,
  Info,
  AlertTriangle,
} from 'lucide-react'
import { usePermissionStore } from '@/stores/permissionStore'
import { logger } from '@/lib/utils/logger'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useUserManagement } from '../hooks/use-user-management'
import type { UserProfile, UserPermission } from '../types'

interface UserPermissionsDialogProps {
  user?: UserProfile | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

interface PermissionGroup {
  resource: string
  permissions: {
    permission: UserPermission
    isRoleBased: boolean
    isUserSpecific: boolean
    canModify: boolean
  }[]
}

export function UserPermissionsDialog({
  user,
  open = false,
  onOpenChange,
}: UserPermissionsDialogProps) {
  const { getUserPermissions, updateUserPermissions, isUpdatingPermissions } =
    useUserManagement()
  const { hasPermission } = usePermissionStore()
  const [permissions, setPermissions] = useState<UserPermission[]>([])
  const [loading, setLoading] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [activeTab, setActiveTab] = useState('current')

  // Real permission check: can the current user modify permissions?
  const canModifyPermissions = hasPermission('manage', 'permissions')

  // Load permissions when dialog opens
  useEffect(() => {
    if (open && user) {
      loadPermissions()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadPermissions is defined below; runs on dialog open
  }, [open, user])

  const loadPermissions = async () => {
    if (!user) return

    setLoading(true)
    try {
      const userPermissions = await getUserPermissions(user.id)
      setPermissions(userPermissions)
      setHasChanges(false)
    } catch (error) {
      logger.error('Error loading permissions:', error)
    } finally {
      setLoading(false)
    }
  }

  const handlePermissionToggle = (permissionId: string, granted: boolean) => {
    setPermissions((prev) =>
      prev.map((perm) =>
        perm.id === permissionId ? { ...perm, granted } : perm
      )
    )
    setHasChanges(true)
  }

  const handleExpirationChange = (permissionId: string, expiresAt: string) => {
    setPermissions((prev) =>
      prev.map((perm) =>
        perm.id === permissionId
          ? { ...perm, expires_at: expiresAt || undefined }
          : perm
      )
    )
    setHasChanges(true)
  }

  const handleSave = async () => {
    if (!user || !hasChanges) return

    try {
      // Only send user-specific permissions (not role-based ones)
      const userSpecificPermissions = permissions.filter(
        (p) =>
          // Include permissions that are explicitly granted/denied by user
          p.expires_at !== undefined || p.granted !== isRoleBasedPermission(p)
      )

      await updateUserPermissions(user.id, userSpecificPermissions)
      setHasChanges(false)
      onOpenChange?.(false)
    } catch (error) {
      logger.error('Error updating permissions:', error)
    }
  }

  const handleCancel = () => {
    if (hasChanges) {
      if (
        confirm('You have unsaved changes. Are you sure you want to cancel?')
      ) {
        loadPermissions() // Reset to original state
        onOpenChange?.(false)
      }
    } else {
      onOpenChange?.(false)
    }
  }

  // Helper to determine if a permission is role-based (simplified logic)
  const isRoleBasedPermission = (permission: UserPermission): boolean => {
    // This is a simplified check - in a real app, you'd have more sophisticated logic
    // to determine if a permission comes from role vs user-specific grants
    return !permission.expires_at && permission.granted
  }

  // Group permissions by resource
  const groupedPermissions: PermissionGroup[] = Object.entries(
    permissions.reduce(
      (acc, perm) => {
        if (!acc[perm.resource]) {
          acc[perm.resource] = []
        }

        const isRoleBased = isRoleBasedPermission(perm)
        acc[perm.resource].push({
          permission: perm,
          isRoleBased,
          isUserSpecific: !isRoleBased,
          canModify: canModifyPermissions,
        })
        return acc
      },
      {} as Record<
        string,
        {
          permission: UserPermission
          isRoleBased: boolean
          isUserSpecific: boolean
          canModify: boolean
        }[]
      >
    )
  ).map(([resource, perms]) => ({
    resource,
    permissions: perms,
  }))

  const grantedCount = permissions.filter((p) => p.granted).length
  const totalCount = permissions.length
  const roleBasedCount = permissions.filter((p) =>
    isRoleBasedPermission(p)
  ).length
  const userSpecificCount = permissions.filter(
    (p) => !isRoleBasedPermission(p)
  ).length

  if (!user) {
    return null
  }

  const fullName =
    user.full_name ||
    `${user.first_name || ''} ${user.last_name || ''}`.trim() ||
    'Unnamed User'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] max-w-4xl overflow-hidden'>
        <DialogHeader>
          <DialogTitle>Manage User Permissions</DialogTitle>
          <DialogDescription>
            Configure permissions for {fullName}. Role-based permissions are
            inherited from the user's role, while user-specific permissions can
            be customized individually.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className='flex items-center justify-center py-8'>
            <Loader2 className='mr-2 h-6 w-6 animate-spin' />
            <span>Loading permissions...</span>
          </div>
        ) : (
          <div className='flex h-full flex-col'>
            {/* Permission Summary */}
            <div className='mb-4 grid grid-cols-4 gap-4'>
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm'>Total Permissions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='text-2xl font-bold'>{totalCount}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm'>Granted</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='text-2xl font-bold text-green-600'>
                    {grantedCount}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm'>Role-Based</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='text-2xl font-bold text-blue-600'>
                    {roleBasedCount}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm'>User-Specific</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='text-2xl font-bold text-purple-600'>
                    {userSpecificCount}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className='flex-1'
            >
              <TabsList className='grid w-full grid-cols-2'>
                <TabsTrigger value='current'>Current Permissions</TabsTrigger>
                <TabsTrigger value='modify'>Modify Permissions</TabsTrigger>
              </TabsList>

              <ScrollArea className='h-[400px] w-full'>
                <TabsContent value='current' className='space-y-4'>
                  <Alert>
                    <Info className='h-4 w-4' />
                    <AlertDescription>
                      This shows all permissions currently available to the user
                      through their role assignment and individual grants.
                    </AlertDescription>
                  </Alert>

                  {groupedPermissions.map((group) => (
                    <Card key={group.resource}>
                      <CardHeader>
                        <CardTitle className='flex items-center gap-2 capitalize'>
                          <Shield className='h-4 w-4' />
                          {group.resource} Permissions
                        </CardTitle>
                        <CardDescription>
                          {group.permissions.length} permissions in this
                          category
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className='grid grid-cols-1 gap-2'>
                          {group.permissions.map(
                            ({ permission, isRoleBased }) => (
                              <div
                                key={permission.id}
                                className='flex items-center justify-between rounded-lg border p-3'
                              >
                                <div className='flex-1'>
                                  <div className='flex items-center gap-2'>
                                    <span className='font-medium'>
                                      {permission.name}
                                    </span>
                                    <Badge
                                      variant={
                                        isRoleBased ? 'default' : 'secondary'
                                      }
                                    >
                                      {isRoleBased
                                        ? 'Role-based'
                                        : 'User-specific'}
                                    </Badge>
                                  </div>
                                  {permission.description && (
                                    <p className='text-muted-foreground mt-1 text-sm'>
                                      {permission.description}
                                    </p>
                                  )}
                                  {permission.expires_at && (
                                    <div className='text-muted-foreground mt-1 flex items-center gap-1 text-sm'>
                                      <Calendar className='h-3 w-3' />
                                      Expires:{' '}
                                      {format(
                                        new Date(permission.expires_at),
                                        'PPp'
                                      )}
                                    </div>
                                  )}
                                </div>
                                <div className='flex items-center'>
                                  {permission.granted ? (
                                    <Check className='h-5 w-5 text-green-600' />
                                  ) : (
                                    <X className='h-5 w-5 text-red-600' />
                                  )}
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </TabsContent>

                <TabsContent value='modify' className='space-y-4'>
                  <Alert>
                    <AlertTriangle className='h-4 w-4' />
                    <AlertDescription>
                      Use caution when modifying permissions. Changes here will
                      override role-based permissions for this specific user.
                    </AlertDescription>
                  </Alert>

                  {groupedPermissions.map((group) => (
                    <Card key={group.resource}>
                      <CardHeader>
                        <CardTitle className='flex items-center gap-2 capitalize'>
                          <Shield className='h-4 w-4' />
                          {group.resource} Permissions
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className='space-y-3'>
                          {group.permissions.map(
                            ({ permission, isRoleBased, canModify }) => (
                              <div
                                key={permission.id}
                                className='space-y-2 rounded-lg border p-3'
                              >
                                <div className='flex items-start justify-between'>
                                  <div className='flex-1'>
                                    <div className='flex items-center gap-2'>
                                      <Checkbox
                                        checked={permission.granted}
                                        onCheckedChange={(checked) =>
                                          handlePermissionToggle(
                                            permission.id,
                                            !!checked
                                          )
                                        }
                                        disabled={!canModify}
                                      />
                                      <span className='font-medium'>
                                        {permission.name}
                                      </span>
                                      <Badge
                                        variant={
                                          isRoleBased ? 'default' : 'secondary'
                                        }
                                      >
                                        {isRoleBased
                                          ? 'Role-based'
                                          : 'User-specific'}
                                      </Badge>
                                    </div>
                                    {permission.description && (
                                      <p className='text-muted-foreground mt-1 ml-6 text-sm'>
                                        {permission.description}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                {/* Expiration Date */}
                                <div className='ml-6'>
                                  <Label
                                    htmlFor={`expires-${permission.id}`}
                                    className='text-sm'
                                  >
                                    Expiration Date (Optional)
                                  </Label>
                                  <Input
                                    id={`expires-${permission.id}`}
                                    type='datetime-local'
                                    value={
                                      permission.expires_at
                                        ? format(
                                            new Date(permission.expires_at),
                                            "yyyy-MM-dd'T'HH:mm"
                                          )
                                        : ''
                                    }
                                    onChange={(e) =>
                                      handleExpirationChange(
                                        permission.id,
                                        e.target.value
                                      )
                                    }
                                    disabled={!canModify}
                                    className='mt-1'
                                  />
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </TabsContent>
              </ScrollArea>
            </Tabs>
          </div>
        )}

        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={handleCancel}
            disabled={isUpdatingPermissions}
          >
            Cancel
          </Button>
          {hasChanges && (
            <Button onClick={handleSave} disabled={isUpdatingPermissions}>
              {isUpdatingPermissions && (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              )}
              Save Changes
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
