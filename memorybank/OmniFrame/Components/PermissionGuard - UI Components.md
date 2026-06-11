---
tags: [type/component, status/active, domain/auth, domain/frontend]
created: 2026-04-10
---
# PermissionGuard - UI Components

## Purpose
React components and hooks for permission-gated rendering and route protection. Three layers: `PermissionGuard` (element-level), `RouteGuard` (route-level with redirects), and `ProtectedRoute` (authentication gate).

## Key Exports / API

### PermissionGuard.tsx
Memoized component that conditionally renders children based on permission checks against the Zustand `permissionStore`.

| Export | Description |
|---|---|
| `PermissionGuard` | Main guard: `resource`, `action`, optional `permissions[]` for batch |
| `ReadPermissionGuard` | Shortcut for `action='read'` |
| `WritePermissionGuard` | Shortcut for `action='write'` |
| `AdminPermissionGuard` | Shortcut for `resource='admin'`, `action='access'` |
| `BatchPermissionGuard` | Multiple permissions with `requireAll` toggle |
| `usePermissionGuard(resource, action, context?)` | Programmatic hook returning `{ hasAccess, isChecking, render }` |
| `usePermissionStats()` | Cache/loading statistics |

Fix Note (Feb 2026): Switched from unmounted auth-provider's `usePermissions` to active Zustand `permissionStore`, fixing crash.

### RouteGuard.tsx
Route-level protection combining authentication check with `PermissionGuard`.

| Export | Description |
|---|---|
| `RouteGuard` | Main route guard with redirect to `/403` on denial |
| `AdminRouteGuard` | Admin access shortcut |
| `WriteRouteGuard` / `ReadRouteGuard` | Action-specific shortcuts |
| `BatchRouteGuard` | Multiple permission route guard |
| `useRouteGuard()` | Programmatic: `checkRouteAccess(resource, action, redirectTo)` |

### ProtectedRoute.tsx
Authentication-only gate (no permission checking). Handles:
- 5-second loading timeout (shorter due to SingletonAuthManager reliability)
- Email verification check (`user.email_confirmed_at`)
- Unauthenticated redirect to `/sign-in`
- Role checking deferred to route protection layer

## Implementation Details
- **Store Integration**: All guards use `usePermissionStore` (Zustand) with `(action, resource)` argument order.
- **Memoization**: `PermissionGuard` is `React.memo` wrapped; permission key memoized via `useMemo`.
- **Loading States**: Shows spinner while store is loading.
- **Error Display**: Optional error alerts using shadcn/ui Alert component.
- **Redirect Strategy**: `RouteGuard` redirects to `/sign-in` (unauth) or `/403` (forbidden).

## Dependencies
- `@/stores/permissionStore` — Zustand permission state
- `@/hooks/use-unified-auth` — auth state hook
- `@/lib/auth/unified-auth-provider` — `useUnifiedAuth`
- `@tanstack/react-router` — navigation and location
- `lucide-react` — icons (ShieldOff, Loader2)
- `@/components/ui/alert` — error display

## Related
- [[RBACService - Role Based Access Control]] — the service that populates permission data
- [[RouteProtection - Navigation Security]] — TanStack Router `beforeLoad` protection
- [[UnifiedAuthProvider - React Provider]] — parent auth context
- [[Architecture]] — System overview