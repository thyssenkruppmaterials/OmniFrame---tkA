---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# Rust Work Service (rust-work-service)

## Purpose
Work queue management service for warehouse cycle count operations. Handles task assignment, claiming, pushing, starting, completing, releasing, skipping, and acknowledging cycle count tasks. Provides real-time updates via WebSocket broadcasting and worker heartbeat tracking for workforce visibility.

## API Endpoints

### Public (no auth)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Basic health check |
| GET | `/health/detailed` | Detailed health with dependency status |
| GET | `/ws` | WebSocket for real-time work events |

### Work Queue (protected, `/api/v1/work`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/queue` | Get pending cycle counts for org |
| GET | `/queue/stats` | Queue statistics (pending, in_progress counts) |
| POST | `/claim` | Claim next available cycle count |
| POST | `/push` | Push task to specific user (supervisor only) |
| GET | `/tasks/:id` | Get specific task |
| POST | `/tasks/:id/start` | Start a claimed task |
| POST | `/tasks/:id/complete` | Complete task with counted quantity |
| POST | `/tasks/:id/release` | Release task back to queue |
| POST | `/tasks/:id/skip` | Skip/defer a task with reason |
| POST | `/tasks/:id/acknowledge` | Acknowledge a pushed task |

### Workers (protected, `/api/v1/workers`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Get active workers in org |
| GET | `/:id/tasks` | Get worker's assigned tasks |
| POST | `/heartbeat` | Worker heartbeat update (status: online/offline/busy/break/idle) |

## WebSocket Events
- `TaskAssigned` — task claimed or pushed to user
- `TaskStatusChanged` — status transitions (pending → in_progress → completed/pending)
- `PushedWork` — supervisor pushed work to a user (triggers notification)

## Key Modules

| File | Role |
|------|------|
| `main.rs` | App bootstrap, DB/Redis pools, auth client, WebSocket broadcast channel, scheduler |
| `lib.rs` | AppState definition (db_pool, redis_pool, auth_client, ws_broadcast) |
| `api/routes/work.rs` | Work queue handlers: get_queue, claim_next, push_to_user, start/complete/release/skip/acknowledge task |
| `api/routes/workers.rs` | Worker management: get_workers, get_worker_tasks, send_heartbeat |
| `api/routes/health.rs` | Health check endpoints |
| `api/routes/mod.rs` | Route exports |
| `api/error.rs` | API error types |
| `db/models.rs` | CycleCountTask, QueueStats, WorkerStatus, HeartbeatRequest/Response, etc. |
| `db/queries.rs` | SQL queries: get/claim/push/start/complete/release/skip cycle counts, heartbeat upsert |
| `auth.rs` | Auth client — delegates to rust-core-service |
| `middleware.rs` | Auth middleware (JWT + service key) |
| `websocket/mod.rs` | WebSocket handler + WsEvent enum + broadcast channel |
| `scheduler/mod.rs` | Background task scheduler |
| `config/mod.rs` | AppConfig from environment |

## Dependencies (Cargo.toml)
- **Web**: axum 0.7 (ws, macros), tokio, tower, tower-http (cors, trace)
- **Database**: sqlx 0.7 (postgres, uuid, chrono, json)
- **Redis**: bb8, bb8-redis
- **WebSocket**: tokio-tungstenite 0.24, futures-util
- **Scheduling**: tokio-cron-scheduler 0.10
- **HTTP Client**: reqwest 0.11
- **Misc**: serde, serde_json, uuid, chrono, dotenvy, thiserror, anyhow

## Deployment
- **Port**: 8030 (configurable via `PORT`)
- **Dockerfile**: Multi-stage Rust build
- **Railway**: Deployed as standalone service
- **Env vars**: `DATABASE_URL`, `REDIS_URL`, `RUST_CORE_URL`, `RUST_CORE_API_KEY`, `CORS_ALLOWED_ORIGINS`

## Architecture Notes
- Organization-scoped: all operations require org context from authenticated user
- Supervisor access: push and release operations require `*`, `manage`, or `supervisor` permissions
- Task lifecycle: pending → assigned → in_progress → completed/matched/variance
- Completion auto-determines final status based on counted vs. expected quantity (matched/variance)
- WebSocket broadcast on every state change for real-time UI updates
- Worker heartbeat tracking with status validation (online/offline/busy/break/idle)
- Background scheduler for periodic maintenance tasks

## Related
- [[Architecture]]
- [[RustService - Core Service]]
- [[RustCore - Frontend Client]]