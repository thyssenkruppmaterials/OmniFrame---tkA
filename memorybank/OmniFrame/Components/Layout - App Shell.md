---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# Layout - App Shell

## Purpose
Documents the authenticated application shell - the top-level layout wrapping all protected pages. Built with a collapsible sidebar, breadcrumb navigation, command palette, session management, and presence awareness.

## Architecture

### AuthenticatedLayout (`authenticated-layout.tsx`)
The root layout for all authenticated routes. Wraps content in:
1. `ProtectedRoute` - auth guard
2. `PresenceProvider` - real-time presence context
3. `SidebarProvider` - sidebar state management (cookie-persisted via `sidebar_state`)

**Key features:**
- Sidebar state persisted to cookies (`sidebar_state`)
- Route tracking via `useRouteTracker()` for post-login restoration
- Idle recovery system (`useIdleRecovery`) with 3-min idle threshold
- Session timeout with warning modal (`useSessionTimeout` + `SessionExpiryModal`)
- Skip-to-main accessibility link
- Command palette (Ctrl+K / Cmd+K)
- Uses `<Outlet />` from TanStack Router for nested route rendering

### Content Area
The main content div responds to sidebar state with CSS transitions:
```
peer-data-[state=collapsed]:w-[calc(100%-var(--sidebar-width-icon)-1rem)]
peer-data-[state=expanded]:w-[calc(100%-var(--sidebar-width))]
```
Layout uses `h-svh` for full viewport height with `flex flex-col`.

## Sidebar System

### OptimizedAppSidebar (`optimized-app-sidebar.tsx`)
Performance-optimized sidebar replacing the original `AppSidebar`. Structure:
- **SidebarHeader** -> `TeamSwitcher` (team/org selector)
- **SidebarContent** -> `OptimizedNavGroup` items (RBAC-filtered navigation)
- **SidebarSeparator** + `OnlineUsersPanel` (presence, conditionally rendered)
- **SidebarFooter** -> `NavUser` (user profile/actions)
- **SidebarRail** - resize rail

**Props:** `collapsible='icon'`, `variant='floating'`

**Sidebar dimensions** (from `sidebar.tsx`):
- Width: `16rem` (expanded), `3rem` (collapsed/icon)
- Mobile width: `18rem`
- Keyboard shortcut: `b` to toggle
- Cookie: `sidebar_state` (7-day expiry)

### NavGroup / OptimizedNavGroup (`nav-group.tsx`, `optimized-nav-group.tsx`)
Rendering sidebar navigation items with:
- **RBAC filtering** via `useRBAC()` and `useNavigationPermissions()`
- Three rendering modes based on sidebar state:
  - **Expanded:** `SidebarMenuCollapsible` with animated chevron (Framer Motion)
  - **Collapsed (desktop):** `SidebarMenuCollapsedDropdown` with dropdown menu
  - **Simple link:** `SidebarMenuLink`
- Sub-item staggered animations with `motion.div`

### RBACNavGroup (`rbac-nav-group.tsx`)
RBAC-enhanced variant that integrates permission checks directly.

### TeamSwitcher (`team-switcher.tsx`)
Dropdown in sidebar header for switching teams/organizations. Adapts to collapsed state by hiding text and showing only the logo icon.

### NavUser (`nav-user.tsx`)
User profile section in the sidebar footer with avatar, name, and dropdown actions.

## Header & Breadcrumbs

### Header (`header.tsx`)
Top bar with:
- `SidebarTrigger` button (toggles sidebar)
- Vertical `Separator`
- Scroll-aware shadow (appears after 10px scroll)
- Optional `fixed` mode with sticky positioning
- Height: `h-16` (4rem)

### AppBreadcrumbs (`breadcrumbs.tsx`)
Automatic breadcrumb generation from TanStack Router matches:
- Uses `useMatches()` to extract route chain
- Skips layout routes (`_authenticated`, `__root`)
- Maps paths to human-readable labels via `routeLabels` lookup table
- Fallback: converts kebab-case segments to Title Case
- Home icon as root breadcrumb
- ~68 pre-defined route labels covering apps, admin, settings, etc.

### Main (`main.tsx`)
Simple `<main>` wrapper with:
- Responsive padding: `px-4 py-6`
- Header offset: `peer-[.header-fixed]/header:mt-16`
- Optional `fixed` mode for overflow-hidden layouts

## Command Palette (`command-palette.tsx`)
- Triggered by `Ctrl+K` / `Cmd+K`
- Uses `CommandDialog` from cmdk integration
- Flattens sidebar nav structure into searchable items
- RBAC-filtered: only shows pages user can access
- Groups results by nav section
- Navigates via TanStack Router on selection

## Type Definitions (`types.ts`)
```typescript
interface SidebarData {
  user: User             // name, email, avatar, initials
  teams: Team[]          // name, logo component, plan
  navGroups: NavGroup[]  // navigation groups
}

type NavItem = NavCollapsible | NavLink
interface BaseNavItem {
  title: string
  badge?: string
  icon?: React.ComponentType
  requiredPermission?: { action: string; resource: string }
}
```

## Data Layer
- `sidebar-data.ts` / `sidebar-data-new.ts` - Functions that generate `SidebarData` from user/profile, defining all navigation structure

## Layout File Listing (16 files)
- `authenticated-layout.tsx` - Root authenticated layout
- `optimized-app-sidebar.tsx` - Optimized sidebar (primary)
- `app-sidebar.tsx` - Original sidebar (legacy)
- `optimized-nav-group.tsx` - Optimized nav group
- `rbac-nav-group.tsx` - RBAC nav group
- `nav-group.tsx` - Base nav group with animations
- `nav-user.tsx` - User profile footer
- `team-switcher.tsx` - Team selector header
- `header.tsx` - Top header bar
- `main.tsx` - Main content wrapper
- `breadcrumbs.tsx` - Auto breadcrumbs
- `command-palette.tsx` - Cmd+K command palette
- `top-nav.tsx` - Top navigation component
- `types.ts` - Type definitions
- `data/sidebar-data.ts` - Sidebar navigation data
- `data/sidebar-data-new.ts` - Updated sidebar data

## Related
- [[UILibrary - Component Catalog]]
- [[SingletonAuthManager - Authentication Core]]
- [[RBACService - Role Based Access Control]]
- [[UnifiedAuthProvider - React Provider]]
- [[SessionManager - Session Lifecycle]]


## Sidebar nav (2026-04-14)
`sidebar-data.ts` no longer lists Tasks, Business Applications, Intelligence Hub, or Facility IT/Vendor Management. See [[Prune-Sidebar-Nav-Placeholders]].
