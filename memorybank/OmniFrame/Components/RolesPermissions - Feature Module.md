---
tags: [type/component, status/active, domain/frontend, domain/admin, domain/auth]
created: 2026-04-10
---
# Roles & Permissions Management

## Purpose
Dual admin modules for comprehensive RBAC (Role-Based Access Control) administration. The **Roles** module manages role definitions, permission assignments, and role hierarchy. The **Permissions** module provides granular control over individual permission definitions (resource + action pairs). Together they form the authorization backbone of the OmniFrame platform.

## Key Components

### Roles Module (`admin/roles/`)
- **RoleManagement** (`index.tsx`) — Main page wrapped in `RolesProvider` context. Three views: Overview (card grid), Table View, Permissions Matrix
- **RolesTable** — Full data table with sorting, filtering, pagination, faceted filters
- **RoleRBACDemo** — Interactive RBAC demo/permissions matrix visualization
- **RolesPrimaryButtons** — Action bar for role creation
- **RolesDialogs** — Dialog orchestrator for all role CRUD operations
- **EnhancedRoleWizard** — Multi-step wizard for creating complex roles
- **RoleCreationWizard** — Step-by-step role creation with draft saving
- **UnifiedRoleEditor** — Full-featured role editing interface
- **DynamicRoleManager** — Dynamic role assignment management
- **PermissionMatrix** — Grid view of role-to-permission mappings
- **RoleHierarchy** — Visual role inheritance tree
- **RBACAuditLog** — Audit trail for role changes
- **ConditionalPermissionEditor** — Condition-based permission rules
- **RoleTemplates** / **RoleTemplateSelector** — Predefined role templates
- **RoleComparison** — Side-by-side role diff view
- **RoleSummaryCard** — Compact role info display
- **PermissionSelector** / **NavigationSelector** / **TabPermissionSelector** — Shared selection UIs

### Permissions Module (`admin/permissions/`)
- **PermissionManagement** (`index.tsx`) — Main page wrapped in `PermissionsProvider`. Data table of all system permissions
- **PermissionsTable** — Full data table with CRUD actions
- **PermissionsPrimaryButtons** — Create/import actions
- **PermissionsDialogs** — Dialog orchestrator
- Dialog components: `PermissionCreateDialog`, `PermissionEditDialog`, `PermissionDeleteDialog`

### Security Module (`admin/security/`)
- **SecurityDashboard** — Security monitoring dashboard with time-range selector (24h/7d/30d/90d)
- **SecurityMetrics** — Key security KPIs
- **SecurityAlerts** — Active security alerts feed
- **ActiveThreats** — Threat detection panel
- **ThreatMonitor** — Real-time threat monitoring
- **SecurityTimeline** — Chronological security event timeline
- Uses `useSecurityMonitoring` hook and `security.service.ts`

## State Management
- **RolesProvider** (`context/roles-context.tsx`) — React Context managing:
  - Role list fetched via `getRoles()` service
  - Selected/current role state
  - Dialog open states (create, edit, delete, permissions, navigation, tab-permissions, quick-edit, comparison, duplicate, wizard)
  - Draft role persistence (wizard progress saved to localStorage)
  - Edit mode tracking (`wizard` | `quick`)
  - Role duplication via `duplicateRoleService`
- **PermissionsProvider** (`context/permissions-context.tsx`) — Context for permission CRUD dialogs
- **Role Service** (`services/role.service.ts`) — Supabase-backed role CRUD operations
- **Data Schema** (`data/schema.ts`) — Zod schemas for Role and Permission validation
- **Sample Data** (`data/data.ts`) — Sample permission definitions
- **PermissionGuard** — UI-level permission checking component from `@/components/auth/PermissionGuard`

## Architecture Notes
- Permission format: `resource:action` (e.g., `users:create`, `roles:update`, `*:*` for superadmin)
- Roles have `isSystem` flag to protect built-in roles from modification
- Role cards show elevated-privilege warnings for roles containing `*:*`, `users:`, or `roles:` permissions
- Data table components follow a shared pattern: `columns`, `data-table-*` utilities, `primary-buttons`, `dialogs`
- Security dashboard fetches data via `useSecurityMonitoring(timeRangeDays)` with configurable time windows

## Related
- [[Architecture]]
- [[UserManagement - Feature Module]]
- [[PermissionGuard - UI Components]]
- [[RBACService - Role Based Access Control]]
- [[SingletonAuthManager - Authentication Core]]
- [[ADR-Auth-Architecture]]