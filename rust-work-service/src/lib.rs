//! rust-work-service library
//!
//! Work Management Service for OmniFrame logistics platform.
//! Handles work queues, task assignment, and worker sessions.

pub mod api;
pub mod auth;
pub mod config;
pub mod db;
pub mod middleware;
pub mod scheduler;
pub mod websocket;

use auth::AuthClient;
use tokio::sync::broadcast;
use websocket::WsEvent;

/// Application state shared across all handlers
///
/// Contains connection pools and service clients needed by route handlers.
#[derive(Clone)]
pub struct AppState {
    /// PostgreSQL connection pool
    pub db_pool: sqlx::PgPool,
    /// Redis connection pool for caching
    pub redis_pool: bb8::Pool<bb8_redis::RedisConnectionManager>,
    /// Authentication client for validating tokens
    pub auth_client: AuthClient,
    /// WebSocket broadcast channel for real-time events
    pub ws_broadcast: broadcast::Sender<WsEvent>,
}

impl AppState {
    /// Create a new AppState with the provided pools and auth client
    pub fn new(
        db_pool: sqlx::PgPool,
        redis_pool: bb8::Pool<bb8_redis::RedisConnectionManager>,
        auth_client: AuthClient,
        ws_broadcast: broadcast::Sender<WsEvent>,
    ) -> Self {
        Self {
            db_pool,
            redis_pool,
            auth_client,
            ws_broadcast,
        }
    }
}
// Developer and Creator: Jai Singh
