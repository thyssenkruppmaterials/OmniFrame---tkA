// Created and developed by Jai Singh
//! rust-work-service library
//!
//! Work Management Service for OneBox AI logistics platform.
//! Handles work queues, task assignment, and worker sessions.

pub mod agent_jwt;
pub mod api;
pub mod auth;
pub mod config;
pub mod cycle_count_listener;
pub mod db;
pub mod entity_focus;
pub mod lx03_listener;
pub mod middleware;
pub mod notifications_listener;
pub mod observability;
pub mod pglistener;
pub mod presence;
pub mod rf_putaway_listener;
pub mod sap_agents_listener;
pub mod sap_import_runs_listener;
pub mod sap_jobs_listener;
pub mod scheduler;
pub mod settings;
pub mod strategies;
pub mod triggers;
pub mod websocket;
pub mod ws_token;
// 2026-05-06 PM — Worker 2's Tier 1 deferred-channel listeners
// (`cycle_count_listener`, `lx03_listener`, `sap_import_runs_listener`,
// `sap_jobs_listener`) landed during the post-sprint reconciliation
// pass. See `Implementations/Migrate-Tier1-Deferred-Channels-To-Rust-WS.md`
// "Reconciliation 2026-05-06" footnote.

use auth::AuthClient;
use settings::cache::SettingsCache;
use std::sync::Arc;
use strategies::DispatchStrategyRegistry;
use tokio::sync::broadcast;
use websocket::WsEvent;

/// Application state shared across all handlers
///
/// Contains connection pools, service clients, and the WorkType
/// dispatcher plumbing needed by route handlers.
///
/// `strategy_registry` and `settings_cache` (Item 12 from the cutover-
/// invariants plan) are shared `Arc` slots so the route handlers can
/// resolve a `DispatchStrategy` per request without paying an
/// allocation. The cache is invalidated by the LISTEN consumer in
/// `settings::listener`.
#[derive(Clone)]
pub struct AppState {
    /// PostgreSQL connection pool (primary; writes + read-after-write paths)
    pub db_pool: sqlx::PgPool,
    /// Read-only PostgreSQL pool. Points at the Supabase read replica
    /// when `WORK_SERVICE_DATABASE_READ_POOLER_URL` is configured;
    /// otherwise this is a clone of `db_pool` so call sites stay
    /// uniform. Use for pure SELECTs / aggregations / dashboards.
    pub read_pool: sqlx::PgPool,
    /// Redis connection pool for caching
    pub redis_pool: bb8::Pool<bb8_redis::RedisConnectionManager>,
    /// Authentication client for validating tokens
    pub auth_client: AuthClient,
    /// WebSocket broadcast channel for real-time events
    pub ws_broadcast: broadcast::Sender<WsEvent>,
    /// WorkType dispatcher registry (Item 12).
    pub strategy_registry: Arc<DispatchStrategyRegistry>,
    /// Per-org settings cache (Item 12).
    pub settings_cache: Arc<SettingsCache>,
}

impl AppState {
    /// Create a new AppState with the provided pools and auth client
    pub fn new(
        db_pool: sqlx::PgPool,
        read_pool: sqlx::PgPool,
        redis_pool: bb8::Pool<bb8_redis::RedisConnectionManager>,
        auth_client: AuthClient,
        ws_broadcast: broadcast::Sender<WsEvent>,
    ) -> Self {
        Self {
            db_pool,
            read_pool,
            redis_pool,
            auth_client,
            ws_broadcast,
            strategy_registry: Arc::new(DispatchStrategyRegistry::new()),
            settings_cache: Arc::new(SettingsCache::new()),
        }
    }
}

// Created and developed by Jai Singh
