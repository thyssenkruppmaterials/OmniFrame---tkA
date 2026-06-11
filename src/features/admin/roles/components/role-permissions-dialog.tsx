// Created and developed by Jai Singh
import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Permission } from '@/lib/supabase/database.types'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useRoles } from '../context/roles-context'
import { permissionActions, resourceTypes } from '../data/data'
import { Role } from '../data/schema'
import {
  getAllPermissions,
  updateRolePermissions,
} from '../services/role.service'

interface RolePermissionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: Role | null
}

interface PermissionCheckboxProps {
  resource: string
  action: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  description?: string
}

function PermissionCheckbox({
  resource,
  action,
  checked,
  onCheckedChange,
  description,
}: PermissionCheckboxProps) {
  const actionType = permissionActions.find((a) => a.value === action)

  return (
    <div className='hover:bg-muted/50 flex items-center space-x-3 rounded p-2'>
      <Checkbox
        id={`${resource}-${action}`}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
      <div className='flex flex-1 items-center gap-2'>
        {actionType?.icon && (
          <actionType.icon size={16} className='text-muted-foreground' />
        )}
        <label
          htmlFor={`${resource}-${action}`}
          className='cursor-pointer text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
        >
          {actionType?.label || action}
        </label>
        <Badge variant='outline' className='text-xs'>
          {resource}
        </Badge>
      </div>
      {description && (
        <p className='text-muted-foreground text-xs'>{description}</p>
      )}
    </div>
  )
}

export function RolePermissionsDialog({
  open,
  onOpenChange,
  role,
}: RolePermissionsDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])
  const [availablePermissions, setAvailablePermissions] = useState<
    Permission[]
  >([])
  const { refreshRoles } = useRoles()

  // Initialize selected permissions when role changes
  useEffect(() => {
    if (role) {
      setSelectedPermissions(role.permissions || [])
    }
  }, [role])

  // Load available permissions from database
  useEffect(() => {
    if (open) {
      loadPermissions()
    }
  }, [open])

  const loadPermissions = async () => {
    try {
      const permissions = await getAllPermissions()
      setAvailablePermissions(permissions)
    } catch (error) {
      logger.error('Error loading permissions:', error)
      toast.error('Failed to load permissions')
    }
  }

  const onSave = async () => {
    if (!role) return

    setIsLoading(true)
    try {
      // Convert permission strings to IDs
      const selectedPermissionIds = availablePermissions
        .filter((p) =>
          selectedPermissions.includes(`${p.resource}:${p.action}`)
        )
        .map((p) => p.id)

      // Update permissions in database
      await updateRolePermissions(role.id, selectedPermissionIds)

      toast.success('Permissions updated successfully!')

      // Refresh roles data
      await refreshRoles()

      onOpenChange(false)
    } catch (error) {
      logger.error('Failed to update permissions:', error)
      toast.error('Failed to update permissions')
    } finally {
      setIsLoading(false)
    }
  }

  const handlePermissionChange = (permission: string, checked: boolean) => {
    setSelectedPermissions((prev) =>
      checked ? [...prev, permission] : prev.filter((p) => p !== permission)
    )
  }

  const handleSelectAll = (resource: string) => {
    const resourcePermissions = permissionActions.map(
      (action) => `${resource}:${action.value}`
    )
    const hasAll = resourcePermissions.every((p) =>
      selectedPermissions.includes(p)
    )

    if (hasAll) {
      // Remove all resource permissions
      setSelectedPermissions((prev) =>
        prev.filter((p) => !p.startsWith(`${resource}:`))
      )
    } else {
      // Add all resource permissions
      setSelectedPermissions((prev) => [
        ...new Set([...prev, ...resourcePermissions]),
      ])
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[80vh] sm:max-w-[700px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            Manage Permissions for <Badge variant='outline'>{role?.name}</Badge>
          </DialogTitle>
          <DialogDescription>
            Configure the permissions for this role. Users assigned to this role
            will inherit these permissions.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className='max-h-[400px] pr-4'>
          <div className='space-y-6'>
            {resourceTypes.map((resource) => {
              const resourcePermissions = permissionActions.map(
                (action) => `${resource.value}:${action.value}`
              )
              const selectedResourcePermissions = resourcePermissions.filter(
                (p) => selectedPermissions.includes(p)
              )
              const hasAll = resourcePermissions.every((p) =>
                selectedPermissions.includes(p)
              )
              // const hasSome = selectedResourcePermissions.length > 0 && !hasAll

              return (
                <div key={resource.value} className='space-y-3'>
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='font-medium capitalize'>
                        {resource.label}
                      </h4>
                      <p className='text-muted-foreground text-sm'>
                        {resource.description}
                      </p>
                    </div>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() => handleSelectAll(resource.value)}
                    >
                      {hasAll ? 'Deselect All' : 'Select All'}
                    </Button>
                  </div>

                  <div className='ml-4 grid grid-cols-1 gap-2 sm:grid-cols-2'>
                    {permissionActions.map((action) => {
                      const permission = `${resource.value}:${action.value}`
                      return (
                        <PermissionCheckbox
                          key={permission}
                          resource={resource.value}
                          action={action.value}
                          checked={selectedPermissions.includes(permission)}
                          onCheckedChange={(checked) =>
                            handlePermissionChange(permission, checked)
                          }
                          description={action.description}
                        />
                      )
                    })}
                  </div>

                  {selectedResourcePermissions.length > 0 && (
                    <div className='ml-4'>
                      <p className='text-muted-foreground mb-2 text-xs'>
                        Selected: {selectedResourcePermissions.length} of{' '}
                        {resourcePermissions.length}
                      </p>
                      <div className='flex flex-wrap gap-1'>
                        {selectedResourcePermissions.slice(0, 5).map((perm) => (
                          <Badge
                            key={perm}
                            variant='secondary'
                            className='text-xs'
                          >
                            {perm}
                          </Badge>
                        ))}
                        {selectedResourcePermissions.length > 5 && (
                          <Badge variant='secondary' className='text-xs'>
                            +{selectedResourcePermissions.length - 5} more
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}

                  <Separator />
                </div>
              )
            })}
          </div>
        </ScrollArea>

        <DialogFooter className='flex items-center justify-between'>
          <div className='text-muted-foreground text-sm'>
            Total: {selectedPermissions.length} permissions selected
          </div>
          <div className='space-x-2'>
            <Button
              variant='outline'
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button onClick={onSave} disabled={isLoading}>
              {isLoading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              Save Permissions
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
