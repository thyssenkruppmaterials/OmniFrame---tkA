import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Search,
  Layout,
  Eye,
  EyeOff,
  Copy,
  Loader2,
  MoreHorizontal,
  Check,
  X,
  Info,
} from 'lucide-react'
import { rbacService } from '@/lib/auth/rbac-service'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { TabDefinition } from './types'

export interface TabPermissionSelectorProps {
  selectedTabs: string[]
  onSelectionChange: (tabs: string[]) => void
  comparisonTabs?: string[] // For role comparison
  readOnly?: boolean
  showBulkActions?: boolean
  maxHeight?: string
}

export function TabPermissionSelector({
  selectedTabs,
  onSelectionChange,
  comparisonTabs,
  readOnly = false,
  showBulkActions = true,
  maxHeight = '400px',
}: TabPermissionSelectorProps) {
  const [tabDefinitions, setTabDefinitions] = useState<TabDefinition[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedResources, setExpandedResources] = useState<Set<string>>(
    new Set()
  )

  // Load tab definitions from database
  useEffect(() => {
    const loadTabDefinitions = async () => {
      setIsLoading(true)
      try {
        const tabs = await rbacService.getAllTabDefinitions()
        setTabDefinitions(tabs)

        // Expand all resources by default
        const resources = [...new Set(tabs.map((t) => t.page_resource))]
        setExpandedResources(new Set(resources))
      } catch (error) {
        logger.error('Error loading tab definitions:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadTabDefinitions()
  }, [])

  // Group tabs by page resource
  const tabsByResource = useMemo(() => {
    const grouped = tabDefinitions.reduce(
      (acc, tab) => {
        if (!acc[tab.page_resource]) {
          acc[tab.page_resource] = []
        }
        acc[tab.page_resource].push(tab)
        return acc
      },
      {} as Record<string, TabDefinition[]>
    )

    // Sort tabs within each resource by display order
    Object.keys(grouped).forEach((resource) => {
      grouped[resource].sort((a, b) => a.display_order - b.display_order)
    })

    return grouped
  }, [tabDefinitions])

  // Filter resources based on search
  const filteredResources = useMemo(() => {
    if (!searchQuery.trim()) return Object.keys(tabsByResource)

    const query = searchQuery.toLowerCase()
    return Object.keys(tabsByResource).filter((resource) => {
      // Check if resource name matches
      if (resource.toLowerCase().includes(query)) return true
      // Check if any tab in this resource matches
      return tabsByResource[resource].some(
        (tab) =>
          tab.tab_label.toLowerCase().includes(query) ||
          tab.tab_id.toLowerCase().includes(query) ||
          tab.description?.toLowerCase().includes(query)
      )
    })
  }, [tabsByResource, searchQuery])

  // Toggle tab selection
  const handleTabToggle = useCallback(
    (tabId: string) => {
      if (readOnly) return

      onSelectionChange(
        selectedTabs.includes(tabId)
          ? selectedTabs.filter((id) => id !== tabId)
          : [...selectedTabs, tabId]
      )
    },
    [selectedTabs, onSelectionChange, readOnly]
  )

  // Toggle all tabs for a resource
  const handleResourceToggle = useCallback(
    (resource: string) => {
      if (readOnly) return

      const resourceTabs = tabsByResource[resource] || []
      const resourceTabIds = resourceTabs.map((t) => t.id)
      const allSelected = resourceTabIds.every((id) =>
        selectedTabs.includes(id)
      )

      if (allSelected) {
        onSelectionChange(
          selectedTabs.filter((id) => !resourceTabIds.includes(id))
        )
      } else {
        onSelectionChange([...new Set([...selectedTabs, ...resourceTabIds])])
      }
    },
    [tabsByResource, selectedTabs, onSelectionChange, readOnly]
  )

  // Select all / Clear all
  const handleSelectAll = useCallback(() => {
    if (readOnly) return
    onSelectionChange(tabDefinitions.map((t) => t.id))
  }, [tabDefinitions, onSelectionChange, readOnly])

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

  // Copy from comparison
  const copyFromComparison = useCallback(() => {
    if (comparisonTabs && !readOnly) {
      onSelectionChange([...comparisonTabs])
    }
  }, [comparisonTabs, onSelectionChange, readOnly])

  // Format resource name for display
  const formatResourceName = (resource: string) => {
    return resource.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
  }

  // Calculate stats
  const grantedCount = selectedTabs.length
  const totalCount = tabDefinitions.length

  if (isLoading) {
    return (
      <div className='flex items-center justify-center py-12'>
        <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
        <span className='text-muted-foreground ml-2'>
          Loading tab definitions...
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
            placeholder='Search tabs by page, name, or description...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className='pl-9'
          />
        </div>

        {showBulkActions && !readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='outline' size='sm'>
                <MoreHorizontal className='h-4 w-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={handleSelectAll}>
                <Check className='mr-2 h-4 w-4' />
                Grant All Tabs
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleClearAll}>
                <X className='mr-2 h-4 w-4' />
                Revoke All Tabs
              </DropdownMenuItem>
              {comparisonTabs && (
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
        )}
      </div>

      {/* Summary */}
      <Card className='bg-muted/50'>
        <CardHeader className='py-3'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <Info className='text-muted-foreground h-4 w-4' />
              <span className='text-sm font-medium'>Tab Access Summary</span>
            </div>
            <Badge variant={grantedCount > 0 ? 'default' : 'secondary'}>
              {grantedCount} of {totalCount} tabs accessible
            </Badge>
          </div>
        </CardHeader>
        <CardContent className='pt-0 pb-3'>
          <div className='text-muted-foreground flex items-center gap-4 text-sm'>
            <div className='flex items-center gap-1'>
              <Eye className='h-4 w-4 text-green-600' />
              <span>Accessible</span>
            </div>
            <div className='flex items-center gap-1'>
              <EyeOff className='h-4 w-4 text-red-600' />
              <span>Restricted</span>
            </div>
            {comparisonTabs && (
              <Badge variant='outline' className='text-xs'>
                Comparing with {comparisonTabs.length} tabs
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tab definitions grouped by resource */}
      <ScrollArea style={{ height: maxHeight }} className='pr-4'>
        <div className='space-y-3'>
          {filteredResources.map((resource) => {
            const resourceTabs = tabsByResource[resource]
            const selectedCount = resourceTabs.filter((t) =>
              selectedTabs.includes(t.id)
            ).length
            const allSelected = selectedCount === resourceTabs.length
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
                          <CardTitle className='text-sm font-medium'>
                            {formatResourceName(resource)}
                          </CardTitle>
                        </div>
                      </CollapsibleTrigger>
                      <p className='text-muted-foreground text-xs'>
                        {resourceTabs.length} tabs
                      </p>
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
                        {selectedCount}/{resourceTabs.length}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CollapsibleContent>
                    <CardContent className='pt-0 pb-3'>
                      <div className='space-y-2'>
                        {resourceTabs.map((tab) => {
                          const isSelected = selectedTabs.includes(tab.id)
                          const inComparison = comparisonTabs?.includes(tab.id)
                          const isDifferent =
                            comparisonTabs !== undefined &&
                            isSelected !== inComparison

                          return (
                            <div
                              key={tab.id}
                              className={`flex items-center gap-2 rounded-lg border p-3 transition-colors ${isDifferent ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30' : 'hover:bg-muted/50'} ${readOnly ? 'cursor-default' : 'cursor-pointer'} `}
                              onClick={() =>
                                !readOnly && handleTabToggle(tab.id)
                              }
                            >
                              <Checkbox
                                checked={isSelected}
                                disabled={readOnly}
                                onCheckedChange={() => handleTabToggle(tab.id)}
                              />
                              <div className='flex min-w-0 flex-1 items-center gap-2'>
                                <Layout className='text-muted-foreground h-4 w-4' />
                                <div className='min-w-0 flex-1'>
                                  <div className='flex items-center gap-2'>
                                    <span className='text-sm font-medium'>
                                      {tab.tab_label}
                                    </span>
                                    <Badge
                                      variant='outline'
                                      className='font-mono text-xs'
                                    >
                                      {tab.tab_id}
                                    </Badge>
                                    {isDifferent && (
                                      <Badge
                                        variant='outline'
                                        className='border-amber-400 text-xs text-amber-600'
                                      >
                                        {isSelected ? 'Added' : 'Removed'}
                                      </Badge>
                                    )}
                                  </div>
                                  {tab.description && (
                                    <p className='text-muted-foreground mt-1 text-xs'>
                                      {tab.description}
                                    </p>
                                  )}
                                </div>
                                {isSelected ? (
                                  <Eye className='h-4 w-4 text-green-600' />
                                ) : (
                                  <EyeOff className='h-4 w-4 text-red-600' />
                                )}
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
              <p>No tabs match your search</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
