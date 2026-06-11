---
tags: [type/component, status/active, domain/auth]
created: 2026-04-10
---
# SingletonAuthManager - Authentication Core

## Purpose
Central authority for all authentication, authorization, and session management in OmniFrame. Designed to eliminate multiple GoTrueClient issues by providing a single Supabase client instance stored on `window.__ONEBOX_AUTH_SINGLETON__` for HMR resistance during development.

## Key Exports / API
- `SingletonAuthManager` class (singleton via `getInstance()`)
- `singletonAuthManager` — module-level singleton export (guarded for Node.js/test)
- `PostgrestResponse<T>` — unified DB response type
- `AuthManagerConfig`, `AuthState` types

### Core Methods
| Method | Description |
|---|---|
| `signIn(email, password)` | Email/password authentication via Supabase GoTrueClient |
| `signOut()` | Sign out, clear encrypted session, broadcast to other tabs |
| `refreshSession()` | Token refresh with cross-tab broadcast via `authBroadcast` |
| `getAuthState()` | Returns current `AuthState` snapshot |
| `executeRead(query, opts)` | DB read with retry logic (3 retries, exponential backoff, timeout) |
| `executeWrite(query, opts)` | DB write with limited retry (max 1 retry) |
| `loadUserPermissions(userId)` | Cached permission loading from `role_permissions` join |
| `loadNavigationPermissions(roleId)` | Navigation items visible to a role |
| `checkPermission(permission, userId?)` | Single permission check in `resource:action` format |
| `getHealthStatus()` | Returns `healthy` / `degraded` / `critical` |

## Implementation Details
- **Singleton Pattern**: Window-level global state (`window.__ONEBOX_AUTH_SINGLETON__`) survives Vite HMR.
- **Session Monitoring**: 30s interval validates session, proactively refreshes within 5 min of expiry.
- **Auth State Listener**: `onAuthStateChange` updates internal state, loads `user_profiles` with role join, logs session activity, and clears caches on auth transitions.
- **Permission Caching**: Three in-memory `Map` caches — permissions, navigation, tabs — with 5-minute TTL.
- **Retry Logic**: Read queries retry 3x with exponential backoff; writes retry once.
- **Error Recovery**: Network errors preserve current auth state instead of forcing logout.
- **Cross-Tab**: Broadcasts `SIGNED_OUT`, `SESSION_EXTENDED` via `authBroadcast` BroadcastChannel.

## Configuration
```
defaultConfig = {
  enableDebugLogging: development mode,
  sessionCheckInterval: 30000,      // 30s
  permissionCacheTTL: 300000,        // 5min
  retryAttempts: 3,
  retryDelayMs: 1000,
  timeoutMs: 10000,
}
```

## Dependencies
- `@supabase/supabase-js` (SupabaseClient, Session, User)
- `@/lib/supabase/client` — singleton Supabase client
- `@/lib/auth/broadcast-channel` — cross-tab communication
- `@/lib/auth/session-activity-logger` — fire-and-forget activity logging
- `@/lib/security/encrypted-storage` — AES-GCM encrypted localStorage
- `@/lib/auth/types` — UserProfile type

## Related
- [[AuthService - Unified Authentication]] — higher-level service that delegates to this manager
- [[UnifiedAuthProvider - React Provider]] — React context wrapping this singleton
- [[AuthCache - Caching Layer]] — dedicated LRU cache used by AuthService and RBACService
- [[RBACService - Role Based Access Control]] — permission checking service
- [[SecurityServices - Rate Limiting and Anomaly Detection]] — encrypted storage, rate limiting
- [[Architecture]] — System overview