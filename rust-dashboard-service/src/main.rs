//! Drone Dashboard Aggregation Service
//!
//! Background service that periodically aggregates drone scan statistics
//! and pushes updates to Supabase for real-time dashboard updates.
//!
//! SECURITY: All endpoints (except /health) require authentication via
//! rust-core-service JWT validation.
//!
//! Version: 0.2.0 - Added authentication (Phase 3 Security Overhaul)

mod auth;
mod middleware;

use axum::{
    routing::get,
    Router,
    Json,
    middleware as axum_middleware,
};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tokio_cron_scheduler::{Job, JobScheduler};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use serde::Serialize;

use crate::auth::{AuthClient, AuthConfig};
use crate::middleware::require_auth;

/// Application state
pub struct AppState {
    pub db: sqlx::PgPool,
    pub auth_client: AuthClient,
}

/// Dashboard statistics
#[derive(Debug, Serialize)]
pub struct DashboardStats {
    pub total_scans_today: i64,
    pub total_scans_week: i64,
    pub pending_analyses: i64,
    pub completed_analyses: i64,
    pub failed_analyses: i64,
    pub avg_processing_time_ms: f64,
    pub zones_scanned: i64,
    pub items_detected: i64,
    pub damage_alerts: i64,
    pub last_updated: chrono::DateTime<chrono::Utc>,
}

/// Health response
#[derive(Serialize)]
struct HealthResponse {
    status: String,
    service: String,
    version: String,
    database: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load environment
    dotenvy::dotenv().ok();
    
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "drone_dashboard_service=info,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting Drone Dashboard Aggregation Service (Secured)");

    // Database connection
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");

    let db_pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    tracing::info!("Connected to database");

    // Initialize auth client
    let auth_config = AuthConfig::from_env();
    let auth_client = AuthClient::new(auth_config);
    tracing::info!("Auth client initialized for rust-core-service");

    let state = Arc::new(AppState { 
        db: db_pool.clone(),
        auth_client,
    });

    // Set up scheduled aggregation job
    let scheduler = JobScheduler::new().await?;
    
    // Run aggregation every 30 seconds
    let job_pool = db_pool.clone();
    scheduler.add(
        Job::new_async("*/30 * * * * *", move |_uuid, _lock| {
            let pool = job_pool.clone();
            Box::pin(async move {
                if let Err(e) = run_aggregation(&pool).await {
                    tracing::error!("Aggregation job failed: {:?}", e);
                }
            })
        })?
    ).await?;

    scheduler.start().await?;
    tracing::info!("Scheduler started - running aggregation every 30 seconds");

    // Build router with authentication
    // Health endpoint is public (for load balancer checks)
    let public_routes = Router::new()
        .route("/health", get(health_check));
    
    // Protected routes require authentication
    let protected_routes = Router::new()
        .route("/stats", get(get_stats))
        .route("/trigger", get(trigger_aggregation))
        .layer(axum_middleware::from_fn_with_state(state.clone(), require_auth));

    let app = Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .layer(
            CorsLayer::new()
                .allow_origin([
                    "http://localhost:5173".parse().unwrap(),
                    "http://localhost:3000".parse().unwrap(),
                    "https://omniframe.example.com".parse().unwrap(),
                    // Add production domains via CORS_ALLOWED_ORIGINS
                ])
                .allow_methods([
                    axum::http::Method::GET,
                    axum::http::Method::POST,
                    axum::http::Method::PUT,
                    axum::http::Method::DELETE,
                ])
                .allow_headers([
                    axum::http::header::AUTHORIZATION,
                    axum::http::header::CONTENT_TYPE,
                    "X-Service-Key".parse().unwrap(),
                ])
                .allow_credentials(true),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Start server
    let port = std::env::var("PORT").unwrap_or_else(|_| "8002".to_string());
    let addr = format!("0.0.0.0:{}", port);
    
    tracing::info!("Listening on {} (auth enabled)", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// Run the aggregation job
async fn run_aggregation(pool: &sqlx::PgPool) -> anyhow::Result<()> {
    tracing::debug!("Running dashboard aggregation");
    
    // Get aggregate statistics
    let stats = sqlx::query_as::<_, (i64, i64, i64, i64, Option<f64>, i64, i64)>(
        r#"
        SELECT 
            COUNT(*) FILTER (WHERE captured_at >= CURRENT_DATE) as scans_today,
            COUNT(*) FILTER (WHERE captured_at >= CURRENT_DATE - INTERVAL '7 days') as scans_week,
            COUNT(*) FILTER (WHERE ai_analysis_status = 'pending') as pending,
            COUNT(*) FILTER (WHERE ai_analysis_status = 'completed') as completed,
            AVG(ai_processing_time_ms)::float8 as avg_time,
            COUNT(DISTINCT warehouse_zone) as zones,
            COALESCE(SUM(jsonb_array_length(COALESCE(detected_texts, '[]'::jsonb))), 0)::bigint as items
        FROM drone_scans
        WHERE captured_at >= CURRENT_DATE - INTERVAL '7 days'
        "#
    )
    .fetch_one(pool)
    .await?;

    tracing::info!(
        "Aggregation complete: {} scans today, {} pending, {} completed",
        stats.0, stats.2, stats.3
    );

    // Here you could push to a dashboard_stats table or notify via websocket
    // For now, we just log the results

    Ok(())
}

/// Health check endpoint
async fn health_check(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<HealthResponse> {
    let db_status = match sqlx::query("SELECT 1").fetch_one(&state.db).await {
        Ok(_) => "connected".to_string(),
        Err(_) => "disconnected".to_string(),
    };
    
    Json(HealthResponse {
        status: "healthy".to_string(),
        service: "drone-dashboard-service".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        database: db_status,
    })
}

/// Get current stats
async fn get_stats(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Result<Json<DashboardStats>, (axum::http::StatusCode, String)> {
    let stats = sqlx::query_as::<_, (i64, i64, i64, i64, i64, Option<f64>, i64, i64)>(
        r#"
        SELECT 
            COUNT(*) FILTER (WHERE captured_at >= CURRENT_DATE) as scans_today,
            COUNT(*) FILTER (WHERE captured_at >= CURRENT_DATE - INTERVAL '7 days') as scans_week,
            COUNT(*) FILTER (WHERE ai_analysis_status = 'pending') as pending,
            COUNT(*) FILTER (WHERE ai_analysis_status = 'completed') as completed,
            COUNT(*) FILTER (WHERE ai_analysis_status = 'failed') as failed,
            AVG(ai_processing_time_ms)::float8 as avg_time,
            COUNT(DISTINCT warehouse_zone) as zones,
            COALESCE(SUM(jsonb_array_length(COALESCE(detected_texts, '[]'::jsonb))), 0)::bigint as items
        FROM drone_scans
        WHERE captured_at >= CURRENT_DATE - INTERVAL '7 days'
        "#
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Get damage alerts count
    let damage_count: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) 
        FROM drone_scans 
        WHERE (inventory_assessment->>'damage_detected')::boolean = true
        AND captured_at >= CURRENT_DATE - INTERVAL '7 days'
        "#
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(DashboardStats {
        total_scans_today: stats.0,
        total_scans_week: stats.1,
        pending_analyses: stats.2,
        completed_analyses: stats.3,
        failed_analyses: stats.4,
        avg_processing_time_ms: stats.5.unwrap_or(0.0),
        zones_scanned: stats.6,
        items_detected: stats.7,
        damage_alerts: damage_count.0,
        last_updated: chrono::Utc::now(),
    }))
}

/// Manually trigger aggregation
async fn trigger_aggregation(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    run_aggregation(&state.db).await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Aggregation triggered"
    })))
}
// Developer and Creator: Jai Singh
