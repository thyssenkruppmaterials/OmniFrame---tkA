---
tags: [type/component, status/active, domain/auth, domain/frontend]
created: 2026-04-10
---
# RouteProtection - Navigation Security

## Purpose
Centralized route protection utility for TanStack Router `beforeLoad` hooks. Prevents direct URL access bypass of navigation restrictions by enforcing authentication, navigation permissions, and resource permissions at the route level.

## Key Exports / API
- `createProtectedRouteBeforeLoad(options)` — factory returning a `beforeLoad` function
- `createStandardProtectedRoute(configKey, customOptions?)` — convenience factory using predefined configs
- `ROUTE_PROTECTION_CONFIGS` — predefined route configurations (19 routes)
- `RouteProtectionOptions`, `RouteProtectionConfig` types

## Implementation Details

### Security Check Flow (4 steps)
1. **Authentication**: Validates `authService.getAuthState()` — redirects to `/sign-in` if unauthenticated or missing `role_id`.
2. **Role Resolution**: Gets `role_id` directly from user profile. Critical fix (Jan 6, 2026): custom roles like TKA supervisor were getting 403s because `profile.role` is a legacy enum.
3. **Navigation Permissions**: Queries `navigation_items` joined with `role_navigation_permissions` to check `visible=true` for the specific route URL and role.
4. **Resource Permissions** (optional): Checks `authService.checkPermission()`.
   - Admin routes (`/admin/*`): Fail-closed — denied permission blocks access.
   - Non-admin routes: Fail-open — navigation permission sufficient if resource check fails.

### Predefined Route Configs (19 routes)
Warehouse: Inventory, Inbound, Outbound, Kitting, Unit Pack, GRS, Quality, Data Manager, TKA Data Manager
Productivity: My Productivity, Shift Productivity, Standard Work
Integrations: Customer Portal, Smartsheet Integrations
Admin: User Management, Role Management, Session Management, Permissions

Each maps a `routePath` to `resourcePermission` with `{ action, resource }` pair.

### Return Value
On success, returns `{ user, profile, hasAccess: true }` as context for child routes.

## Dependencies
- `@tanstack/react-router` — `redirect` function
- `@/lib/auth/auth-service` — auth state and permission checks
- `@/lib/auth/singleton-auth-manager` — DB queries for navigation/role lookups

## Database Tables Used
- `navigation_items` — route URL -> navigation item mapping
- `role_navigation_permissions` — role -> navigation item visibility
- `roles` — role ID/name lookup (debug mode)

## Related
- [[AuthService - Unified Authentication]] — provides auth state and permission checks
- [[SingletonAuthManager - Authentication Core]] — DB query execution
- [[PermissionGuard - UI Components]] — component-level protection (complementary)
- [[RBACService - Role Based Access Control]] — underlying permission engine
- [[Architecture]] — System overview