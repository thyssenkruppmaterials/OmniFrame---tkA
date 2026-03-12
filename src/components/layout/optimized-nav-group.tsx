import { ReactNode, useMemo } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { useNavigationStore } from '@/stores/navigationStore'
import { logger } from '@/lib/utils/logger'
import { useOptimizedNavigationPermissions } from '@/hooks/use-optimized-navigation-permissions'
import { useOptimizedRBAC } from '@/hooks/use-optimized-rbac'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Badge } from '../ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { NavCollapsible, NavItem, NavLink, type NavGroup } from './types'

export function OptimizedNavGroup({ title, items }: NavGroup) {
  const { state, isMobile } = useSidebar()
  const { hasPermission } = useOptimizedRBAC()
  const { hasNavigationAccessByUrl } = useOptimizedNavigationPermissions()
  const href = useLocation({ select: (location) => location.href })

  // Get loading states for dependency tracking
  const { isLoading: isPermissionLoading, permissions: _permissions } =
    useOptimizedRBAC()
  const { isLoading: isNavLoading, navigationPermissions } =
    useOptimizedNavigationPermissions()

  // Memoize filtered items with proper dependency tracking to force re-render when permissions load
  const visibleItems = useMemo(() => {
    // Debug logging removed to prevent infinite render loops
    // Uncomment only for debugging specific navigation filtering issues:
    // logger.log('=== OPTIMIZED NAV GROUP FILTERING DEBUG ===')
    // logger.log('Title:', title)
    // logger.log('Total items:', items.length)
    // logger.log('Items:', items)
    // logger.log('Permission loading:', isPermissionLoading, 'Nav loading:', isNavLoading)
    // logger.log('Permissions count:', permissions?.length || 0)
    // logger.log('Navigation permissions count:', navigationPermissions?.length || 0)

    // ✅ SECURITY FIX: Prevent flash of unauthorized content during loading
    // Instead of showing ALL items during loading, show only safe public items
    if (
      isPermissionLoading ||
      (isNavLoading && navigationPermissions?.length === 0)
    ) {
      logger.log(
        '🔄 Loading state detected - showing only safe items to prevent flash of unauthorized content'
      )

      // Only show truly public items that don't require permissions (like Dashboard, Help Center)
      const safeItems = items.filter((item) => {
        // Dashboard and Help Center are typically safe for all users
        return (
          item.title === 'Dashboard' ||
          item.title === 'Help Center' ||
          !item.requiredPermission
        ) // Items that don't require any permissions
      })

      logger.log(
        '🔒 Showing',
        safeItems.length,
        'safe items during permission loading:',
        safeItems.map((i) => i.title)
      )
      return safeItems
    }

    return items.filter((item) => {
      logger.log('Filtering item:', item.title, 'URL:', item.url)

      // 🔧 FIXED: Navigation permissions are PRIMARY, resource permissions are supplementary
      // This prevents legitimate users from losing menu access after hard refresh

      // First check navigation permissions (most important for menu visibility)
      if (item.url) {
        const hasNavPerm = hasNavigationAccessByUrl(item.url)
        logger.log(
          '🔐 Navigation permission check for',
          item.title,
          ':',
          hasNavPerm
        )

        // Navigation permission is the primary gate for menu visibility
        if (!hasNavPerm) {
          logger.log(
            '🚫 Navigation permission denied - hiding item:',
            item.title
          )
          return false
        }

        logger.log('✅ Navigation permission granted for', item.title)

        // Resource permissions: enforce strictly for admin items, lenient for others
        if (item.requiredPermission) {
          const hasPerm = hasPermission(
            item.requiredPermission.action,
            item.requiredPermission.resource
          )
          logger.log('Resource permission check for', item.title, ':', hasPerm)

          if (!hasPerm) {
            // For admin items, enforce resource permission strictly - hide the item
            const isAdminItem = item.url?.startsWith('/admin')
            if (isAdminItem) {
              logger.log(
                '🚫 Resource permission denied for admin item - hiding:',
                item.title
              )
              return false
            }
            // For non-admin items, allow if navigation permission grants access
            logger.log(
              '⚠️ Resource permission denied but navigation allows:',
              item.title
            )
          }
        }

        return true // Navigation permission granted = show item
      }

      // For items without URL, fall back to resource permission only
      if (item.requiredPermission) {
        const hasPerm = hasPermission(
          item.requiredPermission.action,
          item.requiredPermission.resource
        )
        logger.log('Resource permission check for', item.title, ':', hasPerm)
        return hasPerm
      }

      // For items without required permission, check navigation permissions only
      if (item.url && !hasNavigationAccessByUrl(item.url)) {
        logger.log('❌ Navigation access denied for:', item.url)
        return false
      }

      // If no specific permission required, show the item (if navigation allows)
      return true
    })
  }, [
    items,
    hasNavigationAccessByUrl,
    hasPermission,
    isPermissionLoading,
    isNavLoading,
    navigationPermissions?.length,
  ])

  // Don't render the group if no items are visible AND permissions are not loading
  // This prevents the race condition where groups disappear during permission loading
  if (visibleItems.length === 0 && !isPermissionLoading && !isNavLoading)
    return null

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{title}</SidebarGroupLabel>
      <SidebarMenu>
        {visibleItems.map((item) => {
          const key = `${item.title}-${item.url}`

          if (!item.items)
            return <SidebarMenuLink key={key} item={item} href={href} />

          if (state === 'collapsed' && !isMobile)
            return (
              <SidebarMenuCollapsedDropdown key={key} item={item} href={href} />
            )

          return <SidebarMenuCollapsible key={key} item={item} href={href} />
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}

const NavBadge = ({ children }: { children: ReactNode }) => (
  <Badge className='rounded-full px-1 py-0 text-xs'>{children}</Badge>
)

const SidebarMenuLink = ({ item, href }: { item: NavLink; href: string }) => {
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={checkIsActive(href, item)}
        tooltip={item.title}
      >
        <Link to={item.url} onClick={() => setOpenMobile(false)}>
          {item.icon && <item.icon />}
          <span>{item.title}</span>
          {item.badge && <NavBadge>{item.badge}</NavBadge>}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

const SidebarMenuCollapsible = ({
  item,
  href,
}: {
  item: NavCollapsible
  href: string
}) => {
  const { setOpenMobile } = useSidebar()
  const {
    hasPermission,
    isLoading: isPermissionLoading,
    permissions: _collapsiblePermissions,
  } = useOptimizedRBAC()
  const {
    hasNavigationAccessByUrl,
    isLoading: isNavLoading,
    navigationPermissions: _collapsibleNavPerms,
  } = useOptimizedNavigationPermissions()
  const { expandedGroups, setGroupExpanded } = useNavigationStore()

  // Step 16: Determine open state from persisted store, falling back to active-child check
  const groupId = item.title
  const isOpen =
    expandedGroups[groupId] !== undefined
      ? expandedGroups[groupId]
      : checkIsActive(href, item, true)

  const handleOpenChange = (open: boolean) => {
    setGroupExpanded(groupId, open)
  }

  // Memoize filtered sub-items to prevent recalculation
  const visibleSubItems = useMemo(() => {
    return item.items.filter((subItem) => {
      logger.log(
        '🔍 Collapsible filtering item:',
        subItem.title,
        'URL:',
        subItem.url
      )

      // ROBUST PERMISSION CHECKING FOR NESTED ITEMS: Handle warehouse apps gracefully
      if (subItem.requiredPermission) {
        // First check resource permissions (action-based permissions) - these are more reliable
        const hasPerm = hasPermission(
          subItem.requiredPermission.action,
          subItem.requiredPermission.resource
        )
        logger.log('Resource permission check for', subItem.title, ':', hasPerm)

        // If user has resource permission, check navigation permissions as PRIMARY authorization
        if (subItem.url) {
          const hasNavPerm = hasNavigationAccessByUrl(subItem.url)
          logger.log(
            '🔐 STRICT Nested navigation permission check for',
            subItem.title,
            ':',
            hasNavPerm
          )

          // STRICT ENFORCEMENT: Navigation permissions are AUTHORITATIVE for nested items
          if (!hasNavPerm) {
            logger.log(
              '🚫 STRICT: Nested navigation permission denied - hiding item:',
              subItem.title
            )
            return false
          }

          logger.log(
            '✅ STRICT: Nested navigation permission granted for',
            subItem.title
          )
          return true // Both permissions required and granted
        }

        // No resource permission = definitely deny
        if (!hasPerm) {
          logger.log(
            '❌ Resource permission denied for nested item:',
            subItem.title
          )
          return false
        }
      }

      // For items without required permission, check navigation permissions only
      if (subItem.url && !hasNavigationAccessByUrl(subItem.url)) {
        logger.log('❌ Navigation access denied for nested item:', subItem.url)
        return false
      }

      return true
    })
  }, [
    item.items,
    hasNavigationAccessByUrl,
    hasPermission,
    isPermissionLoading,
    isNavLoading,
    _collapsiblePermissions?.length,
    _collapsibleNavPerms?.length,
  ])

  if (visibleSubItems.length === 0 && !isPermissionLoading && !isNavLoading)
    return null

  return (
    <Collapsible
      asChild
      open={isOpen}
      onOpenChange={handleOpenChange}
      className='group/collapsible'
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={item.title}>
            {item.icon && <item.icon />}
            <span>{item.title}</span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
            <motion.span
              className='ml-auto inline-flex'
              animate={{ rotate: isOpen ? 90 : 0 }}
              transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <ChevronRight className='size-4' />
            </motion.span>
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent className='CollapsibleContent'>
          <SidebarMenuSub>
            {visibleSubItems.map((subItem, index) => (
              <SidebarMenuSubItem key={subItem.title}>
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={
                    isOpen ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }
                  }
                  transition={{
                    duration: 0.25,
                    delay: isOpen ? index * 0.05 : 0,
                    ease: [0.25, 0.1, 0.25, 1],
                  }}
                >
                  <SidebarMenuSubButton
                    asChild
                    isActive={checkIsActive(href, subItem)}
                  >
                    <Link to={subItem.url} onClick={() => setOpenMobile(false)}>
                      {subItem.icon && <subItem.icon />}
                      <span>{subItem.title}</span>
                      {subItem.badge && <NavBadge>{subItem.badge}</NavBadge>}
                    </Link>
                  </SidebarMenuSubButton>
                </motion.div>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

const SidebarMenuCollapsedDropdown = ({
  item,
  href,
}: {
  item: NavCollapsible
  href: string
}) => {
  const {
    hasPermission,
    isLoading: isPermissionLoading,
    permissions: _dropdownPermissions,
  } = useOptimizedRBAC()
  const {
    hasNavigationAccessByUrl,
    isLoading: isNavLoading,
    navigationPermissions: _dropdownNavPerms,
  } = useOptimizedNavigationPermissions()

  // Memoize filtered sub-items to prevent recalculation
  const visibleSubItems = useMemo(() => {
    return item.items.filter((subItem) => {
      // Check navigation visibility first
      if (subItem.url && !hasNavigationAccessByUrl(subItem.url)) {
        return false
      }

      // Then check resource permissions
      if (subItem.requiredPermission) {
        return hasPermission(
          subItem.requiredPermission.action,
          subItem.requiredPermission.resource
        )
      }

      return true
    })
  }, [
    item.items,
    hasNavigationAccessByUrl,
    hasPermission,
    isPermissionLoading,
    isNavLoading,
    _dropdownPermissions?.length,
    _dropdownNavPerms?.length,
  ])

  if (visibleSubItems.length === 0 && !isPermissionLoading && !isNavLoading)
    return null

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            tooltip={item.title}
            isActive={checkIsActive(href, item)}
          >
            {item.icon && <item.icon />}
            <span>{item.title}</span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
            <ChevronRight className='ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90' />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side='right' align='start' sideOffset={4}>
          <DropdownMenuLabel>
            {item.title} {item.badge ? `(${item.badge})` : ''}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {visibleSubItems.map((sub) => (
            <DropdownMenuItem key={`${sub.title}-${sub.url}`} asChild>
              <Link
                to={sub.url}
                className={`${checkIsActive(href, sub) ? 'bg-secondary' : ''}`}
              >
                {sub.icon && <sub.icon />}
                <span className='max-w-52 text-wrap'>{sub.title}</span>
                {sub.badge && (
                  <span className='ml-auto text-xs'>{sub.badge}</span>
                )}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

function checkIsActive(href: string, item: NavItem, mainNav = false) {
  return (
    href === item.url || // /endpint?search=param
    href.split('?')[0] === item.url || // endpoint
    !!item?.items?.filter((i) => i.url === href).length || // if child nav is active
    (mainNav &&
      href.split('/')[1] !== '' &&
      href.split('/')[1] === item?.url?.split('/')[1])
  )
}
