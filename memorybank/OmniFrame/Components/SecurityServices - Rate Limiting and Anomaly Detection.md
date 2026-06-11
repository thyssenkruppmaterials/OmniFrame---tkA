---
tags: [type/component, status/active, domain/auth, domain/infra]
created: 2026-04-10
---
# SecurityServices - Rate Limiting and Anomaly Detection

## Purpose
Enterprise-grade security layer providing Redis-backed rate limiting, DDoS protection, session anomaly detection, encrypted session storage, and server-side permission validation.

## Components

### 1. RateLimiterService (`rate-limiter.ts`)
Redis-backed rate limiting with multiple configurable rules.

Singleton: `rateLimiterService` via `RateLimiterService.getInstance()`

#### Rate Limiting Rules
| Rule | Limit | Window | Block Duration |
|---|---|---|---|
| standard_user | 100 req | 60s | 60s |
| anonymous_ip | 20 req | 60s | 5 min |
| permission_check | 1000 req | 60s | 30s |
| admin_operations | 10 req | 60s | 5 min |
| high_risk_operations | 5 req | 60s | 10 min |
| auth_attempts | 5 attempts | 5 min | 15 min |
| password_reset | 3 attempts | 1 hour | 1 hour |
| ddos_protection | 1000 req | 60s | 30 min |
| suspicious_activity | 50 failures | 1 hour | 2 hours |

#### DDoS Countermeasures
- Temporary IP blacklisting (1 hour)
- IP range blocking when >10 IPs in same /24 subnet are blacklisted
- Security event logging to Redis list (kept at 10k)
- Account flagging for review (24-hour TTL)

#### Middleware
`createRateLimitMiddleware()` — Express/FastAPI compatible middleware: whitelist -> blacklist -> rate limits -> rate limit headers.

### 2. SessionAnomalyDetector (`session-anomaly-detector.ts`)
Multi-factor anomaly detection on session activity.

Checks: IP anomalies (+20/+30/+40), time patterns (+15), device fingerprint (+25), geographic distance (+35), session frequency (+20).

Risk actions: 20+ log, 40+ notify, 70+ terminate session and require MFA.

Data sourced from `audit_logs` and `user_profiles.metadata`.

### 3. EncryptedSessionStorage (`encrypted-storage.ts`)
AES-256-GCM encrypted session data in localStorage using Web Crypto API.
- PBKDF2 key derivation (100,000 iterations, SHA-256, random salt)
- Integrity validation for required fields
- Security event logging on clear/failure

### 4. ServerPermissionValidator (`server-permission-validator.ts`)
Server-side permission validation with full audit trail via `writeAuditLog()`.

Resolution order: user exists/active -> direct user permissions -> role permissions -> inherited permissions -> default deny.

Every check writes an audit log entry with risk level calculation.

## Dependencies
- `ioredis` — Redis client (rate limiter)
- `rate-limiter-flexible` — rate limiting algorithms
- `@/lib/supabase/client` — DB queries
- `@/lib/audit/audit-log-writer` — audit trail
- `@/lib/auth/types` — permission types

## Related
- [[SingletonAuthManager - Authentication Core]] — uses EncryptedSessionStorage on sign-out
- [[RBACService - Role Based Access Control]] — client-side permission checks
- [[SessionManager - Session Lifecycle]] — session monitoring
- [[Architecture]] — System overview