---
tags: [type/component, status/active, domain/infra]
created: 2026-04-10
---
# Infrastructure — Cache and Redis

## Purpose
Documents the multi-tier caching architecture used across OneBox for RBAC permissions, authentication data, and navigation state.

## Architecture Overview

OneBox implements a **three-tier caching strategy**:

| Tier | Service | Environment | Storage |
|---|---|---|---|
| L1 | `AuthCache` | Browser | In-memory Map (singleton) |
| L2 | `DistributedPermissionCache` | Browser | In-memory Map (static class) |
| L3 | `DistributedCacheService` | Server (Node.js) | Redis via ioredis |

## Redis Configuration (`src/lib/infra/redis-config.ts`)

**Connection resolution precedence:**
1. `REDIS_URL` (full connection string, parsed via `URL`)
2. `REDIS_HOST` + `REDIS_PORT` + `REDIS_PASSWORD` (discrete env vars)
3. `localhost:6379` fallback (local dev only, logs warning)

**Connection settings:**
```typescript
{
  maxRetriesPerRequest: 3 (test: 1),
  retryDelayOnFailover: 100 (test: 50),
  enableReadyCheck: true,
  lazyConnect: true,
  keepAlive: 30000,
  family: 4 (IPv4)
}
```

## L3: DistributedCacheService (`src/lib/cache/redis-cache-service.ts`)

**Singleton:** `DistributedCacheService.getInstance()` / `distributedCacheService`

**Design:** Node.js-only. All methods gracefully no-op in browser (`typeof window !== 'undefined'`). `ioredis` is dynamically imported only in `initialize()`. The module is externalized from the browser bundle (`rollupOptions.external: ['ioredis']`).

**Connections:**
- Primary Redis — reads and writes
- Read-only Redis — load balancing for reads
- Rate limiter via `rate-limiter-flexible` (1000 req/s, 10s block)

**Key patterns:**
| Pattern | Purpose | Default TTL |
|---|---|---|
| `perms:{userId}` | User permissions array | 300s (5 min) |
| `nav:{userId}:{role}` | Navigation permissions | 600s (10 min) |
| `tabs:{userId}:{pageResource}` | Tab-level permissions | 300s (5 min) |
| `tag:{tagName}` | Tag-based invalidation sets | 2× data TTL |
| `perm_users` | Set of all cached user IDs | — |
| `role_users:{roleId}` | Users assigned to a role | — |

**Cache versioning:** `CACHE_VERSION = 2` — entries with mismatched versions are auto-evicted.

**Capabilities:**
- `getPermissions(userId)` / `setPermissions(userId, perms, ttl, tags)`
- `getNavigationPermissions(userId, role)` / `setNavigationPermissions()`
- `getTabPermissions(userId, pageResource)` / `setTabPermissions()`
- `invalidateUserPermissions(userId)` — pipeline-based bulk delete
- `invalidateRolePermissions(roleId)` — invalidates all users with role
- `invalidateByTags(tags)` — tag-based targeted invalidation
- `batchGet<T>(keys)` / `batchSet<T>(entries)` — batch operations
- `warmCache(entries)` — priority-sorted preloading (top 1000, 3× TTL)
- `healthCheck()` — ping latency + hit rate checks (warning if >100ms or <80% hit rate)

**Event listeners:** connect, ready, error (max 5 retries), close, reconnecting

**Health monitoring:** 30-second interval health check loop.

## L1: AuthCache (`src/lib/cache/auth-cache.ts`)

**Singleton:** `AuthCache.getInstance()` / `authCache`

**Config:**
- Max entries: 2000 (increased for high-permission users with 173+ permissions)
- Default TTL: 5 minutes
- LRU eviction when at capacity
- 60-second cleanup interval for expired entries

**Tag-based invalidation:**
- `keyToTags` Map + `tagToKeys` Map for bidirectional lookup
- `invalidateUser(userId)` — removes `user:{userId}`, `permissions:{userId}`, `roles:{userId}`
- `invalidateRole(roleId)` — removes `role:{roleId}`, `permissions:role:{roleId}`
- `invalidateByTags(tags)` — generic tag invalidation

**Features:** batch get/set, preloading with priority sorting, TTL extension, health checks.

## L2: DistributedPermissionCache (`src/lib/cache/distributed-permission-cache.ts`)

**Static class** (no singleton pattern — all static methods).

**Config:**
- Max cache size: 10,000 entries
- TTL: 5 minutes
- Cache version: 1
- LRU eviction (sorted by access time)
- 60-second cleanup interval

**Key pattern:** `perm:{userId}:{resource}:{action}` → `boolean`

**Operations:**
- `getPermission(userId, resource, action)` / `setPermission(..., granted, customTtl)`
- `invalidateUserPermissions(userId)` — prefix scan
- `invalidateResourcePermissions(resource)` — pattern scan
- `healthCheck()` — write/read/delete test

## Web Worker: Permission Cache (`src/workers/permission-cache.worker.ts`)

**Offloads permission caching to a background thread** via Web Worker API.

**Config:** Max 5000 entries, 5-min TTL, 50-entry preload batches, 60s cleanup.

**Message types (inbound):**
- `PRELOAD_PERMISSIONS` — batch preload with priority (high = 2× TTL)
- `PRELOAD_USER_PERMISSIONS` — fetch all effective permissions for a user
- `CHECK_PERMISSION` → responds with `PERMISSION_RESULT`
- `INVALIDATE_CACHE` — by userId, pattern, or specific keys
- `CLEAR_CACHE` — all, expired-only, or LRU mode
- `OPTIMIZE_CACHE` — remove expired + LRU eviction
- `GET_CACHE_STATS` → responds with `CACHE_STATS`

**Stats tracked:** hits, misses, evictions, preload operations, total operations, estimated memory usage.

## Related
- [[Infrastructure - Monitoring and Performance]] — Performance tracking that uses cache metrics
- [[Build-Configuration]] — ioredis externalization from browser bundle
- [[Deployment-Railway]] — Redis connection in production
- [[AuthCache - Caching Layer]] — Detailed AuthCache component doc
