---
tags: [type/component, status/active, domain/auth]
created: 2026-04-10
---
# SessionManager - Session Lifecycle

## Purpose
Predictive session management with intelligent refresh scheduling, visibility-aware monitoring, and session analytics. Manages the complete session lifecycle from creation through expiry, including proactive token refresh and background monitoring.

## Key Exports / API
- `SessionManager` class (singleton via `getInstance(config?)`)
- `sessionManager` — module-level singleton
- Types: `SessionConfig`, `SessionState`

### Core Methods
| Method | Description |
|---|---|
| `initialize()` | Set up auth state listener, start monitoring, visibility handler, initial validation |
| `getSessionState()` | Current `SessionState` snapshot |
| `validateSession()` | Check session validity, schedule refresh if needed |
| `refreshSession()` | Force token refresh with retry tracking |
| `predictiveRefresh()` | Proactive refresh based on proximity to expiry |
| `enableBackgroundRefresh()` / `disableBackgroundRefresh()` | Toggle background refresh |
| `getExpiryInfo()` | Expiry details: `expiresAt`, `timeUntilExpiry`, `isExpiringSoon`, `needsRefresh` |
| `getAnalytics()` | Health score (0-100), recommendations, refresh stats |
| `forceCheck()` | Immediate session validation |

### SessionState
```
{
  isValid: boolean
  expiresAt: number | null
  lastCheck: number
  refreshAttempts: number
  isRefreshing: boolean
  backgroundRefreshEnabled: boolean
}
```

## Implementation Details
- **Predictive Refresh**: Schedules refresh `refreshThreshold` (10 min) before expiry using `setTimeout`.
- **Visibility Handler**: On page becoming visible after >2 minutes, validates session (prevents stale sessions on tab switch).
- **Focus Handler**: Also triggers predictive refresh on window focus.
- **Retry with Backoff**: On refresh failure, retries with exponential backoff (5s * 2^attempt, max 30s). Emits `SESSION_EXPIRED` after max attempts (3).
- **Auth State Integration**: Listens to `SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED` from `singletonAuthManager` to update internal state.
- **Expiry Calculation**: Converts `session.expires_at` (Unix seconds) to milliseconds for accurate tracking.
- **Health Score**: Computed from refresh failure rate (-30), session validity (-50), and expiring-soon status (-20).

### Session Management Feature (`features/session-management/`)
Full admin UI for session monitoring with:
- `SessionManagementService` — Queries `user_sessions`, `session_activities`, `security_alerts`, `session_timeout_configs` tables
- Active sessions table with real-time data from `user_profiles.last_seen`
- Role-based timeout configurations (superadmin: 8h, admin: 4h, manager: 2h, cashier: 1h, viewer: 30m)
- Security alert management with resolution workflow
- Session history and analytics
- Data export (CSV/JSON)
- Device registration mapping via `DeviceRegistrationService`

### Session Activity Logger (`session-activity-logger.ts`)
Fire-and-forget logging service writing to `session_activities` table.

Event types: `login`, `logout`, `timeout`, `forced_logout`, `refresh`, `extend`, `session_warning`, `update_timeout_config`, `create_timeout_config`, `delete_timeout_config`, `resolve_security_alert`, `export_session_data`.

### Cross-Tab Communication (`broadcast-channel.ts`)
`AuthBroadcastChannelManager` using BroadcastChannel API on channel `onebox-auth-channel`.

Message types: `SESSION_EXPIRED`, `SESSION_EXTENDED`, `SIGNED_OUT`, `PERMISSIONS_UPDATED`, `SHOW_EXPIRY_WARNING`, `DISMISS_EXPIRY_WARNING`.

### Redirect Utilities (`redirect-utils.ts`)
- `redirectToSignIn(customPath?)` — full-page redirect preserving current URL
- `buildSignInRedirect(returnPath)` — TanStack Router-compatible redirect object
- Loop prevention: skips redirect param for `/sign-in`, `/sign-up`, `/forgot-password`

## Configuration
- checkInterval: 10 min
- warningTime: 5 min before expiry
- refreshThreshold: 10 min before expiry
- maxRefreshAttempts: 3
- enableBackgroundRefresh: true

## Dependencies
- `@/lib/auth/singleton-auth-manager` — Supabase client for session operations
- `@/lib/auth/types` — Session, AuthEvent types
- `@/lib/supabase/client` — direct Supabase access (activity logger)
- `@/lib/supabase/device-registration.service` — device name mapping

## Related
- [[SingletonAuthManager - Authentication Core]] — auth state change source
- [[AuthService - Unified Authentication]] — session validation used here
- [[SecurityServices - Rate Limiting and Anomaly Detection]] — anomaly detection for sessions
- [[PermissionGuard - UI Components]] — session expiry modal
- [[Architecture]] — System overview