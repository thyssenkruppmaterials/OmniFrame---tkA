// Created and developed by Jai Singh
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Search,
  Menu,
  Eye,
  EyeOff,
  Copy,
  Loader2,
  MoreHorizontal,
  Check,
  X,
  FolderTree,
} from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { NavigationItemWithPermission } from './types'

export interface NavigationSelectorProps {
  selectedItems: string[]
  onSelectionChange: (items: string[]) => void
  comparisonItems?: string[] // For role comparison
  readOnly?: boolean
  showBulkActions?: boolean
  maxHeight?: string
}

export function NavigationSelector({
  selectedItems,
  onSelectionChange,
  comparisonItems,
  readOnly = false,
  showBulkActions = true,
  maxHeight = '400px',
}: NavigationSelectorProps) {
  const [navigationItems, setNavigationItems] = useState<
    NavigationItemWithPermission[]
  >([])
  const [flatItems, setFlatItems] = useState<NavigationItemWithPermission[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // Load navigation items from database
  useEffect(() => {
    const loadNavigationItems = async () => {
      setIsLoading(true)
      try {
        const { data: navItems, error } = await supabase
          .from('navigation_items')
          .select('*')
          .order('position')

        if (error) throw error

        // Build hierarchical navigation structure
        const itemsMap = new Map<string, NavigationItemWithPermission>()
        const rootItems: NavigationItemWithPermission[] = []
        const flat: NavigationItemWithPermission[] = []

        // Create all items first
        navItems?.forEach((item) => {
          const itemWithPermission: NavigationItemWithPermission = {
            id: item.id,
            title: item.title,
            url: item.url,
            icon: item.icon,
            parent_id: item.parent_id,
            position: item.position ?? 0,
            is_active: true, // Navigation items in the table are considered active
            visible: selectedItems.includes(item.id),
            children: [],
          }
          itemsMap.set(item.id, itemWithPermission)
          flat.push(itemWithPermission)
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
        setFlatItems(flat)

        // Expand all root items with children by default
        const expanded = new Set(
          rootItems
            .filter((item) => item.children && item.children.length > 0)
            .map((item) => item.id)
        )
        setExpandedGroups(expanded)
      } catch (error) {
        logger.error('Error loading navigation items:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadNavigationItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: run on mount only; selectedItems excluded to avoid infinite loop
  }, [])

  // Update visible status when selectedItems changes
  useEffect(() => {
    setFlatItems((prev) =>
      prev.map((item) => ({
        ...item,
        visible: selectedItems.includes(item.id),
      }))
    )
  }, [selectedItems])

  // Filter items based on search
  const filteredRootItems = useMemo(() => {
    if (!searchQuery.trim()) return navigationItems

    const query = searchQuery.toLowerCase()

    const filterItem = (
      item: NavigationItemWithPermission
    ): NavigationItemWithPermission | null => {
      const matchesSearch =
        item.title.toLowerCase().includes(query) ||
        item.url?.toLowerCase().includes(query)

      const filteredChildren = item.children
        ?.map(filterItem)
        .filter(Boolean) as NavigationItemWithPermission[] | undefined

      if (matchesSearch || (filteredChildren && filteredChildren.length > 0)) {
        return {
          ...item,
          children: filteredChildren || item.children,
        }
      }
      return null
    }

    return navigationItems
      .map(filterItem)
      .filter(Boolean) as NavigationItemWithPermission[]
  }, [navigationItems, searchQuery])

  // Toggle item visibility
  const handleItemToggle = useCallback(
    (itemId: string) => {
      if (readOnly) return

      onSelectionChange(
        selectedItems.includes(itemId)
          ? selectedItems.filter((id) => id !== itemId)
          : [...selectedItems, itemId]
      )
    },
    [selectedItems, onSelectionChange, readOnly]
  )

  // Toggle all items in a group (parent and all children)
  const handleGroupToggle = useCallback(
    (item: NavigationItemWithPermission) => {
      if (readOnly) return

      const allIds = [
        item.id,
        ...(item.children?.map((child) => child.id) || []),
      ]
      const allSelected = allIds.every((id) => selectedItems.includes(id))

      if (allSelected) {
        onSelectionChange(selectedItems.filter((id) => !allIds.includes(id)))
      } else {
        onSelectionChange([...new Set([...selectedItems, ...allIds])])
      }
    },
    [selectedItems, onSelectionChange, readOnly]
  )

  // Select all / Clear all
  const handleSelectAll = useCallback(() => {
    if (readOnly) return
    onSelectionChange(flatItems.map((item) => item.id))
  }, [flatItems, onSelectionChange, readOnly])

  const handleClearAll = useCallback(() => {
    if (readOnly) return
    onSelectionChange([])
  }, [onSelectionChange, readOnly])

  // Toggle group expand/collapse
  const toggleGroupExpand = useCallback((itemId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }, [])

  // Copy from comparison
  const copyFromComparison = useCallback(() => {
    if (comparisonItems && !readOnly) {
      onSelectionChange([...comparisonItems])
    }
  }, [comparisonItems, onSelectionChange, readOnly])

  // Calculate stats
  const visibleCount = selectedItems.length
  const totalCount = flatItems.length

  // Render a navigation item
  const renderNavigationItem = (
    item: NavigationItemWithPermission,
    level = 0
  ) => {
    const hasChildren = item.children && item.children.length > 0
    const isExpanded = expandedGroups.has(item.id)
    const isSelected = selectedItems.includes(item.id)
    const inComparison = comparisonItems?.includes(item.id)
    const isDifferent =
      comparisonItems !== undefined && isSelected !== inComparison
    const indent = level * 16

    const childrenSelected = hasChildren
      ? item.children!.filter((child) => selectedItems.includes(child.id))
          .length
      : 0
    const allChildrenSelected =
      hasChildren && childrenSelected === item.children!.length
    const someChildrenSelected =
      hasChildren && childrenSelected > 0 && !allChildrenSelected

    return (
      <div key={item.id} className='space-y-1'>
        <div
          className={`flex items-center gap-2 rounded-md p-2 transition-colors ${isDifferent ? 'border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30' : 'hover:bg-muted/50'} ${readOnly ? 'cursor-default' : 'cursor-pointer'} `}
          style={{ marginLeft: `${indent}px` }}
        >
          <Checkbox
            checked={isSelected}
            ref={(ref) => {
              if (hasChildren && ref && ref instanceof HTMLButtonElement) {
                ;(
                  ref as HTMLButtonElement & { indeterminate: boolean }
                ).indeterminate = !!(someChildrenSelected && !isSelected)
              }
            }}
            disabled={readOnly}
            onCheckedChange={() => handleItemToggle(item.id)}
          />

          {hasChildren && (
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation()
                toggleGroupExpand(item.id)
              }}
              className='hover:bg-muted rounded p-0.5'
            >
              {isExpanded ? (
                <ChevronDown className='text-muted-foreground h-4 w-4' />
              ) : (
                <ChevronRight className='text-muted-foreground h-4 w-4' />
              )}
            </button>
          )}

          <div
            className='flex min-w-0 flex-1 items-center gap-2'
            onClick={() => !readOnly && handleItemToggle(item.id)}
          >
            <Menu className='text-muted-foreground h-4 w-4' />
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-2'>
                <span className='text-sm font-medium'>{item.title}</span>
                {hasChildren && (
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-5 px-2 text-xs'
                    onClick={(e) => {
                      e.stopPropagation()
                      handleGroupToggle(item)
                    }}
                    disabled={readOnly}
                  >
                    {allChildrenSelected ? 'Deselect' : 'Select'} All (
                    {childrenSelected}/{item.children!.length})
                  </Button>
                )}
                {isDifferent && (
                  <Badge
                    variant='outline'
                    className='border-amber-400 text-xs text-amber-600'
                  >
                    {isSelected ? 'Added' : 'Removed'}
                  </Badge>
                )}
              </div>
              {item.url && (
                <Badge variant='outline' className='mt-0.5 font-mono text-xs'>
                  {item.url}
                </Badge>
              )}
            </div>
            {isSelected ? (
              <Eye className='h-4 w-4 text-green-600' />
            ) : (
              <EyeOff className='h-4 w-4 text-red-600' />
            )}
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div className='ml-4'>
            {item.children!.map((child) =>
              renderNavigationItem(child, level + 1)
            )}
          </div>
        )}
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className='flex items-center justify-center py-12'>
        <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
        <span className='text-muted-foreground ml-2'>
          Loading navigation items...
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
            placeholder='Search navigation items...'
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
                Show All Items
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleClearAll}>
                <X className='mr-2 h-4 w-4' />
                Hide All Items
              </DropdownMenuItem>
              {comparisonItems && (
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
              <FolderTree className='text-muted-foreground h-4 w-4' />
              <span className='text-sm font-medium'>Menu Visibility</span>
            </div>
            <Badge variant={visibleCount > 0 ? 'default' : 'secondary'}>
              {visibleCount} of {totalCount} items visible
            </Badge>
          </div>
        </CardHeader>
        <CardContent className='pt-0 pb-3'>
          <div className='text-muted-foreground flex items-center gap-4 text-sm'>
            <div className='flex items-center gap-1'>
              <Eye className='h-4 w-4 text-green-600' />
              <span>Visible</span>
            </div>
            <div className='flex items-center gap-1'>
              <EyeOff className='h-4 w-4 text-red-600' />
              <span>Hidden</span>
            </div>
            {comparisonItems && (
              <Badge variant='outline' className='text-xs'>
                Comparing with {comparisonItems.length} items
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Navigation items list */}
      <ScrollArea style={{ height: maxHeight }} className='pr-4'>
        <div className='space-y-1'>
          {filteredRootItems.map((item) => renderNavigationItem(item))}

          {filteredRootItems.length === 0 && (
            <div className='text-muted-foreground py-8 text-center'>
              <Search className='mx-auto mb-2 h-8 w-8 opacity-50' />
              <p>No navigation items match your search</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// Created and developed by Jai Singh
