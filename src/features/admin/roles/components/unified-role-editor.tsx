// Created and developed by Jai Singh
import { useState, useEffect, useCallback, useMemo } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  User,
  Shield,
  Menu,
  Layout,
  GitCompare,
  Loader2,
  Save,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { rbacService } from '@/lib/auth/rbac-service'
import { supabase } from '@/lib/supabase/client'
import type { Database, UserRole } from '@/lib/supabase/database.types'
import { logger } from '@/lib/utils/logger'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { SYSTEM_ROLES } from '@/features/user-management/types'
import { useRoles } from '../context/roles-context'
import type { Role } from '../data/schema'
import {
  updateRole,
  updateRolePermissions,
  getAllPermissions,
} from '../services/role.service'
import {
  PermissionSelector,
  NavigationSelector,
  TabPermissionSelector,
  RoleComparison,
  RoleSummaryCard,
  type RoleSummaryData,
  type Permission as SharedPermission,
} from './shared'

// Schema for basic info editing
const basicInfoSchema = z.object({
  displayName: z.string().min(1, 'Display name is required').max(100),
  description: z.string().max(500).optional(),
})

type BasicInfoFormData = z.infer<typeof basicInfoSchema>

export interface UnifiedRoleEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: Role | null
  defaultTab?: 'overview' | 'permissions' | 'navigation' | 'tabs' | 'compare'
}

// Helper to get role enum from name (Updated Dec 20, 2025 to support custom roles)
const getRoleEnumFromName = (roleName: string): UserRole => {
  // System roles that exist in the database enum
  const systemRoles = [
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
  const lowerName = roleName.toLowerCase()

  // If it's a system role, return it
  if (systemRoles.includes(lowerName)) {
    return lowerName as UserRole
  }

  // For custom roles, return the actual role name (not an enum value)
  // The database will use role_id for validation, not the role enum
  return roleName.toLowerCase() as UserRole
}

export function UnifiedRoleEditor({
  open,
  onOpenChange,
  role,
  defaultTab = 'overview',
}: UnifiedRoleEditorProps) {
  const { refreshRoles } = useRoles()

  // Loading states
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  // Current data state
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])
  const [selectedNavigationItems, setSelectedNavigationItems] = useState<
    string[]
  >([])
  const [selectedTabPermissions, setSelectedTabPermissions] = useState<
    string[]
  >([])

  // Original data (for comparison/dirty check)
  const [originalPermissions, setOriginalPermissions] = useState<string[]>([])
  const [originalNavigationItems, setOriginalNavigationItems] = useState<
    string[]
  >([])
  const [originalTabPermissions, setOriginalTabPermissions] = useState<
    string[]
  >([])

  // All available items for summary
  const [allPermissions, setAllPermissions] = useState<SharedPermission[]>([])
  const [totalNavigationCount, setTotalNavigationCount] = useState(0)
  const [totalTabsCount, setTotalTabsCount] = useState(0)

  // Unsaved changes dialog
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [activeTab, setActiveTab] = useState(defaultTab)

  // Form for basic info
  const form = useForm<BasicInfoFormData>({
    resolver: zodResolver(basicInfoSchema),
    defaultValues: {
      displayName: '',
      description: '',
    },
  })

  // Load role data when role changes
  useEffect(() => {
    const loadRoleData = async () => {
      if (!role || !open) return

      setIsLoading(true)
      try {
        // Reset form
        form.reset({
          displayName: role.displayName || role.name,
          description: role.description || '',
        })

        // Load all permissions first
        const perms = await getAllPermissions()
        setAllPermissions(perms as SharedPermission[])

        // Load role permissions
        const { data: rolePerms } = await supabase
          .from('role_permissions')
          .select('permission_id')
          .eq('role_id', role.id)

        const permIds = rolePerms?.map((p) => p.permission_id) || []
        setSelectedPermissions(permIds)
        setOriginalPermissions(permIds)

        // Load navigation permissions
        const { data: navItems } = await supabase
          .from('navigation_items')
          .select('id')

        setTotalNavigationCount(navItems?.length || 0)

        const { data: navPerms } = await supabase
          .from('role_navigation_permissions')
          .select('navigation_item_id')
          .eq('role_id', role.id)
          .eq('visible', true)

        const navIds = navPerms?.map((n) => n.navigation_item_id) || []
        setSelectedNavigationItems(navIds)
        setOriginalNavigationItems(navIds)

        // Load tab permissions
        const tabs = await rbacService.getAllTabDefinitions()
        setTotalTabsCount(tabs.length)

        const { data: tabPerms } = await supabase
          .from('role_tab_permissions')
          .select('tab_definition_id')
          .eq('role_id', role.id)
          .eq('granted', true)

        const tabIds = tabPerms?.map((t) => t.tab_definition_id) || []
        setSelectedTabPermissions(tabIds)
        setOriginalTabPermissions(tabIds)
      } catch (error) {
        logger.error('Error loading role data:', error)
        toast.error('Failed to load role data')
      } finally {
        setIsLoading(false)
      }
    }

    loadRoleData()
  }, [role, open, form])

  // Check if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (!role) return false

    const formValues = form.getValues()
    const basicInfoChanged =
      formValues.displayName !== (role.displayName || role.name) ||
      formValues.description !== (role.description || '')

    const permissionsChanged =
      JSON.stringify([...selectedPermissions].sort()) !==
      JSON.stringify([...originalPermissions].sort())

    const navigationChanged =
      JSON.stringify([...selectedNavigationItems].sort()) !==
      JSON.stringify([...originalNavigationItems].sort())

    const tabsChanged =
      JSON.stringify([...selectedTabPermissions].sort()) !==
      JSON.stringify([...originalTabPermissions].sort())

    return (
      basicInfoChanged || permissionsChanged || navigationChanged || tabsChanged
    )
  }, [
    role,
    form,
    selectedPermissions,
    originalPermissions,
    selectedNavigationItems,
    originalNavigationItems,
    selectedTabPermissions,
    originalTabPermissions,
  ])

  // Summary data for the card
  const summaryData: RoleSummaryData = useMemo(() => {
    const permissionsByResource: Record<string, number> = {}

    selectedPermissions.forEach((permId) => {
      const perm = allPermissions.find((p) => p.id === permId)
      if (perm) {
        permissionsByResource[perm.resource] =
          (permissionsByResource[perm.resource] || 0) + 1
      }
    })

    return {
      name: role?.name || '',
      displayName:
        form.watch('displayName') || role?.displayName || role?.name || '',
      description: form.watch('description') || role?.description,
      permissionsCount: selectedPermissions.length,
      permissionsByResource,
      navigationVisibleCount: selectedNavigationItems.length,
      navigationTotalCount: totalNavigationCount,
      tabsGrantedCount: selectedTabPermissions.length,
      tabsTotalCount: totalTabsCount,
    }
  }, [
    role,
    form,
    selectedPermissions,
    allPermissions,
    selectedNavigationItems,
    totalNavigationCount,
    selectedTabPermissions,
    totalTabsCount,
  ])

  // Handle dialog close with unsaved changes check
  const handleClose = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowUnsavedDialog(true)
    } else {
      onOpenChange(false)
    }
  }, [hasUnsavedChanges, onOpenChange])

  // Discard changes and close
  const handleDiscardAndClose = useCallback(() => {
    setShowUnsavedDialog(false)
    onOpenChange(false)
  }, [onOpenChange])

  // Save all changes
  const handleSaveAll = async () => {
    if (!role) return

    setIsSaving(true)
    try {
      const formValues = form.getValues()

      // Update basic info
      await updateRole(role.id, {
        display_name: formValues.displayName,
        description: formValues.description,
      })

      // Update permissions
      await updateRolePermissions(role.id, selectedPermissions)

      // Update navigation permissions (Dec 20, 2025: Fixed to support custom roles)
      const roleEnumValue = getRoleEnumFromName(role.name)

      // Get all navigation items
      const { data: allNavItems } = await supabase
        .from('navigation_items')
        .select('id')

      if (allNavItems) {
        for (const item of allNavItems) {
          const visible = selectedNavigationItems.includes(item.id)

          // CRITICAL FIX (Dec 20, 2025): Handle both system and custom roles
          // Custom roles aren't in enum, but role column is NOT NULL
          // Solution: Use actual role for system roles, 'viewer' as fallback for custom roles
          const roleEnum: UserRole = SYSTEM_ROLES.includes(
            roleEnumValue as (typeof SYSTEM_ROLES)[number]
          )
            ? roleEnumValue
            : 'viewer'
          const navPermRecord: Database['public']['Tables']['role_navigation_permissions']['Insert'] =
            {
              role_id: role.id,
              navigation_item_id: item.id,
              visible,
              role: roleEnum,
            }

          await supabase
            .from('role_navigation_permissions')
            .upsert(navPermRecord, {
              onConflict: 'role_id,navigation_item_id',
            })
        }
      }

      // Update tab permissions
      await rbacService.assignTabPermissionsToRole(
        role.id,
        selectedTabPermissions
      )

      // Update original values
      setOriginalPermissions([...selectedPermissions])
      setOriginalNavigationItems([...selectedNavigationItems])
      setOriginalTabPermissions([...selectedTabPermissions])

      await refreshRoles()
      toast.success('Role updated successfully!')
    } catch (error) {
      logger.error('Error saving role:', error)
      toast.error('Failed to save role changes')
    } finally {
      setIsSaving(false)
    }
  }

  // Copy handlers for comparison
  const handleCopyPermissions = useCallback((permissions: string[]) => {
    setSelectedPermissions(permissions)
    toast.success('Permissions copied from comparison role')
  }, [])

  const handleCopyNavigation = useCallback((items: string[]) => {
    setSelectedNavigationItems(items)
    toast.success('Navigation items copied from comparison role')
  }, [])

  const handleCopyTabs = useCallback((tabs: string[]) => {
    setSelectedTabPermissions(tabs)
    toast.success('Tab permissions copied from comparison role')
  }, [])

  if (!role) return null

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className='flex max-h-[90vh] flex-col overflow-hidden sm:max-w-[1000px]'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              Edit Role:{' '}
              <Badge variant='outline'>{role.displayName || role.name}</Badge>
              {role.isSystem && (
                <Badge variant='secondary' className='text-xs'>
                  System Role
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Modify role settings, permissions, navigation access, and tab
              permissions.
              {hasUnsavedChanges && (
                <span className='ml-2 inline-flex items-center gap-1 text-amber-600'>
                  <AlertTriangle className='h-3 w-3' />
                  Unsaved changes
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className='flex flex-1 items-center justify-center py-12'>
              <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
              <span className='text-muted-foreground ml-3'>
                Loading role data...
              </span>
            </div>
          ) : (
            <div className='flex-1 overflow-hidden'>
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as typeof activeTab)}
                className='flex h-full flex-col'
              >
                <TabsList className='grid w-full grid-cols-5'>
                  <TabsTrigger
                    value='overview'
                    className='flex items-center gap-2'
                  >
                    <User className='h-4 w-4' />
                    <span className='hidden sm:inline'>Overview</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value='permissions'
                    className='flex items-center gap-2'
                  >
                    <Shield className='h-4 w-4' />
                    <span className='hidden sm:inline'>Permissions</span>
                    <Badge variant='outline' className='ml-1 text-xs'>
                      {selectedPermissions.length}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger
                    value='navigation'
                    className='flex items-center gap-2'
                  >
                    <Menu className='h-4 w-4' />
                    <span className='hidden sm:inline'>Navigation</span>
                    <Badge variant='outline' className='ml-1 text-xs'>
                      {selectedNavigationItems.length}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value='tabs' className='flex items-center gap-2'>
                    <Layout className='h-4 w-4' />
                    <span className='hidden sm:inline'>Tabs</span>
                    <Badge variant='outline' className='ml-1 text-xs'>
                      {selectedTabPermissions.length}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger
                    value='compare'
                    className='flex items-center gap-2'
                  >
                    <GitCompare className='h-4 w-4' />
                    <span className='hidden sm:inline'>Compare</span>
                  </TabsTrigger>
                </TabsList>

                <div className='mt-4 flex-1 overflow-hidden'>
                  {/* Overview Tab */}
                  <TabsContent
                    value='overview'
                    className='m-0 h-full overflow-auto'
                  >
                    <div className='grid grid-cols-1 gap-6 pb-4 lg:grid-cols-2'>
                      {/* Basic Info Form */}
                      <Card>
                        <CardHeader>
                          <CardTitle className='text-base'>
                            Basic Information
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <Form {...form}>
                            <div className='space-y-4'>
                              <FormField
                                control={form.control}
                                name='displayName'
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Display Name</FormLabel>
                                    <FormControl>
                                      <Input
                                        {...field}
                                        disabled={role.isSystem}
                                      />
                                    </FormControl>
                                    <FormDescription>
                                      The name shown in the interface.
                                    </FormDescription>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <FormField
                                control={form.control}
                                name='description'
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Description</FormLabel>
                                    <FormControl>
                                      <Textarea
                                        {...field}
                                        placeholder='Describe the purpose of this role...'
                                        className='resize-none'
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <div className='text-muted-foreground space-y-1 text-xs'>
                                <p>Role ID: {role.id}</p>
                                <p>System Name: {role.name}</p>
                                <p>Users: {role.userCount || 0}</p>
                              </div>
                            </div>
                          </Form>
                        </CardContent>
                      </Card>

                      {/* Summary Card */}
                      <RoleSummaryCard data={summaryData} variant='detailed' />
                    </div>
                  </TabsContent>

                  {/* Permissions Tab */}
                  <TabsContent value='permissions' className='m-0 h-full'>
                    <PermissionSelector
                      selectedPermissions={selectedPermissions}
                      onSelectionChange={setSelectedPermissions}
                      maxHeight='calc(90vh - 280px)'
                    />
                  </TabsContent>

                  {/* Navigation Tab */}
                  <TabsContent value='navigation' className='m-0 h-full'>
                    <NavigationSelector
                      selectedItems={selectedNavigationItems}
                      onSelectionChange={setSelectedNavigationItems}
                      maxHeight='calc(90vh - 280px)'
                    />
                  </TabsContent>

                  {/* Tabs Tab */}
                  <TabsContent value='tabs' className='m-0 h-full'>
                    <TabPermissionSelector
                      selectedTabs={selectedTabPermissions}
                      onSelectionChange={setSelectedTabPermissions}
                      maxHeight='calc(90vh - 280px)'
                    />
                  </TabsContent>

                  {/* Compare Tab */}
                  <TabsContent
                    value='compare'
                    className='m-0 h-full overflow-auto'
                  >
                    <RoleComparison
                      currentRoleId={role.id}
                      currentPermissions={selectedPermissions}
                      currentNavigationItems={selectedNavigationItems}
                      currentTabPermissions={selectedTabPermissions}
                      onCopyPermissions={handleCopyPermissions}
                      onCopyNavigation={handleCopyNavigation}
                      onCopyTabs={handleCopyTabs}
                    />
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          )}

          <DialogFooter className='flex items-center justify-between border-t pt-4'>
            <div className='flex items-center gap-2 text-sm'>
              {hasUnsavedChanges ? (
                <span className='flex items-center gap-1 text-amber-600'>
                  <AlertTriangle className='h-4 w-4' />
                  Unsaved changes
                </span>
              ) : (
                <span className='flex items-center gap-1 text-green-600'>
                  <CheckCircle className='h-4 w-4' />
                  All changes saved
                </span>
              )}
            </div>
            <div className='flex gap-2'>
              <Button variant='outline' onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveAll}
                disabled={isSaving || !hasUnsavedChanges}
              >
                {isSaving && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                <Save className='mr-2 h-4 w-4' />
                Save All Changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unsaved Changes Alert */}
      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Do you want to save them before closing?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDiscardAndClose}>
              Discard
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await handleSaveAll()
                setShowUnsavedDialog(false)
                onOpenChange(false)
              }}
            >
              Save Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// Created and developed by Jai Singh
