---
tags: [type/component, status/active, domain/auth]
created: 2026-04-10
---
# AuthService - Unified Authentication

## Purpose
High-level authentication service that acts as the single source of truth for all auth and authorization operations. Wraps `singletonAuthManager` and `authCache` to provide a clean API with caching, event emission, and session monitoring.

## Key Exports / API
- `AuthService` class (singleton via `getInstance(config?)`)
- `authService` — module-level singleton instance
- `AuthConfig` type re-export

### Core Methods
| Method | Description |
|---|---|
| `initialize()` | Set up auth state change listener, start session monitoring, cache cleanup |
| `getAuthState()` | Returns full `AuthState` (user, session, profile, permissions, roles) |
| `signIn(email, password)` | Sign in, invalidate cache, get fresh state, emit event |
| `signUp(email, password, metadata)` | Sign up with email redirect callback |
| `signOut()` | Invalidate cache, clear localStorage, sign out from Supabase |
| `resetPassword(email)` / `updatePassword(newPassword)` | Password management |
| `refreshSession()` | Token refresh with `TOKEN_REFRESHED` event |
| `getUserProfile(userId)` | Cached profile fetch from `user_profiles` table |
| `getUserPermissions(userId)` | Cached permissions from `role_permissions` + `user_permissions` joins |
| `getUserRoles(userId)` | Role hierarchy from `user_profiles` -> `roles` join |
| `checkPermission(userId, resource, action, context)` | Permission check with 2-min cache, audit logging |
| `validateSession()` | Session validity check with proactive refresh |

## Implementation Details
- **Permission Format**: `resource:action` strings (e.g., `inventory_apps:view`).
- **Dual Permission Sources**: Checks both role-based (`role_permissions`) and direct user (`user_permissions`) grants.
- **Wildcard Support**: `*` resource or action matches everything.
- **Event System**: Internal event bus (`Set<AuthEventHandler>`) emitting `AuthEvent` with types: `SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, `SESSION_EXPIRED`, `SESSION_WARNING`, `USER_UPDATED`.
- **Session Monitoring**: Periodic interval checks session validity; emits `SESSION_WARNING` within `warningTime` of expiry.
- **Cache Strategy**: Uses `authCache` (tag-based LRU) with 5-min default TTL; permission checks cached for 2 min.
- **Security**: `serviceRoleKey` intentionally omitted; admin operations handled via backend API.

## Configuration (`AuthConfig`)
- supabase: url + anonKey (no serviceRoleKey)
- cache: maxEntries 1000, defaultTTL 5min
- session: checkInterval 10min, warningTime 5min
- security: enableAudit true, maxFailedAttempts 5, lockoutDuration 15min
- features: enable2FA true, enableSSO false, enableSessionManagement true

## Dependencies
- `@/lib/auth/singleton-auth-manager` — underlying Supabase client
- `@/lib/cache/auth-cache` — LRU cache with tag invalidation
- `@/lib/auth/types` — type definitions
- `@/lib/supabase/rpc-types` — Supabase result types

## Related
- [[SingletonAuthManager - Authentication Core]] — lower-level manager this service wraps
- [[RBACService - Role Based Access Control]] — dedicated RBAC with conditional permissions
- [[AuthCache - Caching Layer]] — caching backend
- [[UnifiedAuthProvider - React Provider]] — React context that exposes this service
- [[RouteProtection - Navigation Security]] — uses this service for route-level checks
- [[Architecture]] — System overview