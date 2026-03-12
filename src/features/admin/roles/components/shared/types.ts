/**
 * Shared types for Role Management components.
 *
 * Extracted from index.ts to break circular barrel imports:
 * components were importing types from ./index which also re-exports those
 * same components, creating a circular dependency chain.
 */

export interface Permission {
  id: string
  name: string
  resource: string
  action: string
  description?: string | null
}

export interface NavigationItemWithPermission {
  id: string
  title: string
  url?: string | null
  icon?: string | null
  parent_id?: string | null
  position: number
  is_active: boolean
  visible: boolean
  children?: NavigationItemWithPermission[]
}

export interface TabDefinition {
  id: string
  page_resource: string
  tab_id: string
  tab_label: string
  description?: string
  display_order: number
  is_active: boolean
}

export interface RoleTemplate {
  id: string
  name: string
  displayName: string
  description: string
  permissions: string[]
  navigationItems: string[]
  tabPermissions: string[]
  category: 'system' | 'custom'
}

export interface RoleSummaryData {
  name: string
  displayName: string
  description?: string
  permissionsCount: number
  permissionsByResource: Record<string, number>
  navigationVisibleCount: number
  navigationTotalCount: number
  tabsGrantedCount: number
  tabsTotalCount: number
}
