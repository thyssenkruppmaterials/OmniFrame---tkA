// Created and developed by Jai Singh
mod api;
mod auth;
mod config;
pub mod metrics;
mod middleware;
mod state;

use axum::{routing::{get, post, put}, Router};
use axum::http::header::HeaderValue;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tower_http::compression::CompressionLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::api::routes;
use crate::config::AppConfig;
use crate::state::AppState;

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
                    "CORS_ALLOWED_ORIGINS not set in production! \
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
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rust_mdm_service=info,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting rust-mdm-service v{}", env!("CARGO_PKG_VERSION"));

    let metrics_handle = metrics::setup_metrics();
    tracing::info!("Prometheus metrics recorder installed");

    let config = AppConfig::from_env();
    let http_port = config.server_port;

    tracing::info!(
        port = http_port,
        mdm_enabled = config.mdm_enabled(),
        telemetry_enabled = config.telemetry_enabled(),
        "Configuration loaded"
    );

    let state = Arc::new(AppState::new(config).await?);
    tracing::info!("Application state initialized");

    let public_routes = Router::new()
        .route("/api/v1/health", get(routes::health::health_check))
        .route("/api/v1/health/detailed", get(routes::health::health_check_detailed))
        .route("/api/v1/metrics", get(routes::health::metrics_handler).with_state(metrics_handle));

    let mdm_device_routes = Router::new()
        .route("/api/v1/mdm/checkin", put(routes::mdm::handle_checkin))
        .route("/api/v1/mdm/server", put(routes::mdm::handle_server_request))
        .route("/api/v1/mdm/enroll/profile", get(routes::mdm::generate_enrollment_profile));

    let telemetry_routes = Router::new()
        .route("/api/v1/telemetry/heartbeat", post(routes::telemetry::heartbeat))
        .route("/api/v1/telemetry/location", post(routes::telemetry::report_location))
        .route("/api/v1/telemetry/device-health", post(routes::telemetry::report_device_health))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::require_telemetry_auth,
        ));

    let stream_routes = Router::new()
        .route("/api/v1/admin/streams/devices", get(routes::streams::device_stream_handler))
        .route("/api/v1/admin/streams/locations", get(routes::streams::location_stream_handler))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::require_auth_or_query_token,
        ));

    let admin_routes = Router::new()
        .route("/api/v1/admin/devices", get(routes::admin::list_devices))
        .route("/api/v1/admin/devices/:device_id", get(routes::admin::get_device))
        .route("/api/v1/admin/devices/:device_id/commands", post(routes::admin::queue_command))
        .route("/api/v1/admin/commands", get(routes::admin::list_commands))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::require_organization,
        ))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::require_auth,
        ));

    let app = Router::new()
        .merge(public_routes)
        .merge(mdm_device_routes)
        .merge(telemetry_routes)
        .merge(stream_routes)
        .merge(admin_routes)
        .layer(CompressionLayer::new())
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
                    "X-Telemetry-Token".parse().unwrap(),
                ])
        })
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("0.0.0.0:{}", http_port);
    tracing::info!("HTTP server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("rust-mdm-service is ready on {}", addr);

    axum::serve(listener, app).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn service_version_is_set() {
        let version = env!("CARGO_PKG_VERSION");
        assert!(!version.is_empty());
        assert_eq!(version, "0.1.0");
    }

    #[test]
    fn service_name_is_correct() {
        let name = env!("CARGO_PKG_NAME");
        assert_eq!(name, "rust-mdm-service");
    }
}

// Created and developed by Jai Singh
