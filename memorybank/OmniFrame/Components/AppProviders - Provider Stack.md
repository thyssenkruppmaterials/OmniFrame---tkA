---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# AppProviders - Provider Stack

## Purpose
Documents the React provider/context hierarchy that wraps the application. Providers are split between `src/main.tsx` (app-level), `src/routes/__root.tsx` (route-level), and `src/components/layout/authenticated-layout.tsx` (auth-level).

## Provider Hierarchy

```
<QueryClientProvider client={queryClient}>          // main.tsx — TanStack Query
  <ThemeProvider>                                    // main.tsx — Theme (light/dark/custom/system)
    <FontProvider>                                   // main.tsx — Font family selection
      <UnifiedAuthProvider>                          // main.tsx — Auth state + permissions + session
        <RouterProvider router={router}>             // main.tsx — TanStack Router
          <!-- __root route component: -->
          <ToastSettingsProvider>                    // __root.tsx — Toast notification config
            <SearchProvider>                         // __root.tsx — Command menu (Cmd+K)
              <AppUpdateBanner />                    // __root.tsx — PWA update banner
              <NavigationProgress />                 // __root.tsx — Route transition progress
              <Outlet />                             // Renders child routes
              <Toaster />                            // __root.tsx — Sonner toast container
              <!-- Dev only: ReactQueryDevtools + TanStackRouterDevtools -->
            </SearchProvider>
          </ToastSettingsProvider>
          <!-- _authenticated route component: -->
          <ProtectedRoute>                           // auth-layout — Route guard
            <PresenceProvider>                       // auth-layout — Online presence tracking
              <SidebarProvider>                      // auth-layout — Sidebar collapse state
                <OptimizedAppSidebar />              // Sidebar component
                <main>                               // Main content area
                  <PermissionProvider>               // PermissionProvider.tsx — auto-loads permissions
                    <Outlet />                       // Renders page content
                  </PermissionProvider>
                </main>
              </SidebarProvider>
            </PresenceProvider>
          </ProtectedRoute>
        </RouterProvider>
      </UnifiedAuthProvider>
    </FontProvider>
  </ThemeProvider>
</QueryClientProvider>
```

## Context Details

### ThemeProvider (`src/context/theme-context.tsx`)
- **State:** `theme` (light|dark|system|custom), `activePalette`, `resolvedTheme`, `isCustomTheme`, full `AppearancePreferencesV2` preferences, `customColors`
- **Features:** System dark mode detection via `matchMedia`, custom OKLCH color token system, per-mode palettes (light/dark), CSS custom property injection, radius presets
- **Persistence:** `hydratePreferences()` / `persistPreferences()` (localStorage)
- **Hook:** `useTheme()`

### FontProvider (`src/context/font-context.tsx`)
- **State:** Selected font from config list (Inter, Manrope, Geist, Plus Jakarta Sans, DM Sans, system)
- **Persistence:** localStorage key `font`
- **Effect:** Sets `font-family` CSS property on `<html>`
- **Hook:** `useFont()`

### UnifiedAuthProvider (`src/lib/auth/unified-auth-provider.tsx`)
- **The primary auth context.** Manages authentication state, permissions, session, and auth lifecycle.
- **Provides:** `authState`, `permissions`, `authActions`, `session`
- **Options:** `enableDevTools`, `onAuthChange` callback
- **Hook:** `useUnifiedAuth()` (from `src/lib/auth/unified-auth-provider`)

### SearchProvider (`src/context/search-context.tsx`)
- **State:** `open: boolean` for command palette
- **Keyboard shortcut:** Cmd/Ctrl+K toggles
- **Renders:** `<CommandMenu />` component
- **Hook:** `useSearch()`

### ToastSettingsProvider (`src/context/toast-settings-context.tsx`)
- **State:** `settings: ToastNotificationSettings`, `isLoading`
- **Actions:** `refreshSettings()`, `updateSettings()`
- **Data source:** `SettingsService.getToastSettings()` (async, loaded on mount)
- **Hook:** `useToastSettings()`

### PresenceProvider (`src/context/presence-context.tsx`)
- **Wraps:** `usePresenceTracker()` hook output
- **Provides:** Online user list, status, connection state
- **Scope:** Only available inside authenticated routes
- **Hooks:** `usePresence()` (throws if outside provider), `usePresenceOptional()` (returns null if outside)

### PermissionProvider (`src/providers/PermissionProvider.tsx`)
- **Orchestrates permission loading** by watching auth state changes
- **Dependencies:** `useUnifiedAuth` (auth-provider), `usePermissionStore`, `useNavigationStore`
- **Behavior:**
  - On user change: clears all caches, reloads permissions + navigation + tab permissions
  - Uses `role_id` (UUID) for navigation permissions instead of legacy role enum
  - On logout: clears all permission state after 500ms delay (allows auth state to stabilize)
  - Exposes `__PERMISSION_STORE__` and `__NAVIGATION_STORE__` on window for debugging
- **Hook:** `usePermissionProvider()` — returns `{ initialized: boolean }`

## Key Architecture Notes

1. **Two auth systems coexist:** `UnifiedAuthProvider` (lib/auth) and `unifiedAuthStore` (stores/). The provider is the canonical source; the store is used by some components directly.
2. **PermissionProvider bridges** the auth provider with the standalone Zustand permission/navigation stores.
3. **Contexts follow the provider-hook pattern:** each context exports both a Provider component and a `use*` hook.
4. **No context is used for server state** — all server state goes through TanStack Query.

## Related
- [[ZustandStores - State Management]]
- [[CustomHooks - React Hooks]]
- [[RoutingSystem - TanStack Router]]
- [[UnifiedAuthProvider - React Provider]]
- [[PermissionGuard - UI Components]]
- [[State-Management-Patterns]]