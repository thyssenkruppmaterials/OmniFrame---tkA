import React, { useState, useEffect, useMemo } from 'react'
import {
  Shield,
  AlertTriangle,
  Lock,
  Search,
  Filter,
  Save,
  RefreshCw,
  Download,
  Upload,
  AlertCircle,
  CheckCircle,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { rbacService } from '@/lib/auth/rbac-service'
import type { PermissionWithCategory } from '@/lib/auth/types'
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
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { PermissionGuard } from '@/components/auth/PermissionGuard'

interface PermissionMatrixProps {
  roleId: string | null
  onRoleChange?: (roleId: string | null) => void
  readOnly?: boolean
}

interface GroupedPermissions {
  [category: string]: {
    [resource: string]: {
      [action: string]: PermissionWithCategory
    }
  }
}

interface PermissionChange {
  permissionId: string
  granted: boolean
  reason?: string
}

const RISK_LEVEL_COLORS = {
  low: 'bg-green-100 text-green-800 border-green-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  critical: 'bg-red-100 text-red-800 border-red-200',
}

const RISK_LEVEL_ICONS = {
  low: CheckCircle,
  medium: AlertCircle,
  high: AlertTriangle,
  critical: XCircle,
}

export function PermissionMatrix({
  roleId,
  readOnly = false,
}: PermissionMatrixProps) {
  const [permissions, setPermissions] = useState<PermissionWithCategory[]>([])
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(
    new Set()
  )
  const [pendingChanges, setPendingChanges] = useState<
    Map<string, PermissionChange>
  >(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Filters and search
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [riskLevelFilter, setRiskLevelFilter] = useState<string>('all')
  const [showCriticalOnly, setShowCriticalOnly] = useState(false)
  const [show2FAOnly, setShow2FAOnly] = useState(false)
  const [showChangedOnly, setShowChangedOnly] = useState(false)

  // Dialog states
  const [dependencyDialog, setDependencyDialog] = useState(false)
  const [dependencyInfo, setDependencyInfo] = useState<{
    permission: PermissionWithCategory
    dependencies: string[]
    conflicts: string[]
  } | null>(null)

  // Load permissions when component mounts or roleId changes
  useEffect(() => {
    if (roleId) {
      loadPermissions()
      loadRolePermissions()
    } else {
      loadPermissions()
      setSelectedPermissions(new Set())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadPermissions/loadRolePermissions are stable; adding would cause unnecessary re-fetches
  }, [roleId])

  const loadPermissions = async () => {
    setIsLoading(true)
    try {
      const allPermissions = await rbacService.getPermissionsWithMetadata()
      setPermissions(allPermissions)
    } catch (error) {
      logger.error('Error loading permissions:', error)
      toast.error('Failed to load permissions')
    } finally {
      setIsLoading(false)
    }
  }

  const loadRolePermissions = async () => {
    if (!roleId) return

    try {
      // In a real implementation, this would load the specific role's permissions
      // For now, we'll simulate some selected permissions
      setSelectedPermissions(new Set(['perm-1', 'perm-2']))
    } catch (error) {
      logger.error('Error loading role permissions:', error)
      toast.error('Failed to load role permissions')
    }
  }

  // Group permissions by category and resource
  const groupedPermissions = useMemo(() => {
    return permissions.reduce<GroupedPermissions>((acc, perm) => {
      const category = perm.category_name || 'Uncategorized'
      const resource = perm.resource
      const action = perm.action

      if (!acc[category]) acc[category] = {}
      if (!acc[category][resource]) acc[category][resource] = {}
      acc[category][resource][action] = perm

      return acc
    }, {})
  }, [permissions])

  // Filter permissions based on current filters
  const filteredPermissions = useMemo(() => {
    let filtered = [...permissions]

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(
        (perm) =>
          perm.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          perm.resource.toLowerCase().includes(searchTerm.toLowerCase()) ||
          perm.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
          perm.description?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    // Category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(
        (perm) => perm.category_name === categoryFilter
      )
    }

    // Risk level filter
    if (riskLevelFilter !== 'all') {
      filtered = filtered.filter((perm) => perm.risk_level === riskLevelFilter)
    }

    // Critical only filter
    if (showCriticalOnly) {
      filtered = filtered.filter((perm) => perm.is_critical)
    }

    // 2FA only filter
    if (show2FAOnly) {
      filtered = filtered.filter((perm) => perm.requires_2fa)
    }

    // Changed only filter
    if (showChangedOnly) {
      filtered = filtered.filter((perm) => pendingChanges.has(perm.id))
    }

    return filtered
  }, [
    permissions,
    searchTerm,
    categoryFilter,
    riskLevelFilter,
    showCriticalOnly,
    show2FAOnly,
    showChangedOnly,
    pendingChanges,
  ])

  // Get unique categories and actions for the table
  const categories = useMemo(() => {
    return Array.from(
      new Set(
        filteredPermissions.map((p) => p.category_name || 'Uncategorized')
      )
    ).sort()
  }, [filteredPermissions])

  // Resources calculated inline where needed

  const actions = useMemo(() => {
    return Array.from(new Set(filteredPermissions.map((p) => p.action))).sort()
  }, [filteredPermissions])

  const handlePermissionToggle = async (permId: string, enabled: boolean) => {
    if (readOnly) return

    const permission = permissions.find((p) => p.id === permId)
    if (!permission) return

    try {
      // Check for dependencies if enabling
      if (
        enabled &&
        (permission.required_dependencies_count > 0 ||
          permission.conflicts_count > 0)
      ) {
        const validation = await rbacService.validatePermissionAssignment(
          'temp-user',
          permId
        )

        if (
          !validation.is_valid &&
          validation.missing_dependencies &&
          validation.conflicting_permissions
        ) {
          setDependencyInfo({
            permission,
            dependencies: validation.missing_dependencies,
            conflicts: validation.conflicting_permissions,
          })
          setDependencyDialog(true)
          return
        }
      }

      // Update selected permissions
      const newSelected = new Set(selectedPermissions)
      if (enabled) {
        newSelected.add(permId)
      } else {
        newSelected.delete(permId)
      }
      setSelectedPermissions(newSelected)

      // Track pending change
      const newChanges = new Map(pendingChanges)
      newChanges.set(permId, {
        permissionId: permId,
        granted: enabled,
        reason: `${enabled ? 'Granted' : 'Revoked'} via permission matrix`,
      })
      setPendingChanges(newChanges)
    } catch (error) {
      logger.error('Error toggling permission:', error)
      toast.error('Error updating permission')
    }
  }

  const handleSelectAllForResource = (resource: string) => {
    if (readOnly) return

    const resourcePermissions = filteredPermissions.filter(
      (p) => p.resource === resource
    )
    const allSelected = resourcePermissions.every((p) =>
      selectedPermissions.has(p.id)
    )

    const newSelected = new Set(selectedPermissions)
    const newChanges = new Map(pendingChanges)

    resourcePermissions.forEach((perm) => {
      if (allSelected) {
        newSelected.delete(perm.id)
        newChanges.set(perm.id, {
          permissionId: perm.id,
          granted: false,
          reason: 'Revoked via bulk action',
        })
      } else {
        newSelected.add(perm.id)
        newChanges.set(perm.id, {
          permissionId: perm.id,
          granted: true,
          reason: 'Granted via bulk action',
        })
      }
    })

    setSelectedPermissions(newSelected)
    setPendingChanges(newChanges)
  }

  const handleSaveChanges = async () => {
    if (!roleId || pendingChanges.size === 0) return

    setIsSaving(true)
    try {
      // In a real implementation, this would save the changes to the database
      await new Promise((resolve) => setTimeout(resolve, 1000)) // Simulate API call

      toast.success(`Saved ${pendingChanges.size} permission changes`)
      setPendingChanges(new Map())
    } catch (error) {
      logger.error('Error saving changes:', error)
      toast.error('Failed to save changes')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDiscardChanges = () => {
    setPendingChanges(new Map())
    loadRolePermissions()
    toast.info('Changes discarded')
  }

  const getRiskIcon = (riskLevel: string) => {
    const IconComponent =
      RISK_LEVEL_ICONS[riskLevel as keyof typeof RISK_LEVEL_ICONS] ||
      AlertCircle
    return <IconComponent className='h-3 w-3' />
  }

  const getPendingChangeIndicator = (permId: string) => {
    const change = pendingChanges.get(permId)
    if (!change) return null

    return (
      <div
        className={`absolute -top-1 -right-1 h-2 w-2 rounded-full ${
          change.granted ? 'bg-green-500' : 'bg-red-500'
        }`}
      />
    )
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className='flex items-center justify-center py-8'>
          <div className='border-primary h-8 w-8 animate-spin rounded-full border-b-2'></div>
          <span className='ml-3'>Loading permissions...</span>
        </CardContent>
      </Card>
    )
  }

  return (
    <PermissionGuard resource='permissions' action='read' showError>
      <div className='space-y-4'>
        <div className='flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
          <div>
            <h3 className='flex items-center gap-2 text-lg font-semibold'>
              <Shield className='h-5 w-5' />
              Permission Matrix
              {roleId && (
                <Badge variant='outline' className='ml-2'>
                  Role Selected
                </Badge>
              )}
            </h3>
            <p className='text-muted-foreground text-sm'>
              Manage permissions for roles with dependency validation
            </p>
          </div>

          {!readOnly && (
            <div className='flex flex-wrap gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setShowChangedOnly(!showChangedOnly)}
                className={showChangedOnly ? 'bg-accent' : ''}
              >
                <Filter className='mr-2 h-4 w-4' />
                Changes ({pendingChanges.size})
              </Button>
              <Button variant='outline' size='sm'>
                <Download className='mr-2 h-4 w-4' />
                Export
              </Button>
              <Button variant='outline' size='sm'>
                <Upload className='mr-2 h-4 w-4' />
                Import
              </Button>
              {pendingChanges.size > 0 && (
                <>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={handleDiscardChanges}
                  >
                    Discard
                  </Button>
                  <PermissionGuard resource='permissions' action='update'>
                    <Button
                      size='sm'
                      onClick={handleSaveChanges}
                      disabled={isSaving}
                    >
                      {isSaving ? (
                        <RefreshCw className='mr-2 h-4 w-4 animate-spin' />
                      ) : (
                        <Save className='mr-2 h-4 w-4' />
                      )}
                      Save Changes
                    </Button>
                  </PermissionGuard>
                </>
              )}
            </div>
          )}
        </div>

        {/* Filters */}
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6'>
          <div className='relative'>
            <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform' />
            <Input
              placeholder='Search permissions...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='pl-9'
            />
          </div>

          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger>
              <SelectValue placeholder='All Categories' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Categories</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={riskLevelFilter} onValueChange={setRiskLevelFilter}>
            <SelectTrigger>
              <SelectValue placeholder='All Risk Levels' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Risk Levels</SelectItem>
              <SelectItem value='low'>Low</SelectItem>
              <SelectItem value='medium'>Medium</SelectItem>
              <SelectItem value='high'>High</SelectItem>
              <SelectItem value='critical'>Critical</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant='outline'
            size='sm'
            onClick={() => setShowCriticalOnly(!showCriticalOnly)}
            className={showCriticalOnly ? 'bg-accent' : ''}
          >
            <AlertTriangle className='mr-2 h-4 w-4' />
            Critical Only
          </Button>

          <Button
            variant='outline'
            size='sm'
            onClick={() => setShow2FAOnly(!show2FAOnly)}
            className={show2FAOnly ? 'bg-accent' : ''}
          >
            <Lock className='mr-2 h-4 w-4' />
            2FA Required
          </Button>

          <div className='text-muted-foreground flex items-center text-sm'>
            Showing {filteredPermissions.length} of {permissions.length}{' '}
            permissions
          </div>
        </div>

        {/* Permission Matrix Table */}
        <Card>
          <ScrollArea className='h-[600px]'>
            <div className='p-4'>
              <table className='w-full'>
                <thead className='bg-background sticky top-0 z-10 border-b'>
                  <tr>
                    <th className='p-3 text-left font-medium'>Resource</th>
                    {actions.map((action) => (
                      <th
                        key={action}
                        className='min-w-[100px] p-3 text-center font-medium'
                      >
                        <div className='capitalize'>{action}</div>
                      </th>
                    ))}
                    <th className='p-3 text-center font-medium'>All</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((category) => (
                    <React.Fragment key={category}>
                      <tr className='bg-muted/30'>
                        <td
                          colSpan={actions.length + 2}
                          className='p-3 text-sm font-semibold'
                        >
                          <div className='flex items-center gap-2'>
                            <Shield className='h-4 w-4' />
                            {category}
                          </div>
                        </td>
                      </tr>
                      {Object.entries(groupedPermissions[category] || {}).map(
                        ([resource, perms]) => {
                          const resourcePerms = Object.values(perms)
                          const allSelected = resourcePerms.every((p) =>
                            selectedPermissions.has(p.id)
                          )

                          return (
                            <tr
                              key={`${category}-${resource}`}
                              className='hover:bg-muted/20 border-b'
                            >
                              <td className='p-3'>
                                <div className='font-medium'>{resource}</div>
                                <div className='text-muted-foreground text-xs'>
                                  {resourcePerms.length} permissions
                                </div>
                              </td>
                              {actions.map((action) => {
                                const perm = perms[action]
                                if (!perm)
                                  return (
                                    <td
                                      key={action}
                                      className='text-muted-foreground p-3 text-center'
                                    >
                                      -
                                    </td>
                                  )

                                const isSelected = selectedPermissions.has(
                                  perm.id
                                )
                                const hasChange = pendingChanges.has(perm.id)

                                return (
                                  <td key={action} className='p-3 text-center'>
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div className='relative inline-flex items-center'>
                                            <Checkbox
                                              checked={isSelected}
                                              onCheckedChange={(checked) =>
                                                handlePermissionToggle(
                                                  perm.id,
                                                  checked as boolean
                                                )
                                              }
                                              disabled={readOnly}
                                              className={` ${perm.is_critical ? 'border-red-500' : ''} ${hasChange ? 'animate-pulse' : ''} `}
                                            />
                                            {getPendingChangeIndicator(perm.id)}
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent
                                          side='top'
                                          className='max-w-xs'
                                        >
                                          <div className='space-y-2'>
                                            <div className='font-medium'>
                                              {perm.name}
                                            </div>
                                            <div className='text-xs'>
                                              {perm.description}
                                            </div>
                                            <div className='flex flex-wrap gap-1'>
                                              <Badge
                                                variant='outline'
                                                className={`text-xs ${RISK_LEVEL_COLORS[perm.risk_level || 'low']}`}
                                              >
                                                {getRiskIcon(
                                                  perm.risk_level || 'low'
                                                )}
                                                {perm.risk_level || 'low'}
                                              </Badge>
                                              {perm.is_critical && (
                                                <Badge
                                                  variant='destructive'
                                                  className='text-xs'
                                                >
                                                  Critical
                                                </Badge>
                                              )}
                                              {perm.requires_2fa && (
                                                <Badge
                                                  variant='secondary'
                                                  className='text-xs'
                                                >
                                                  <Lock className='mr-1 h-3 w-3' />
                                                  2FA
                                                </Badge>
                                              )}
                                            </div>
                                            {perm.required_dependencies_count >
                                              0 && (
                                              <div className='text-muted-foreground text-xs'>
                                                Requires{' '}
                                                {
                                                  perm.required_dependencies_count
                                                }{' '}
                                                dependencies
                                              </div>
                                            )}
                                          </div>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </td>
                                )
                              })}
                              <td className='p-3 text-center'>
                                {!readOnly && (
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    onClick={() =>
                                      handleSelectAllForResource(resource)
                                    }
                                    className='text-xs'
                                  >
                                    {allSelected ? 'None' : 'All'}
                                  </Button>
                                )}
                              </td>
                            </tr>
                          )
                        }
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </ScrollArea>
        </Card>

        {/* Dependency Dialog */}
        <AlertDialog open={dependencyDialog} onOpenChange={setDependencyDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className='flex items-center gap-2'>
                <AlertTriangle className='h-5 w-5 text-yellow-500' />
                Permission Dependencies
              </AlertDialogTitle>
              <AlertDialogDescription>
                This permission has dependencies or conflicts that need to be
                resolved:
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className='space-y-4'>
              {dependencyInfo?.dependencies &&
                dependencyInfo.dependencies.length > 0 && (
                  <div>
                    <h4 className='mb-2 text-sm font-medium text-red-600'>
                      Missing Dependencies:
                    </h4>
                    <ul className='space-y-1 text-sm'>
                      {dependencyInfo.dependencies.map((dep, index) => (
                        <li key={index} className='flex items-center gap-2'>
                          <XCircle className='h-4 w-4 text-red-500' />
                          {dep}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              {dependencyInfo?.conflicts &&
                dependencyInfo.conflicts.length > 0 && (
                  <div>
                    <h4 className='mb-2 text-sm font-medium text-yellow-600'>
                      Conflicts:
                    </h4>
                    <ul className='space-y-1 text-sm'>
                      {dependencyInfo.conflicts.map((conflict, index) => (
                        <li key={index} className='flex items-center gap-2'>
                          <AlertTriangle className='h-4 w-4 text-yellow-500' />
                          {conflict}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  // Force the permission change despite dependencies
                  if (dependencyInfo) {
                    handlePermissionToggle(dependencyInfo.permission.id, true)
                  }
                  setDependencyDialog(false)
                }}
              >
                Grant Anyway
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </PermissionGuard>
  )
}
