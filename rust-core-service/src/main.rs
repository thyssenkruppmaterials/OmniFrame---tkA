//! OmniFrame Rust Core Service
//!
//! High-performance database optimization, JWT validation, and caching service.

use axum::{
    middleware as axum_middleware,
    routing::{get, post, put, delete},
    Router,
};
use axum::http::header::HeaderValue;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tower_http::compression::CompressionLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use rust_core_service::{
    AppState,
    api::{routes, middleware::require_auth},
    cache::redis_pool,
    db::pool,
    metrics::prometheus,
};

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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load environment variables
    dotenvy::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rust_core_service=info,tower_http=debug,sqlx=warn".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!(
        version = rust_core_service::VERSION,
        "Starting OmniFrame Rust Core Service"
    );

    // Setup Prometheus metrics
    let metrics_handle = prometheus::setup_metrics();

    // Database connection pool
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");
    
    let db_config = pool::DatabaseConfig {
        url: database_url,
        ..Default::default()
    };
    
    let db_pool = pool::create_pool(&db_config).await?;
    tracing::info!("Database pool initialized");

    // Redis connection pool (optional - service works without it)
    let redis_pool = match std::env::var("REDIS_URL") {
        Ok(url) => {
            tracing::info!("Attempting Redis connection...");
            let config = redis_pool::RedisConfig {
                url,
                ..Default::default()
            };
            match redis_pool::create_redis_pool(&config).await {
                Ok(pool) => {
                    tracing::info!("Redis pool initialized");
                    Some(pool)
                }
                Err(e) => {
                    tracing::warn!("Failed to connect to Redis: {}. Caching disabled.", e);
                    None
                }
            }
        }
        Err(_) => {
            tracing::info!("REDIS_URL not set. Caching disabled.");
            None
        }
    };

    // Supabase configuration
    let supabase_url = std::env::var("SUPABASE_URL")
        .expect("SUPABASE_URL must be set");
    let jwt_secret = std::env::var("SUPABASE_JWT_SECRET").ok();

    // Create application state
    let state = AppState::new(
        db_pool,
        redis_pool,
        supabase_url,
        jwt_secret,
    ).await?;

    tracing::info!("Application state initialized");

    // ── Public routes (no authentication required) ──────────────────────
    // Health endpoints remain open for load balancer probes and uptime checks.
    let public_routes = Router::new()
        .route("/health", get(routes::health::health_check))
        .route("/health/detailed", get(routes::health::detailed_health));

    // ── Protected API routes (require JWT or service API key) ────────
    // All sensitive endpoints are guarded by the require_auth middleware
    // which accepts either:
    //   - X-Service-Key header (for internal service-to-service calls)
    //   - Authorization: Bearer <token> (for end-user calls)
    let protected_api = Router::new()
        // Authentication (called by other services with X-Service-Key)
        .route("/auth/validate", post(routes::auth::validate_token))
        .route("/auth/validate-with-profile", post(routes::auth::validate_with_profile))
        .route("/auth/permissions/:user_id", get(routes::auth::get_permissions))
        .route("/auth/invalidate", post(routes::auth::invalidate_session))
        
        // Warehouse operations
        .route("/warehouse/inbound-scans", get(routes::warehouse::get_inbound_scans))
        .route("/warehouse/inbound-scans", post(routes::warehouse::create_inbound_scan))
        .route("/warehouse/inbound-scans/:barcode", get(routes::warehouse::get_inbound_scan_by_barcode))
        .route("/warehouse/transfer-orders", get(routes::warehouse::get_transfer_orders))
        .route("/warehouse/transfer-orders/:to_number", get(routes::warehouse::get_transfer_order))
        .route("/warehouse/transfer-orders/:to_number/status", put(routes::warehouse::update_transfer_order_status))
        .route("/warehouse/stats", get(routes::warehouse::get_warehouse_stats))
        .route("/warehouse/drone-scans/pending", get(routes::warehouse::get_pending_drone_scans))
        .route("/warehouse/materials/search", get(routes::warehouse::search_materials))
        
        // SmartSheet operations (high-performance)
        .route("/smartsheet/health", get(routes::smartsheet::health_check))
        .route("/smartsheet/user", get(routes::smartsheet::get_current_user))
        .route("/smartsheet/sheets", get(routes::smartsheet::list_sheets))
        .route("/smartsheet/sheets/:sheet_id", get(routes::smartsheet::get_sheet))
        .route("/smartsheet/sheets/:sheet_id/statistics", get(routes::smartsheet::get_statistics))
        .route("/smartsheet/sheets/:sheet_id/rows", post(routes::smartsheet::add_rows))
        .route("/smartsheet/sheets/:sheet_id/rows", delete(routes::smartsheet::delete_rows))
        .route("/smartsheet/sheets/:sheet_id/rows/:row_id/cells", put(routes::smartsheet::update_cells))
        // Attachment operations
        .route("/smartsheet/sheets/:sheet_id/attachments", get(routes::smartsheet::list_sheet_attachments))
        .route("/smartsheet/sheets/:sheet_id/attachments/:attachment_id", get(routes::smartsheet::get_attachment))
        .route("/smartsheet/sheets/:sheet_id/attachments/:attachment_id", delete(routes::smartsheet::delete_attachment))
        .route("/smartsheet/sheets/:sheet_id/rows/:row_id/attachments", get(routes::smartsheet::list_row_attachments))
        .route("/smartsheet/sheets/:sheet_id/rows/:row_id/attachments/url", post(routes::smartsheet::attach_url_to_row))
        // Discussion operations
        .route("/smartsheet/sheets/:sheet_id/rows/:row_id/discussions", get(routes::smartsheet::list_row_discussions))
        .route("/smartsheet/sheets/:sheet_id/rows/:row_id/discussions", post(routes::smartsheet::create_row_discussion))
        .route("/smartsheet/sheets/:sheet_id/discussions/:discussion_id", get(routes::smartsheet::get_discussion))
        .route("/smartsheet/sheets/:sheet_id/discussions/:discussion_id", delete(routes::smartsheet::delete_discussion))
        .route("/smartsheet/sheets/:sheet_id/discussions/:discussion_id/comments", post(routes::smartsheet::add_comment_to_discussion))
        // Comment operations
        .route("/smartsheet/sheets/:sheet_id/comments/:comment_id", put(routes::smartsheet::update_comment))
        .route("/smartsheet/sheets/:sheet_id/comments/:comment_id", delete(routes::smartsheet::delete_comment))
        // Import and dashboard
        .route("/smartsheet/import/outbound-data", get(routes::smartsheet::import_outbound_data))
        .route("/smartsheet/dashboard/stats", get(routes::smartsheet::get_dashboard_stats))
        .route("/smartsheet/cache/:pattern", delete(routes::smartsheet::clear_cache))
        
        // Cache operations
        .route("/cache/:key", get(routes::cache::get_cached))
        .route("/cache/:key", put(routes::cache::set_cached))
        .route("/cache/:key", delete(routes::cache::delete_cached))
        .route("/cache/batch", post(routes::cache::batch_get))
        
        // Generic query execution
        .route("/query", post(routes::queries::execute_query))
        
        // Apply auth middleware to all protected routes
        .layer(axum_middleware::from_fn_with_state(state.clone(), require_auth));

    tracing::info!("Auth middleware applied to all API routes (health endpoints remain public)");

    // Build the main app with middleware
    // Structure: public health routes are merged with protected API routes,
    // then nested under /api/v1. Global middleware (CORS, compression, tracing)
    // is applied to the entire app.
    let app = Router::new()
        .nest("/api/v1", public_routes.merge(protected_api))
        // NOTE: /metrics is intentionally left without auth for Prometheus scraping.
        // If auth is needed, wrap with a separate middleware or use IP-based allow-listing.
        .route("/metrics", get(move || async move { metrics_handle.render() }))
        .layer(CompressionLayer::new())
        .layer({
            let origins = parse_cors_origins();
            CorsLayer::new()
                .allow_origin(origins)
                .allow_methods(Any)
                .allow_headers(Any)
        })
        .layer(TraceLayer::new_for_http())
        .with_state(state.clone());

    // Start HTTP server
    let http_port = std::env::var("PORT").unwrap_or_else(|_| "8010".to_string());
    let http_addr = format!("0.0.0.0:{}", http_port);
    
    tracing::info!("HTTP server listening on {}", http_addr);

    // Start gRPC server in background
    let grpc_port = std::env::var("GRPC_PORT").unwrap_or_else(|_| "8011".to_string());
    let grpc_state = state.clone();
    tokio::spawn(async move {
        if let Err(e) = rust_core_service::grpc::service::start_grpc_server(&grpc_port, grpc_state).await {
            tracing::error!(error = %e, "gRPC server error");
        }
    });

    // Start HTTP server
    let listener = tokio::net::TcpListener::bind(&http_addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
// Developer and Creator: Jai Singh
