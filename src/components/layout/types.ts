// Created and developed by Jai Singh
import { LinkProps } from '@tanstack/react-router'

interface User {
  name: string
  email: string
  avatar: string
  initials: string
}

interface Team {
  name: string
  logo: React.ComponentType<{ className?: string }>
  plan: string
}

interface BaseNavItem {
  title: string
  badge?: string
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
  requiredPermission?: {
    action: string
    resource: string
  }
}

type NavLink = BaseNavItem & {
  url: LinkProps['to']
  items?: never
}

type NavCollapsible = BaseNavItem & {
  items: (BaseNavItem & { url: LinkProps['to'] })[]
  url?: never
}

type NavItem = NavCollapsible | NavLink

interface NavGroup {
  title: string
  items: NavItem[]
}

interface SidebarData {
  user: User
  teams: Team[]
  navGroups: NavGroup[]
}

export type { SidebarData, NavGroup, NavItem, NavCollapsible, NavLink }

// Created and developed by Jai Singh
