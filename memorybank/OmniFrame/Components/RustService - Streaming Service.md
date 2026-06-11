---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# Rust Streaming Service (rust-streaming-service)

## Purpose
High-performance ExacqVision camera streaming proxy. Provides MJPEG stream proxying with zero-copy forwarding, snapshot capture, camera management, PTZ control, recording access, and WebSocket event broadcasting for motion/trigger alerts. Acts as a middleware layer between the frontend and ExacqVision NVR systems.

## API Endpoints

All routes nested under `/api/v1`.

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Basic health check |
| GET | `/health/detailed` | Detailed health with ExacqVision session status |

### Cameras
| Method | Path | Description |
|--------|------|-------------|
| GET | `/cameras` | List cameras (filterable by name, online status, PTZ capability) |
| GET | `/cameras/:camera_id` | Get camera details |
| POST | `/cameras/:camera_id/ptz` | Send PTZ command (pan, tilt, zoom, presets, focus, iris) |

### Streaming
| Method | Path | Description |
|--------|------|-------------|
| GET | `/stream/:camera_id` | MJPEG live stream proxy (zero-copy, configurable resolution/quality) |
| GET | `/snapshot/:camera_id` | Single frame capture (cached 5s in Redis) |

### Recordings
| Method | Path | Description |
|--------|------|-------------|
| GET | `/recordings/:camera_id` | List recordings |
| GET | `/recordings/:camera_id/download` | Download recording |
| GET | `/recordings/:camera_id/playback` | Playback stream |

### Events
| Method | Path | Description |
|--------|------|-------------|
| GET | `/events` | WebSocket endpoint for real-time camera events |

## Key Modules

| File | Role |
|------|------|
| `main.rs` | App bootstrap, router, CORS |
| `lib.rs` | AppState (ExacqClient, SessionManager, CacheService, config) |
| `config/mod.rs` | AppConfig from env (ExacqVision URL, credentials, video defaults, Redis, ports) |
| `exacq/client.rs` | ExacqVision REST API client (cameras, streams, snapshots, PTZ, recordings) |
| `exacq/session.rs` | Session manager with Redis caching for ExacqVision auth sessions |
| `exacq/models.rs` | Camera, StreamParams, PtzCommand, CameraListResponse, etc. |
| `api/routes/cameras.rs` | Camera listing, details, PTZ control with Redis caching |
| `api/routes/stream.rs` | MJPEG proxy (zero-copy Body::from_stream) and snapshot capture |
| `api/routes/recordings.rs` | Recording listing, download, playback |
| `api/routes/events.rs` | WebSocket event broadcasting |
| `api/routes/health.rs` | Health checks |
| `api/error.rs` | API error types (Session, Exacq, Stream, NotFound, etc.) |
| `cache/mod.rs` | Redis cache service (generic get/set, raw bytes, TTL) |

## Dependencies (Cargo.toml)
- **Web**: axum 0.7 (macros, ws), axum-extra, tower, tower-http (cors, trace, compression, limit), hyper
- **Async**: tokio 1.35, tokio-tungstenite (native-tls), futures, futures-util
- **HTTP Client**: reqwest 0.11 (json, rustls-tls, stream, cookies) — for ExacqVision API
- **Redis**: bb8, bb8-redis
- **Streaming**: bytes, async-stream, pin-project-lite
- **Observability**: tracing, tracing-subscriber
- **URL**: url 2.5, base64
- **Misc**: serde, serde_json, uuid, chrono, once_cell, parking_lot, dotenvy, thiserror, anyhow

## Deployment
- **Port**: 8020 (configurable via `PORT`)
- **Dockerfile**: Multi-stage Rust build with release optimizations (LTO, strip, panic=abort)
- **Railway**: Deployed as standalone service
- **Env vars**: `EXACQ_URL`, `EXACQ_USERNAME`, `EXACQ_PASSWORD`, `REDIS_URL` (optional), `CORS_ALLOWED_ORIGINS`, `PORT`
- **Rust version**: 1.80+ required

## Architecture Notes
- **No auth middleware currently** — all endpoints are publicly accessible. Designed for internal-network-only deployment; auth should be added before internet-facing exposure.
- ExacqVision session management with automatic retry on first request failure
- MJPEG stream proxying uses zero-copy forwarding via `Body::from_stream` — frames are never buffered in memory
- Camera list cached 60s, camera details cached 5min, snapshots cached 5s in Redis
- PTZ actions validated against whitelist before forwarding
- Session manager handles ExacqVision authentication with Redis-backed session caching

## Related
- [[Architecture]]
- [[RustService - Core Service]]
- [[RustCore - Frontend Client]]