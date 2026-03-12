import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Search,
  Shield,
  Check,
  X,
  Copy,
  Loader2,
  MoreHorizontal,
  Eye,
  Edit,
  Trash2,
  Plus,
  FileDown,
} from 'lucide-react'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getAllPermissions } from '../../services/role.service'
import type { Permission } from './types'

export interface PermissionSelectorProps {
  selectedPermissions: string[]
  onSelectionChange: (permissions: string[]) => void
  comparisonPermissions?: string[] // For role comparison
  readOnly?: boolean
  showBulkActions?: boolean
  maxHeight?: string
}

// Permission presets for quick selection
const PERMISSION_PRESETS = [
  {
    name: 'Full Access',
    description: 'All permissions for all resources',
    filter: () => true,
  },
  {
    name: 'Read Only',
    description: 'Only view/read permissions',
    filter: (p: Permission) => p.action === 'read',
  },
  {
    name: 'Standard User',
    description: 'Read and basic create/update',
    filter: (p: Permission) => ['read', 'create', 'update'].includes(p.action),
  },
  {
    name: 'Admin',
    description: 'Full CRUD access',
    filter: (p: Permission) =>
      ['read', 'create', 'update', 'delete', 'manage'].includes(p.action),
  },
]

// Action icons mapping
const ACTION_ICONS: Record<string, React.ReactNode> = {
  create: <Plus className='h-3 w-3' />,
  read: <Eye className='h-3 w-3' />,
  update: <Edit className='h-3 w-3' />,
  delete: <Trash2 className='h-3 w-3' />,
  export: <FileDown className='h-3 w-3' />,
  manage: <Shield className='h-3 w-3' />,
}

export function PermissionSelector({
  selectedPermissions,
  onSelectionChange,
  comparisonPermissions,
  readOnly = false,
  showBulkActions = true,
  maxHeight = '400px',
}: PermissionSelectorProps) {
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedResources, setExpandedResources] = useState<Set<string>>(
    new Set()
  )

  // Load permissions from database
  useEffect(() => {
    const loadPermissions = async () => {
      setIsLoading(true)
      try {
        const perms = await getAllPermissions()
        setPermissions(perms as Permission[])
        // Expand all resources by default
        const resources = [...new Set(perms.map((p) => p.resource))]
        setExpandedResources(new Set(resources))
      } catch (error) {
        logger.error('Error loading permissions:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadPermissions()
  }, [])

  // Group permissions by resource
  const permissionsByResource = useMemo(() => {
    return permissions.reduce(
      (acc, perm) => {
        if (!acc[perm.resource]) {
          acc[perm.resource] = []
        }
        acc[perm.resource].push(perm)
        return acc
      },
      {} as Record<string, Permission[]>
    )
  }, [permissions])

  // Filter permissions based on search
  const filteredResources = useMemo(() => {
    if (!searchQuery.trim()) return Object.keys(permissionsByResource)

    const query = searchQuery.toLowerCase()
    return Object.keys(permissionsByResource).filter((resource) => {
      // Check if resource name matches
      if (resource.toLowerCase().includes(query)) return true
      // Check if any permission in this resource matches
      return permissionsByResource[resource].some(
        (perm) =>
          perm.action.toLowerCase().includes(query) ||
          perm.description?.toLowerCase().includes(query)
      )
    })
  }, [permissionsByResource, searchQuery])

  // Toggle permission
  const handlePermissionToggle = useCallback(
    (permissionId: string) => {
      if (readOnly) return

      onSelectionChange(
        selectedPermissions.includes(permissionId)
          ? selectedPermissions.filter((id) => id !== permissionId)
          : [...selectedPermissions, permissionId]
      )
    },
    [selectedPermissions, onSelectionChange, readOnly]
  )

  // Toggle all permissions for a resource
  const handleResourceToggle = useCallback(
    (resource: string) => {
      if (readOnly) return

      const resourcePermissions = permissionsByResource[resource] || []
      const resourcePermissionIds = resourcePermissions.map((p) => p.id)
      const allSelected = resourcePermissionIds.every((id) =>
        selectedPermissions.includes(id)
      )

      if (allSelected) {
        onSelectionChange(
          selectedPermissions.filter(
            (id) => !resourcePermissionIds.includes(id)
          )
        )
      } else {
        onSelectionChange([
          ...new Set([...selectedPermissions, ...resourcePermissionIds]),
        ])
      }
    },
    [permissionsByResource, selectedPermissions, onSelectionChange, readOnly]
  )

  // Apply preset
  const applyPreset = useCallback(
    (presetFilter: (p: Permission) => boolean) => {
      if (readOnly) return

      const filteredIds = permissions.filter(presetFilter).map((p) => p.id)
      onSelectionChange(filteredIds)
    },
    [permissions, onSelectionChange, readOnly]
  )

  // Select all / Clear all
  const handleSelectAll = useCallback(() => {
    if (readOnly) return
    onSelectionChange(permissions.map((p) => p.id))
  }, [permissions, onSelectionChange, readOnly])

  const handleClearAll = useCallback(() => {
    if (readOnly) return
    onSelectionChange([])
  }, [onSelectionChange, readOnly])

  // Toggle resource expand/collapse
  const toggleResourceExpand = useCallback((resource: string) => {
    setExpandedResources((prev) => {
      const next = new Set(prev)
      if (next.has(resource)) {
        next.delete(resource)
      } else {
        next.add(resource)
      }
      return next
    })
  }, [])

  // Copy from comparison (if available)
  const copyFromComparison = useCallback(() => {
    if (comparisonPermissions && !readOnly) {
      onSelectionChange([...comparisonPermissions])
    }
  }, [comparisonPermissions, onSelectionChange, readOnly])

  if (isLoading) {
    return (
      <div className='flex items-center justify-center py-12'>
        <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
        <span className='text-muted-foreground ml-2'>
          Loading permissions...
        </span>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {/* Header with search and bulk actions */}
      <div className='flex flex-col gap-3 sm:flex-row'>
        <div className='relative flex-1'>
          <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Search permissions by resource, action, or description...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className='pl-9'
          />
        </div>

        {showBulkActions && !readOnly && (
          <div className='flex gap-2'>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='outline' size='sm'>
                  <Shield className='mr-2 h-4 w-4' />
                  Presets
                  <ChevronDown className='ml-2 h-4 w-4' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-56'>
                <DropdownMenuLabel>Quick Presets</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {PERMISSION_PRESETS.map((preset) => (
                  <DropdownMenuItem
                    key={preset.name}
                    onClick={() => applyPreset(preset.filter)}
                  >
                    <div className='flex flex-col'>
                      <span className='font-medium'>{preset.name}</span>
                      <span className='text-muted-foreground text-xs'>
                        {preset.description}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='outline' size='sm'>
                  <MoreHorizontal className='h-4 w-4' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onClick={handleSelectAll}>
                  <Check className='mr-2 h-4 w-4' />
                  Select All
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleClearAll}>
                  <X className='mr-2 h-4 w-4' />
                  Clear All
                </DropdownMenuItem>
                {comparisonPermissions && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={copyFromComparison}>
                      <Copy className='mr-2 h-4 w-4' />
                      Copy from Comparison
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Summary badge */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <Shield className='text-muted-foreground h-4 w-4' />
          <span className='text-muted-foreground text-sm'>
            {selectedPermissions.length} of {permissions.length} permissions
            selected
          </span>
        </div>
        {comparisonPermissions && (
          <Badge variant='outline' className='text-xs'>
            Comparing with {comparisonPermissions.length} permissions
          </Badge>
        )}
      </div>

      {/* Permission list grouped by resource */}
      <ScrollArea style={{ height: maxHeight }} className='pr-4'>
        <div className='space-y-3'>
          {filteredResources.map((resource) => {
            const resourcePerms = permissionsByResource[resource]
            const selectedCount = resourcePerms.filter((p) =>
              selectedPermissions.includes(p.id)
            ).length
            const allSelected = selectedCount === resourcePerms.length
            const someSelected = selectedCount > 0 && !allSelected
            const isExpanded = expandedResources.has(resource)

            return (
              <Card key={resource} className='border-border/50'>
                <Collapsible
                  open={isExpanded}
                  onOpenChange={() => toggleResourceExpand(resource)}
                >
                  <CardHeader className='py-3 pb-2'>
                    <div className='flex items-center gap-3'>
                      {!readOnly && (
                        <Checkbox
                          checked={allSelected}
                          ref={(ref) => {
                            if (ref && ref instanceof HTMLButtonElement) {
                              ;(
                                ref as HTMLButtonElement & {
                                  indeterminate: boolean
                                }
                              ).indeterminate = someSelected
                            }
                          }}
                          onCheckedChange={() => handleResourceToggle(resource)}
                        />
                      )}
                      <CollapsibleTrigger asChild>
                        <div className='hover:text-primary flex flex-1 cursor-pointer items-center gap-2 transition-colors'>
                          {isExpanded ? (
                            <ChevronDown className='h-4 w-4' />
                          ) : (
                            <ChevronRight className='h-4 w-4' />
                          )}
                          <CardTitle className='text-sm font-medium capitalize'>
                            {resource.replace('_', ' ')}
                          </CardTitle>
                        </div>
                      </CollapsibleTrigger>
                      <Badge
                        variant={
                          allSelected
                            ? 'default'
                            : someSelected
                              ? 'secondary'
                              : 'outline'
                        }
                        className='text-xs'
                      >
                        {selectedCount}/{resourcePerms.length}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CollapsibleContent>
                    <CardContent className='pt-0 pb-3'>
                      <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                        {resourcePerms.map((permission) => {
                          const isSelected = selectedPermissions.includes(
                            permission.id
                          )
                          const inComparison = comparisonPermissions?.includes(
                            permission.id
                          )
                          const isDifferent =
                            comparisonPermissions !== undefined &&
                            isSelected !== inComparison

                          return (
                            <div
                              key={permission.id}
                              className={`flex items-center gap-2 rounded-md p-2 transition-colors ${isDifferent ? 'border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30' : 'hover:bg-muted/50'} ${readOnly ? 'cursor-default' : 'cursor-pointer'} `}
                              onClick={() =>
                                !readOnly &&
                                handlePermissionToggle(permission.id)
                              }
                            >
                              <Checkbox
                                checked={isSelected}
                                disabled={readOnly}
                                onCheckedChange={() =>
                                  handlePermissionToggle(permission.id)
                                }
                              />
                              <div className='flex min-w-0 flex-1 items-center gap-2'>
                                <span className='text-muted-foreground'>
                                  {ACTION_ICONS[permission.action] || (
                                    <Shield className='h-3 w-3' />
                                  )}
                                </span>
                                <div className='min-w-0 flex-1'>
                                  <div className='flex items-center gap-2'>
                                    <span className='text-sm font-medium capitalize'>
                                      {permission.action}
                                    </span>
                                    {isDifferent && (
                                      <Badge
                                        variant='outline'
                                        className='border-amber-400 text-xs text-amber-600'
                                      >
                                        {isSelected ? 'Added' : 'Removed'}
                                      </Badge>
                                    )}
                                  </div>
                                  {permission.description && (
                                    <p className='text-muted-foreground truncate text-xs'>
                                      {permission.description}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            )
          })}

          {filteredResources.length === 0 && (
            <div className='text-muted-foreground py-8 text-center'>
              <Search className='mx-auto mb-2 h-8 w-8 opacity-50' />
              <p>No permissions match your search</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
