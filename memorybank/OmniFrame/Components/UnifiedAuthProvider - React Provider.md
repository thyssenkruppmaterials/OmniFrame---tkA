---
tags: [type/component, status/active, domain/auth, domain/frontend]
created: 2026-04-10
---
# UnifiedAuthProvider - React Provider

## Purpose
React context provider that bridges `SingletonAuthManager` into the React component tree. Provides auth state, sign-in/sign-out methods, and permission checking to all child components. Wraps children in `PermissionProvider` for permission store integration.

## Key Exports / API
- `UnifiedAuthProvider` — React component (top-level auth wrapper)
- `useUnifiedAuth()` — hook returning `AuthContextType`
- `useAuthState()` — legacy hook returning just `AuthState`
- `singletonAuthManager` — re-exported singleton

### AuthContextType Interface
```
{
  authState: AuthState
  isLoading: boolean
  error: Error | null
  signIn: (email, password) => Promise<{ user, error }>
  signOut: () => Promise<void>
  checkPermission: (permission: string) => Promise<boolean>
}
```

## Implementation Details
- **Initialization Guard**: Uses `useRef` flags (`isInitialized`, `isInitializing`) to prevent double initialization in React StrictMode.
- **State Listener**: Registers `addStateListener` callback on singleton; updates React state on every auth change.
- **Cross-Tab Sync**: Listens to `authBroadcast` for:
  - `SIGNED_OUT` / `SESSION_EXPIRED` -> force sign-out + redirect to `/sign-in`
  - `PERMISSIONS_UPDATED` -> reload permissions for current user
- **Dev Tools**: When `enableDevTools=true`, exposes `window.__AUTH_STATE__()` and `window.__AUTH_HEALTH__()`.
- **Provider Hierarchy**: `AuthContext.Provider` -> `PermissionProvider` -> `{children}`
- **Cleanup**: Removes state listener and broadcast listener on unmount.

## Props
| Prop | Type | Default | Description |
|---|---|---|---|
| children | ReactNode | required | Child components |
| enableDevTools | boolean | false | Enable window debug functions |
| onAuthChange | function | - | Callback on auth state changes |
| onError | function | - | Error callback |

## Dependencies
- `@/lib/auth/singleton-auth-manager` — the auth singleton
- `@/lib/auth/broadcast-channel` — cross-tab events
- `@/providers/PermissionProvider` — Zustand-backed permission context
- `@/lib/auth/types` — User type

## Related
- [[SingletonAuthManager - Authentication Core]] — underlying auth engine
- [[PermissionGuard - UI Components]] — permission-gated rendering
- [[RouteProtection - Navigation Security]] — route-level protection
- [[Architecture]] — System overview