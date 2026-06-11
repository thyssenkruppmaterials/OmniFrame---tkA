// Created and developed by Jai Singh
import { useCallback, useEffect, useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Eye,
  EyeOff,
  Info,
  Layout,
  Loader2,
  Menu,
  Shield,
  User,
} from 'lucide-react'
import { Wizard, useWizard } from 'react-use-wizard'
import { toast } from 'sonner'
import { rbacService } from '@/lib/auth/rbac-service'
import { supabase } from '@/lib/supabase/client'
import type { NavigationItem, UserRole } from '@/lib/supabase/database.types'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { useRoles } from '../context/roles-context'
import {
  createRole,
  getAllPermissions,
  isRoleNameTaken,
  updateRolePermissions,
} from '../services/role.service'

// Enhanced form schema with all wizard steps
const roleWizardSchema = z.object({
  // Step 1: Basic Information
  name: z
    .string()
    .min(3, 'Role name must be at least 3 characters')
    .max(50, 'Role name must be less than 50 characters')
    .regex(
      /^[a-z0-9-_]+$/,
      'Role name must be lowercase and contain only letters, numbers, hyphens, and underscores'
    ),
  displayName: z
    .string()
    .min(3, 'Display name must be at least 3 characters')
    .max(100, 'Display name must be less than 100 characters'),
  description: z
    .string()
    .max(500, 'Description must be less than 500 characters')
    .optional(),

  // Step 2: Permissions
  permissions: z.array(z.string()).default([]),

  // Step 3: Navigation Items
  navigationItems: z.array(z.string()).default([]),

  // Step 4: Tab Permissions
  tabPermissions: z.array(z.string()).default([]),
})

type RoleWizardFormData = z.infer<typeof roleWizardSchema>

// Type-safe window extensions for wizard data sharing between wizard steps
interface RoleWizardWindow extends Window {
  roleWizardData?: Partial<RoleWizardFormData> & {
    name?: string
    displayName?: string
    description?: string
  }
  roleWizardComplete?: () => void
}
const wizardWindow = window as unknown as RoleWizardWindow

interface RoleCreationWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Permission {
  id: string
  name: string
  resource: string
  action: string
  description?: string | null
}

interface NavigationItemWithPermission extends NavigationItem {
  visible: boolean
  children?: NavigationItemWithPermission[]
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

// Helper function to get role enum value from role name (improved for custom roles)
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

// Step 1: Basic Role Information
function BasicInformationStep() {
  const { nextStep, isLoading, handleStep } = useWizard()
  const form = useForm<
    Pick<RoleWizardFormData, 'name' | 'displayName' | 'description'>
  >({
    resolver: zodResolver(
      roleWizardSchema.pick({
        name: true,
        displayName: true,
        description: true,
      })
    ),
  })

  // Auto-generate display name from role name
  const watchName = form.watch('name')
  useEffect(() => {
    if (watchName && !form.getValues('displayName')) {
      const displayName = watchName
        .split(/[-_]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
      form.setValue('displayName', displayName)
    }
  }, [watchName, form])

  // Handle step validation
  handleStep(async () => {
    const isValid = await form.trigger()
    if (!isValid) {
      throw new Error('Please fix the validation errors before continuing')
    }

    // Check if role name is already taken with enhanced checking
    const formData = form.getValues()
    const nameCheck = await isRoleNameTaken(formData.name)
    if (nameCheck.taken) {
      const conflictingRole = nameCheck.conflictingRole
      const suggestions = nameCheck.suggestions || []

      let errorMessage = 'This role name is already taken'
      if (conflictingRole) {
        errorMessage = `Similar role exists: "${conflictingRole.name}" (${conflictingRole.display_name})`
      }
      if (suggestions.length > 0) {
        errorMessage += `. Suggestions: ${suggestions.slice(0, 2).join(', ')}`
      }

      form.setError('name', {
        type: 'manual',
        message: errorMessage,
      })
      throw new Error(errorMessage)
    }

    // Store form data in parent component state
    const wizardData = wizardWindow.roleWizardData || {}
    wizardWindow.roleWizardData = { ...wizardData, ...formData }
  })

  return (
    <div className='flex h-full flex-col space-y-6 overflow-hidden'>
      <div className='flex flex-shrink-0 items-center gap-3'>
        <div className='bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-full'>
          <User size={16} />
        </div>
        <div>
          <h3 className='text-lg font-semibold'>Basic Information</h3>
          <p className='text-muted-foreground text-sm'>
            Define the role name and description
          </p>
        </div>
      </div>

      <div className='flex-1 overflow-hidden'>
        <Form {...form}>
          <div className='space-y-4'>
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='e.g., content_editor, warehouse_manager'
                      {...field}
                      onChange={(e) => {
                        const value = e.target.value
                          .toLowerCase()
                          .replace(/\s+/g, '_')
                        field.onChange(value)
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    A unique identifier for this role (lowercase, no spaces).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='displayName'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='e.g., Content Editor, Warehouse Manager'
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    The user-friendly name shown in the interface.
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
                      placeholder='Describe the purpose and scope of this role...'
                      className='resize-none'
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    A clear description of what this role can do and its
                    intended use.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </Form>
      </div>

      <div className='flex flex-shrink-0 justify-end border-t pt-4'>
        <Button onClick={() => nextStep()} disabled={isLoading}>
          {isLoading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          Continue
          <ArrowRight className='ml-2 h-4 w-4' />
        </Button>
      </div>
    </div>
  )
}

// Step 2: Permission Selection (Simplified)
function PermissionSelectionStep() {
  const { previousStep, nextStep, isLoading, handleStep } = useWizard()
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])
  const [permissionsByResource, setPermissionsByResource] = useState<
    Record<string, Permission[]>
  >({})

  // Load permissions
  useEffect(() => {
    const loadPermissions = async () => {
      try {
        const perms = await getAllPermissions()

        // Group permissions by resource for better organization
        const grouped = perms.reduce(
          (acc: Record<string, Permission[]>, perm) => {
            if (!acc[perm.resource]) {
              acc[perm.resource] = []
            }
            acc[perm.resource].push(perm)
            return acc
          },
          {}
        )
        setPermissionsByResource(grouped)

        // Load any existing selected permissions
        const wizardData = wizardWindow.roleWizardData || {}
        if (wizardData.permissions) {
          setSelectedPermissions(wizardData.permissions)
        }
      } catch (error) {
        logger.error('Error loading permissions:', error)
        toast.error('Failed to load permissions')
      }
    }

    loadPermissions()
  }, [])

  // Handle step validation
  handleStep(async () => {
    const wizardData = wizardWindow.roleWizardData || {}
    wizardWindow.roleWizardData = {
      ...wizardData,
      permissions: selectedPermissions,
    }
  })

  const handlePermissionToggle = (permissionId: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(permissionId)
        ? prev.filter((id) => id !== permissionId)
        : [...prev, permissionId]
    )
  }

  const handleResourceToggle = (resource: string) => {
    const resourcePermissions = permissionsByResource[resource] || []
    const resourcePermissionIds = resourcePermissions.map((p) => p.id)
    const allSelected = resourcePermissionIds.every((id) =>
      selectedPermissions.includes(id)
    )

    if (allSelected) {
      // Remove all permissions for this resource
      setSelectedPermissions((prev) =>
        prev.filter((id) => !resourcePermissionIds.includes(id))
      )
    } else {
      // Add all permissions for this resource
      setSelectedPermissions((prev) => [
        ...new Set([...prev, ...resourcePermissionIds]),
      ])
    }
  }

  return (
    <div className='flex h-full flex-col space-y-4 overflow-hidden'>
      <div className='flex flex-shrink-0 items-center gap-3'>
        <div className='bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-full'>
          <Shield size={16} />
        </div>
        <div>
          <h3 className='text-lg font-semibold'>Permissions</h3>
          <p className='text-muted-foreground text-sm'>
            Select the permissions this role should have
          </p>
        </div>
      </div>

      <Card className='flex flex-1 flex-col overflow-hidden'>
        <CardHeader className='pb-3'>
          <CardTitle className='flex items-center justify-between text-base'>
            <span>Available Permissions</span>
            <Badge variant='outline'>
              {selectedPermissions.length} selected
            </Badge>
          </CardTitle>
          <div className='text-muted-foreground flex items-center gap-2 text-sm'>
            <Info size={14} />
            <span>
              Select permissions by resource group or individual permissions
            </span>
          </div>
        </CardHeader>
        <CardContent className='flex flex-1 flex-col overflow-hidden px-6 pb-4'>
          <ScrollArea className='h-80 pr-4'>
            <div className='space-y-3'>
              {Object.entries(permissionsByResource).map(
                ([resource, resourcePermissions]) => {
                  const allSelected = resourcePermissions.every((perm) =>
                    selectedPermissions.includes(perm.id)
                  )
                  const someSelected = resourcePermissions.some((perm) =>
                    selectedPermissions.includes(perm.id)
                  )

                  return (
                    <Card key={resource} className='border-border/50'>
                      <CardHeader className='pb-2'>
                        <div className='flex items-center gap-3'>
                          <Checkbox
                            checked={
                              allSelected
                                ? true
                                : someSelected
                                  ? 'indeterminate'
                                  : false
                            }
                            onCheckedChange={() =>
                              handleResourceToggle(resource)
                            }
                          />
                          <div className='flex-1'>
                            <h4 className='font-medium capitalize'>
                              {resource.replace('_', ' ')}
                            </h4>
                            <p className='text-muted-foreground text-xs'>
                              {resourcePermissions.length} permissions
                            </p>
                          </div>
                          <Badge
                            variant={
                              allSelected
                                ? 'default'
                                : someSelected
                                  ? 'secondary'
                                  : 'outline'
                            }
                          >
                            {
                              resourcePermissions.filter((p) =>
                                selectedPermissions.includes(p.id)
                              ).length
                            }
                            /{resourcePermissions.length}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className='pt-2'>
                        <div className='grid grid-cols-1 gap-2'>
                          {resourcePermissions.map((permission) => (
                            <div
                              key={permission.id}
                              className='hover:bg-muted/50 flex items-center gap-2 rounded p-2'
                            >
                              <Checkbox
                                checked={selectedPermissions.includes(
                                  permission.id
                                )}
                                onCheckedChange={() =>
                                  handlePermissionToggle(permission.id)
                                }
                              />
                              <div className='min-w-0 flex-1'>
                                <div className='flex items-center gap-2'>
                                  <span className='text-sm font-medium'>
                                    {permission.resource}:{permission.action}
                                  </span>
                                </div>
                                {permission.description && (
                                  <p className='text-muted-foreground truncate text-xs'>
                                    {permission.description}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )
                }
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <div className='flex flex-shrink-0 justify-between border-t pt-4'>
        <Button variant='outline' onClick={() => previousStep()}>
          <ArrowLeft className='mr-2 h-4 w-4' />
          Previous
        </Button>
        <Button onClick={() => nextStep()} disabled={isLoading}>
          {isLoading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          Continue
          <ArrowRight className='ml-2 h-4 w-4' />
        </Button>
      </div>
    </div>
  )
}

// Step 3: Navigation Menu Items (Simplified)
function NavigationItemsStep() {
  const { previousStep, nextStep, isLoading, handleStep } = useWizard()
  const [navigationItems, setNavigationItems] = useState<
    NavigationItemWithPermission[]
  >([])
  const [selectedItems, setSelectedItems] = useState<string[]>([])

  // Load navigation items
  useEffect(() => {
    const loadNavigationItems = async () => {
      try {
        const { data: navItems, error } = await supabase
          .from('navigation_items')
          .select('*')
          .order('position')

        if (error) throw error

        // Build hierarchical navigation structure
        const itemsMap = new Map<string, NavigationItemWithPermission>()
        const rootItems: NavigationItemWithPermission[] = []

        // Create all items first with default visibility
        navItems?.forEach((item) => {
          const itemWithPermission: NavigationItemWithPermission = {
            ...item,
            visible: true, // Default to visible for new roles
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

        // Load any existing selected items
        const wizardData = wizardWindow.roleWizardData || {}
        if (wizardData.navigationItems) {
          setSelectedItems(wizardData.navigationItems)
        } else {
          // Default to selecting all main navigation items for new roles
          const defaultItems = rootItems.map((item) => item.id)
          setSelectedItems(defaultItems)
        }
      } catch (error) {
        logger.error('Error loading navigation items:', error)
        toast.error('Failed to load navigation items')
      }
    }

    loadNavigationItems()
  }, [])

  // Handle step validation (store navigation items and proceed to next step)
  handleStep(async () => {
    const wizardData = wizardWindow.roleWizardData || {}
    wizardWindow.roleWizardData = {
      ...wizardData,
      navigationItems: selectedItems,
    }
  })

  const handleItemToggle = (itemId: string) => {
    setSelectedItems((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId]
    )
  }

  const handleGroupToggle = (item: NavigationItemWithPermission) => {
    const allItemIds = [
      item.id,
      ...(item.children?.map((child) => child.id) || []),
    ]
    const allSelected = allItemIds.every((id) => selectedItems.includes(id))

    if (allSelected) {
      setSelectedItems((prev) => prev.filter((id) => !allItemIds.includes(id)))
    } else {
      setSelectedItems((prev) => [...new Set([...prev, ...allItemIds])])
    }
  }

  const renderNavigationItem = (
    item: NavigationItemWithPermission,
    level = 0
  ) => {
    const indent = level * 20
    const isSelected = selectedItems.includes(item.id)
    const hasChildren = item.children && item.children.length > 0
    const childrenSelected = hasChildren
      ? item.children!.filter((child) => selectedItems.includes(child.id))
          .length
      : 0

    return (
      <div key={item.id} className='space-y-2'>
        <div
          className='hover:bg-muted/50 flex items-center space-x-3 rounded-lg border p-3 transition-colors'
          style={{ marginLeft: `${indent}px` }}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => handleItemToggle(item.id)}
          />
          <div className='flex min-w-0 flex-1 items-center gap-2'>
            <Menu size={16} className='text-muted-foreground' />
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-2'>
                <span className='text-sm font-medium'>{item.title}</span>
                {hasChildren && (
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 px-2 text-xs'
                    onClick={() => handleGroupToggle(item)}
                  >
                    Select All ({childrenSelected}/{item.children!.length})
                  </Button>
                )}
              </div>
              {item.url && (
                <Badge variant='outline' className='mt-1 font-mono text-xs'>
                  {item.url}
                </Badge>
              )}
            </div>
            {isSelected ? (
              <Eye size={14} className='text-green-600' />
            ) : (
              <EyeOff size={14} className='text-red-600' />
            )}
          </div>
        </div>

        {hasChildren && (
          <div className='ml-4 space-y-2'>
            {item.children!.map((child) =>
              renderNavigationItem(child, level + 1)
            )}
          </div>
        )}
      </div>
    )
  }

  const selectedCount = selectedItems.length
  const totalItems = navigationItems.reduce((count, item) => {
    let total = 1
    if (item.children) {
      total += item.children.length
    }
    return count + total
  }, 0)

  return (
    <div className='flex h-full flex-col space-y-4 overflow-hidden'>
      <div className='flex flex-shrink-0 items-center gap-3'>
        <div className='bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-full'>
          <Menu size={16} />
        </div>
        <div>
          <h3 className='text-lg font-semibold'>Navigation Menu Items</h3>
          <p className='text-muted-foreground text-sm'>
            Choose which menu items will be visible to this role
          </p>
        </div>
      </div>

      <Card className='flex flex-1 flex-col overflow-hidden'>
        <CardHeader className='pb-3'>
          <CardTitle className='flex items-center justify-between text-base'>
            <span>Menu Visibility</span>
            <Badge variant={selectedCount > 0 ? 'default' : 'secondary'}>
              {selectedCount} of {totalItems} selected
            </Badge>
          </CardTitle>
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
        </CardHeader>
        <CardContent className='flex flex-1 flex-col overflow-hidden px-6 pb-4'>
          <ScrollArea className='h-80 pr-4'>
            <div className='space-y-3'>
              {navigationItems.map((item) => renderNavigationItem(item))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <div className='flex flex-shrink-0 justify-between border-t pt-4'>
        <Button variant='outline' onClick={() => previousStep()}>
          <ArrowLeft className='mr-2 h-4 w-4' />
          Previous
        </Button>
        <Button onClick={() => nextStep()} disabled={isLoading}>
          {isLoading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          Continue
          <ArrowRight className='ml-2 h-4 w-4' />
        </Button>
      </div>
    </div>
  )
}

// Step 4: Tab Permissions
function TabPermissionsStep() {
  const { previousStep, isLoading, handleStep } = useWizard()
  const [tabDefinitions, setTabDefinitions] = useState<TabDefinition[]>([])
  const [selectedTabs, setSelectedTabs] = useState<string[]>([])
  const [tabsByResource, setTabsByResource] = useState<
    Record<string, TabDefinition[]>
  >({})
  const { refreshRoles } = useRoles()

  // Load tab definitions
  useEffect(() => {
    const loadTabDefinitions = async () => {
      try {
        const tabs = await rbacService.getAllTabDefinitions()
        setTabDefinitions(tabs)

        // Group tabs by page resource for better organization
        const grouped = tabs.reduce(
          (acc: Record<string, TabDefinition[]>, tab) => {
            if (!acc[tab.page_resource]) {
              acc[tab.page_resource] = []
            }
            acc[tab.page_resource].push(tab)
            return acc
          },
          {}
        )

        // Sort tabs within each resource by display order
        Object.keys(grouped).forEach((resource) => {
          grouped[resource].sort((a, b) => a.display_order - b.display_order)
        })

        setTabsByResource(grouped)

        // Load any existing selected tabs
        const wizardData = wizardWindow.roleWizardData || {}
        if (wizardData.tabPermissions) {
          setSelectedTabs(wizardData.tabPermissions)
        }
      } catch (error) {
        logger.error('Error loading tab definitions:', error)
        toast.error('Failed to load tab definitions')
      }
    }

    loadTabDefinitions()
  }, [])

  // Handle final wizard submission with enhanced error handling
  const handleFinalSubmit = async () => {
    const wizardData = wizardWindow.roleWizardData || {
      tabPermissions: selectedTabs,
    }

    try {
      // Create the role
      const newRole = await createRole({
        name: wizardData.name ?? '',
        display_name: wizardData.displayName ?? '',
        description: wizardData.description,
      })

      // Set up permissions
      if (wizardData.permissions && wizardData.permissions.length > 0) {
        try {
          await updateRolePermissions(newRole.id, wizardData.permissions)
        } catch (permError) {
          logger.error('Error setting up role permissions:', permError)
          // Continue with role creation even if permissions fail - can be set up later
          toast.error(
            'Role created but permissions setup failed. Please configure permissions manually.'
          )
        }
      }

      // Set up navigation permissions
      if (wizardData.navigationItems && wizardData.navigationItems.length > 0) {
        try {
          const roleEnumValue = getRoleEnumFromName(wizardData.name ?? '')

          // Get all navigation items first
          const { data: navItems } = await supabase
            .from('navigation_items')
            .select('id')

          if (navItems) {
            const allItemIds = navItems.map((item) => item.id)

            for (const itemId of allItemIds) {
              const visible = wizardData.navigationItems.includes(itemId)
              await supabase.from('role_navigation_permissions').upsert(
                {
                  role_id: newRole.id,
                  navigation_item_id: itemId,
                  visible,
                  role: roleEnumValue, // Custom roles support via getRoleEnumFromName
                },
                {
                  onConflict: 'role_id,navigation_item_id',
                }
              )
            }
          }
        } catch (navError) {
          logger.error('Error setting up navigation permissions:', navError)
          toast.error(
            'Role created but navigation setup failed. Please configure navigation manually.'
          )
        }
      }

      // Set up tab permissions
      if (selectedTabs.length > 0) {
        try {
          await rbacService.assignTabPermissionsToRole(newRole.id, selectedTabs)
        } catch (tabError) {
          logger.error('Error setting up tab permissions:', tabError)
          toast.error(
            'Role created but tab permissions setup failed. Please configure tabs manually.'
          )
        }
      }

      toast.success(`Role "${wizardData.displayName}" created successfully!`)

      // Clean up temporary data
      delete wizardWindow.roleWizardData

      // Refresh roles data
      await refreshRoles()

      // Trigger completion
      const completeHandler = wizardWindow.roleWizardComplete
      if (completeHandler) {
        completeHandler()
      }

      return true
    } catch (error) {
      logger.error('Error creating role:', error)

      // Provide user-friendly error messages
      let userMessage = 'Failed to create role'
      if (error instanceof Error) {
        if (
          error.message.includes('already exists') ||
          error.message.includes('already taken')
        ) {
          userMessage = error.message
        } else if (error.message.includes('duplicate key')) {
          userMessage =
            'A role with this name already exists. Please choose a different name.'
        } else {
          userMessage = `Failed to create role: ${error.message}`
        }
      }

      toast.error(userMessage)
      throw new Error(userMessage)
    }
  }

  // Set up the final step handler
  handleStep(handleFinalSubmit)

  const handleTabToggle = (tabId: string) => {
    setSelectedTabs((prev) =>
      prev.includes(tabId)
        ? prev.filter((id) => id !== tabId)
        : [...prev, tabId]
    )
  }

  const handleResourceToggle = (resource: string) => {
    const resourceTabs = tabsByResource[resource] || []
    const resourceTabIds = resourceTabs.map((t) => t.id)
    const allSelected = resourceTabIds.every((id) => selectedTabs.includes(id))

    if (allSelected) {
      // Remove all tabs for this resource
      setSelectedTabs((prev) =>
        prev.filter((id) => !resourceTabIds.includes(id))
      )
    } else {
      // Add all tabs for this resource
      setSelectedTabs((prev) => [...new Set([...prev, ...resourceTabIds])])
    }
  }

  const selectedCount = selectedTabs.length
  const totalTabs = tabDefinitions.length

  return (
    <div className='flex h-full flex-col space-y-4 overflow-hidden'>
      <div className='flex flex-shrink-0 items-center gap-3'>
        <div className='bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-full'>
          <Layout size={16} />
        </div>
        <div>
          <h3 className='text-lg font-semibold'>Tab Permissions</h3>
          <p className='text-muted-foreground text-sm'>
            Choose which tabs will be accessible to this role
          </p>
        </div>
      </div>

      <Card className='flex flex-1 flex-col overflow-hidden'>
        <CardHeader className='pb-3'>
          <CardTitle className='flex items-center justify-between text-base'>
            <span>Tab Access Control</span>
            <Badge variant={selectedCount > 0 ? 'default' : 'secondary'}>
              {selectedCount} of {totalTabs} selected
            </Badge>
          </CardTitle>
          <div className='text-muted-foreground flex items-center gap-2 text-sm'>
            <Info size={14} />
            <span>Control access to specific tabs within each page</span>
          </div>
        </CardHeader>
        <CardContent className='flex flex-1 flex-col overflow-hidden px-6 pb-4'>
          <ScrollArea className='h-80 pr-4'>
            <div className='space-y-4'>
              {Object.entries(tabsByResource).map(
                ([resource, resourceTabs]) => {
                  const allSelected = resourceTabs.every((tab) =>
                    selectedTabs.includes(tab.id)
                  )
                  const someSelected = resourceTabs.some((tab) =>
                    selectedTabs.includes(tab.id)
                  )

                  return (
                    <Card key={resource} className='border-border/50'>
                      <CardHeader className='pb-2'>
                        <div className='flex items-center gap-3'>
                          <Checkbox
                            checked={
                              allSelected
                                ? true
                                : someSelected
                                  ? 'indeterminate'
                                  : false
                            }
                            onCheckedChange={() =>
                              handleResourceToggle(resource)
                            }
                          />
                          <div className='flex-1'>
                            <h4 className='font-medium capitalize'>
                              {resource
                                .replace('_', ' ')
                                .replace('apps', 'Apps')}
                            </h4>
                            <p className='text-muted-foreground text-xs'>
                              {resourceTabs.length} tabs available
                            </p>
                          </div>
                          <Badge
                            variant={
                              allSelected
                                ? 'default'
                                : someSelected
                                  ? 'secondary'
                                  : 'outline'
                            }
                          >
                            {
                              resourceTabs.filter((t) =>
                                selectedTabs.includes(t.id)
                              ).length
                            }
                            /{resourceTabs.length}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className='pt-2'>
                        <div className='grid grid-cols-1 gap-2'>
                          {resourceTabs.map((tab) => (
                            <div
                              key={tab.id}
                              className='hover:bg-muted/50 flex items-center gap-2 rounded p-2'
                            >
                              <Checkbox
                                checked={selectedTabs.includes(tab.id)}
                                onCheckedChange={() => handleTabToggle(tab.id)}
                              />
                              <div className='min-w-0 flex-1'>
                                <div className='flex items-center gap-2'>
                                  <span className='text-sm font-medium'>
                                    {tab.tab_label}
                                  </span>
                                  <Badge variant='outline' className='text-xs'>
                                    {tab.tab_id}
                                  </Badge>
                                </div>
                                {tab.description && (
                                  <p className='text-muted-foreground mt-1 truncate text-xs'>
                                    {tab.description}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )
                }
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <div className='flex flex-shrink-0 justify-between border-t pt-4'>
        <Button variant='outline' onClick={() => previousStep()}>
          <ArrowLeft className='mr-2 h-4 w-4' />
          Previous
        </Button>
        <Button onClick={handleFinalSubmit} disabled={isLoading}>
          {isLoading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          Create Role
          <CheckCircle className='ml-2 h-4 w-4' />
        </Button>
      </div>
    </div>
  )
}

// Progress Header Component (used outside Wizard)
function ProgressHeader() {
  const steps = [
    { title: 'Basic Information', icon: User },
    { title: 'Permissions', icon: Shield },
    { title: 'Navigation Items', icon: Menu },
    { title: 'Tab Permissions', icon: Layout },
  ]

  return (
    <div className='border-border space-y-4 border-b pb-6'>
      <div className='flex items-center justify-between'>
        <h3 className='text-lg font-semibold'>Create New Role</h3>
      </div>

      {/* Step Indicators */}
      <div className='flex items-center justify-between'>
        {steps.map((step, index) => {
          const StepIcon = step.icon

          return (
            <div key={index} className='flex items-center gap-2'>
              <div
                className={`bg-muted text-muted-foreground flex h-8 w-8 items-center justify-center rounded-full transition-colors`}
              >
                <StepIcon size={16} />
              </div>
              <span className={`text-muted-foreground text-sm font-medium`}>
                {step.title}
              </span>
              {index < steps.length - 1 && (
                <div className='bg-border ml-2 h-px w-12' />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function RoleCreationWizard({
  open,
  onOpenChange,
}: RoleCreationWizardProps) {
  const [isComplete, setIsComplete] = useState(false)

  const handleComplete = useCallback(() => {
    setIsComplete(true)
    setTimeout(() => {
      onOpenChange(false)
      setIsComplete(false)
    }, 1500)
  }, [onOpenChange])

  // Pass the completion handler to window for child components to use
  useEffect(() => {
    wizardWindow.roleWizardComplete = handleComplete
    return () => {
      delete wizardWindow.roleWizardComplete
    }
  }, [handleComplete])

  const handleClose = () => {
    // Clean up any temporary data
    delete wizardWindow.roleWizardData
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className='max-h-[85vh] overflow-hidden sm:max-w-[700px]'>
        <DialogHeader>
          <DialogTitle>Role Creation Wizard</DialogTitle>
          <DialogDescription>
            Create a comprehensive role with permissions and navigation settings
            in a guided process.
          </DialogDescription>
        </DialogHeader>

        {isComplete ? (
          <div className='flex flex-col items-center justify-center space-y-4 py-12'>
            <CheckCircle size={48} className='text-green-600' />
            <h3 className='text-lg font-semibold'>
              Role Created Successfully!
            </h3>
            <p className='text-muted-foreground text-center text-sm'>
              Your new role has been created with the specified permissions and
              navigation settings.
            </p>
          </div>
        ) : (
          <div className='flex h-full max-h-[calc(85vh-8rem)] flex-col space-y-4 overflow-hidden'>
            <ProgressHeader />
            <div className='flex-1 overflow-hidden'>
              <Wizard startIndex={0}>
                <BasicInformationStep />
                <PermissionSelectionStep />
                <NavigationItemsStep />
                <TabPermissionsStep />
              </Wizard>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
