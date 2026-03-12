// Shared components for Role Management
export {
  PermissionSelector,
  type PermissionSelectorProps,
} from './PermissionSelector'
export {
  NavigationSelector,
  type NavigationSelectorProps,
} from './NavigationSelector'
export {
  TabPermissionSelector,
  type TabPermissionSelectorProps,
} from './TabPermissionSelector'
export { RoleComparison, type RoleComparisonProps } from './RoleComparison'
export { RoleSummaryCard, type RoleSummaryCardProps } from './RoleSummaryCard'
export {
  RoleTemplateSelector,
  type RoleTemplateSelectorProps,
} from './RoleTemplateSelector'

// Shared types (re-exported from dedicated types file to avoid circular barrel imports)
export type {
  Permission,
  NavigationItemWithPermission,
  TabDefinition,
  RoleTemplate,
  RoleSummaryData,
} from './types'
