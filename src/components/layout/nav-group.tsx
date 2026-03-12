import { ReactNode, useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { useNavigationPermissions } from '@/hooks/use-navigation-permissions'
import { useRBAC } from '@/hooks/use-rbac'
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

export function NavGroup({ title, items }: NavGroup) {
  const { state, isMobile } = useSidebar()
  const { hasPermission } = useRBAC()
  const { hasNavigationAccessByUrl } = useNavigationPermissions()
  const href = useLocation({ select: (location) => location.href })

  // Filter items based on both permissions and navigation visibility
  const visibleItems = items.filter((item) => {
    // Check navigation visibility first (role-based menu permissions)
    if (item.url && !hasNavigationAccessByUrl(item.url)) {
      return false
    }

    // Then check resource permissions (action-based permissions)
    if (item.requiredPermission) {
      return hasPermission(
        item.requiredPermission.action,
        item.requiredPermission.resource
      )
    }

    // If no specific permission required, show the item (if navigation allows)
    return true
  })

  // Don't render the group if no items are visible
  if (visibleItems.length === 0) return null

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
  const { hasPermission } = useRBAC()
  const { hasNavigationAccessByUrl } = useNavigationPermissions()
  const [isOpen, setIsOpen] = useState(() => checkIsActive(href, item, true))

  // Filter sub-items based on both permissions and navigation visibility
  const visibleSubItems = item.items.filter((subItem) => {
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

  // Don't render if no sub-items are visible
  if (visibleSubItems.length === 0) return null

  return (
    <Collapsible
      asChild
      open={isOpen}
      onOpenChange={setIsOpen}
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
  const { hasPermission } = useRBAC()
  const { hasNavigationAccessByUrl } = useNavigationPermissions()

  // Filter sub-items based on both permissions and navigation visibility
  const visibleSubItems = item.items.filter((subItem) => {
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

  // Don't render if no sub-items are visible
  if (visibleSubItems.length === 0) return null

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
