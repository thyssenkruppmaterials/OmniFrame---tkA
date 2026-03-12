//! rust-work-service - Work Management Service
//!
//! This service handles work queue management, task assignment, and
//! worker sessions for the OmniFrame logistics platform.
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
//!
//! ## Port
//! Runs on port 8030 by default (configurable via PORT env var)

mod api;
mod auth;
mod config;
mod db;
mod middleware;
mod scheduler;
mod websocket;

use axum::{routing::get, Router};
use axum::http::header::HeaderValue;
use bb8_redis::RedisConnectionManager;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::api::routes::{health_check, health_check_detailed, work_routes, workers_routes};
use crate::auth::{AuthClient, AuthConfig};
use crate::config::AppConfig;
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

/// Application state shared across all handlers
pub struct AppState {
    pub db_pool: sqlx::PgPool,
    pub redis_pool: bb8::Pool<RedisConnectionManager>,
    pub auth_client: AuthClient,
    pub ws_broadcast: broadcast::Sender<WsEvent>,
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

    // Load configuration
    let config = AppConfig::from_env();
    tracing::info!("Configuration loaded, server port: {}", config.server_port);

    // Create PostgreSQL connection pool
    tracing::info!("Connecting to PostgreSQL...");
    let db_pool = PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect(&config.database_url)
        .await
        .expect("Failed to create PostgreSQL pool");
    tracing::info!("Connected to PostgreSQL successfully");

    // Create Redis connection pool
    tracing::info!("Connecting to Redis...");
    let redis_manager = RedisConnectionManager::new(config.redis_url.clone())
        .expect("Failed to create Redis connection manager");
    let redis_pool = bb8::Pool::builder()
        .max_size(10)
        .build(redis_manager)
        .await
        .expect("Failed to create Redis pool");
    tracing::info!("Connected to Redis successfully");

    // Initialize auth client
    let auth_config = AuthConfig {
        rust_core_url: config.rust_core_url.clone(),
        service_api_key: config.rust_core_api_key.clone(),
    };
    let auth_client = AuthClient::new(auth_config);
    tracing::info!(
        "Auth client initialized for rust-core-service at {}",
        config.rust_core_url
    );

    // Create WebSocket broadcast channel
    let (ws_tx, _ws_rx) = websocket::create_broadcast_channel();
    tracing::info!("WebSocket broadcast channel created");

    // Create shared application state
    let state = Arc::new(AppState {
        db_pool: db_pool.clone(),
        redis_pool,
        auth_client,
        ws_broadcast: ws_tx.clone(),
    });

    // Build router
    // Public routes (no authentication required)
    // Note: WebSocket is public to allow initial connection before auth handshake
    let public_routes = Router::new()
        .route("/health", get(health_check))
        .route("/health/detailed", get(health_check_detailed))
        .route("/ws", get(ws_handler));

    // Protected routes (authentication required)
    let protected_routes = Router::new()
        .nest("/api/v1/work", work_routes())
        .nest("/api/v1/workers", workers_routes())
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::require_auth,
        ));

    // Combine all routes
    let app = Router::new()
        .merge(public_routes)
        .merge(protected_routes)
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

    // Start background scheduler
    let scheduler_pool = db_pool.clone();
    let scheduler_tx = ws_tx.clone();
    tokio::spawn(async move {
        if let Err(e) = scheduler::start_scheduler(scheduler_pool, scheduler_tx).await {
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
// Developer and Creator: Jai Singh
