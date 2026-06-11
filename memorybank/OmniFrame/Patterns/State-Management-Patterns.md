---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-04-10
---
# State Management Patterns

## Purpose
Documents the state management strategy across the OneBox application, covering when to use each tool and the patterns that govern state flow.

## Three-Tier State Architecture

| Tier | Tool | Use Case | Persistence |
|------|------|----------|-------------|
| **Global client state** | Zustand | Auth, permissions, navigation, UI state (warehouse map, device manager) | `persist` middleware → localStorage |
| **Server state** | TanStack Query | All data from Supabase/APIs/Rust services | In-memory cache with TTL |
| **Scoped UI state** | React Context | Theme, font, search, presence, toast settings | Context value (some use localStorage) |

### Decision Criteria
- **Need it across many components?** → Zustand store
- **Comes from a server/API?** → TanStack Query hook
- **Scoped to a subtree of components?** → React Context
- **Local to a single component?** → `useState`/`useReducer`

## Zustand Patterns

### Store Creation
```typescript
export const useMyStore = create<MyState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({ ... }),
      { name: 'store-key', partialize: (state) => ({ ... }) }
    )
  )
)
```

### Middleware Stack
1. **`persist`** — localStorage with `partialize` to exclude sensitive/derived data
2. **`subscribeWithSelector`** — enables fine-grained subscriptions (used on `unifiedAuthStore`)
3. **`createJSONStorage(() => localStorage)`** — explicit storage adapter

### Convenience Hook Pattern
Stores export focused hooks that select specific slices:
```typescript
export const useAuth = () => {
  const { user, profile, isAuthenticated, signIn, signOut } = useUnifiedAuth()
  return { user, profile, isAuthenticated, signIn, signOut }
}
```
This prevents unnecessary re-renders from unrelated state changes.

### External Cache Pattern
Permission and navigation stores use Maps **outside** the Zustand store for cross-instance sharing:
```typescript
const permissionCache = new Map<string, PermissionCache>()
const quickPermissionCache = new Map<string, { result: boolean; timestamp: number }>()
const globalLoadingState = new Map<string, boolean>()
```
These survive store re-creation and prevent duplicate network requests.

### Cache Invalidation Pattern
All RBAC-related stores register with a central `rbacCacheManager`:
```typescript
rbacCacheManager.registerCacheLayer('permission-store', () => {
  permissionCache.clear()
  quickPermissionCache.clear()
})
```
On sign-out or permission change, `rbacCacheManager.invalidateAll()` clears all layers.

### Fail-Closed Security
Permission checks deny access by default:
- While `isLoading` → return `false`
- Empty permissions for authenticated user → trigger async reload, return `false` meanwhile
- Network error → use cached data if fresh enough, otherwise deny all

## Context Patterns

### Provider-Hook Pattern
Every context follows this structure:
```typescript
const MyContext = createContext<MyType | null>(null)

export function MyProvider({ children }) {
  const value = useMyLogic()
  return <MyContext.Provider value={value}>{children}</MyContext.Provider>
}

export function useMy() {
  const ctx = useContext(MyContext)
  if (!ctx) throw new Error('useMy must be used within MyProvider')
  return ctx
}
```

### Optional Context Hook
The presence context provides a safe optional variant:
```typescript
export function usePresenceOptional(): PresenceContextType | null {
  return useContext(PresenceContext) // returns null if outside provider
}
```

## State Flow Patterns

### Auth State Cascade
```
User signs in
  → unifiedAuthStore.signIn()
    → singletonAuthManager.signIn()
    → fetchProfile() → sets user, session, profile, currentRole
    → loadPermissions() → Redis cache → DB fallback
    → loadNavigationPermissions() → role lookup → nav items
    → loadTabPermissions()
```

### Permission Reload on User Change
```
PermissionProvider detects profile.id or profile.role_id changed
  → clearPermissions() + clearNavigationPermissions() + clearTabPermissions()
  → loadPermissions(userId, force=true)
  → loadNavigationPermissions(role_id, force=true)
  → loadTabPermissions(userId, force=true)
```

### Idle Recovery Flow
```
User returns from idle (5+ min tab hidden)
  → useIdleRecovery detects visibility change
  → validates session with 5s timeout
  → PermissionProvider detects empty permissions → auto-reloads
  → Navigation/tab stores detect empty state → auto-reload via setTimeout
```

## Anti-Patterns Avoided

1. **No prop drilling for global state** — Zustand hooks used directly
2. **No context for server data** — TanStack Query handles caching, deduplication, background refetch
3. **No Zustand for server data** — clear separation between client and server state
4. **No sensitive data in localStorage** — `partialize` excludes tokens, permissions, session data

## Related
- [[ZustandStores - State Management]]
- [[CustomHooks - React Hooks]]
- [[AppProviders - Provider Stack]]
- [[React-Query-Patterns]]
- [[AuthCache - Caching Layer]]