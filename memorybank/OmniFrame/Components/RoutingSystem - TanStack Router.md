---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# RoutingSystem - TanStack Router

## Purpose
The application uses TanStack Router (file-based routing) defined in `src/routes/`. Routes are organized by authentication status and functional domain.

## Route Structure

```
src/routes/
├── __root.tsx                          # Root layout (ToastSettings, Search, Toaster)
├── (auth)/                             # Public auth routes (pathless group)
│   ├── sign-in.tsx                     # /sign-in
│   ├── sign-in-2.tsx                   # /sign-in-2 (alternate)
│   ├── sign-up.tsx                     # /sign-up
│   ├── forgot-password.tsx             # /forgot-password
│   ├── otp.tsx                         # /otp
│   └── rf-signin.tsx                   # /rf-signin (RF scanner login)
├── (errors)/                           # Error pages (pathless group)
│   ├── 401.tsx                         # Unauthorized
│   ├── 403.tsx                         # Forbidden
│   ├── 404.tsx                         # Not Found
│   ├── 500.tsx                         # Server Error
│   └── 503.tsx                         # Service Unavailable
├── _authenticated/                     # Protected routes (requires auth)
│   ├── route.tsx                       # Auth guard (beforeLoad → AuthenticatedLayout)
│   ├── index.tsx                       # / (dashboard)
│   ├── admin/                          # Admin section
│   │   ├── route.tsx                   # Admin guard (resource: admin, action: read)
│   │   ├── user-management/index.tsx
│   │   ├── roles/index.tsx
│   │   ├── permissions/index.tsx
│   │   ├── session-management.tsx
│   │   ├── device-manager.tsx
│   │   ├── work-queue/index.tsx
│   │   ├── onboarding/index.tsx
│   │   ├── system-settings.tsx
│   │   ├── performance-monitor.tsx
│   │   ├── sap-testing.tsx
│   │   └── tab-permissions-debug.tsx
│   ├── apps/                           # Core application modules
│   │   ├── inbound.tsx
│   │   ├── outbound.tsx
│   │   ├── inventory.tsx
│   │   ├── kitting.tsx
│   │   ├── quality.tsx
│   │   ├── grs.tsx
│   │   ├── shift-productivity.tsx
│   │   ├── my-productivity.tsx
│   │   ├── data-manager.tsx
│   │   ├── tka-data-manager.tsx
│   │   ├── unit-pack.tsx
│   │   ├── standard-work.tsx
│   │   ├── customer-portal.tsx
│   │   └── smartsheet-integrations.tsx
│   ├── business/                       # Business operations
│   │   ├── warehouse.tsx
│   │   ├── inventory.tsx
│   │   ├── logistics.tsx
│   │   ├── transportation.tsx
│   │   ├── supply-chain.tsx
│   │   ├── engineering.tsx
│   │   └── customer-service.tsx
│   ├── facility/                       # Facility management
│   │   ├── maintenance.tsx
│   │   ├── security.tsx
│   │   ├── it-services.tsx
│   │   └── vendor-management.tsx
│   ├── hr/                             # Human resources
│   │   ├── employee-reviews.tsx
│   │   └── time-tracker.tsx
│   ├── intelligence/                   # Intelligence & automation
│   │   ├── ai-chat.tsx
│   │   └── drone-control.tsx
│   ├── settings/                       # User settings
│   │   ├── route.tsx                   # Settings layout
│   │   ├── index.tsx
│   │   ├── account.tsx
│   │   ├── appearance.tsx
│   │   ├── display.tsx
│   │   ├── notifications.tsx
│   │   ├── organization.tsx
│   │   └── cache.tsx
│   ├── tasks/index.tsx                 # Task management
│   └── help-center/index.tsx           # Help/docs
├── rf-interface/                       # RF scanner PWA (standalone)
│   └── index.tsx
├── customer-portal/                    # External customer portal
│   ├── index.tsx
│   └── $ticketId.tsx                   # Dynamic ticket route
└── timeclockapp/                       # Time clock PWA (standalone)
    └── index.tsx
```

## Route Protection

### Layer 1: `_authenticated/route.tsx` (Authentication Guard)
- Uses `beforeLoad` hook to validate session via `authService.validateSession()`
- Redirects to `/sign-in` with `redirect` search param preserving full path
- Returns `{ user, profile, permissions, roles }` to child routes
- Renders `AuthenticatedLayout` component

### Layer 2: Sub-route Guards (Permission Guard)
- Admin routes use `createProtectedRouteBeforeLoad()` from `src/lib/auth/route-protection.ts`
- Example: `/_authenticated/admin/route.tsx` requires `{ action: 'read', resource: 'admin' }`
- Redirects to `/403` on permission failure

### Key Patterns
- **Pathless groups:** `(auth)` and `(errors)` use TanStack Router's pathless group syntax — no `/auth/` prefix in URLs
- **Layout routes:** `_authenticated`, `admin`, `settings` define `route.tsx` as layout wrappers with `<Outlet />`
- **Dynamic segments:** `customer-portal/$ticketId.tsx` uses `$` for dynamic params
- **Standalone PWAs:** `rf-interface/`, `customer-portal/`, `timeclockapp/` are separate entry points for specialized devices

## Root Route Configuration

```typescript
createRootRouteWithContext<{ queryClient: QueryClient }>()()
```

- Passes `queryClient` via router context for use in `beforeLoad` / `loader` functions
- Sets `notFoundComponent: NotFoundError` and `errorComponent: GeneralError`

## Route Tracking

- `useRouteTracker` hook (in `AuthenticatedLayout`) subscribes to `router.onResolved` events
- Saves the current path to `unifiedAuthStore.lastVisitedPath`
- Filters out auth pages (`/sign-in`, `/sign-up`, `/forgot-password`, `/500`, `/403`)
- Used for post-login path restoration

## Related
- [[AppProviders - Provider Stack]]
- [[RouteProtection - Navigation Security]]
- [[CustomHooks - React Hooks]]
- [[ZustandStores - State Management]]