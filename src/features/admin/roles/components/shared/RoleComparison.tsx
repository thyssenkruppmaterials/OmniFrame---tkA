import { useState, useEffect, useMemo } from 'react'
import {
  ArrowRight,
  Copy,
  Loader2,
  Shield,
  Menu,
  Layout,
  Plus,
  Minus,
  Equal,
  GitCompare,
} from 'lucide-react'
import { rbacService } from '@/lib/auth/rbac-service'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getRoles, type RoleData } from '../../services/role.service'
import type { Permission, TabDefinition } from './types'

export interface RoleComparisonProps {
  currentRoleId?: string
  currentPermissions?: string[]
  currentNavigationItems?: string[]
  currentTabPermissions?: string[]
  onCopyPermissions?: (permissions: string[]) => void
  onCopyNavigation?: (items: string[]) => void
  onCopyTabs?: (tabs: string[]) => void
}

interface ComparisonData {
  permissions: string[]
  navigationItems: string[]
  tabPermissions: string[]
}

export function RoleComparison({
  currentRoleId,
  currentPermissions = [],
  currentNavigationItems = [],
  currentTabPermissions = [],
  onCopyPermissions,
  onCopyNavigation,
  onCopyTabs,
}: RoleComparisonProps) {
  const [roles, setRoles] = useState<RoleData[]>([])
  const [selectedRoleId, setSelectedRoleId] = useState<string>('')
  const [comparisonData, setComparisonData] = useState<ComparisonData | null>(
    null
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingComparison, setIsLoadingComparison] = useState(false)
  const [allPermissions, setAllPermissions] = useState<Permission[]>([])
  const [allTabs, setAllTabs] = useState<TabDefinition[]>([])

  // Load roles for selection
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true)
      try {
        const [rolesData, permsData, tabsData] = await Promise.all([
          getRoles(),
          supabase.from('permissions').select('*'),
          rbacService.getAllTabDefinitions(),
        ])

        // Filter out current role from selection
        const availableRoles = rolesData.filter((r) => r.id !== currentRoleId)
        setRoles(availableRoles)
        setAllPermissions((permsData.data || []) as Permission[])
        setAllTabs(tabsData)
      } catch (error) {
        logger.error('Error loading roles:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [currentRoleId])

  // Load comparison data when a role is selected
  useEffect(() => {
    const loadComparisonData = async () => {
      if (!selectedRoleId) {
        setComparisonData(null)
        return
      }

      setIsLoadingComparison(true)
      try {
        // Get role permissions
        const { data: rolePerms } = await supabase
          .from('role_permissions')
          .select('permission_id')
          .eq('role_id', selectedRoleId)

        // Get role navigation permissions
        const { data: navPerms } = await supabase
          .from('role_navigation_permissions')
          .select('navigation_item_id')
          .eq('role_id', selectedRoleId)
          .eq('visible', true)

        // Get role tab permissions
        const { data: tabPerms } = await supabase
          .from('role_tab_permissions')
          .select('tab_definition_id')
          .eq('role_id', selectedRoleId)
          .eq('granted', true)

        setComparisonData({
          permissions: rolePerms?.map((p) => p.permission_id) || [],
          navigationItems: navPerms?.map((n) => n.navigation_item_id) || [],
          tabPermissions: tabPerms?.map((t) => t.tab_definition_id) || [],
        })
      } catch (error) {
        logger.error('Error loading comparison data:', error)
      } finally {
        setIsLoadingComparison(false)
      }
    }
    loadComparisonData()
  }, [selectedRoleId])

  // Calculate differences
  const differences = useMemo(() => {
    if (!comparisonData) return null

    const calcDiff = (current: string[], other: string[]) => ({
      added: current.filter((id) => !other.includes(id)),
      removed: other.filter((id) => !current.includes(id)),
      common: current.filter((id) => other.includes(id)),
    })

    return {
      permissions: calcDiff(currentPermissions, comparisonData.permissions),
      navigation: calcDiff(
        currentNavigationItems,
        comparisonData.navigationItems
      ),
      tabs: calcDiff(currentTabPermissions, comparisonData.tabPermissions),
    }
  }, [
    currentPermissions,
    currentNavigationItems,
    currentTabPermissions,
    comparisonData,
  ])

  // Get permission details
  const getPermissionName = (id: string) => {
    const perm = allPermissions.find((p) => p.id === id)
    return perm ? `${perm.resource}:${perm.action}` : id
  }

  // Get tab details
  const getTabName = (id: string) => {
    const tab = allTabs.find((t) => t.id === id)
    return tab ? `${tab.page_resource} - ${tab.tab_label}` : id
  }

  const selectedRole = roles.find((r) => r.id === selectedRoleId)

  if (isLoading) {
    return (
      <div className='flex items-center justify-center py-12'>
        <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
        <span className='text-muted-foreground ml-2'>Loading roles...</span>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {/* Role Selection */}
      <Card>
        <CardHeader className='pb-3'>
          <div className='flex items-center gap-2'>
            <GitCompare className='text-muted-foreground h-5 w-5' />
            <CardTitle className='text-base'>
              Compare with Another Role
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
            <SelectTrigger>
              <SelectValue placeholder='Select a role to compare...' />
            </SelectTrigger>
            <SelectContent>
              {roles.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  <div className='flex items-center gap-2'>
                    <span>{role.displayName || role.name}</span>
                    {role.isSystem && (
                      <Badge variant='outline' className='text-xs'>
                        System
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Comparison Results */}
      {isLoadingComparison ? (
        <div className='flex items-center justify-center py-8'>
          <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
          <span className='text-muted-foreground ml-2'>
            Loading comparison...
          </span>
        </div>
      ) : differences && selectedRole ? (
        <Tabs defaultValue='permissions' className='space-y-4'>
          <TabsList className='grid w-full grid-cols-3'>
            <TabsTrigger
              value='permissions'
              className='flex items-center gap-2'
            >
              <Shield className='h-4 w-4' />
              Permissions
              <Badge variant='outline' className='ml-1 text-xs'>
                {differences.permissions.added.length +
                  differences.permissions.removed.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value='navigation' className='flex items-center gap-2'>
              <Menu className='h-4 w-4' />
              Navigation
              <Badge variant='outline' className='ml-1 text-xs'>
                {differences.navigation.added.length +
                  differences.navigation.removed.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value='tabs' className='flex items-center gap-2'>
              <Layout className='h-4 w-4' />
              Tabs
              <Badge variant='outline' className='ml-1 text-xs'>
                {differences.tabs.added.length +
                  differences.tabs.removed.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          {/* Permissions Comparison */}
          <TabsContent value='permissions'>
            <Card>
              <CardHeader className='pb-3'>
                <div className='flex items-center justify-between'>
                  <CardTitle className='text-sm'>
                    Permission Differences
                  </CardTitle>
                  {onCopyPermissions && comparisonData && (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() =>
                        onCopyPermissions(comparisonData.permissions)
                      }
                    >
                      <Copy className='mr-2 h-4 w-4' />
                      Copy All from {selectedRole.displayName}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className='h-[300px]'>
                  <div className='space-y-4'>
                    {/* Summary */}
                    <div className='flex items-center gap-4 text-sm'>
                      <div className='flex items-center gap-1'>
                        <Plus className='h-4 w-4 text-green-500' />
                        <span>
                          {differences.permissions.added.length} unique to
                          current
                        </span>
                      </div>
                      <div className='flex items-center gap-1'>
                        <Minus className='h-4 w-4 text-red-500' />
                        <span>
                          {differences.permissions.removed.length} in{' '}
                          {selectedRole.displayName} only
                        </span>
                      </div>
                      <div className='flex items-center gap-1'>
                        <Equal className='h-4 w-4 text-blue-500' />
                        <span>
                          {differences.permissions.common.length} shared
                        </span>
                      </div>
                    </div>

                    <Separator />

                    {/* Added (in current but not in comparison) */}
                    {differences.permissions.added.length > 0 && (
                      <div>
                        <h4 className='mb-2 flex items-center gap-2 text-sm font-medium'>
                          <Plus className='h-4 w-4 text-green-500' />
                          Unique to Current Role
                        </h4>
                        <div className='flex flex-wrap gap-1'>
                          {differences.permissions.added.map((id) => (
                            <Badge
                              key={id}
                              variant='outline'
                              className='border-green-300 bg-green-50 text-xs dark:bg-green-950/30'
                            >
                              {getPermissionName(id)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Removed (in comparison but not in current) */}
                    {differences.permissions.removed.length > 0 && (
                      <div>
                        <h4 className='mb-2 flex items-center gap-2 text-sm font-medium'>
                          <Minus className='h-4 w-4 text-red-500' />
                          Only in {selectedRole.displayName}
                        </h4>
                        <div className='flex flex-wrap gap-1'>
                          {differences.permissions.removed.map((id) => (
                            <Badge
                              key={id}
                              variant='outline'
                              className='border-red-300 bg-red-50 text-xs dark:bg-red-950/30'
                            >
                              {getPermissionName(id)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Common */}
                    {differences.permissions.common.length > 0 && (
                      <div>
                        <h4 className='mb-2 flex items-center gap-2 text-sm font-medium'>
                          <Equal className='h-4 w-4 text-blue-500' />
                          Shared Permissions
                        </h4>
                        <div className='flex flex-wrap gap-1'>
                          {differences.permissions.common
                            .slice(0, 10)
                            .map((id) => (
                              <Badge
                                key={id}
                                variant='secondary'
                                className='text-xs'
                              >
                                {getPermissionName(id)}
                              </Badge>
                            ))}
                          {differences.permissions.common.length > 10 && (
                            <Badge variant='outline' className='text-xs'>
                              +{differences.permissions.common.length - 10} more
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}

                    {differences.permissions.added.length === 0 &&
                      differences.permissions.removed.length === 0 && (
                        <div className='text-muted-foreground py-8 text-center'>
                          <Equal className='mx-auto mb-2 h-8 w-8 opacity-50' />
                          <p>Permissions are identical</p>
                        </div>
                      )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Navigation Comparison */}
          <TabsContent value='navigation'>
            <Card>
              <CardHeader className='pb-3'>
                <div className='flex items-center justify-between'>
                  <CardTitle className='text-sm'>
                    Navigation Differences
                  </CardTitle>
                  {onCopyNavigation && comparisonData && (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() =>
                        onCopyNavigation(comparisonData.navigationItems)
                      }
                    >
                      <Copy className='mr-2 h-4 w-4' />
                      Copy All from {selectedRole.displayName}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className='h-[300px]'>
                  <div className='space-y-4'>
                    <div className='flex items-center gap-4 text-sm'>
                      <div className='flex items-center gap-1'>
                        <Plus className='h-4 w-4 text-green-500' />
                        <span>
                          {differences.navigation.added.length} unique to
                          current
                        </span>
                      </div>
                      <div className='flex items-center gap-1'>
                        <Minus className='h-4 w-4 text-red-500' />
                        <span>
                          {differences.navigation.removed.length} in{' '}
                          {selectedRole.displayName} only
                        </span>
                      </div>
                    </div>

                    <Separator />

                    {differences.navigation.added.length === 0 &&
                      differences.navigation.removed.length === 0 && (
                        <div className='text-muted-foreground py-8 text-center'>
                          <Equal className='mx-auto mb-2 h-8 w-8 opacity-50' />
                          <p>Navigation items are identical</p>
                        </div>
                      )}

                    {differences.navigation.added.length > 0 && (
                      <div>
                        <h4 className='mb-2 flex items-center gap-2 text-sm font-medium'>
                          <Plus className='h-4 w-4 text-green-500' />
                          Visible only in Current Role
                        </h4>
                        <p className='text-muted-foreground text-sm'>
                          {differences.navigation.added.length} navigation items
                        </p>
                      </div>
                    )}

                    {differences.navigation.removed.length > 0 && (
                      <div>
                        <h4 className='mb-2 flex items-center gap-2 text-sm font-medium'>
                          <Minus className='h-4 w-4 text-red-500' />
                          Visible only in {selectedRole.displayName}
                        </h4>
                        <p className='text-muted-foreground text-sm'>
                          {differences.navigation.removed.length} navigation
                          items
                        </p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tabs Comparison */}
          <TabsContent value='tabs'>
            <Card>
              <CardHeader className='pb-3'>
                <div className='flex items-center justify-between'>
                  <CardTitle className='text-sm'>
                    Tab Permissions Differences
                  </CardTitle>
                  {onCopyTabs && comparisonData && (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => onCopyTabs(comparisonData.tabPermissions)}
                    >
                      <Copy className='mr-2 h-4 w-4' />
                      Copy All from {selectedRole.displayName}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className='h-[300px]'>
                  <div className='space-y-4'>
                    <div className='flex items-center gap-4 text-sm'>
                      <div className='flex items-center gap-1'>
                        <Plus className='h-4 w-4 text-green-500' />
                        <span>
                          {differences.tabs.added.length} unique to current
                        </span>
                      </div>
                      <div className='flex items-center gap-1'>
                        <Minus className='h-4 w-4 text-red-500' />
                        <span>
                          {differences.tabs.removed.length} in{' '}
                          {selectedRole.displayName} only
                        </span>
                      </div>
                    </div>

                    <Separator />

                    {differences.tabs.added.length === 0 &&
                      differences.tabs.removed.length === 0 && (
                        <div className='text-muted-foreground py-8 text-center'>
                          <Equal className='mx-auto mb-2 h-8 w-8 opacity-50' />
                          <p>Tab permissions are identical</p>
                        </div>
                      )}

                    {differences.tabs.added.length > 0 && (
                      <div>
                        <h4 className='mb-2 flex items-center gap-2 text-sm font-medium'>
                          <Plus className='h-4 w-4 text-green-500' />
                          Accessible only in Current Role
                        </h4>
                        <div className='flex flex-wrap gap-1'>
                          {differences.tabs.added.map((id) => (
                            <Badge
                              key={id}
                              variant='outline'
                              className='border-green-300 bg-green-50 text-xs dark:bg-green-950/30'
                            >
                              {getTabName(id)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {differences.tabs.removed.length > 0 && (
                      <div>
                        <h4 className='mb-2 flex items-center gap-2 text-sm font-medium'>
                          <Minus className='h-4 w-4 text-red-500' />
                          Accessible only in {selectedRole.displayName}
                        </h4>
                        <div className='flex flex-wrap gap-1'>
                          {differences.tabs.removed.map((id) => (
                            <Badge
                              key={id}
                              variant='outline'
                              className='border-red-300 bg-red-50 text-xs dark:bg-red-950/30'
                            >
                              {getTabName(id)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      ) : (
        <Card className='border-dashed'>
          <CardContent className='text-muted-foreground flex flex-col items-center justify-center py-12'>
            <ArrowRight className='mb-2 h-8 w-8 opacity-50' />
            <p>Select a role above to compare</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
