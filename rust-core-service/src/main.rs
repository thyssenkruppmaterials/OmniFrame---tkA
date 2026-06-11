// Created and developed by Jai Singh
//! OneBox AI Rust Core Service
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
        "Starting OneBox AI Rust Core Service"
    );

    // Setup Prometheus metrics
    let metrics_handle = prometheus::setup_metrics();

    // Database connection pool (primary)
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");

    let db_config = pool::DatabaseConfig {
        url: database_url,
        ..Default::default()
    };

    let db_pool = pool::create_pool(&db_config).await?;
    tracing::info!("Database pool initialized (primary)");

    // Optional read-replica pool. When `DATABASE_READ_POOLER_URL` is set,
    // pure-read paths (RBAC permission lookups, user-profile fetches in
    // `validate-with-profile`) route through this pool instead of the
    // primary. When unset, `read_pool` is a clone of `db_pool` so all
    // downstream code can use `state.read_pool` unconditionally.
    let read_pool = match std::env::var("DATABASE_READ_POOLER_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
    {
        Some(read_url) => {
            tracing::info!("Initializing read-replica pool (DATABASE_READ_POOLER_URL set)");
            let read_cfg = pool::DatabaseConfig {
                url: read_url,
                ..Default::default()
            };
            match pool::create_pool(&read_cfg).await {
                Ok(p) => {
                    tracing::info!("Read-replica pool initialized");
                    p
                }
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        "Failed to initialize read-replica pool — falling back to primary"
                    );
                    db_pool.clone()
                }
            }
        }
        None => {
            tracing::info!(
                "DATABASE_READ_POOLER_URL unset; read_pool falls back to primary db_pool"
            );
            db_pool.clone()
        }
    };

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
        read_pool,
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
    //
    // IMPORTANT: Bind to `[::]` (IPv6 wildcard) rather than `0.0.0.0` so this
    // service is reachable over Railway's private network (`*.railway.internal`
    // resolves to AAAA records — IPv6-only on legacy environments, dual-stack
    // on environments created after 2025-10-16). On Linux the kernel default
    // `net.ipv6.bindv6only=0` makes `[::]` accept IPv4 connections via
    // IPv4-mapped IPv6 addresses too, so this keeps the public Railway proxy
    // working as before.
    //
    // History: prior to 2026-05-22 this bound to `0.0.0.0` only, which made
    // private-DNS connections from sibling services (e.g.
    // `RUST_CORE_PRIVATE_URL=http://rust-core-service.railway.internal:8010`
    // set on the `onebox-ai-logistics` FastAPI service) fail with
    // `httpcore.ConnectError: All connection attempts failed`. See
    // memorybank/OmniFrame/Debug/Fix-Rust-Core-Private-URL-IPv6-401-2026-05-22.md.
    let http_port = std::env::var("PORT").unwrap_or_else(|_| "8010".to_string());
    let http_addr = format!("[::]:{}", http_port);
    
    tracing::info!("HTTP server listening on {} (IPv6 dual-stack)", http_addr);

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

// Created and developed by Jai Singh
