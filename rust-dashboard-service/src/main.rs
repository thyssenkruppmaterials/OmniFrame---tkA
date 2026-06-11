// Created and developed by Jai Singh
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
mod omnibelt;

use axum::{
    routing::get,
    Router,
    Json,
    middleware as axum_middleware,
};
use bb8::Pool;
use bb8_redis::RedisConnectionManager;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use std::str::FromStr;
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
    /// Read-replica pool (or clone of `db` when DASHBOARD_SERVICE_DATABASE_READ_POOLER_URL
    /// is unset). Use for pure-read endpoints. Tagged with
    /// `application_name = "rust-dashboard-service-read"` for forensic clarity
    /// in pg_stat_activity.
    pub read_pool: sqlx::PgPool,
    /// Optional Redis connection pool used by `/omnibelt/bootstrap` for
    /// the 30-second cache (key
    /// `omnibelt:bootstrap:{org_id}:{user_id}`). `None` when Redis is
    /// unconfigured or unreachable at startup — the bootstrap endpoint
    /// degrades to "always read replica" without erroring. Reads
    /// `DASHBOARD_SERVICE_REDIS_URL` first, falling back to `REDIS_URL`.
    pub redis_pool: Option<Pool<RedisConnectionManager>>,
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
    read_database: String,
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

    // Optional read-replica pool. When `DASHBOARD_SERVICE_DATABASE_READ_POOLER_URL`
    // (or fallback `DATABASE_READ_POOLER_URL`) is set and distinct from the
    // primary URL, pure-read paths can route through this pool tagged with
    // `application_name = "rust-dashboard-service-read"` for forensic clarity in
    // `pg_stat_activity`. Gracefully falls back to a clone of the primary pool
    // when the env var is unset, blank, equal to the primary URL, or if the
    // connection fails — so call sites can use `state.read_pool` unconditionally
    // and a misconfigured replica never crashes startup.
    let read_url_opt = std::env::var("DASHBOARD_SERVICE_DATABASE_READ_POOLER_URL")
        .ok()
        .or_else(|| std::env::var("DATABASE_READ_POOLER_URL").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != &database_url);

    let read_pool = match read_url_opt {
        Some(read_url) => {
            let connect_attempt = PgConnectOptions::from_str(&read_url)
                .map(|o| o.application_name("rust-dashboard-service-read"));

            match connect_attempt {
                Ok(opts) => match PgPoolOptions::new()
                    .max_connections(5)
                    .connect_with(opts)
                    .await
                {
                    Ok(pool) => {
                        tracing::info!(
                            "Connected to read-replica via DASHBOARD_SERVICE_DATABASE_READ_POOLER_URL"
                        );
                        pool
                    }
                    Err(err) => {
                        tracing::warn!(
                            "Read pool falling back to primary (connection failed: {err})"
                        );
                        db_pool.clone()
                    }
                },
                Err(err) => {
                    tracing::warn!(
                        "Read pool falling back to primary (connection failed: {err})"
                    );
                    db_pool.clone()
                }
            }
        }
        None => {
            tracing::info!(
                "Read pool falling back to primary (DASHBOARD_SERVICE_DATABASE_READ_POOLER_URL unset)"
            );
            db_pool.clone()
        }
    };

    // Initialize auth client
    let auth_config = AuthConfig::from_env();
    let auth_client = AuthClient::new(auth_config);
    tracing::info!("Auth client initialized for rust-core-service");

    // Optional Redis pool for the `/omnibelt/bootstrap` cache.
    //
    // Reads `DASHBOARD_SERVICE_REDIS_URL` first, falls back to plain
    // `REDIS_URL` so the service can share the existing project-wide
    // Redis instance without a separate var. When neither is set, OR
    // when the connection probe fails, we log a `warn!` and disable
    // caching — the endpoint still works (it just hits the replica
    // every time, which is exactly the cache-miss path). This keeps
    // the service bootable on local dev machines without Redis.
    let redis_url = std::env::var("DASHBOARD_SERVICE_REDIS_URL")
        .ok()
        .or_else(|| std::env::var("REDIS_URL").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let redis_pool: Option<Pool<RedisConnectionManager>> = match redis_url {
        Some(url) => match RedisConnectionManager::new(url.as_str()) {
            Ok(manager) => match Pool::builder()
                .max_size(8)
                .connection_timeout(std::time::Duration::from_secs(2))
                .build(manager)
                .await
            {
                Ok(pool) => {
                    // Probe so a misconfigured URL surfaces at boot
                    // rather than at first request. The probe handle
                    // borrows `pool`; we collapse it to a plain
                    // Result<(), String> before deciding whether to
                    // move `pool` into the `Some(pool)` branch.
                    let probe_err: Option<String> = match pool.get().await {
                        Ok(_) => None,
                        Err(e) => Some(e.to_string()),
                    };
                    match probe_err {
                        None => {
                            tracing::info!(
                                "Redis pool connected for /omnibelt/bootstrap cache (TTL 30s)"
                            );
                            Some(pool)
                        }
                        Some(err) => {
                            tracing::warn!(
                                error = %err,
                                "Redis pool probe failed at boot — caching disabled (\
                                 /omnibelt/bootstrap will hit the replica unconditionally)"
                            );
                            None
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        "Redis pool build failed — caching disabled"
                    );
                    None
                }
            },
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "Redis URL parse failed — caching disabled"
                );
                None
            }
        },
        None => {
            tracing::info!(
                "Redis URL unset (DASHBOARD_SERVICE_REDIS_URL / REDIS_URL) — \
                 /omnibelt/bootstrap cache disabled"
            );
            None
        }
    };

    let state = Arc::new(AppState {
        db: db_pool.clone(),
        read_pool,
        redis_pool,
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
        .route("/omnibelt/bootstrap", get(omnibelt::get_bootstrap))
        .layer(axum_middleware::from_fn_with_state(state.clone(), require_auth));

    let app = Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .layer(
            CorsLayer::new()
                .allow_origin([
                    "http://localhost:5173".parse().unwrap(),
                    "http://localhost:3000".parse().unwrap(),
                    "https://onebox-ai.netlify.app".parse().unwrap(),
                    // Add Railway domains in production
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

    let read_db_status = match sqlx::query("SELECT 1").fetch_one(&state.read_pool).await {
        Ok(_) => "connected".to_string(),
        Err(_) => "disconnected".to_string(),
    };

    Json(HealthResponse {
        status: "healthy".to_string(),
        service: "drone-dashboard-service".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        database: db_status,
        read_database: read_db_status,
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

// Created and developed by Jai Singh
