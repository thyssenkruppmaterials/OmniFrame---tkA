---
tags: [type/component, status/active, domain/auth]
created: 2026-04-10
---
# RBACService - Role Based Access Control

## Purpose
Comprehensive RBAC engine providing fine-grained permission checking with conditional (time-based) permissions, role hierarchy inheritance, tab/navigation permissions, temporary permission grants, and audit logging. The most feature-rich permission service in the auth stack.

## Key Exports / API
- `RBACService` class (singleton via `getInstance()`)
- `rbacService` — module-level singleton
- Re-exported types: `Permission`, `PermissionCheckResult`, `PermissionWithCategory`, `Role`, `RoleWithHierarchy`, `UserRole`, `UserPermission`, `RolePermission`

### Core Methods
| Category | Method | Description |
|---|---|---|
| Permission Checks | `checkPermission(userId, resource, action, context)` | Full check with conditional evaluation, 2-min cache |
| | `hasAnyPermission(userId, permissions[])` | OR check across multiple permissions |
| | `hasAllPermissions(userId, permissions[])` | AND check across multiple permissions |
| | `checkConditionalPermission(userId, resource, action)` | Server-side RPC for definitive check |
| Permission Data | `getUserPermissions(userId)` | String array of `resource:action` |
| | `getUserPermissionsDetailed(userId)` | Full `PermissionWithCategory[]` |
| | `getPermissionsWithMetadata(ids?)` | Enhanced permissions with category defaults |
| Role Management | `getUserRoles(userId)` | `RoleWithHierarchy[]` from `user_profiles.role_id` |
| | `createRole(data)` | Create new role |
| | `assignRoleToUser(userId, roleId)` | Update user's role_id |
| Tab Permissions | `checkTabPermission(userId, pageResource, tabId)` | RPC-based tab access check |
| | `getUserTabPermissions(userId, pageResource?)` | All tab permissions for user |
| Navigation | `assignNavigationPermissionsToRole(roleId, navItemIds)` | Via backend API endpoint |
| Temporary Grants | `grantTemporaryPermission(userId, permId, hours, reason)` | Time-limited permission |
| Hierarchy | `getUserEffectivePermissionsWithHierarchy(userId)` | Inherited via `get_inherited_roles` RPC |
| Validation | `validatePermissionAssignment(userId, permId)` | Check dependencies and conflicts |

## Implementation Details

### Conditional Permissions (Time-Based)
Evaluates `role_permissions.conditions` JSONB:
```
{ time: { allowed_days: ["1","2","3","4","5"], start_time: "08:00", end_time: "17:00" } }
```
- DOW: 0=Sunday through 6=Saturday
- Supports `AND` / `OR` condition logic via `condition_logic` column
- Temporal bounds via `valid_from` / `valid_to` columns
- IP/geo restrictions handled server-side by Rust Core Service

### Permission Resolution Order
1. Role-based permissions (via `user_profiles.role_id` -> `role_permissions`)
2. Direct user permissions (`user_permissions` where `granted=true`)
3. Conditional evaluation (time-based, temporal bounds)
4. Wildcard matching (`*` resource or action)

### Cache Integration
Registers with `rbacCacheManager` as `'rbac-service'` layer. Uses `authCache` (tag-based LRU):
- Permission checks: 2-min TTL
- Permission lists: 5-min TTL
- Role data: 10-min TTL
- System data (all permissions/roles): 15-min TTL

### Admin Operations
Tab and navigation permission assignments route through backend API endpoints (`/api/admin/roles/:roleId/...`) to bypass RLS policies.

## Database Tables Used
- `user_profiles`, `roles`, `permissions`
- `role_permissions` (with conditions JSONB)
- `user_permissions` (direct grants)
- `user_tab_permissions`, `tab_definitions`
- `role_navigation_permissions`, `navigation_items`
- `audit_logs`, `permission_dependencies`, `permission_conflicts`

## Dependencies
- `@/lib/auth/singleton-auth-manager` — DB query execution
- `@/lib/cache/auth-cache` — LRU cache
- `@/lib/auth/cache-manager` — unified cache invalidation

## Related
- [[AuthService - Unified Authentication]] — higher-level service with overlapping permission checks
- [[SingletonAuthManager - Authentication Core]] — DB execution layer
- [[AuthCache - Caching Layer]] — underlying cache
- [[RouteProtection - Navigation Security]] — route-level enforcement
- [[PermissionGuard - UI Components]] — React components consuming permission data
- [[ADR-Auth-Architecture]] — architectural decisions
- [[Architecture]] — System overview