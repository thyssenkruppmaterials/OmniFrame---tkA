---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# Rust Core Service (rust-core-service)

## Purpose
Central high-performance backend service for the OmniFrame platform. Acts as the authentication gateway, database query engine, Redis cache manager, and SmartSheet proxy. All other Rust services delegate JWT validation to this service. Provides both REST (port 8010) and gRPC (port 8011) interfaces.

## API Endpoints

### Public (no auth)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Basic health check |
| GET | `/api/v1/health/detailed` | Detailed health (DB, Redis, session cache, uptime) |
| GET | `/metrics` | Prometheus metrics endpoint |

### Authentication
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/validate` | Basic JWT validation |
| POST | `/api/v1/auth/validate-with-profile` | JWT validation + profile enrichment + session caching (primary endpoint for all services) |
| GET | `/api/v1/auth/permissions/:user_id` | Get user permissions and roles |
| POST | `/api/v1/auth/invalidate` | Invalidate session(s) |

### Warehouse Operations
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/warehouse/inbound-scans` | Paginated inbound scans with filters |
| POST | `/api/v1/warehouse/inbound-scans` | Create inbound scan |
| GET | `/api/v1/warehouse/inbound-scans/:barcode` | Lookup by barcode |
| GET | `/api/v1/warehouse/transfer-orders` | List transfer orders |
| GET | `/api/v1/warehouse/transfer-orders/:to_number` | Get specific TO |
| PUT | `/api/v1/warehouse/transfer-orders/:to_number/status` | Update TO status |
| GET | `/api/v1/warehouse/stats` | Warehouse statistics |
| GET | `/api/v1/warehouse/drone-scans/pending` | Pending drone scans |
| GET | `/api/v1/warehouse/materials/search` | Material search |

### SmartSheet (high-performance proxy)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/smartsheet/health` | SmartSheet connection health |
| GET | `/api/v1/smartsheet/user` | Current SmartSheet user |
| GET | `/api/v1/smartsheet/sheets` | List sheets |
| GET | `/api/v1/smartsheet/sheets/:id` | Get sheet with data |
| GET | `/api/v1/smartsheet/sheets/:id/statistics` | Sheet statistics |
| POST | `/api/v1/smartsheet/sheets/:id/rows` | Add rows |
| DELETE | `/api/v1/smartsheet/sheets/:id/rows` | Delete rows |
| PUT | `/api/v1/smartsheet/sheets/:id/rows/:row_id/cells` | Update cells |
| Various | `/api/v1/smartsheet/sheets/:id/attachments/*` | Attachment CRUD |
| Various | `/api/v1/smartsheet/sheets/:id/discussions/*` | Discussion and comment CRUD |
| GET | `/api/v1/smartsheet/import/outbound-data` | Import outbound data |
| GET | `/api/v1/smartsheet/dashboard/stats` | Dashboard stats |
| DELETE | `/api/v1/smartsheet/cache/:pattern` | Clear cache |

### Cache and Queries
| Method | Path | Description |
|--------|------|-------------|
| GET/PUT/DELETE | `/api/v1/cache/:key` | General cache operations |
| POST | `/api/v1/cache/batch` | Batch cache get |
| POST | `/api/v1/query` | Generic named query execution (warehouse_stats, lx03_data, lx03_statistics, dashboard_stats, material_search, user_permissions, inbound_statistics) |

## Key Modules

| File | Role |
|------|------|
| `main.rs` | App bootstrap, HTTP + gRPC server startup |
| `lib.rs` | AppState definition, module exports, version |
| `auth/jwt.rs` | JWKS-based RS256 JWT validation with Supabase |
| `auth/api_keys.rs` | Service-to-service API key validation (DB-backed) |
| `auth/rbac.rs` | Role-Based Access Control with permission caching |
| `auth/jwks.rs` | JWKS key fetching and caching |
| `auth/claims.rs` | JWT claims parsing |
| `cache/redis_pool.rs` | Redis connection pool + CacheService |
| `cache/session.rs` | Session caching with 15-min TTL |
| `cache/query_cache.rs` | Query result caching |
| `db/pool.rs` | PostgreSQL connection pool (sqlx) |
| `db/queries/warehouse.rs` | Warehouse SQL queries |
| `db/queries/lx03.rs` | LX03 SAP data queries |
| `db/queries/productivity.rs` | Dashboard/productivity queries |
| `db/queries/auth.rs` | User profile + permission queries |
| `db/models/*.rs` | Data models (warehouse, lx03, auth, smartsheet, productivity) |
| `api/middleware/auth.rs` | Auth middleware (JWT + API key) |
| `api/middleware/rate_limit.rs` | Rate limiting (governor) |
| `api/middleware/tracing.rs` | Request tracing |
| `api/routes/*.rs` | Route handlers (auth, warehouse, cache, queries, smartsheet, health) |
| `api/smartsheet_client.rs` | SmartSheet API client |
| `api/error.rs` | API error types |
| `grpc/service.rs` | gRPC server implementation |
| `metrics/prometheus.rs` | Prometheus metrics setup |
| `config/*.rs` | Configuration (database, redis, auth) |

## Dependencies (Cargo.toml)
- **Web**: axum 0.7 (macros, multipart), axum-extra, tower, tower-http (cors, trace, compression, limit), hyper
- **Async**: tokio 1.35, futures
- **Database**: sqlx 0.7 (postgres, uuid, chrono, json, bigdecimal, migrate)
- **Redis**: bb8, bb8-redis
- **JWT**: jsonwebtoken 9.2, ring, base64, md-5
- **gRPC**: tonic 0.10, prost 0.12
- **Observability**: tracing, tracing-subscriber, metrics, metrics-exporter-prometheus
- **Rate Limiting**: governor
- **HTTP Client**: reqwest (for JWKS fetching)
- **Caching**: dashmap, lru, once_cell, parking_lot
- **Misc**: uuid, chrono, serde, serde_json, regex-lite, dotenvy, thiserror, anyhow
- **Optional**: pyo3 (Python bindings)

## Deployment
- **HTTP Port**: 8010 (configurable via `PORT`)
- **gRPC Port**: 8011 (configurable via `GRPC_PORT`)
- **Dockerfile**: Multi-stage Rust build with release optimizations (LTO, strip, panic=abort)
- **Railway**: Primary backend service
- **Env vars**: `DATABASE_URL`, `REDIS_URL` (optional), `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `CORS_ALLOWED_ORIGINS`

## Architecture Notes
- Central auth gateway: all other services validate JWTs through this service
- Session cache (Redis): validate-with-profile caches full user context for 15 min
- Organization-scoped queries: regular users filtered by org_id, service accounts get cross-org access
- Graceful degradation: runs without Redis (caching disabled, service still functional)
- Background task: refreshes session TTL asynchronously, updates last_seen
- gRPC server runs in a background tokio task

## Related
- [[Architecture]]
- [[RustService - rust-ai-service]]
- [[RustService - Dashboard Service]]
- [[RustService - MDM Service]]
- [[RustService - Streaming Service]]
- [[RustService - Work Service]]
- [[RustCore - Frontend Client]]