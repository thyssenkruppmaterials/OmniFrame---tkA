//! OmniFrame Rust Streaming Service
//!
//! High-performance ExacqVision camera streaming proxy.

use axum::{
    routing::{get, post},
    Router,
};
use axum::http::header::HeaderValue;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tower_http::compression::CompressionLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use rust_streaming_service::{
    AppState,
    api::routes,
    config::AppConfig,
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
                .unwrap_or_else(|_| "rust_streaming_service=info,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!(
        version = rust_streaming_service::VERSION,
        "Starting OmniFrame Rust Streaming Service"
    );

    // Load configuration
    let config = AppConfig::from_env()?;
    let http_port = config.http_port;
    
    tracing::info!(
        exacq_url = %config.exacq.base_url,
        redis_enabled = config.redis_url.is_some(),
        "Configuration loaded"
    );

    // Create application state
    let state = AppState::new(config).await?;
    tracing::info!("Application state initialized");

    // Attempt initial session authentication
    match state.session_manager.get_session().await {
        Ok(session_id) => {
            tracing::info!(session_id = %session_id, "ExacqVision session established");
        }
        Err(e) => {
            tracing::warn!(error = %e, "Failed to establish initial ExacqVision session - will retry on first request");
        }
    }

    // Build API router
    let api_router = Router::new()
        // Health and status
        .route("/health", get(routes::health::health_check))
        .route("/health/detailed", get(routes::health::detailed_health))
        
        // Camera operations
        .route("/cameras", get(routes::cameras::list_cameras))
        .route("/cameras/:camera_id", get(routes::cameras::get_camera))
        .route("/cameras/:camera_id/ptz", post(routes::cameras::ptz_command))
        
        // Streaming operations
        .route("/stream/:camera_id", get(routes::stream::mjpeg_stream))
        .route("/snapshot/:camera_id", get(routes::stream::snapshot))
        
        // Recordings operations
        .route("/recordings/:camera_id", get(routes::recordings::list_recordings))
        .route("/recordings/:camera_id/download", get(routes::recordings::download_recording))
        .route("/recordings/:camera_id/playback", get(routes::recordings::playback_stream))
        
        // WebSocket events
        .route("/events", get(routes::events::websocket_handler));

    // Build the main app with middleware
    // TODO: This service has NO auth middleware — all endpoints (including camera
    // streams and recordings) are publicly accessible. This was acceptable for
    // internal-network-only deployment but should be revisited before any
    // internet-facing exposure. See rust-ai-service for the auth pattern.
    let app = Router::new()
        .nest("/api/v1", api_router)
        .layer(CompressionLayer::new())
        .layer({
            let origins = parse_cors_origins();
            CorsLayer::new()
                .allow_origin(origins)
                .allow_methods(Any)
                .allow_headers(Any)
        })
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Start HTTP server
    let http_addr = format!("0.0.0.0:{}", http_port);
    
    tracing::info!("HTTP server listening on {}", http_addr);

    let listener = tokio::net::TcpListener::bind(&http_addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
// Developer and Creator: Jai Singh
