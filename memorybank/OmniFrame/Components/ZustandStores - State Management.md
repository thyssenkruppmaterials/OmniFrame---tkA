---
tags: [type/component, status/active, domain/frontend, domain/auth]
created: 2026-04-10
---
# ZustandStores - State Management

## Purpose
All client-side global state is managed through Zustand stores located in `src/stores/`. There are 6 stores covering authentication, permissions, navigation, device management, and warehouse mapping.

## Store Inventory

### 1. `unifiedAuthStore.ts` — `useUnifiedAuth`
**The primary auth store.** Enterprise-grade, replaces older `supabaseAuthStore`, `permissionStore`, and `navigationStore` into a single unified surface. Uses `subscribeWithSelector` + `persist` middleware.

**State shape:**
- **Core Auth:** `user`, `session`, `profile`, `isLoading`, `isAuthenticated`, `isInitializing`
- **Permissions:** `permissions: string[]`, `userPermissions`, `isPermissionsLoading`, `permissionsError`, `permissionsLastLoadTime`, `currentUserId`
- **Navigation:** `navigationPermissions: NavigationPermission[]`, `isNavigationLoading`, `currentRole`
- **Tab Permissions:** `tabPermissions: TabPermission[]`, `isTabPermissionsLoading`
- **Cache:** `cacheStats: CacheStats`, `lastCacheRefresh`
- **Session:** `sessionExpiresAt`, `lastSessionCheck`, `lastVisitedPath`
- **Metrics:** `metrics: PerformanceMetrics` (tracks permission check counts, avg times, error counts)
- **Error:** `error: AuthError | null`

**Key actions:**
- Auth: `signIn`, `signUp`, `signOut`, `resetPassword`, `updatePassword`, `refreshSession`, `checkSession`, `fetchProfile`, `updateProfile`
- Permissions: `loadPermissions(userId, useCache?)`, `hasPermission(action, resource)`, `hasAnyPermission`, `hasAllPermissions`, `invalidateUserPermissions`
- Navigation: `loadNavigationPermissions(role)`, `hasNavigationAccess(name)`, `hasNavigationAccessByUrl(url)`
- Tab: `loadTabPermissions(userId, pageResource?)`, `hasTabPermission`, `getAllowedTabs`
- Cache: `warmCache()`, `clearCache()`, `getCacheStats()`, `optimizeCache()`
- Lifecycle: `initialize()`, `destroy()`, `healthCheck()`

**Persistence:** Only persists non-sensitive data: `sessionExpiresAt`, `lastSessionCheck`, `currentUserId`, `currentRole`, `lastVisitedPath`

**Cache integration:** Uses `distributedCacheService` (Redis) for permissions, navigation, and tab permissions. Also registers with `rbacCacheManager` for unified cache invalidation.

**Convenience hooks exported:**
- `useAuth()` — core auth only
- `usePermissions()` — permission state + actions
- `useNavigation()` — navigation permissions
- `useTabPermissions()` — tab-level permissions

**TTL constants:**
- Permission cache: 5 min
- Navigation cache: 10 min
- Tab cache: 5 min
- Session check interval: 30 sec
- Cache warm interval: 15 min
- Metrics reset: 24 hours

---

### 2. `permissionStore.ts` — `usePermissionStore`
**Standalone RBAC permission store** with its own caching layer. Uses `persist` middleware with localStorage.

**State:** `permissions: string[]`, `userPermissions`, `tabPermissions`, `isLoading`, `isTabLoading`, `currentUserId`, `lastLoadTime`, `lastTabLoadTime`

**Caching architecture:** Uses 4 external Map caches (outside Zustand for cross-instance sharing):
- `permissionCache` — full permission sets per user
- `tabPermissionCache` — tab permissions per user+page
- `quickPermissionCache` — individual check results (2-min TTL)
- `globalLoadingState` — prevents concurrent loads

**Key behaviors:**
- Fail-closed security: denies access while loading or on error
- Idle recovery: detects empty permissions for authenticated users, triggers async reload
- Exponential backoff retry on fetch failures (3 retries)
- Tab permissions loaded on-demand per page, not bulk
- Merges tab permissions by resource to preserve existing loaded pages

**Convenience hooks:** `usePermissions`, `useTabPermissions`, `useHasPermission`, `useHasTabPermission`, `useCheckPermission`, `usePermissionActions`, `useTabPermissionActions`, `useRBAC`

---

### 3. `navigationStore.ts` — `useNavigationStore`
**Navigation permission store** controlling sidebar/menu visibility. Uses `persist` middleware.

**State:** `navigationPermissions`, `isLoading`, `error`, `currentRole`, `currentRoleName`, `lastLoadTime`, `expandedGroups`

**Key features:**
- Handles both role name and role UUID (auto-detects with regex)
- Retry with exponential backoff (3 attempts: 300ms, 600ms, 1.2s)
- Quick navigation cache (5-min TTL) for URL access checks
- Admin override: superadmin/admin roles default to accessible
- Nuclear cache clear for specific scenarios (hard refresh, TKA associate role)
- Expanded nav group state persisted per user in localStorage
- Fallback: minimal navigation (dashboard + help center) on network failure

**Convenience hooks:** `useNavigationPermissions`, `useNavigationAccess`, `useNavigationActions`, `useNavigation`

---

### 4. `supabaseAuthStore.ts` — `useSupabaseAuth`
**Legacy auth store** — the original Supabase auth implementation. Still present for backward compatibility. Uses `persist` middleware. Only persists `profile` (not user/session — Supabase handles those).

**Also exports:**
- `useAuthStore` — legacy compatibility wrapper
- `useAuth()` — creates legacy-compatible `AuthUser` objects

---

### 5. `warehouse-map-store.ts` — `useWarehouseMapStore`
**UI state store for the warehouse visual map.** No middleware. Pure synchronous state.

**State:** `selectedMapId`, `selectedWarehouseCode`, `selectedZoneId`, `selectedRackId`, `selectedLocationId`, `selectedLocationIds` (multi-select), `editMode` (view|edit-building|edit-zones|edit-racks), `activeDataLayer` (status|stock|utilization|activity), `viewport` (x, y, scale), `sidebarPanel`, `searchQuery`, `highlightedBin`, `isListMode`, `isDraftDirty`, `publishConflict`, `showDiagnostics`, `undoStack`, `redoStack`

**Undo/redo:** Supports push, undo, redo, and clear operations on an action stack.

**Viewport controls:** `zoomIn`, `zoomOut`, `fitToView` (auto-calculate scale from bounds)

---

### 6. `deviceManagerStore.ts` — `useDeviceManagerStore`
**UI state for the device management module.** No middleware. Manages device fleet filtering, command drafts, and approval workflows.

**State:** `selectedDeviceId`, `selectedGroupId`, `fleetFilters` (search, status, model, osVersion, groupId, enrollmentType, complianceStatus), `commandDraftState`, `approvalModalOpen`, `approvalCommandId`, `mapMode` (live|history|geofence), `liveRefreshEnabled`

## Architecture Notes

- **Unified vs. Standalone:** The `unifiedAuthStore` is the canonical auth store designed for 100k+ concurrent users. The `permissionStore` and `navigationStore` are standalone alternatives used by `PermissionProvider`. The `supabaseAuthStore` is legacy.
- **All permission stores register with `rbacCacheManager`** for coordinated cache invalidation across layers.
- **Stores use `singletonAuthManager.executeRead/executeWrite`** for database operations (not raw Supabase client) to ensure connection pooling.

## Related
- [[AuthService - Unified Authentication]]
- [[SingletonAuthManager - Authentication Core]]
- [[AuthCache - Caching Layer]]
- [[RBACService - Role Based Access Control]]
- [[AppProviders - Provider Stack]]
- [[CustomHooks - React Hooks]]
- [[State-Management-Patterns]]