// Created and developed by Jai Singh
import { useState, useEffect, useCallback, useMemo } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  ArrowLeft,
  ArrowRight,
  User,
  Shield,
  Menu,
  Layout,
  CheckCircle,
  Loader2,
  Save,
  Sparkles,
  Edit,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { rbacService } from '@/lib/auth/rbac-service'
import { supabase } from '@/lib/supabase/client'
import type { Database, UserRole } from '@/lib/supabase/database.types'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { SYSTEM_ROLES } from '@/features/user-management/types'
import { useRoles } from '../context/roles-context'
import type { Role } from '../data/schema'
import {
  createRole,
  updateRole,
  updateRolePermissions,
  isRoleNameTaken,
  getAllPermissions,
} from '../services/role.service'
import {
  PermissionSelector,
  NavigationSelector,
  TabPermissionSelector,
  RoleComparison,
  RoleSummaryCard,
  RoleTemplateSelector,
  type RoleSummaryData,
  type RoleTemplate,
  type Permission as SharedPermission,
} from './shared'

// Form schema
const wizardSchema = z.object({
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
  description: z.string().max(500).optional(),
})

type WizardFormData = z.infer<typeof wizardSchema>

export interface EnhancedRoleWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  role?: Role | null
}

// Wizard steps
const STEPS = [
  { id: 'basic', title: 'Basic Information', icon: User },
  { id: 'permissions', title: 'Permissions', icon: Shield },
  { id: 'navigation', title: 'Navigation', icon: Menu },
  { id: 'tabs', title: 'Tab Permissions', icon: Layout },
  { id: 'review', title: 'Review & Save', icon: CheckCircle },
]

// Draft storage key
const DRAFT_STORAGE_KEY = 'roleWizardDraft'

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

// Draft interface
interface WizardDraft {
  step: number
  formData: Partial<WizardFormData>
  permissions: string[]
  navigationItems: string[]
  tabPermissions: string[]
  savedAt: string
}

export function EnhancedRoleWizard({
  open,
  onOpenChange,
  mode,
  role,
}: EnhancedRoleWizardProps) {
  const { refreshRoles } = useRoles()

  // Step management
  const [currentStep, setCurrentStep] = useState(0)

  // Loading states
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isComplete, setIsComplete] = useState(false)

  // Data states
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])
  const [selectedNavigationItems, setSelectedNavigationItems] = useState<
    string[]
  >([])
  const [selectedTabPermissions, setSelectedTabPermissions] = useState<
    string[]
  >([])

  // For summary calculations
  const [allPermissions, setAllPermissions] = useState<SharedPermission[]>([])
  const [totalNavigationCount, setTotalNavigationCount] = useState(0)
  const [totalTabsCount, setTotalTabsCount] = useState(0)

  // Draft recovery
  const [_hasDraft, setHasDraft] = useState(false)
  const [showDraftRecovery, setShowDraftRecovery] = useState(false)

  // Form
  const form = useForm<WizardFormData>({
    resolver: zodResolver(wizardSchema),
    defaultValues: {
      name: '',
      displayName: '',
      description: '',
    },
  })

  // Auto-generate display name from role name
  const watchName = form.watch('name')
  useEffect(() => {
    if (watchName && mode === 'create' && !form.getValues('displayName')) {
      const displayName = watchName
        .split(/[-_]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
      form.setValue('displayName', displayName)
    }
  }, [watchName, form, mode])

  // Load data on open
  useEffect(() => {
    const loadData = async () => {
      if (!open) return

      setIsLoading(true)
      try {
        // Load all permissions
        const perms = await getAllPermissions()
        setAllPermissions(perms as SharedPermission[])

        // Load navigation count
        const { data: navItems } = await supabase
          .from('navigation_items')
          .select('id')
        setTotalNavigationCount(navItems?.length || 0)

        // Load tabs count
        const tabs = await rbacService.getAllTabDefinitions()
        setTotalTabsCount(tabs.length)

        // Check for draft
        const draft = localStorage.getItem(DRAFT_STORAGE_KEY)
        if (draft && mode === 'create') {
          const parsedDraft = JSON.parse(draft) as WizardDraft
          // Only show recovery if draft is less than 24 hours old
          const draftAge = Date.now() - new Date(parsedDraft.savedAt).getTime()
          if (draftAge < 24 * 60 * 60 * 1000) {
            setHasDraft(true)
            setShowDraftRecovery(true)
          }
        }

        // If editing, load role data
        if (mode === 'edit' && role) {
          form.reset({
            name: role.name,
            displayName: role.displayName || role.name,
            description: role.description || '',
          })

          // Load role permissions
          const { data: rolePerms } = await supabase
            .from('role_permissions')
            .select('permission_id')
            .eq('role_id', role.id)
          setSelectedPermissions(rolePerms?.map((p) => p.permission_id) || [])

          // Load navigation
          const { data: navPerms } = await supabase
            .from('role_navigation_permissions')
            .select('navigation_item_id')
            .eq('role_id', role.id)
            .eq('visible', true)
          setSelectedNavigationItems(
            navPerms?.map((n) => n.navigation_item_id) || []
          )

          // Load tabs
          const { data: tabPerms } = await supabase
            .from('role_tab_permissions')
            .select('tab_definition_id')
            .eq('role_id', role.id)
            .eq('granted', true)
          setSelectedTabPermissions(
            tabPerms?.map((t) => t.tab_definition_id) || []
          )
        }
      } catch (error) {
        logger.error('Error loading wizard data:', error)
        toast.error('Failed to load data')
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [open, mode, role, form])

  // Reset on close
  useEffect(() => {
    if (!open) {
      setCurrentStep(0)
      setIsComplete(false)
      setSelectedPermissions([])
      setSelectedNavigationItems([])
      setSelectedTabPermissions([])
      form.reset()
    }
  }, [open, form])

  // Save draft
  const saveDraft = useCallback(() => {
    const draft: WizardDraft = {
      step: currentStep,
      formData: form.getValues(),
      permissions: selectedPermissions,
      navigationItems: selectedNavigationItems,
      tabPermissions: selectedTabPermissions,
      savedAt: new Date().toISOString(),
    }
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
    toast.success('Draft saved')
  }, [
    currentStep,
    form,
    selectedPermissions,
    selectedNavigationItems,
    selectedTabPermissions,
  ])

  // Recover draft
  const recoverDraft = useCallback(() => {
    try {
      const draft = localStorage.getItem(DRAFT_STORAGE_KEY)
      if (draft) {
        const parsedDraft = JSON.parse(draft) as WizardDraft
        setCurrentStep(parsedDraft.step)
        form.reset(parsedDraft.formData as WizardFormData)
        setSelectedPermissions(parsedDraft.permissions)
        setSelectedNavigationItems(parsedDraft.navigationItems)
        setSelectedTabPermissions(parsedDraft.tabPermissions)
        toast.success('Draft recovered')
      }
    } catch (error) {
      logger.error('Error recovering draft:', error)
      toast.error('Failed to recover draft')
    }
    setShowDraftRecovery(false)
  }, [form])

  // Clear draft
  const clearDraft = useCallback(() => {
    localStorage.removeItem(DRAFT_STORAGE_KEY)
    setHasDraft(false)
    setShowDraftRecovery(false)
  }, [])

  // Apply template
  const handleTemplateSelect = useCallback(
    (template: RoleTemplate) => {
      if (template.permissions.length > 0) {
        setSelectedPermissions(template.permissions)
      }
      if (template.navigationItems.length > 0) {
        setSelectedNavigationItems(template.navigationItems)
      }
      if (template.tabPermissions.length > 0) {
        setSelectedTabPermissions(template.tabPermissions)
      }

      // Suggest name based on template
      if (mode === 'create' && !form.getValues('name')) {
        form.setValue('name', template.name + '_custom')
        form.setValue('displayName', template.displayName + ' (Custom)')
      }
    },
    [form, mode]
  )

  // Step validation
  const canProceed = useCallback(async (): Promise<boolean> => {
    if (currentStep === 0) {
      const isValid = await form.trigger()
      if (!isValid) return false

      // Check if role name is taken (only for create mode)
      if (mode === 'create') {
        const formData = form.getValues()
        const nameCheck = await isRoleNameTaken(formData.name)
        if (nameCheck.taken) {
          form.setError('name', {
            type: 'manual',
            message: `Role name "${formData.name}" is already taken`,
          })
          return false
        }
      }
      return true
    }
    return true
  }, [currentStep, form, mode])

  // Navigation
  const goToStep = useCallback(
    async (step: number) => {
      if (step > currentStep) {
        const canGo = await canProceed()
        if (!canGo) return
      }
      setCurrentStep(step)
    },
    [currentStep, canProceed]
  )

  const nextStep = useCallback(async () => {
    const canGo = await canProceed()
    if (canGo && currentStep < STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1)
    }
  }, [canProceed, currentStep])

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1)
    }
  }, [currentStep])

  // Summary data
  const summaryData: RoleSummaryData = useMemo(() => {
    const formData = form.getValues()
    const permissionsByResource: Record<string, number> = {}

    selectedPermissions.forEach((permId) => {
      const perm = allPermissions.find((p) => p.id === permId)
      if (perm) {
        permissionsByResource[perm.resource] =
          (permissionsByResource[perm.resource] || 0) + 1
      }
    })

    return {
      name: formData.name || '',
      displayName: formData.displayName || '',
      description: formData.description,
      permissionsCount: selectedPermissions.length,
      permissionsByResource,
      navigationVisibleCount: selectedNavigationItems.length,
      navigationTotalCount: totalNavigationCount,
      tabsGrantedCount: selectedTabPermissions.length,
      tabsTotalCount: totalTabsCount,
    }
  }, [
    form,
    selectedPermissions,
    allPermissions,
    selectedNavigationItems,
    totalNavigationCount,
    selectedTabPermissions,
    totalTabsCount,
  ])

  // Final submission
  const handleSubmit = async () => {
    setIsSaving(true)
    try {
      const formData = form.getValues()
      let roleId: string

      if (mode === 'create') {
        // Create new role
        const newRole = await createRole({
          name: formData.name,
          display_name: formData.displayName,
          description: formData.description,
        })
        roleId = newRole.id
      } else if (role) {
        // Update existing role
        await updateRole(role.id, {
          display_name: formData.displayName,
          description: formData.description,
        })
        roleId = role.id
      } else {
        throw new Error('No role to update')
      }

      // Update permissions
      if (selectedPermissions.length > 0) {
        await updateRolePermissions(roleId, selectedPermissions)
      }

      // Update navigation permissions (Dec 20, 2025: Fixed to support custom roles)
      const roleEnumValue = getRoleEnumFromName(formData.name)
      const { data: allNavItems } = await supabase
        .from('navigation_items')
        .select('id')

      if (allNavItems) {
        for (const item of allNavItems) {
          const visible = selectedNavigationItems.includes(item.id)

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
              navigation_item_id: item.id,
              visible,
              role,
            }

          await supabase
            .from('role_navigation_permissions')
            .upsert(navPermRecord, {
              onConflict: 'role_id,navigation_item_id',
            })
        }
      }

      // Update tab permissions
      if (selectedTabPermissions.length > 0) {
        await rbacService.assignTabPermissionsToRole(
          roleId,
          selectedTabPermissions
        )
      }

      // Clear draft
      localStorage.removeItem(DRAFT_STORAGE_KEY)

      // Refresh roles
      await refreshRoles()

      // Show success
      setIsComplete(true)
      toast.success(
        `Role "${formData.displayName}" ${mode === 'create' ? 'created' : 'updated'} successfully!`
      )

      // Close after delay
      setTimeout(() => {
        onOpenChange(false)
      }, 2000)
    } catch (error) {
      logger.error('Error saving role:', error)
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to save role'
      toast.error(errorMessage)
    } finally {
      setIsSaving(false)
    }
  }

  // Progress percentage
  const progressPercentage = ((currentStep + 1) / STEPS.length) * 100

  // Render step content
  const renderStepContent = () => {
    if (isLoading) {
      return (
        <div className='flex items-center justify-center py-12'>
          <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
          <span className='text-muted-foreground ml-3'>Loading...</span>
        </div>
      )
    }

    switch (currentStep) {
      case 0: // Basic Information
        return (
          <div className='space-y-6'>
            <div className='flex items-center gap-3'>
              <div className='bg-primary text-primary-foreground flex h-10 w-10 items-center justify-center rounded-full'>
                <User className='h-5 w-5' />
              </div>
              <div>
                <h3 className='text-lg font-semibold'>Basic Information</h3>
                <p className='text-muted-foreground text-sm'>
                  Define the role name and description
                </p>
              </div>
            </div>

            <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>Role Details</CardTitle>
                </CardHeader>
                <CardContent>
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
                                disabled={mode === 'edit'}
                                onChange={(e) => {
                                  const value = e.target.value
                                    .toLowerCase()
                                    .replace(/\s+/g, '_')
                                  field.onChange(value)
                                }}
                              />
                            </FormControl>
                            <FormDescription>
                              A unique identifier (lowercase, no spaces).
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
                                placeholder='e.g., Content Editor'
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
                                placeholder='Describe the purpose of this role...'
                                className='resize-none'
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </Form>
                </CardContent>
              </Card>

              <div className='space-y-4'>
                <Card>
                  <CardHeader>
                    <CardTitle className='flex items-center gap-2 text-base'>
                      <Sparkles className='h-4 w-4' />
                      Start from Template
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <RoleTemplateSelector
                      onTemplateSelect={handleTemplateSelect}
                    />
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        )

      case 1: // Permissions
        return (
          <div className='space-y-4'>
            <div className='flex items-center gap-3'>
              <div className='bg-primary text-primary-foreground flex h-10 w-10 items-center justify-center rounded-full'>
                <Shield className='h-5 w-5' />
              </div>
              <div>
                <h3 className='text-lg font-semibold'>Permissions</h3>
                <p className='text-muted-foreground text-sm'>
                  Select the permissions this role should have
                </p>
              </div>
            </div>

            <PermissionSelector
              selectedPermissions={selectedPermissions}
              onSelectionChange={setSelectedPermissions}
              maxHeight='calc(70vh - 200px)'
            />
          </div>
        )

      case 2: // Navigation
        return (
          <div className='space-y-4'>
            <div className='flex items-center gap-3'>
              <div className='bg-primary text-primary-foreground flex h-10 w-10 items-center justify-center rounded-full'>
                <Menu className='h-5 w-5' />
              </div>
              <div>
                <h3 className='text-lg font-semibold'>Navigation Items</h3>
                <p className='text-muted-foreground text-sm'>
                  Choose which menu items will be visible to this role
                </p>
              </div>
            </div>

            <NavigationSelector
              selectedItems={selectedNavigationItems}
              onSelectionChange={setSelectedNavigationItems}
              maxHeight='calc(70vh - 200px)'
            />
          </div>
        )

      case 3: // Tab Permissions
        return (
          <div className='space-y-4'>
            <div className='flex items-center gap-3'>
              <div className='bg-primary text-primary-foreground flex h-10 w-10 items-center justify-center rounded-full'>
                <Layout className='h-5 w-5' />
              </div>
              <div>
                <h3 className='text-lg font-semibold'>Tab Permissions</h3>
                <p className='text-muted-foreground text-sm'>
                  Choose which tabs will be accessible to this role
                </p>
              </div>
            </div>

            <TabPermissionSelector
              selectedTabs={selectedTabPermissions}
              onSelectionChange={setSelectedTabPermissions}
              maxHeight='calc(70vh - 200px)'
            />
          </div>
        )

      case 4: // Review
        return (
          <div className='space-y-6'>
            <div className='flex items-center gap-3'>
              <div className='bg-primary text-primary-foreground flex h-10 w-10 items-center justify-center rounded-full'>
                <CheckCircle className='h-5 w-5' />
              </div>
              <div>
                <h3 className='text-lg font-semibold'>Review & Save</h3>
                <p className='text-muted-foreground text-sm'>
                  Review your configuration before saving
                </p>
              </div>
            </div>

            <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
              <RoleSummaryCard data={summaryData} variant='detailed' />

              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>Quick Edit</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className='text-muted-foreground mb-4 text-sm'>
                    Click on any step to make changes before saving.
                  </p>
                  <div className='space-y-2'>
                    {STEPS.slice(0, -1).map((step, index) => {
                      const StepIcon = step.icon
                      return (
                        <Button
                          key={step.id}
                          variant='outline'
                          className='w-full justify-start'
                          onClick={() => setCurrentStep(index)}
                        >
                          <StepIcon className='mr-2 h-4 w-4' />
                          {step.title}
                          <Edit className='ml-auto h-3 w-3 opacity-50' />
                        </Button>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>

            {mode === 'edit' && role && (
              <Card className='bg-muted/50'>
                <CardHeader>
                  <CardTitle className='text-base'>
                    Compare with Other Roles
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <RoleComparison
                    currentRoleId={role.id}
                    currentPermissions={selectedPermissions}
                    currentNavigationItems={selectedNavigationItems}
                    currentTabPermissions={selectedTabPermissions}
                    onCopyPermissions={setSelectedPermissions}
                    onCopyNavigation={setSelectedNavigationItems}
                    onCopyTabs={setSelectedTabPermissions}
                  />
                </CardContent>
              </Card>
            )}
          </div>
        )

      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[90vh] flex-col overflow-hidden sm:max-w-[1100px]'>
        <DialogHeader>
          <DialogTitle>
            {mode === 'create'
              ? 'Create New Role'
              : `Edit Role: ${role?.displayName || role?.name}`}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Create a comprehensive role with permissions and navigation settings.'
              : 'Modify role settings, permissions, and access controls.'}
          </DialogDescription>
        </DialogHeader>

        {/* Draft Recovery Banner */}
        {showDraftRecovery && (
          <Card className='border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'>
            <CardContent className='flex items-center justify-between py-3'>
              <div className='flex items-center gap-2'>
                <AlertTriangle className='h-5 w-5 text-amber-600' />
                <span className='text-sm'>
                  You have an unsaved draft. Would you like to recover it?
                </span>
              </div>
              <div className='flex gap-2'>
                <Button variant='outline' size='sm' onClick={clearDraft}>
                  Discard
                </Button>
                <Button size='sm' onClick={recoverDraft}>
                  Recover Draft
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Progress Indicator */}
        <div className='space-y-3 px-1'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              {STEPS.map((step, index) => {
                const StepIcon = step.icon
                const isActive = index === currentStep
                const isCompleted = index < currentStep
                const isClickable = index <= currentStep || isCompleted

                return (
                  <button
                    key={step.id}
                    type='button'
                    onClick={() => isClickable && goToStep(index)}
                    className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-all ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : isCompleted
                          ? 'bg-primary/10 text-primary hover:bg-primary/20'
                          : 'text-muted-foreground'
                    } ${isClickable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'} `}
                    disabled={!isClickable}
                  >
                    <StepIcon className='h-4 w-4' />
                    <span className='hidden md:inline'>{step.title}</span>
                    {isCompleted && <CheckCircle className='h-3 w-3' />}
                  </button>
                )
              })}
            </div>
            <div className='flex items-center gap-2'>
              {mode === 'create' && (
                <Button variant='ghost' size='sm' onClick={saveDraft}>
                  <Save className='mr-2 h-4 w-4' />
                  Save Draft
                </Button>
              )}
            </div>
          </div>
          <Progress value={progressPercentage} className='h-1' />
        </div>

        <Separator />

        {/* Step Content */}
        <div className='flex-1 overflow-hidden'>
          {isComplete ? (
            <div className='flex h-full flex-col items-center justify-center space-y-4 py-12'>
              <div className='flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30'>
                <CheckCircle className='h-8 w-8' />
              </div>
              <h3 className='text-xl font-semibold'>
                Role {mode === 'create' ? 'Created' : 'Updated'} Successfully!
              </h3>
              <p className='text-muted-foreground max-w-md text-center text-sm'>
                Your role has been {mode === 'create' ? 'created' : 'updated'}{' '}
                with the specified permissions, navigation access, and tab
                permissions.
              </p>
            </div>
          ) : (
            <ScrollArea className='h-[calc(70vh-180px)]'>
              <div className='pr-4 pb-4'>{renderStepContent()}</div>
            </ScrollArea>
          )}
        </div>

        {/* Navigation Footer */}
        {!isComplete && (
          <>
            <Separator />
            <div className='flex items-center justify-between pt-2'>
              <Button
                variant='outline'
                onClick={prevStep}
                disabled={currentStep === 0}
              >
                <ArrowLeft className='mr-2 h-4 w-4' />
                Previous
              </Button>

              <div className='text-muted-foreground flex items-center gap-2 text-sm'>
                Step {currentStep + 1} of {STEPS.length}
              </div>

              {currentStep === STEPS.length - 1 ? (
                <Button onClick={handleSubmit} disabled={isSaving}>
                  {isSaving && (
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  )}
                  {mode === 'create' ? 'Create Role' : 'Save Changes'}
                  <CheckCircle className='ml-2 h-4 w-4' />
                </Button>
              ) : (
                <Button onClick={nextStep}>
                  Next
                  <ArrowRight className='ml-2 h-4 w-4' />
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
