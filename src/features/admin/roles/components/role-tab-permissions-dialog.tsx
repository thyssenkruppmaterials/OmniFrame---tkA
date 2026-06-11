// Created and developed by Jai Singh
import { useState, useEffect } from 'react'
import { Loader2, Layout, Eye, EyeOff, Info } from 'lucide-react'
import { toast } from 'sonner'
import { rbacService } from '@/lib/auth/rbac-service'
import { supabase } from '@/lib/supabase/client'
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

interface RoleTabPermissionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roleId: string
  roleName: string
}

interface TabDefinition {
  id: string
  page_resource: string
  tab_id: string
  tab_label: string
  description?: string
  display_order: number
  is_active: boolean
}

interface TabPermissionState {
  tabDefinitionId: string
  granted: boolean
}

interface GroupedTabs {
  [pageResource: string]: TabDefinition[]
}

export function RoleTabPermissionsDialog({
  open,
  onOpenChange,
  roleId,
  roleName,
}: RoleTabPermissionsDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [tabDefinitions, setTabDefinitions] = useState<TabDefinition[]>([])
  const [tabPermissions, setTabPermissions] = useState<TabPermissionState[]>([])
  const [groupedTabs, setGroupedTabs] = useState<GroupedTabs>({})

  // Load tab definitions and current permissions
  useEffect(() => {
    const loadTabPermissionData = async () => {
      if (!open) return

      setIsLoading(true)
      try {
        // Get all tab definitions
        const tabs = await rbacService.getAllTabDefinitions()
        setTabDefinitions(tabs)

        // Group tabs by page resource
        const grouped = tabs.reduce((acc: GroupedTabs, tab) => {
          if (!acc[tab.page_resource]) {
            acc[tab.page_resource] = []
          }
          acc[tab.page_resource].push(tab)
          return acc
        }, {})

        // Sort tabs within each resource by display order
        Object.keys(grouped).forEach((resource) => {
          grouped[resource].sort((a, b) => a.display_order - b.display_order)
        })

        setGroupedTabs(grouped)

        // Get current role tab permissions
        const { data: roleTabPerms, error: permsError } = await supabase
          .from('role_tab_permissions')
          .select('tab_definition_id, granted')
          .eq('role_id', roleId)

        if (permsError) {
          logger.warn('Error loading role tab permissions:', permsError)
          // Initialize with default permissions (all granted for now)
          const defaultPermissions = tabs.map((tab) => ({
            tabDefinitionId: tab.id,
            granted: true,
          }))
          setTabPermissions(defaultPermissions)
        } else {
          // Map the loaded permissions
          const permissions = tabs.map((tab) => {
            const existingPerm = roleTabPerms?.find(
              (p: { tab_definition_id: string }) =>
                p.tab_definition_id === tab.id
            )
            return {
              tabDefinitionId: tab.id,
              granted: existingPerm?.granted ?? false, // Default to restricted if no explicit permission
            }
          })
          setTabPermissions(permissions)
        }
      } catch (error) {
        logger.error('Error loading tab permission data:', error)
        toast.error('Failed to load tab permissions')
      } finally {
        setIsLoading(false)
      }
    }

    loadTabPermissionData()
  }, [open, roleId])

  // Toggle permission for a specific tab
  const handleTabToggle = (tabDefinitionId: string) => {
    setTabPermissions((prev) =>
      prev.map((perm) =>
        perm.tabDefinitionId === tabDefinitionId
          ? { ...perm, granted: !perm.granted }
          : perm
      )
    )
  }

  // Toggle all tabs for a page resource
  const handleResourceToggle = (resource: string) => {
    const resourceTabs = groupedTabs[resource] || []
    const resourceTabIds = resourceTabs.map((tab) => tab.id)

    // Check if all tabs in this resource are currently granted
    const allGranted = resourceTabIds.every(
      (tabId) =>
        tabPermissions.find((perm) => perm.tabDefinitionId === tabId)
          ?.granted ?? false
    )

    // Toggle all tabs in this resource
    setTabPermissions((prev) =>
      prev.map((perm) =>
        resourceTabIds.includes(perm.tabDefinitionId)
          ? { ...perm, granted: !allGranted }
          : perm
      )
    )
  }

  // Save permissions
  const handleSave = async () => {
    setIsSaving(true)
    try {
      // Get the tab definition IDs that should be granted
      const grantedTabIds = tabPermissions
        .filter((perm) => perm.granted)
        .map((perm) => perm.tabDefinitionId)

      // Use the RBAC service to assign tab permissions to the role
      await rbacService.assignTabPermissionsToRole(roleId, grantedTabIds)

      toast.success(`Tab permissions updated for ${roleName}`)
      onOpenChange(false)
    } catch (error) {
      logger.error('Error saving tab permissions:', error)
      toast.error('Failed to save tab permissions')
    } finally {
      setIsSaving(false)
    }
  }

  // Calculate statistics for display
  const visibleCount = Object.entries(groupedTabs).reduce((total, [, tabs]) => {
    const resourceVisibleCount = tabs.reduce((count, tab) => {
      const permission = tabPermissions.find(
        (perm) => perm.tabDefinitionId === tab.id
      )
      return count + (permission?.granted ? 1 : 0)
    }, 0)
    return total + resourceVisibleCount
  }, 0)

  const totalCount = tabDefinitions.length

  const renderTabItem = (tab: TabDefinition) => {
    const permission = tabPermissions.find(
      (perm) => perm.tabDefinitionId === tab.id
    )
    const isGranted = permission?.granted ?? true

    return (
      <div
        key={tab.id}
        className='hover:bg-muted/50 flex items-center space-x-3 rounded-lg border p-3 transition-colors'
      >
        <Checkbox
          checked={isGranted}
          onCheckedChange={() => handleTabToggle(tab.id)}
        />
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <Layout size={16} className='text-muted-foreground' />
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'>
              <span className='text-sm font-medium'>{tab.tab_label}</span>
              <Badge variant='outline' className='font-mono text-xs'>
                {tab.tab_id}
              </Badge>
            </div>
            {tab.description && (
              <p className='text-muted-foreground mt-1 text-xs'>
                {tab.description}
              </p>
            )}
          </div>
          {isGranted ? (
            <Eye size={14} className='text-green-600' />
          ) : (
            <EyeOff size={14} className='text-red-600' />
          )}
        </div>
      </div>
    )
  }

  const renderResourceGroup = (
    resource: string,
    resourceTabs: TabDefinition[]
  ) => {
    const allGranted = resourceTabs.every(
      (tab) =>
        tabPermissions.find((perm) => perm.tabDefinitionId === tab.id)
          ?.granted ?? false
    )
    const someGranted = resourceTabs.some(
      (tab) =>
        tabPermissions.find((perm) => perm.tabDefinitionId === tab.id)
          ?.granted ?? false
    )
    const grantedCount = resourceTabs.filter(
      (tab) =>
        tabPermissions.find((perm) => perm.tabDefinitionId === tab.id)
          ?.granted ?? false
    ).length

    const displayName = resource
      .replace('_', ' ')
      .replace('apps', 'Apps')
      .replace('portal', 'Portal')
      .replace('integrations', 'Integrations')
      .replace(/\b\w/g, (l) => l.toUpperCase())

    return (
      <Card key={resource} className='border-border/50'>
        <CardHeader className='pb-3'>
          <div className='flex items-center gap-3'>
            <Checkbox
              checked={allGranted}
              ref={(ref) => {
                if (ref && ref instanceof HTMLButtonElement) {
                  ;(ref as HTMLInputElement).indeterminate =
                    someGranted && !allGranted
                }
              }}
              onCheckedChange={() => handleResourceToggle(resource)}
            />
            <div className='flex-1'>
              <h4 className='font-medium'>{displayName}</h4>
              <p className='text-muted-foreground text-xs'>
                {resourceTabs.length} tabs available
              </p>
            </div>
            <Badge
              variant={
                allGranted ? 'default' : someGranted ? 'secondary' : 'outline'
              }
            >
              {grantedCount}/{resourceTabs.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className='pt-0'>
          <div className='space-y-2'>
            {resourceTabs.map((tab) => renderTabItem(tab))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] sm:max-w-[900px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Layout className='h-5 w-5' />
            Tab Permissions for <Badge variant='outline'>{roleName}</Badge>
          </DialogTitle>
          <DialogDescription>
            Configure which tabs are accessible to users with the {roleName}{' '}
            role. Users will only see tabs they have access to within each
            application.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className='flex items-center justify-center py-12'>
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            Loading tab permissions...
          </div>
        ) : (
          <div className='space-y-4'>
            {/* Summary */}
            <Card className='bg-muted/50'>
              <CardHeader className='pb-3'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <Info size={16} className='text-muted-foreground' />
                    <span className='text-sm font-medium'>Access Summary</span>
                  </div>
                  <Badge variant={visibleCount > 0 ? 'default' : 'secondary'}>
                    {visibleCount} of {totalCount} tabs accessible
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className='pt-0'>
                <div className='text-muted-foreground flex items-center gap-4 text-sm'>
                  <div className='flex items-center gap-1'>
                    <Eye size={14} className='text-green-600' />
                    <span>Accessible</span>
                  </div>
                  <div className='flex items-center gap-1'>
                    <EyeOff size={14} className='text-red-600' />
                    <span>Restricted</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Tab Permissions by Resource */}
            <ScrollArea className='h-[400px] pr-4'>
              <div className='space-y-4'>
                {Object.entries(groupedTabs).map(([resource, resourceTabs]) =>
                  renderResourceGroup(resource, resourceTabs)
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || isLoading}>
            {isSaving && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Save Tab Permissions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
