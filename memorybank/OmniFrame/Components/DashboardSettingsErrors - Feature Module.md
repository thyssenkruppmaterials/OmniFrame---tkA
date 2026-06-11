---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# Dashboard, Settings & Error Pages

## Purpose
Three foundational feature modules: the **Dashboard** serves as the landing page with a cinematic welcome experience; **Settings** provides user-level account and preference configuration with role-gated organization settings; **Error Pages** handle HTTP error states (403, 404, 500, maintenance) with consistent branded UX.

## Key Components

### Dashboard (`features/dashboard/`)
- **Dashboard** (`index.tsx`) — Welcome/landing page featuring:
  - `CinematicLogo` — Animated brand logo component
  - `Typewriter` — Cycling welcome messages ("Welcome {name}", "to OmniFrame", "Single Solution Provider", "Super Intelligent") with configurable speed, delays, and cursor animation
  - User display name resolution with cascading fallbacks: full_name → first+last → first → username → email prefix → "Guest User"
- **Overview** (`components/overview.tsx`) — Business overview component
- **RecentSales** (`components/recent-sales.tsx`) — Recent sales activity
- **FastAPIAnalytics** (`components/fastapi-analytics.tsx`) — FastAPI backend analytics integration

### Settings (`features/settings/`)
- **Settings** (`index.tsx`) — Layout shell with sidebar navigation using `@tanstack/react-router` `Outlet` for nested routes
- **SidebarNav** — Settings category navigation with icons
- **ContentSection** — Settings content wrapper component
- **ProfileForm** (`profile/profile-form.tsx`) — User profile editing (name, avatar, bio)
- **AccountForm** (`account/account-form.tsx`) — Account settings (email, password change)
- **AppearanceForm** (`appearance/appearance-form.tsx`) — Theme and visual preferences
- **NotificationsForm** (`notifications/notifications-form.tsx`) — Notification channel preferences
- **DisplayForm** (`display/display-form.tsx`) — Display density and formatting preferences
- **OrganizationForm** (`organization/organization-form.tsx`) — Organization settings (admin/superadmin only)
- Settings pages: Profile, Account, Appearance, Notifications, Display, Cache Management + Organization (admin-gated)

### Error Pages (`features/errors/`)
- **GeneralError** (`general-error.tsx`) — 500 error page with Go Back / Back to Home actions. Supports `minimal` prop for embedded use (hides 500 heading)
- **NotFoundError** (`not-found-error.tsx`) — 404 page with navigation actions
- **ForbiddenError** (`forbidden.tsx`) — 403 access denied page with navigation actions
- **UnauthorizedError** (`unauthorized-error.tsx`) — 401 authentication required page
- **MaintenanceError** (`maintenance-error.tsx`) — Maintenance mode page

## State Management
- **Dashboard** — Reads from `useUnifiedAuth()` for user profile data (authState.user, authState.profile)
- **Settings** — Uses `useUnifiedAuth()` for role-based menu visibility (`profile?.role === 'superadmin' || 'admin'` gates Organization tab). Each form manages its own local state
- **Error Pages** — Stateless; uses `@tanstack/react-router` `useNavigate` and `useRouter().history` for navigation

## Architecture Notes
- Settings uses nested routing via `<Outlet />` — each settings page is a child route rendered inside the settings layout
- Organization settings conditionally injected into sidebar nav at index 1 (after Profile) for admin users
- Cache Management settings page available to all users
- Error pages follow consistent pattern: large status code, message, Go Back + Home buttons
- Dashboard is intentionally minimal — primarily a branded welcome experience rather than a data dashboard
- All error pages use `h-svh` (viewport height) for full-screen centered layout

## Related
- [[Architecture]]
- [[UnifiedAuthProvider - React Provider]]
- [[SingletonAuthManager - Authentication Core]]
- [[RouteProtection - Navigation Security]]