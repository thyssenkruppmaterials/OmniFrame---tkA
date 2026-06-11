// Created and developed by Jai Singh
//! rust-work-service - Work Management Service
//!
//! This service handles work queue management, task assignment, and
//! worker sessions for the OneBox AI logistics platform.
//!
//! ## Endpoints
//!
//! ### Public (no auth required)
//! - GET /health - Basic health check
//! - GET /health/detailed - Detailed health with dependency status
//! - GET /ws - WebSocket endpoint for real-time events
//!
//! ### Protected (auth required)
//! - GET /api/v1/work/queue - Get pending cycle counts
//! - GET /api/v1/work/queue/stats - Get queue statistics
//! - POST /api/v1/work/claim - Claim next available task
//! - POST /api/v1/work/push - Push task to specific user
//! - POST /api/v1/work/tasks/:id/start - Start a task
//! - POST /api/v1/work/tasks/:id/complete - Complete a task
//! - POST /api/v1/work/tasks/:id/release - Release task back to queue
//! - POST /api/v1/work/tasks/:id/acknowledge - Acknowledge pushed task
//! - GET /api/v1/workers - Get active workers
//! - GET /api/v1/workers/:id/tasks - Get worker's tasks
//! - POST /api/v1/workers/heartbeat - Send worker heartbeat
//! - GET /api/v1/sap-agents/fleet - Get fleet snapshot (Phase 3)
//! - GET /api/v1/sap-agents/jobs/recent - Get recent SAP-agent job ledger (Phase 3)
//! - POST /api/v1/sap-console/lines - Fleet-wide live console relay (Phase 6)
//! - POST /api/v1/sap-mutations/material-master - Server-side defence-in-depth wrapper for MM02 mutations (Phase 5)
//! - GET /api/v1/sap-testing/dashboard - Aggregated SAP Testing dashboard (online agents + in-flight jobs + recent audits + scheduled jobs + fleet capabilities) (Phase 8)
//!
//! ## Port
//! Runs on port 8030 by default (configurable via PORT env var)

// mimalloc global allocator (2026-05-31). Replaces the system glibc
// allocator process-wide for lower fragmentation / RSS and faster
// alloc-heavy paths (WS broadcast fan-out, per-NOTIFY deserialize,
// per-request JSON). Drop-in: no other code changes, compatible with
// `#[tokio::main]` and the glibc/bookworm Docker build.
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

mod agent_jwt;
mod api;
mod auth;
mod config;
mod cycle_count_listener;
mod db;
mod entity_focus;
mod lx03_listener;
mod middleware;
mod notifications_listener;
mod observability;
mod omnibelt_listener;
mod pglistener;
mod presence;
mod rf_putaway_listener;
mod sap_agents_listener;
mod sap_import_runs_listener;
mod sap_jobs_listener;
mod scheduler;
mod settings;
mod strategies;
mod triggers;
mod websocket;
mod ws_token;
// 2026-05-06 PM — Worker 2's Tier 1 deferred-channel listeners landed
// during the post-sprint reconciliation pass (cycle_count_listener,
// lx03_listener, sap_import_runs_listener, sap_jobs_listener).

use axum::{routing::get, Router};
use axum::http::header::HeaderValue;
use bb8_redis::RedisConnectionManager;
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::api::routes::{
    agent_identity_protected_routes, agent_identity_public_routes, dispatch_routes,
    entity_focus_routes, health_check, health_check_detailed, metrics_endpoint,
    notifications_routes, presence_routes, sap_agents_routes, sap_console_routes,
    sap_mutations_routes, sap_testing_routes, triggers_routes, work_routes, workers_routes,
};
use crate::auth::{AuthClient, AuthConfig};
use crate::config::AppConfig;
use crate::settings::cache::SettingsCache;
use crate::strategies::DispatchStrategyRegistry;
use crate::websocket::{ws_handler, WsEvent};

fn parse_cors_origins() -> Vec<HeaderValue> {
    let origins_str = match std::env::var("CORS_ALLOWED_ORIGINS") {
        Ok(val) => val,
        Err(_) => {
            let is_prod = std::env::var("RAILWAY_ENVIRONMENT")
                .or_else(|_| std::env::var("RUST_ENV"))
                .map(|e| e == "production")
                .unwrap_or(false);
            if is_prod {
                tracing::warn!(
                    "CORS_ALLOWED_ORIGINS not set in production! Defaulting to localhost origins. \
                     Set CORS_ALLOWED_ORIGINS to your frontend domain(s)."
                );
            }
            "http://localhost:5173,http://localhost:3000".to_string()
        }
    };

    origins_str
        .split(',')
        .filter_map(|s| {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                trimmed.parse::<HeaderValue>().ok()
            }
        })
        .collect()
}

/// Application state shared across all handlers.
///
/// Mirrors `rust_work_service::AppState` but is the binary-side struct
/// since `main.rs` doesn't import the library crate. `strategy_registry`
/// and `settings_cache` (Item 12 from the cutover-invariants plan) are
/// shared `Arc` slots so handlers can resolve a `DispatchStrategy` per
/// request without paying an allocation. The cache is invalidated by
/// the `LISTEN work_engine_settings_changed` consumer.
pub struct AppState {
    /// Primary PostgreSQL pool. Use for: mutations, scheduler reaper
    /// writes, read-after-write paths, anything that must observe its
    /// own writes.
    pub db_pool: sqlx::PgPool,
    /// Read-only pool. Points at the Supabase read replica when
    /// `WORK_SERVICE_DATABASE_READ_POOLER_URL` is set; otherwise a
    /// clone of `db_pool`. Use for: pure SELECTs / aggregations
    /// (`get_queue_stats`, `get_pending_cycle_counts` candidate scan,
    /// dashboards). Tolerates ~50-100 ms replication lag.
    pub read_pool: sqlx::PgPool,
    pub redis_pool: bb8::Pool<RedisConnectionManager>,
    pub auth_client: AuthClient,
    pub ws_broadcast: broadcast::Sender<WsEvent>,
    /// WorkType dispatcher registry (Item 12).
    pub strategy_registry: Arc<DispatchStrategyRegistry>,
    /// Per-org settings cache (Item 12).
    pub settings_cache: Arc<SettingsCache>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load environment variables from .env file
    dotenvy::dotenv().ok();

    // Initialize tracing/logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rust_work_service=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting rust-work-service v{}", env!("CARGO_PKG_VERSION"));

    // Item 7b (post-audit, 2026-05-07) — eagerly create every known
    // counter series at zero so `/metrics` exposes the full label
    // set from the moment the service comes up. Idempotent, runs
    // exactly once, must happen BEFORE any spawned task can start
    // emitting metrics so the seeded zeros never overwrite a real
    // observation. See `observability::metrics::init_zero_value_series`.
    observability::metrics::init_zero_value_series();
    tracing::info!(
        "metrics: per-channel + per-WsEvent-variant series \
         zero-initialised for stable dashboard labels"
    );

    // Load configuration
    let config = AppConfig::from_env();
    tracing::info!("Configuration loaded, server port: {}", config.server_port);

    // Create PostgreSQL connection pools.
    //
    // Item 17 — every connection carries the `work_engine.flag_overrides`
    // GUC populated from the `WORK_ENGINE_FLAG_OVERRIDES` env var
    // (consumed by migration 262's `work_engine_feature_flag` SQL helper).
    //
    // Item 4 (post-audit, 2026-05-07) — DUAL POOL pattern. Splits sqlx
    // pool traffic into two distinct pools so the long-tail listener
    // load doesn't block the HTTP / scheduler traffic from migrating
    // onto Supavisor's transaction pooler:
    //
    //   * `db_pool` (general-purpose, HTTP routes + scheduler + WS
    //     handler): when `WORK_SERVICE_DATABASE_POOLER_URL` is set,
    //     uses it (port 6543, transaction-mode pooler). Otherwise
    //     falls back to the direct URL — backwards-compatible.
    //
    //   * `listener_db_pool` (every `*_listener.rs` consumer +
    //     `settings::listener` + `triggers::loader` + `triggers::evaluator`
    //     + their nested `pglistener::run` calls): ALWAYS uses the
    //     direct URL (port 5432). LISTEN/NOTIFY requires a long-lived
    //     dedicated socket, which transaction-mode pooling
    //     multiplexes to death — sqlx `PgListener` against a
    //     transaction-pooled URL fails to receive frames at all.
    //
    // Item 5 (post-audit) — both pools tag their connections with an
    // `application_name` so `pg_stat_activity` audits can tell our
    // backends apart from pg_cron, the agent, edge functions, etc.
    // After this lands, the per-pool `application_name` shows up as:
    //
    //   * `rust-work-service` — every backend owned by `db_pool`
    //   * `rust-work-service-listener` — every backend (LISTEN socket
    //     + keepalive sender) owned by `listener_db_pool`
    //
    // Audit query (Supabase MCP / psql):
    //   SELECT application_name, COUNT(*)
    //     FROM pg_stat_activity
    //    WHERE application_name LIKE 'rust-work-service%'
    //    GROUP BY 1;

    let general_pool_url = config
        .database_pooler_url
        .as_deref()
        .unwrap_or(&config.database_url);
    let general_pool_via_pooler = config.database_pooler_url.is_some();
    tracing::info!(
        via_pooler = general_pool_via_pooler,
        "Initializing general-purpose PostgreSQL pool (lazy connect) ({}) ...",
        if general_pool_via_pooler {
            "WORK_SERVICE_DATABASE_POOLER_URL"
        } else {
            "DATABASE_URL (direct)"
        }
    );
    // 2026-05-14 — switch from eager `connect_with` to
    // `connect_lazy_with`. The previous eager init panicked on rolling
    // deploys whenever Supavisor's session-mode `pool_size` (16) was
    // already saturated by the OLD container's 20-connection share, e.g.
    // the 2026-05-14 12:55Z deploy where the Phase 0 fix never went live
    // because Railway flipped the new container to FAILED after 10
    // crash-loop retries on `(EMAXCONNSESSION) max clients reached in
    // session mode - max clients are limited to pool_size: 16`. The old
    // container kept serving stale code and James Dearman was still
    // getting `claim_next_task: capacity exhausted; returning None` at
    // 14:13Z. See `pool_setup::build_pool_with_flag_overrides_named_lazy`
    // for the long-form rationale and
    // `memorybank/OmniFrame/Debug/Fix-RF-Cycle-Count-Stuck-Waiting.md`
    // (James Dearman PM deep-dive) for the incident timeline.
    //
    // The basic `/health` endpoint never touches the pool, so Railway's
    // healthcheck passes immediately and Railway drains the OLD
    // container; by the time the FIRST HTTP route handler tries to
    // acquire a connection, Supavisor slots have freed up. We still
    // spawn a best-effort connectivity probe (10 s timeout) to surface
    // the diagnosis in logs if connectivity is broken — symmetric with
    // the Redis probe spawned a few lines below.
    let db_pool = db::pool_setup::build_pool_with_flag_overrides_named_lazy(
        general_pool_url,
        20,
        std::time::Duration::from_secs(10),
        Some("rust-work-service"),
    )
    .expect("Failed to parse general-purpose PostgreSQL pool config");
    tracing::info!(
        via_pooler = general_pool_via_pooler,
        application_name = "rust-work-service",
        "Initialized general-purpose PostgreSQL pool (lazy; first request opens the first connection)"
    );

    {
        let probe_pool = db_pool.clone();
        tokio::spawn(async move {
            const PROBE_TIMEOUT: std::time::Duration =
                std::time::Duration::from_secs(10);
            match tokio::time::timeout(PROBE_TIMEOUT, probe_pool.acquire()).await {
                Ok(Ok(_conn)) => {
                    tracing::info!(
                        "Postgres general-pool connectivity probe OK — pool is reachable"
                    );
                }
                Ok(Err(e)) => {
                    tracing::warn!(
                        error = %e,
                        "Postgres general-pool probe failed at boot — \
                         service will continue in degraded mode \
                         (HTTP routes that hit the pool will return 5xx). \
                         If this is a fresh rolling deploy, the OLD container is \
                         likely still holding Supavisor's session-mode slots; the \
                         probe will retry on the first real request after the OLD \
                         container drains. Check Supavisor pool_size and pg_stat_activity \
                         if the warning persists past the deploy window."
                    );
                }
                Err(_elapsed) => {
                    tracing::warn!(
                        timeout_secs = PROBE_TIMEOUT.as_secs(),
                        "Postgres general-pool probe timed out at boot — \
                         service will continue in degraded mode. See the warn \
                         message above for the rolling-deploy explanation."
                    );
                }
            }
        });
    }

    // Listener pool — direct URL only. Sized to absorb the small
    // number of consolidated multi-channel listener tasks plus their
    // pool-side keepalive sends.
    //
    // 2026-05-20 — listener-pool COMPRESSION. The pre-consolidation
    // shape spawned 13 single-channel listener tasks against a
    // `max_connections = 30` pool; `pg_stat_activity` showed 25
    // long-lived `idle` backends for `application_name =
    // 'rust-work-service-listener'` (13 dedicated `PgListener`
    // sockets + 12 keepalive-send slots the bb8 pool grew into and
    // never released). That was one of the largest single
    // contributors to the 120-conn Supabase Pro Small budget. See
    // [[Implementations/Compress-Rust-Work-Listener-Pool-2026-05-20]].
    //
    // After consolidation the binary spawns just TWO multi-channel
    // listener tasks (config + domain — see below), so the steady-
    // state shape is:
    //
    //   * 2 dedicated `PgListener` sockets (one per consolidated
    //     task, each `LISTEN`s on N channels over the same backend).
    //   * 2 min-idle pool slots (cheap to hold; avoids the cold-
    //     acquire spike on the first keepalive `pg_notify` after a
    //     quiescent overnight).
    //   * Headroom for the keepalive senders + the `trigger_evaluator`
    //     side-effect INSERTs (`INSERT INTO sap_agent_jobs ...`)
    //     and the `trigger_loader::reload(...)` SELECT after each
    //     `agent_triggers_changed` NOTIFY.
    //
    // `max_connections = 8` leaves ~4× the steady-state floor for
    // those bursts; `min_connections = 2` matches the listener-task
    // count so a transient pool churn doesn't open + close the same
    // sockets on every keepalive tick.
    //
    // 2026-05-14 PM (v0.1.42) — switched from eager
    // `build_pool_with_flag_overrides_named` to the lazy variant for
    // the same reason the general pool went lazy in this same file
    // earlier today: a rolling deploy where the OLD container still
    // holds Supavisor session-mode slots (in production
    // `DATABASE_URL` resolves through the same
    // `*.pooler.supabase.com` endpoint as the pooler URL, despite
    // the historical "DIRECT URL" framing) crashed v0.1.42's first
    // deploy attempt with `PoolTimedOut` at this exact line. The
    // `pglistener::run` reconnect loop already handles deferred
    // first-acquire — each LISTEN task that needs a dedicated
    // socket retries with exponential backoff until the OLD
    // container's slots free up — so the eager init was paying for
    // boot-time guarantees the runtime didn't actually need. See
    // `memorybank/OmniFrame/Debug/Fix-Trigger-Evaluator-Empty-After-v041-Restart.md`
    // ("Deploy attempt v0.1.42") for the failure timeline that
    // motivated this.
    const LISTENER_POOL_MAX: u32 = 8;
    const LISTENER_POOL_MIN: u32 = 2;
    tracing::info!(
        max_connections = LISTENER_POOL_MAX,
        min_connections = LISTENER_POOL_MIN,
        "Initializing listener-dedicated PostgreSQL pool (lazy connect, DATABASE_URL direct, compressed 2026-05-20)..."
    );
    let listener_db_pool = db::pool_setup::build_listener_pool_lazy(
        &config.database_url,
        LISTENER_POOL_MAX,
        LISTENER_POOL_MIN,
        std::time::Duration::from_secs(10),
        Some("rust-work-service-listener"),
    )
    .expect("Failed to parse listener-dedicated PostgreSQL pool config");
    tracing::info!(
        application_name = "rust-work-service-listener",
        "Initialized listener-dedicated PostgreSQL pool (lazy; LISTEN tasks open their first connections on demand via pglistener reconnect loop)"
    );

    {
        let probe_pool = listener_db_pool.clone();
        tokio::spawn(async move {
            const PROBE_TIMEOUT: std::time::Duration =
                std::time::Duration::from_secs(10);
            match tokio::time::timeout(PROBE_TIMEOUT, probe_pool.acquire()).await {
                Ok(Ok(_conn)) => {
                    tracing::info!(
                        "Postgres listener-pool connectivity probe OK — pool is reachable"
                    );
                }
                Ok(Err(e)) => {
                    tracing::warn!(
                        error = %e,
                        "Postgres listener-pool probe failed at boot — \
                         service will continue in degraded mode \
                         (LISTEN tasks will retry via pglistener reconnect loop). \
                         If this is a fresh rolling deploy, the OLD container is \
                         likely still holding Supavisor's session-mode slots; the \
                         LISTEN tasks will reconnect once the OLD container drains. \
                         Check Supavisor pool_size and pg_stat_activity if the warning \
                         persists past the deploy window."
                    );
                }
                Err(_elapsed) => {
                    tracing::warn!(
                        timeout_secs = PROBE_TIMEOUT.as_secs(),
                        "Postgres listener-pool probe timed out at boot — \
                         service will continue in degraded mode. See the warn \
                         message above for the rolling-deploy explanation."
                    );
                }
            }
        });
    }

    // Create Redis connection pool.
    //
    // Phase 11 (rust-work-service integration plan, 2026-05-07) — bumped
    // `max_size` 10 → 50 and pinned `min_idle` to 5 now that the service's
    // Redis usage has fanned out across multiple Phase 4-10 features:
    //   * Phase 4 — WS subscribe-token nonces (`/api/v1/work/ws-token`).
    //   * Phase 5 — per-material locks for Material Master mutations
    //     (`material_lock:{org}:{material}` — held for the duration of an
    //     RFC call, ~50-500 ms).
    //   * Phase 9 — trigger loop-detection counters
    //     (`trigger:depth:{org}:{row_id}` — INCR/EXPIRE per fire, 60 s TTL).
    //   * Phase 10 — agent-key revocation cache
    //     (`agent-identity:revoked:{key_id}` — read on every authenticated
    //     agent request, 60 s TTL).
    //   * Plus pre-existing presence + entity-focus + rate-limit usage.
    //
    // At a fleet of 4 agents + ~30 browsers per org, the worst-case
    // concurrent acquire was hitting the old 10-cap during dispatch
    // bursts (claim → trigger fire → material lock → audit) and queuing
    // for the bb8 timeout. 50 connections × ~30 KiB/conn ≈ 1.5 MiB
    // resident on the Redis client side — cheap for the headroom.
    // `min_idle = 5` keeps the warm-path latency stable through a
    // quiescent Citrix overnight (no acquire-on-idle reconnect storm at
    // the morning login spike).
    // 2026-05-11 — switch from eager `Pool::builder().build(...)` to
    // lazy `build_unchecked(...)`. The previous v0.1.39 retry-loop
    // approach (5 attempts with 1→2→4→8→16 s exponential backoff)
    // was the wrong tool for the failure mode we actually saw.
    //
    // What v0.1.39 logged on every fresh container boot:
    //   1. Postgres pools connect successfully (~700 ms each).
    //   2. "Connecting to Redis..." → ~41 s wait → bb8 returns Err
    //      with `Multiplexed connection driver unexpectedly
    //      terminated- IoError`.
    //   3. Each retry hits the SAME error (~41 s × 5 attempts).
    //   4. Service panics after ~4 min, before Railway's 5 min
    //      healthcheck window closes.
    //
    // The 41 s wall-clock per attempt is bb8 trying to fill
    // `min_idle = 5` against a Redis endpoint that accepts the TCP
    // handshake then kills the multiplexed connection — i.e. the
    // failure is deterministic, not transient. Retrying 5× just
    // delays the panic; backoff doesn't help.
    //
    // Why the surviving v0.1.36 container is healthy on the SAME
    // `REDIS_URL`: it established its 50-conn pool 36 h ago and
    // the underlying TCP sockets are still alive — bb8 reconnects
    // multiplexed connections behind the live pool without
    // re-establishing the initial handshake that's now refused.
    // New containers can't get past the handshake. Most likely
    // root cause is infrastructure-level (Redis Cloud max-clients
    // hit, IP allowlist drift on Railway egress IP rotation, or a
    // capped tier rejecting handshakes that exceed the pool cap).
    // See [[Debug/Fix-Rust-Work-Service-Redis-Pool-Init-Crash]]
    // "Round 2" for the full diagnosis.
    //
    // `build_unchecked` returns the pool synchronously without
    // touching the network. The first request that calls
    // `pool.get().await` takes the connection hit. The presence /
    // entity-focus / trigger-evaluator background tasks all
    // already log Redis errors at `warn!` and continue (see
    // `presence::evictor::run` doc — "All Redis errors are logged
    // at `tracing::warn!` and the task continues"), so a Redis
    // outage is now a degraded-mode condition rather than a boot
    // panic. Route handlers that use Redis (presence heartbeat,
    // idempotency middleware, agent-key revocation cache, rate
    // limit) propagate `bb8::RunError` as 500 to the caller —
    // same shape as a Redis blip mid-operation, which the FE
    // already retries.
    //
    // We still spawn a best-effort probe at boot (5 s timeout)
    // that logs whether Redis is reachable. The probe never
    // panics — it only surfaces the diagnosis up to whoever is
    // watching the logs after `railway up`. If it fails, the
    // operator's next move is to check Redis Cloud, not to
    // redeploy.
    tracing::info!(
        "Initializing Redis pool (lazy connect via build_unchecked)..."
    );
    let redis_manager = RedisConnectionManager::new(config.redis_url.clone())
        .expect("Failed to create Redis connection manager");
    let redis_pool = bb8::Pool::builder()
        .max_size(50)
        .min_idle(Some(5))
        .build_unchecked(redis_manager);
    tracing::info!(
        "Redis pool created (bb8: max_size=50, min_idle=5 — Phase 11; \
         lazy build_unchecked added 2026-05-11 v0.1.40 — first request \
         takes the connection hit, evictors warn-and-continue)"
    );

    {
        let probe_pool = redis_pool.clone();
        tokio::spawn(async move {
            const PROBE_TIMEOUT: std::time::Duration =
                std::time::Duration::from_secs(5);
            match tokio::time::timeout(PROBE_TIMEOUT, probe_pool.get()).await {
                Ok(Ok(_conn)) => {
                    tracing::info!(
                        "Redis connectivity probe OK — pool is reachable"
                    );
                }
                Ok(Err(e)) => {
                    tracing::warn!(
                        error = %e,
                        "Redis connectivity probe failed at boot — \
                         service will continue in degraded mode \
                         (Redis-dependent endpoints will return 500). \
                         Check Redis Cloud max-conns / allowlist."
                    );
                }
                Err(_elapsed) => {
                    tracing::warn!(
                        timeout_secs = PROBE_TIMEOUT.as_secs(),
                        "Redis connectivity probe timed out at boot — \
                         service will continue in degraded mode. \
                         Check Redis Cloud max-conns / allowlist."
                    );
                }
            }
        });
    }

    // Initialize auth client
    let (cache_ttl_secs, cache_max_capacity) = AuthConfig::cache_settings_from_env();
    let auth_config = AuthConfig {
        rust_core_url: config.rust_core_url.clone(),
        service_api_key: config.rust_core_api_key.clone(),
        timeout_secs: config.auth_timeout_secs,
        cache_ttl_secs,
        cache_max_capacity,
    };
    let auth_client = AuthClient::new(auth_config);
    tracing::info!(
        "Auth client initialized for rust-core-service at {}",
        config.rust_core_url
    );

    // Create WebSocket broadcast channel
    let (ws_tx, _ws_rx) = websocket::create_broadcast_channel();
    tracing::info!("WebSocket broadcast channel created");

    // Item 12: WorkType dispatcher registry + per-org settings cache.
    let strategy_registry = Arc::new(DispatchStrategyRegistry::new());
    let settings_cache = Arc::new(SettingsCache::new());

    // ── Read-replica pool ────────────────────────────────────────────────
    //
    // Optional third pool that routes pure-read traffic at the Supabase
    // read replica. When `WORK_SERVICE_DATABASE_READ_POOLER_URL` (or
    // `DATABASE_READ_POOLER_URL`) is unset, `read_pool` is a clone of
    // `db_pool` so call sites can use `state.read_pool` unconditionally
    // and the runtime behaviour stays identical.
    //
    // Why a third pool (not just a query-string switch on the existing
    // general pool): replication lag (typically <50 ms but unbounded under
    // load) means a read against the replica can return stale rows. We
    // route only safe sites — queue-stats broadcasts, `get_pending_cycle_counts`
    // candidate scans — that are either pure aggregates or that the
    // claim/push paths re-validate under row-lock anyway. Mutations,
    // LISTEN/NOTIFY, scheduler reaper functions, and any path that must
    // observe its own writes continue to go through `db_pool`.
    //
    // Same lazy-connect rationale applies as for the general pool: a
    // fresh container should boot even if Supavisor session-mode slots
    // are temporarily saturated by a draining sibling.
    let read_pool = if let Some(read_url) = config.database_read_pooler_url.as_deref() {
        tracing::info!(
            via_pooler = true,
            "Initializing read-only PostgreSQL pool (lazy connect, WORK_SERVICE_DATABASE_READ_POOLER_URL) ..."
        );
        let pool = db::pool_setup::build_pool_with_flag_overrides_named_lazy(
            read_url,
            20,
            std::time::Duration::from_secs(10),
            Some("rust-work-service-read"),
        )
        .expect("Failed to parse read-only PostgreSQL pool config");
        tracing::info!(
            application_name = "rust-work-service-read",
            "Initialized read-only PostgreSQL pool (lazy)"
        );
        pool
    } else {
        tracing::info!(
            "WORK_SERVICE_DATABASE_READ_POOLER_URL unset; read_pool falls back to db_pool"
        );
        db_pool.clone()
    };

    // Create shared application state
    let state = Arc::new(AppState {
        db_pool: db_pool.clone(),
        read_pool: read_pool.clone(),
        redis_pool,
        auth_client,
        ws_broadcast: ws_tx.clone(),
        strategy_registry: strategy_registry.clone(),
        settings_cache: settings_cache.clone(),
    });

    // ───────────────────────────────────────────────────────────────
    // LISTEN/NOTIFY consumers — CONSOLIDATED multi-channel listeners.
    //
    // 2026-05-20 — listener-pool COMPRESSION. The pre-consolidation
    // shape spawned ONE `tokio::spawn` per channel:
    //
    //    1.  settings::listener::run         (work_engine_settings_changed)
    //    2.  sap_agents_listener::run        (sap_agent_changed)
    //    3.  sap_jobs_listener::run          (sap_agent_job_changed)
    //    4.  sap_import_runs_listener::run   (sap_import_run_changed)
    //    5.  cycle_count_listener::run       (cycle_count_data_changed)
    //    6.  lx03_listener::run              (lx03_data_changed)
    //    7.  rf_putaway_listener::run        (rf_putaway_operation_changed)
    //    8.  notifications_listener::run     (notification_created)
    //    9.  triggers::loader::run           (agent_triggers_changed)
    //   10–13. triggers::evaluator::run      (one per allowlisted table)
    //
    // …each holding ONE dedicated `PgListener` Postgres backend for
    // life, regardless of `pg_notify` traffic. That's 13 long-lived
    // backends from a 30-slot pool — production was carrying ~25
    // `application_name = 'rust-work-service-listener'` rows (13
    // dedicated sockets + 12 keepalive-send slots) against a 120
    // Supabase max_connections budget. See
    // [[Implementations/Compress-Rust-Work-Listener-Pool-2026-05-20]].
    //
    // The replacement spawns just TWO multi-channel listener tasks:
    //
    //   * `config_listener_task` — config / hot-reload plane (2
    //     channels). Isolated from the domain-event plane so a
    //     hot-loop on `cycle_count_data_changed` can't stall a
    //     manager's settings flip.
    //
    //   * `domain_listener_task` — every domain-event channel (9
    //     channels: 7 WS-broadcast + 2 evaluator-only that don't
    //     have a publisher today but are pre-registered so a
    //     future `work_tasks_changed` / `shipment_queue_changed`
    //     NOTIFY trigger lights up without a Rust release).
    //     Routes by `frame.channel.as_str()` to per-module
    //     `handle(...)` functions; the channels that have BOTH a
    //     WS-broadcast handler AND a trigger-evaluator handler
    //     (`rf_putaway_operation_changed`, `sap_agent_job_changed`)
    //     run both in sequence — preserving the pre-consolidation
    //     event-handling semantics exactly.
    //
    // Net `pg_stat_activity` shape for
    // `application_name = 'rust-work-service-listener'`:
    //
    //   Before: 13 dedicated + ~12 keepalive-pool ≈ 25 backends.
    //   After:   2 dedicated +  ~2 keepalive-pool ≈  4–5 backends
    //           (pool capped at 8 — generous headroom for the
    //           evaluator's INSERTs + loader's reload SELECT).
    //
    // Every NOTIFY still reaches the same downstream handler;
    // ordering of frames within a single channel is preserved by
    // Postgres' single-socket FIFO; cross-channel ordering on the
    // same task is best-effort serial (which matches the prior
    // per-task serial behaviour — there was no cross-task ordering
    // guarantee before either).
    //
    // All listener subsystems run against `listener_db_pool` (direct
    // URL, port 5432) — see the dual-pool comment block above. This
    // MUST stay direct because LISTEN/NOTIFY needs a long-lived
    // dedicated TCP socket that transaction-mode pooling
    // multiplexes to death.

    // Trigger DSL hot-reload rule set — shared between the loader
    // (writes on reload) and the evaluator (reads on every frame).
    // Same `Arc<RwLock<_>>` shape the per-channel spawn used pre-
    // consolidation; only the wire-up changed.
    let trigger_set = std::sync::Arc::new(tokio::sync::RwLock::new(
        crate::triggers::loader::TriggerSet::default(),
    ));

    // Boot-time bounded-retry initial load of the trigger rule set.
    // Pulled out of `triggers::loader::run` so the LISTEN side
    // (which now shares its socket with `work_engine_settings_changed`)
    // doesn't block on the SELECT.
    {
        let loader_pool = listener_db_pool.clone();
        let loader_set = trigger_set.clone();
        tokio::spawn(async move {
            crate::triggers::loader::initial_load(loader_pool, loader_set).await;
        });
    }

    // ── Config / hot-reload listener ────────────────────────────────
    let config_channels = vec![
        settings::listener::CHANNEL.to_string(),
        crate::triggers::loader::CHANNEL.to_string(),
    ];
    tracing::info!(
        listener = "config",
        max_connections = LISTENER_POOL_MAX,
        channels = ?config_channels,
        "Listener pool: spawning consolidated config-plane PgListener"
    );
    {
        let pool = listener_db_pool.clone();
        let callback_pool = listener_db_pool.clone();
        let settings_cache = settings_cache.clone();
        let trigger_set = trigger_set.clone();
        let channels = config_channels.clone();
        tokio::spawn(async move {
            pglistener::run_multi(pool, channels, "config", move |frame| {
                let pool = callback_pool.clone();
                let settings_cache = settings_cache.clone();
                let trigger_set = trigger_set.clone();
                async move {
                    match frame.channel.as_str() {
                        c if c == settings::listener::CHANNEL => {
                            settings::listener::handle(&frame, &settings_cache).await;
                        }
                        c if c == crate::triggers::loader::CHANNEL => {
                            crate::triggers::loader::handle(&frame, &pool, &trigger_set).await;
                        }
                        other => {
                            tracing::warn!(
                                channel = %other,
                                "config listener: dropping frame on unmapped channel"
                            );
                        }
                    }
                }
            })
            .await;
        });
    }

    // ── Domain-event listener ──────────────────────────────────────
    //
    // Channel list is the union of (every per-module `CHANNEL`) and
    // (every channel the evaluator subscribes to). `rf_putaway_*` and
    // `sap_agent_job_*` appear in BOTH and dispatch to BOTH handlers
    // — see the match arms below.
    let evaluator_channels = crate::triggers::evaluator::evaluator_channels();
    let mut domain_channels: Vec<String> = vec![
        sap_agents_listener::CHANNEL.to_string(),
        sap_jobs_listener::CHANNEL.to_string(),
        sap_import_runs_listener::CHANNEL.to_string(),
        cycle_count_listener::CHANNEL.to_string(),
        lx03_listener::CHANNEL.to_string(),
        rf_putaway_listener::CHANNEL.to_string(),
        notifications_listener::CHANNEL.to_string(),
        omnibelt_listener::CHANNEL.to_string(),
    ];
    // Add any evaluator-only channels (the ones that aren't already
    // covered above — `work_tasks_changed`, `shipment_queue_changed`
    // as of 2026-05-20).
    for ch in &evaluator_channels {
        if !domain_channels.iter().any(|existing| existing == ch) {
            domain_channels.push(ch.clone());
        }
    }
    tracing::info!(
        listener = "domain",
        max_connections = LISTENER_POOL_MAX,
        channels = ?domain_channels,
        "Listener pool: spawning consolidated domain-plane PgListener"
    );
    {
        let pool = listener_db_pool.clone();
        let callback_pool = listener_db_pool.clone();
        let ws_tx = ws_tx.clone();
        let redis_pool = state.redis_pool.clone();
        let trigger_set = trigger_set.clone();
        let channels = domain_channels.clone();
        tokio::spawn(async move {
            pglistener::run_multi(pool, channels, "domain", move |frame| {
                let pool = callback_pool.clone();
                let ws_tx = ws_tx.clone();
                let redis_pool = redis_pool.clone();
                let trigger_set = trigger_set.clone();
                async move {
                    // Dispatch by channel name. Channels that have
                    // BOTH a WS-broadcast consumer AND a trigger-
                    // evaluator consumer run BOTH (sequentially) to
                    // preserve pre-consolidation semantics — exactly
                    // the pre-2026-05-20 fan-out, just sharing one
                    // PgListener socket instead of two per channel.
                    match frame.channel.as_str() {
                        c if c == sap_agents_listener::CHANNEL => {
                            sap_agents_listener::handle(&frame, &ws_tx).await;
                        }
                        c if c == sap_jobs_listener::CHANNEL => {
                            sap_jobs_listener::handle(&frame, &pool, &ws_tx).await;
                            crate::triggers::evaluator::handle(
                                &frame,
                                &pool,
                                &redis_pool,
                                &trigger_set,
                                &ws_tx,
                            )
                            .await;
                        }
                        c if c == sap_import_runs_listener::CHANNEL => {
                            sap_import_runs_listener::handle(&frame, &ws_tx).await;
                        }
                        c if c == cycle_count_listener::CHANNEL => {
                            cycle_count_listener::handle(&frame, &ws_tx).await;
                        }
                        c if c == lx03_listener::CHANNEL => {
                            lx03_listener::handle(&frame, &ws_tx).await;
                        }
                        c if c == rf_putaway_listener::CHANNEL => {
                            rf_putaway_listener::handle(&frame, &ws_tx).await;
                            crate::triggers::evaluator::handle(
                                &frame,
                                &pool,
                                &redis_pool,
                                &trigger_set,
                                &ws_tx,
                            )
                            .await;
                        }
                        c if c == notifications_listener::CHANNEL => {
                            notifications_listener::handle(&frame, &ws_tx).await;
                        }
                        c if c == omnibelt_listener::CHANNEL => {
                            omnibelt_listener::handle(&frame, &redis_pool, &ws_tx).await;
                        }
                        other => {
                            // Evaluator-only channels (work_tasks_changed,
                            // shipment_queue_changed): no per-domain
                            // listener to call, but if a future
                            // migration installs the matching NOTIFY
                            // trigger this lights up automatically.
                            if crate::triggers::evaluator::table_for_channel(other).is_some() {
                                crate::triggers::evaluator::handle(
                                    &frame,
                                    &pool,
                                    &redis_pool,
                                    &trigger_set,
                                    &ws_tx,
                                )
                                .await;
                            } else {
                                tracing::warn!(
                                    channel = %other,
                                    "domain listener: dropping frame on unmapped channel"
                                );
                            }
                        }
                    }
                }
            })
            .await;
        });
    }

    // ── Redis-driven evictors (NOT PgListener — no connection cost) ─
    //
    // 2026-05-06 — server-side presence (Option 2 from
    // `memorybank/OmniFrame/Decisions/ADR-Presence-Architecture-Next-Steps.md`).
    // The evictor sweeps `presence:org:*` HSETs every 30s, removing
    // rows whose 90s TTL elapsed and broadcasting `PresenceLeft`
    // events through the existing WS fan-out. Heartbeats land on
    // `POST /api/v1/presence/heartbeat`; the route handler does the
    // HSET write and broadcasts `PresenceJoined` / `PresenceUpdated`.
    let presence_redis_pool = state.redis_pool.clone();
    let presence_tx = ws_tx.clone();
    tokio::spawn(async move {
        presence::evictor::run(presence_redis_pool, presence_tx).await;
    });
    tracing::info!("presence evictor spawned (30s tick, 90s TTL)");

    // 2026-05-06 — Tier 2 #1 entity-focus subsystem (sibling to the
    // presence subsystem). Tracks "who is editing this row right
    // now" via a separate Redis schema (presence:focus:{org}:{kind}:{id})
    // with a 30s TTL — half of presence's 90s because focus leases
    // are short-lived. The evictor runs INDEPENDENTLY (separate task)
    // so a transient Redis hiccup that breaks one doesn't stall the
    // other. See `Implementations/Implement-Entity-Soft-Locking-Tier2-1.md`.
    let entity_focus_redis_pool = state.redis_pool.clone();
    let entity_focus_tx = ws_tx.clone();
    tokio::spawn(async move {
        entity_focus::evictor::run(entity_focus_redis_pool, entity_focus_tx).await;
    });
    tracing::info!("entity_focus evictor spawned (30s tick, 30s TTL)");

    // Build router
    // Public routes (no authentication required)
    // Note: WebSocket is public to allow initial connection before auth handshake
    // `/metrics` is public so Prometheus scrapers don't need to mint JWTs;
    // operators MUST front this with network ACLs (cluster-internal only).
    let public_routes = Router::new()
        .route("/health", get(health_check))
        .route("/health/detailed", get(health_check_detailed))
        .route("/metrics", get(metrics_endpoint))
        .route("/ws", get(ws_handler))
        // Phase 10 (2026-05-07) — agent identity v2. The `/exchange`
        // route is public because agents have no JWT yet — they trade
        // their plaintext `omni_sk_*` service key for a 15-min
        // `kind: "agent"` JWT signed by `WORK_SERVICE_AGENT_JWT_SECRET`.
        // The other three identity routes (`/register`, `/revoke`,
        // `/list`) are admin-only and live on `protected_routes` below.
        .nest("/api/v1/agent-identity", agent_identity_public_routes());

    // Protected routes (authentication required)
    // Mount order: alphabetical within each thematic group; the
    // `/api/v1/sap-agents` group is the Phase 3 (2026-05-06)
    // bootstrap-snapshot owner that pairs with the
    // `WsEvent::SapAgentChanged` + `SapJobStatusChanged` push path.
    let protected_routes = Router::new()
        .nest("/api/v1/work", work_routes())
        .nest("/api/v1/workers", workers_routes())
        .nest("/api/v1/presence", presence_routes())
        .nest("/api/v1/sap-agents", sap_agents_routes())
        // Phase 6 (2026-05-07) — fleet-wide live console streaming.
        // Mounted alphabetically between `/sap-agents` and `/sap-mutations`
        // — agent's `_console_relay_thread` POSTs batches of recent
        // stdout/stderr lines, the route fans each out as a
        // `WsEvent::SapAgentConsoleLine`. See
        // `Implementations/Implement-Rust-Work-Service-Phase6.md`.
        .nest("/api/v1/sap-console", sap_console_routes())
        // Phase 5 (2026-05-06) — server-side defence-in-depth wrapper
        // for the highest-risk SAP Testing surface (Material Master
        // mutations). Nested alphabetically right after the Phase 3
        // `/api/v1/sap-agents` group. See
        // `Implementations/Implement-Rust-Work-Service-Phase5.md`.
        .nest("/api/v1/sap-mutations", sap_mutations_routes())
        // Phase 8 (2026-05-06) — server-owned SAP Testing dashboard
        // snapshot. Single endpoint that runs the four sub-queries
        // the FE used to fan out (online agents / in-flight jobs /
        // recent audits / scheduled jobs) in parallel via
        // `tokio::try_join!`. See
        // `Implementations/Implement-Rust-Work-Service-Phase8.md`.
        .nest("/api/v1/sap-testing", sap_testing_routes())
        // Tier 2 (2026-05-06) — three new product surfaces.
        .nest("/api/v1/entity-focus", entity_focus_routes())
        .nest("/api/v1/notifications", notifications_routes())
        .nest("/api/v1/dispatch", dispatch_routes())
        // Phase 9 (2026-05-07) — server-side trigger DSL evaluator
        // CRUD. Replaces the browser-side `use-agent-trigger-runtime.ts`
        // and the agent-side `_HARDCODED_TRIGGERS`. See
        // `Implementations/Implement-Rust-Work-Service-Phase9.md`.
        .nest("/api/v1/triggers", triggers_routes())
        // Phase 10 (2026-05-07) — admin-only agent identity v2
        // management routes (register / revoke / list). The
        // `/exchange` sibling lives on `public_routes` above
        // because agents have no JWT yet at exchange time. See
        // ADR-Agent-Identity-V2-Phase10 and
        // `Implementations/Implement-Rust-Work-Service-Phase10.md`.
        .nest("/api/v1/agent-identity", agent_identity_protected_routes())
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::require_auth,
        ));

    // Combine all routes
    //
    // Phase 2 (2026-05-06) — `track_http_metrics` is layered at the
    // top so it sees every request (public + protected, including
    // /health, /metrics, and /ws upgrade attempts). It populates
    // `work_http_requests_total{route,method,status}` which backs the
    // `WorkServiceHealthFailing` alert (5xx-rate threshold).
    let app = Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .layer(axum::middleware::from_fn(
            observability::http_metrics::track_http_metrics,
        ))
        .layer({
            let origins = parse_cors_origins();
            CorsLayer::new()
                .allow_origin(origins)
                .allow_methods([
                    axum::http::Method::GET,
                    axum::http::Method::POST,
                    axum::http::Method::PUT,
                    axum::http::Method::PATCH,
                    axum::http::Method::DELETE,
                    axum::http::Method::OPTIONS,
                ])
                .allow_headers([
                    axum::http::header::AUTHORIZATION,
                    axum::http::header::CONTENT_TYPE,
                    axum::http::header::ACCEPT,
                    "X-Service-Key".parse().unwrap(),
                    "X-Organization-ID".parse().unwrap(),
                ])
        })
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Start background scheduler. Pass both pools: writes (reaper functions)
    // route through primary, queue-stats broadcasts route through replica.
    let scheduler_pool = db_pool.clone();
    let scheduler_read_pool = read_pool.clone();
    let scheduler_tx = ws_tx.clone();
    tokio::spawn(async move {
        if let Err(e) =
            scheduler::start_scheduler(scheduler_pool, scheduler_read_pool, scheduler_tx).await
        {
            tracing::error!("Failed to start background scheduler: {}", e);
        }
    });

    // Start HTTP server
    let addr = format!("0.0.0.0:{}", config.server_port);
    tracing::info!("Starting HTTP server on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("rust-work-service is ready and listening on {}", addr);
    tracing::info!("WebSocket endpoint available at ws://{}/ws", addr);

    axum::serve(listener, app).await?;

    Ok(())
}

// Created and developed by Jai Singh
