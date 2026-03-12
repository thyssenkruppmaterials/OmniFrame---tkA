import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { useNavigationPermissions } from '@/hooks/use-navigation-permissions'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { getSidebarData } from '@/components/layout/data/sidebar-data'
import type { NavGroup, NavItem } from '@/components/layout/types'

interface FlatNavItem {
  title: string
  url: string
  icon?: React.ElementType
  group: string
}

/**
 * Recursively flatten nav items from sidebar data into a flat list,
 * expanding collapsible items and preserving their group context.
 */
function flattenNavItems(navGroups: NavGroup[]): FlatNavItem[] {
  const items: FlatNavItem[] = []

  for (const group of navGroups) {
    for (const item of group.items) {
      collectItems(item, group.title, items)
    }
  }

  return items
}

function collectItems(
  item: NavItem,
  group: string,
  result: FlatNavItem[]
): void {
  if ('url' in item && item.url) {
    result.push({
      title: item.title,
      url: item.url as string,
      icon: item.icon,
      group,
    })
  }

  if ('items' in item && item.items) {
    for (const child of item.items) {
      result.push({
        title: child.title,
        url: child.url as string,
        icon: child.icon ?? item.icon,
        group,
      })
    }
  }
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { hasNavigationAccessByUrl } = useNavigationPermissions()
  const { authState } = useUnifiedAuth()
  const { user, profile } = authState

  // Build flattened, permission-filtered navigation items
  const navItems = useMemo(() => {
    const sidebarData = getSidebarData(user, profile)
    const flat = flattenNavItems(sidebarData.navGroups)
    return flat.filter((item) => hasNavigationAccessByUrl(item.url))
  }, [user, profile, hasNavigationAccessByUrl])

  // Group items by their nav group for display
  const groupedItems = useMemo(() => {
    const groups = new Map<string, FlatNavItem[]>()
    for (const item of navItems) {
      const existing = groups.get(item.group)
      if (existing) {
        existing.push(item)
      } else {
        groups.set(item.group, [item])
      }
    }
    return groups
  }, [navItems])

  // Listen for Ctrl+K / Cmd+K
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      setOpen((prev) => !prev)
    }
  }, [])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Navigate to selected item and close palette
  const handleSelect = useCallback(
    (url: string) => {
      setOpen(false)
      navigate({ to: url })
    },
    [navigate]
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title='Command Palette'
      description='Search and navigate to any page'
      showCloseButton={false}
    >
      <CommandInput placeholder='Type to search...' />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {Array.from(groupedItems.entries()).map(([group, items]) => (
          <CommandGroup key={group} heading={group}>
            {items.map((item) => {
              const Icon = item.icon
              return (
                <CommandItem
                  key={item.url}
                  value={`${item.title} ${item.group}`}
                  onSelect={() => handleSelect(item.url)}
                >
                  {Icon && <Icon className='mr-2 size-4 shrink-0' />}
                  <span>{item.title}</span>
                  {item.url === '/' && <CommandShortcut>Home</CommandShortcut>}
                </CommandItem>
              )
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
