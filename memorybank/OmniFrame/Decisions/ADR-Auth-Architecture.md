---
tags: [type/decision, status/active, domain/auth]
created: 2026-04-10
---
# ADR: Authentication & Authorization Architecture

## Context
OmniFrame requires enterprise-grade authentication and fine-grained authorization for a multi-role warehouse management system (superadmin, admin, manager, cashier, viewer, tka_associate) with 87+ permissions, 34 navigation items, and 52 tab-level permissions.

## Decision

### 1. Singleton Supabase Client (Jan 2025)
**Problem**: Multiple GoTrueClient instances caused auth state conflicts, duplicate listeners, and session race conditions during development HMR.

**Solution**: `SingletonAuthManager` with window-level global state (`window.__ONEBOX_AUTH_SINGLETON__`) that survives Vite HMR. All auth operations flow through a single Supabase client instance.

**Consequence**: Zero GoTrueClient conflicts. All components share one auth state source.

### 2. Layered Auth Service Architecture
**Decision**: Three-layer service stack:
- **SingletonAuthManager** (low-level): Supabase client wrapper with retry logic, DB operations, session monitoring
- **AuthService** (mid-level): Business logic for sign-in/out, profile/permission management, event system
- **RBACService** (specialized): Full RBAC engine with conditional permissions, role hierarchy, tab/navigation access

**Rationale**: Separation of concerns allows each layer to evolve independently. RBACService handles complex permission logic without bloating the core auth manager.

### 3. No Service Role Key in Frontend (Security)
**Decision**: `serviceRoleKey` is intentionally omitted from all frontend code. Admin operations that require elevated privileges route through backend API endpoints (`/api/admin/*`).

**Consequence**: RLS policies are always enforced on the frontend. Tab and navigation permission assignments call backend endpoints that use service role key server-side.

### 4. role_id over role enum (Jan 6, 2026)
**Problem**: User profiles had a legacy `role` enum column. Custom roles (e.g., TKA supervisor) didn't match any enum value, causing 403 errors on route protection.

**Solution**: Route protection now uses `user_profiles.role_id` (UUID FK to `roles` table) exclusively. The `role` column is legacy/deprecated.

**Consequence**: Any role created in the `roles` table works without code changes.

### 5. Conditional Permissions with Client/Server Split
**Decision**: Time-based conditions (day-of-week, time-of-day windows) are evaluated client-side in RBACService. IP-based and geo-restriction conditions are evaluated server-side only by the Rust Core Service.

**Rationale**: Browser cannot reliably determine client IP. The Rust middleware calls `check_permission_conditions()` DB function for full context.

### 6. Multi-Layer Caching Strategy
**Decision**: Three caching tiers:
1. `AuthCache` (LRU, 2000 entries, tag-based invalidation) — used by AuthService and RBACService
2. `SingletonAuthManager` internal Maps (permissions, navigation, tabs) — session-scoped
3. `RBACCacheManager` — orchestrates invalidation across AuthCache + Zustand stores + cross-tab broadcast

**TTLs**: Permission checks 2min, permission lists 5min, roles 10min, system data 15min.

### 7. Cross-Tab Session Synchronization
**Decision**: Use BroadcastChannel API (`onebox-auth-channel`) for cross-tab auth events: sign-out, session expiry, session extension, permission updates.

**Consequence**: When one tab signs out, all tabs redirect to sign-in. Permission updates in admin tab propagate to user tabs.

### 8. Fail-Open vs Fail-Closed Route Protection
**Decision**: Admin routes (`/admin/*`) use fail-closed security (resource permission denial blocks access). Non-admin routes use fail-open (navigation permission is sufficient even if resource permission check fails).

**Rationale**: Prevents legitimate users from getting 403 errors after hard refresh when permission cache is cold, while keeping admin routes strictly locked down.

### 9. Permission Format: `resource:action`
All permissions follow the `resource:action` pattern (e.g., `inventory_apps:view`, `users:manage`). Wildcards supported: `resource:*` or `*:*`.

### 10. Encrypted Session Storage
**Decision**: AES-256-GCM encryption for session data in localStorage using Web Crypto API with PBKDF2 key derivation (100,000 iterations).

**Rationale**: Protects session tokens from XSS-based localStorage theft.

## Roles Defined
| Role | Session Timeout | Description |
|---|---|---|
| superadmin | 8 hours | Full system access |
| admin | 4 hours | Administrative access |
| manager | 2 hours | Operations management |
| cashier | 1 hour | Point of sale operations |
| viewer | 30 min | Read-only access |
| tka_associate | 2 hours | TKA warehouse associate |

## Status
Active — Comprehensive Authentication Redesign v2.0.0 (Jan 2025), with incremental enhancements through April 2026.

## Related
- [[SingletonAuthManager - Authentication Core]]
- [[AuthService - Unified Authentication]]
- [[RBACService - Role Based Access Control]]
- [[AuthCache - Caching Layer]]
- [[UnifiedAuthProvider - React Provider]]
- [[SecurityServices - Rate Limiting and Anomaly Detection]]
- [[SessionManager - Session Lifecycle]]
- [[RouteProtection - Navigation Security]]
- [[PermissionGuard - UI Components]]
- [[Architecture]] — System overview