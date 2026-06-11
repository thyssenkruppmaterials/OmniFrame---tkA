---
tags: [type/component, status/active, domain/frontend, domain/auth]
created: 2026-04-10
---
# User Management

## Purpose
Central workforce account management interface for administering user lifecycles: creation, invitation, role assignment, status management (active/pending/suspended/on-leave/terminated/inactive/deleted), permissions override, password resets, and bulk operations. Provides a comprehensive overview of organizational workforce health with status distribution visualization and attention-required alerts.

## Key Components
- **UserManagement** (`index.tsx`) — Main page wrapped in `UserManagementProvider`. Features a hero card with workforce stats, status distribution bar, and tabbed table views
- **UserManagementTable** — Data table with per-status filtering via `filter` prop (e.g., `{ status: 'active' }`, `{ include_deleted: true }`)
- **CreateUserDialog** — New user creation form with role selection
- **UserInviteDialog** — Email invitation sender for new users
- **EditUserDialog** — Edit existing user profile details
- **UserDetailsDialog** — Read-only user profile viewer
- **UserPermissionsDialog** — Per-user permission overrides (beyond role defaults)
- **PasswordResetDialog** — Admin-initiated password reset
- **UserChangeRoleDialog** — Role reassignment
- **UserStatusChangeDialog** — Status transitions with reason tracking
- **BulkActionsDialog** — Batch operations on selected users
- **DataTableToolbar** / **DataTablePagination** — Table utilities

## State Management
- **UserManagementProvider** (`context/user-management-context.tsx`) — React Context managing:
  - `users: UserProfile[]` — User list (populated by hook)
  - `selectedUsers: string[]` — Multi-select for bulk operations
  - `currentUser: UserProfile | null` — Currently focused user for dialogs
  - `filters: UserFilters` — Active filters
  - 8 dialog open states: view, edit, permissions, password-reset, change-role, status-change, bulk-actions
  - CRUD operations: `createUser`, `updateUser`, `deleteUser`, `restoreUser`, `permanentlyDeleteUser`
  - Workflow operations: `inviteUser`, `resetPassword`, `updateUserRole`, `updateUserStatus`, `updateUserStatusWithReason`, `resendInvitation`, `bulkUpdateUsers`
  - Query operations: `getUserPermissions`, `getUserActivity`, `getUserStatusHistory`
- **useUserManagement** (`hooks/use-user-management.ts`) — Custom hook providing `stats` object with: total, active, pending, suspended, on_leave, deleted, admins, newThisMonth, activePercentage
- **UserManagementService** (`services/user-management.service.ts`) — Supabase-backed user CRUD service
- **Types** (`types.ts`) — `UserProfile`, `UserFilters`, `UserManagementContextType` definitions
- **PermissionGuard** — Guards create/invite buttons with `resource='users' action='create'`

## Architecture Notes
- 8 tab views: All, Active, Pending, On Leave, Suspended, Terminated, Inactive, Deleted
- Workforce Overview Hero Card shows:
  - Total workforce count with month-over-month growth indicator
  - Color-coded status distribution bar (emerald=active, yellow=pending, orange=on-leave, red=suspended)
  - Quick stat chips grid: Active, Pending, Suspended, On Leave, Admins, Deleted
- Attention banner auto-appears when suspended users > 0 or pending invitations > 3
- Soft-delete support: deleted users can be restored or permanently deleted
- Status change operations track reason for audit trail
- Uses `@tanstack/react-query` pattern via the hook layer

## Related
- [[Architecture]]
- [[RolesPermissions - Feature Module]]
- [[Onboarding - Feature Module]]
- [[UnifiedAuthProvider - React Provider]]
- [[PermissionGuard - UI Components]]
- [[SingletonAuthManager - Authentication Core]]