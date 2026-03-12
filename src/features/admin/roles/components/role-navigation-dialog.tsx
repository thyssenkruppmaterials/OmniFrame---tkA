import { useState, useEffect } from 'react'
import { Loader2, Menu, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import type {
  Database,
  NavigationItem,
  UserRole,
} from '@/lib/supabase/database.types'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
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
import { SYSTEM_ROLES } from '@/features/user-management/types'

// Helper function to get role enum value from role ID
const getRoleEnumFromId = async (roleId: string): Promise<UserRole> => {
  try {
    const { data, error } = await supabase
      .from('roles')
      .select('name')
      .eq('id', roleId)
      .single()

    if (error) throw error

    // Map role name to enum value - ensure it's a valid enum value
    const roleName = data?.name?.toLowerCase() as UserRole
    const validRoles: UserRole[] = [
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

    if (!validRoles.includes(roleName)) {
      logger.warn(`Invalid role name: ${data?.name}, defaulting to viewer`)
      return 'viewer'
    }

    return roleName
  } catch (error) {
    logger.error('Error getting role enum from ID:', error)
    return 'viewer' // Default fallback
  }
}

interface RoleNavigationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roleId: string
  roleName: string
}

interface NavigationItemWithPermission extends NavigationItem {
  visible: boolean
  children?: NavigationItemWithPermission[]
}

export function RoleNavigationDialog({
  open,
  onOpenChange,
  roleId,
  roleName,
}: RoleNavigationDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [navigationItems, setNavigationItems] = useState<
    NavigationItemWithPermission[]
  >([])

  // Load navigation items and current permissions
  useEffect(() => {
    const loadNavigationData = async () => {
      if (!open) return

      setIsLoading(true)
      try {
        // Get all navigation items
        const { data: navItems, error: navError } = await supabase
          .from('navigation_items')
          .select('*')
          .order('position')

        if (navError) throw navError

        // Get current role navigation permissions
        const { data: roleNavPerms, error: permsError } = await supabase
          .from('role_navigation_permissions')
          .select('*')
          .eq('role_id', roleId)

        if (permsError) throw permsError

        // Build hierarchical navigation structure with permission status
        const itemsMap = new Map<string, NavigationItemWithPermission>()
        const rootItems: NavigationItemWithPermission[] = []

        // Create all items first
        navItems?.forEach((item) => {
          const permission = roleNavPerms?.find(
            (p) => p.navigation_item_id === item.id
          )
          const itemWithPermission: NavigationItemWithPermission = {
            ...item,
            visible: permission?.visible ?? true,
            children: [],
          }
          itemsMap.set(item.id, itemWithPermission)
        })

        // Build hierarchy
        navItems?.forEach((item) => {
          const itemWithPermission = itemsMap.get(item.id)!
          if (item.parent_id) {
            const parent = itemsMap.get(item.parent_id)
            if (parent) {
              parent.children = parent.children || []
              parent.children.push(itemWithPermission)
            }
          } else {
            rootItems.push(itemWithPermission)
          }
        })

        setNavigationItems(rootItems)
      } catch (error) {
        logger.error('Error loading navigation data:', error)
        toast.error('Failed to load navigation permissions')
      } finally {
        setIsLoading(false)
      }
    }

    loadNavigationData()
  }, [open, roleId])

  const handleVisibilityChange = (itemId: string, visible: boolean) => {
    const updateItem = (
      items: NavigationItemWithPermission[]
    ): NavigationItemWithPermission[] => {
      return items.map((item) => {
        if (item.id === itemId) {
          return { ...item, visible }
        }
        if (item.children) {
          return { ...item, children: updateItem(item.children) }
        }
        return item
      })
    }

    setNavigationItems((prevItems) => updateItem(prevItems))
  }

  const onSave = async () => {
    setIsSaving(true)
    try {
      // Collect all navigation permissions to update
      const permissions: { navigation_item_id: string; visible: boolean }[] = []

      const collectPermissions = (items: NavigationItemWithPermission[]) => {
        items.forEach((item) => {
          permissions.push({
            navigation_item_id: item.id,
            visible: item.visible,
          })
          if (item.children) {
            collectPermissions(item.children)
          }
        })
      }

      collectPermissions(navigationItems)

      // Get the proper enum value for this role (Dec 20, 2025: Fixed to support custom roles)
      const roleEnumValue = await getRoleEnumFromId(roleId)

      // Use upsert to avoid duplicate key violations
      for (const permission of permissions) {
        // CRITICAL FIX (Dec 20, 2025): Handle both system and custom roles
        // Custom roles aren't in enum, but role column is NOT NULL
        // Solution: Use actual role for system roles, 'viewer' as fallback for custom roles
        const role: UserRole = SYSTEM_ROLES.includes(
          roleEnumValue as (typeof SYSTEM_ROLES)[number]
        )
          ? roleEnumValue
          : 'viewer'
        const navPermRecord: Database['public']['Tables']['role_navigation_permissions']['Insert'] =
          {
            role_id: roleId,
            navigation_item_id: permission.navigation_item_id,
            visible: permission.visible,
            role,
          }

        const { error: upsertError } = await supabase
          .from('role_navigation_permissions')
          .upsert(navPermRecord, {
            onConflict: 'role_id,navigation_item_id',
          })

        if (upsertError) {
          logger.error('Error upserting navigation permission:', upsertError)
          throw upsertError
        }
      }

      toast.success('Navigation permissions updated successfully!')
      onOpenChange(false)
    } catch (error) {
      logger.error('Error saving navigation permissions:', error)
      toast.error('Failed to update navigation permissions')
    } finally {
      setIsSaving(false)
    }
  }

  const renderNavigationItem = (
    item: NavigationItemWithPermission,
    level = 0
  ) => {
    const indent = level * 20

    return (
      <div key={item.id} className='space-y-3'>
        <div
          className='bg-card hover:bg-muted/50 flex items-center space-x-3 rounded-md border p-3 transition-colors'
          style={{ paddingLeft: `${12 + indent}px` }}
        >
          <Checkbox
            id={`nav-${item.id}`}
            checked={item.visible}
            onCheckedChange={(checked) =>
              handleVisibilityChange(item.id, checked as boolean)
            }
          />
          <div className='flex flex-1 items-center gap-3'>
            <Menu size={16} className='text-muted-foreground' />
            <div className='flex-1'>
              <label
                htmlFor={`nav-${item.id}`}
                className='block cursor-pointer text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
              >
                {item.title}
              </label>
              {item.url && (
                <Badge variant='outline' className='mt-1 font-mono text-xs'>
                  {item.url}
                </Badge>
              )}
            </div>
            {item.visible ? (
              <Eye size={14} className='text-green-600' />
            ) : (
              <EyeOff size={14} className='text-red-600' />
            )}
          </div>
        </div>

        {item.children && item.children.length > 0 && (
          <div className='ml-6 space-y-2'>
            {item.children.map((child) =>
              renderNavigationItem(child, level + 1)
            )}
          </div>
        )}
      </div>
    )
  }

  const visibleCount = navigationItems.reduce((count, item) => {
    const countItem = (i: NavigationItemWithPermission): number => {
      let total = i.visible ? 1 : 0
      if (i.children) {
        total += i.children.reduce((sum, child) => sum + countItem(child), 0)
      }
      return total
    }
    return count + countItem(item)
  }, 0)

  const totalCount = navigationItems.reduce((count, item) => {
    const countItem = (i: NavigationItemWithPermission): number => {
      let total = 1
      if (i.children) {
        total += i.children.reduce((sum, child) => sum + countItem(child), 0)
      }
      return total
    }
    return count + countItem(item)
  }, 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] sm:max-w-[800px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            Navigation Permissions for{' '}
            <Badge variant='outline'>{roleName}</Badge>
          </DialogTitle>
          <DialogDescription>
            Configure which navigation menu items are visible to users with the{' '}
            {roleName} role. Hidden items will not appear in the sidebar or
            command menu.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className='flex items-center justify-center py-12'>
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            Loading navigation permissions...
          </div>
        ) : (
          <div className='space-y-4'>
            {/* Summary */}
            <Card className='bg-muted/50'>
              <CardHeader className='pb-3'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <Menu size={16} className='text-muted-foreground' />
                    <span className='text-sm font-medium'>Menu Visibility</span>
                  </div>
                  <Badge variant={visibleCount > 0 ? 'default' : 'secondary'}>
                    {visibleCount} of {totalCount} items visible
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className='pt-0'>
                <div className='text-muted-foreground flex items-center gap-4 text-sm'>
                  <div className='flex items-center gap-1'>
                    <Eye size={14} className='text-green-600' />
                    <span>Visible</span>
                  </div>
                  <div className='flex items-center gap-1'>
                    <EyeOff size={14} className='text-red-600' />
                    <span>Hidden</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Navigation Items */}
            <ScrollArea className='h-[400px] pr-4'>
              <div className='space-y-4 pb-4'>
                {navigationItems.map((item) => renderNavigationItem(item))}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter className='flex items-center justify-between'>
          <div className='text-muted-foreground text-sm'>
            {visibleCount} of {totalCount} menu items will be visible
          </div>
          <div className='space-x-2'>
            <Button
              variant='outline'
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button onClick={onSave} disabled={isSaving || isLoading}>
              {isSaving && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              Save Navigation Permissions
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
