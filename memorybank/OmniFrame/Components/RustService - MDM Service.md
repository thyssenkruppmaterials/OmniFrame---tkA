---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# Rust MDM Service (rust-mdm-service)

## Purpose
Mobile Device Management service implementing the Apple MDM protocol for managing iOS/iPadOS devices used in warehouse operations. Handles device enrollment, check-in lifecycle, command queue, telemetry ingestion (heartbeat, location, device health), geofence evaluation, and real-time device/location streaming via WebSocket.

## API Endpoints

### Public (no auth)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/health/detailed` | Detailed health |
| GET | `/api/v1/metrics` | Prometheus metrics |

### MDM Device Protocol (device-initiated)
| Method | Path | Description |
|--------|------|-------------|
| PUT | `/api/v1/mdm/checkin` | MDM check-in (Authenticate, TokenUpdate, CheckOut) — plist |
| PUT | `/api/v1/mdm/server` | MDM server request — command poll + response handling |
| GET | `/api/v1/mdm/enroll/profile` | Generate enrollment profile info |

### Telemetry (device auth via X-Telemetry-Token)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/telemetry/heartbeat` | Device heartbeat (battery, storage, IP, carrier) |
| POST | `/api/v1/telemetry/location` | GPS location report with geofence evaluation |
| POST | `/api/v1/telemetry/device-health` | Device health metrics sample |

### Admin (JWT auth + org scope)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/devices` | List devices (paginated, filterable by status/search) |
| GET | `/api/v1/admin/devices/:device_id` | Get device details |
| POST | `/api/v1/admin/devices/:device_id/commands` | Queue MDM command to device |
| GET | `/api/v1/admin/commands` | List queued commands |

### WebSocket Streams (JWT auth + query token)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/streams/devices` | Real-time device events WebSocket |
| GET | `/api/v1/admin/streams/locations` | Real-time location/geofence events WebSocket |

## Key Modules

| File | Role |
|------|------|
| `main.rs` | App bootstrap, route composition with layered auth |
| `state.rs` | AppState with DB pool, Redis, auth client, WebSocket broadcast, config |
| `config.rs` | AppConfig from environment |
| `auth.rs` | Auth client delegating to rust-core-service |
| `middleware.rs` | Multiple auth middlewares: require_auth, require_organization, require_telemetry_auth, require_auth_or_query_token |
| `api/routes/mdm.rs` | Apple MDM protocol handlers (Authenticate, TokenUpdate, CheckOut, Server) |
| `api/routes/admin.rs` | Admin device/command CRUD with command event audit trail |
| `api/routes/telemetry.rs` | Telemetry ingestion: heartbeat, location, device health + geofence evaluation |
| `api/routes/streams.rs` | WebSocket handlers for device event and location streaming |
| `api/routes/health.rs` | Health/metrics endpoints |
| `metrics/mod.rs` | Prometheus metrics: checkin counts, telemetry ingestion, command queue |

## Dependencies (Cargo.toml)
- **Web**: axum 0.7 (ws, macros), tokio, tower, tower-http (cors, trace, compression)
- **Database**: sqlx 0.7 (postgres, uuid, chrono, json)
- **Redis**: bb8, bb8-redis
- **MDM**: plist 1.6 (Apple plist parsing/generation)
- **WebSocket**: tokio-tungstenite 0.24, futures-util
- **HTTP Client**: reqwest 0.11 (json, rustls-tls, stream)
- **Metrics**: metrics, metrics-exporter-prometheus
- **Misc**: serde, serde_json, uuid, chrono, bytes, dotenvy, thiserror, anyhow

## Deployment
- **Port**: Configurable via `PORT` env
- **Dockerfile**: Multi-stage Rust build with release optimizations (LTO, strip, panic=abort)
- **Railway**: Deployed as standalone service
- **Env vars**: `DATABASE_URL`, `REDIS_URL`, `RUST_CORE_URL`, `RUST_CORE_API_KEY`, `MDM_BASE_URL`, `CORS_ALLOWED_ORIGINS`

## Architecture Notes
- Implements Apple MDM check-in protocol with plist parsing
- Command queue pattern: commands are queued by admin, polled by devices via `/mdm/server`
- Command lifecycle: Queued → Sent → Acknowledged/Completed/Failed with full event audit trail
- Geofence evaluation: Haversine distance calculation for circle geofences with enter/exit transition detection
- WebSocket broadcasting: org-scoped real-time event streams using tokio broadcast channels
- Multiple auth layers: JWT for admin, telemetry token for devices, query token for WebSocket
- Database tables: `mdm_devices`, `mdm_device_secrets`, `mdm_commands`, `mdm_command_events`, `mdm_device_locations`, `mdm_device_health_samples`, `mdm_geofences`, `mdm_geofence_events`

## Related
- [[Architecture]]
- [[RustService - Core Service]]
- [[RustCore - Frontend Client]]