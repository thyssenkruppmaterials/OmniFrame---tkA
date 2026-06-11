---
tags: [type/component, status/active, domain/auth]
created: 2026-04-10
---
# AuthCache - Caching Layer

## Purpose
Centralized LRU cache for all auth-related data (permissions, profiles, roles) with TTL-based expiry, tag-based invalidation, and performance metrics. Used by `AuthService`, `RBACService`, and `SingletonAuthManager` for reducing database query load.

## Key Exports / API
- `AuthCache` class (singleton via `getInstance(config?)`)
- `authCache` — module-level singleton
- Types: `CacheEntry<T>`, `CacheConfig`, `CacheMetrics`

### Core Methods
| Method | Description |
|---|---|
| `get<T>(key)` | Get with TTL check, updates access stats, tracks hits/misses |
| `set<T>(key, value, ttl?, tags?)` | Store with LRU eviction if at capacity |
| `delete(key)` | Remove entry and clean up tag mappings |
| `invalidateByTags(tags[])` | Bulk invalidation by tag array |
| `invalidateUser(userId)` | Shortcut for user/permissions/roles tags |
| `invalidateRole(roleId)` | Shortcut for role/permissions tags |
| `clear()` | Full cache reset |
| `getStats()` | Hit rate, entries count, entries by tag |
| `healthCheck()` | Status: healthy / warning / critical |
| `batchSet` / `batchGet` | Batch operations |
| `preload(entries[])` | Priority-based preloading with 2x TTL |

## Implementation Details
- **Storage**: In-memory `Map<string, CacheEntry>` — not persisted across page reloads.
- **Capacity**: 2000 max entries (increased from 1000 for high-permission users with 173+ permissions).
- **Default TTL**: 5 minutes.
- **LRU Eviction**: On capacity, finds and removes least-recently-accessed entry.
- **Tag System**: Bidirectional mappings (`keyToTags` / `tagToKeys`) enable efficient bulk invalidation.
- **Cleanup**: Background interval (60s) removes expired entries.
- **Metrics**: Tracks hits, misses, evictions, average access time, entries count.

### Cache Manager Integration
The `RBACCacheManager` (`cache-manager.ts`) orchestrates invalidation across multiple cache layers:
- `rbac-service` -> authCache.clear()
- `permission-store` -> Zustand permissionStore Maps
- `navigation-store` -> Zustand navigationStore Maps
- `unified-auth-permissions` / `unified-auth-navigation` -> unified auth store state

Supports selective invalidation (`invalidatePermissions()`, `invalidateNavigation()`) and cross-tab broadcast.

## Configuration
- maxEntries: 2000
- defaultTTL: 5 min
- enableMetrics: true

## Dependencies
- `@/lib/utils/logger`

## Related
- [[AuthService - Unified Authentication]] — primary consumer for profiles and permissions
- [[RBACService - Role Based Access Control]] — primary consumer for RBAC data
- [[SingletonAuthManager - Authentication Core]] — has its own Map-based caches alongside this
- [[Architecture]] — System overview