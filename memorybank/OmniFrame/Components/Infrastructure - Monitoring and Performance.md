---
tags: [type/component, status/active, domain/infra]
created: 2026-04-10
---
# Infrastructure — Monitoring and Performance

## Purpose
Documents the enterprise monitoring, health check, and performance tracking systems used across OneBox.

## Architecture Overview

Three interconnected monitoring systems:

| System | File | Scope | Storage |
|---|---|---|---|
| PerformanceTracker | `src/lib/monitoring/performance-tracker.ts` | Server-side metrics | Redis |
| HealthCheckService | `src/lib/monitoring/health-checks.ts` | System-wide health | In-memory |
| RBACPerformanceMonitor | `src/lib/performance/rbac-monitor.ts` | Client-side RBAC perf | In-memory + Worker |

## PerformanceTracker (`src/lib/monitoring/performance-tracker.ts`)

**Singleton:** `PerformanceTracker.getInstance()` / `performanceTracker`

**Dependencies:** Redis (via `redis-config.ts`), `distributedCacheService`, `databaseConnectionPool`.

**Tracked operation types:**
- `trackPermissionCheck()` — userId, resource, action, duration, cacheHit, success
- `trackAuthOperation()` — operation, userId, duration, success
- `trackDatabaseOperation()` — operation, duration, queryType, success, rowsAffected
- `trackCacheOperation()` — get/set/invalidate, duration, hit, keyCount, success

**System metrics (with alert thresholds):**
| Metric | Warning | Critical |
|---|---|---|
| Permission check latency | >100ms | >500ms |
| Cache hit rate | <80% | <50% |
| Cache latency | >50ms | >200ms |
| DB query latency | >200ms | >1000ms |
| DB connection pool | >80% | >95% |
| Auth operation latency | >500ms | >2000ms |
| Error rate | >1% | >5% |
| Memory usage | >1000 MB | >2000 MB |
| CPU usage | >80% | >95% |

**Background processes (intervals):**
- Metrics collection: every 5s
- Alert checking: every 10s
- Metrics aggregation: every 60s (stored in Redis `metrics_hourly`, 1-week retention)

**Alert handling:**
- Warning alerts: logged
- Critical alerts: trigger automatic responses (e.g., cache warming for low hit rate, DBA notification for pool exhaustion)
- Stored in Redis `performance_alerts` (max 1000) and `admin_performance_alerts`

**Sample buffer:** 10,000 samples in-memory, 24h retention in Redis.

## HealthCheckService (`src/lib/monitoring/health-checks.ts`)

**Singleton:** `HealthCheckService.getInstance()` / `healthCheckService`

**Registered health checks:**
| Component | Interval | Timeout | Retries | Critical |
|---|---|---|---|---|
| `redis_cache` | 30s | 5s | 2 | Yes |
| `database_pool` | 15s | 10s | 3 | Yes |
| `auth_system` | 60s | 5s | 2 | Yes |
| `permission_system` | 45s | 8s | 2 | Yes |
| `rate_limiter` | 60s | 5s | 2 | No |
| `audit_service` | 120s | 5s | 1 | No |
| `performance_tracker` | 180s | 5s | 1 | No |

**Overall status determination:**
- Any critical component down → **critical**
- Non-critical failures or >30% degraded → **degraded**
- All green → **healthy**

**Features:**
- Retry with exponential backoff (1s, 2s, 4s...)
- Uptime tracking per component (% calculation)
- `getHealthDashboard()` — aggregates health + performance + alerts
- `getHealthCheckEndpoint()` — REST-compatible response (up/down/degraded)
- Middleware: `createHealthCheckMiddleware()` for `/health` endpoint

**React hook:** `useHealthCheck(componentName?)` — polls every 30s, returns `{ health, isLoading, specificComponent }`.

## RBACPerformanceMonitor (`src/lib/performance/rbac-monitor.ts`)

**Singleton:** `RBACPerformanceUtils.getMonitor()` / `rbacPerformanceMonitor`

**Client-side focus.** Uses the permission cache Web Worker for background processing.

**Capabilities:**
- `recordMetric(operation, duration, metadata)` — in-memory buffer (max 10,000)
- `getRBACAnalytics(timeRange)` — permission checks, top permissions, user activity, system health
- `preloadUserPermissions(userId, priority)` — sends to cache worker
- `optimizeCache()` — triggers worker optimization
- `getCacheMetrics()` — requests stats from worker (5s timeout)
- `monitorSystemHealth()` — returns status + issues + recommendations
- `generatePerformanceReport()` — full report with trends

**RBACPerformanceUtils static methods:**
- `measurePermissionCheck(operation, metadata)` — wraps async operations with timing
- `preloadPermissions(userId, permissions?)` — via worker
- `getDashboardMetrics()` — analytics + cache + health combined
- `optimizePerformance()` — cache optimization + metric cleanup
- `exportPerformanceData(format)` — JSON or CSV export

**React hook:** `useRBACPerformance()` — polls every 30s, returns `{ metrics, isLoading, refresh, optimize, preloadPermissions }`.

**Analytics collection:** 60-second interval, logs warnings for high response time (>1s) and high error rate (>5%).

## Worker Integration

The `permission-cache.worker.ts` Web Worker (see [[Infrastructure - Cache and Redis]]) provides the background thread for the RBAC monitor. It handles permission preloading, cache optimization, and stats collection without blocking the main thread.

Instantiated in `RBACPerformanceMonitor` constructor:
```typescript
new Worker(
  new URL('@/workers/permission-cache.worker.ts', import.meta.url),
  { type: 'module' }
)
```

## Related
- [[Infrastructure - Cache and Redis]] — Cache services that feed monitoring metrics
- [[Build-Configuration]] — ESLint override for worker files (`no-explicit-any` off)
- [[Deployment-Railway]] — Health check endpoint at `/health`
- [[Quality-Pipeline]] — Testing infrastructure for monitoring services
