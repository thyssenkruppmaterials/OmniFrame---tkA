---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# Rust Dashboard Service (drone-dashboard-service)

## Purpose
Background aggregation service that periodically collects and aggregates drone scan statistics for real-time dashboard updates. Runs a cron job every 30 seconds to compute scan metrics (today/weekly counts, pending/completed/failed analyses, processing times, zones scanned, items detected, damage alerts) from the `drone_scans` table.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | Public | Health check with DB status |
| GET | `/stats` | JWT | Get current aggregated dashboard statistics |
| GET | `/trigger` | JWT | Manually trigger aggregation job |

## Key Modules

| File | Role |
|------|------|
| `main.rs` | App bootstrap, scheduler setup (30s cron), router, DashboardStats struct, aggregation queries |
| `auth.rs` | Auth client — delegates to rust-core-service |
| `middleware.rs` | Auth middleware (JWT + service key) |

## Data Model — DashboardStats
- `total_scans_today` / `total_scans_week` — scan counts
- `pending_analyses` / `completed_analyses` / `failed_analyses` — inference pipeline status
- `avg_processing_time_ms` — average inference processing time
- `zones_scanned` — distinct warehouse zones
- `items_detected` — count from detected_texts JSONB
- `damage_alerts` — scans with damage_detected = true
- `last_updated` — timestamp

## Dependencies (Cargo.toml)
- **Web**: axum 0.7, tokio, tower-http (cors, trace)
- **Database**: sqlx 0.7 (postgres, uuid, chrono, json)
- **Scheduling**: tokio-cron-scheduler 0.10
- **HTTP Client**: reqwest 0.11 (for auth service calls)
- **Observability**: tracing, tracing-subscriber
- **Misc**: serde, serde_json, uuid, chrono, dotenvy, thiserror, anyhow

## Deployment
- **Port**: 8002 (configurable via `PORT`)
- **Dockerfile**: Multi-stage Rust build
- **Railway**: Deployed as standalone service
- **Env vars**: `DATABASE_URL`, `RUST_CORE_URL`, `RUST_CORE_API_KEY`

## Architecture Notes
- Lightweight service — only 3 source files
- Cron-based aggregation every 30 seconds queries `drone_scans` table
- Auth delegated to rust-core-service
- Could be extended to push aggregated stats to a `dashboard_stats` table or notify via WebSocket

## Related
- [[Architecture]]
- [[RustService - Core Service]]
- [[RustService - rust-ai-service]]
- [[RustCore - Frontend Client]]