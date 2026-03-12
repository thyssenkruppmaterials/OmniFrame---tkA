//! Health check endpoints for rust-work-service
//!
//! Provides endpoints for load balancer health checks and
//! detailed service status monitoring.

use axum::{extract::State, http::StatusCode, Json};
use serde::Serialize;
use std::sync::Arc;
use tracing::{error, info};

use crate::AppState;

/// Basic health response
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub service: String,
}

/// Detailed health response with dependency status
#[derive(Debug, Serialize)]
pub struct DetailedHealthResponse {
    pub status: String,
    pub version: String,
    pub service: String,
    pub dependencies: DependencyStatus,
}

/// Status of external dependencies
#[derive(Debug, Serialize)]
pub struct DependencyStatus {
    pub database: ComponentStatus,
    pub redis: ComponentStatus,
}

/// Status of a single component/dependency
#[derive(Debug, Serialize)]
pub struct ComponentStatus {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// GET /health - Basic health check
///
/// Returns a simple health status for load balancer checks.
/// This endpoint is always public (no auth required).
pub async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        service: "rust-work-service".to_string(),
    })
}

/// GET /health/detailed - Detailed health check with dependency status
///
/// Checks connectivity to PostgreSQL and Redis, returning their status.
/// This endpoint is public but provides more detail for monitoring.
pub async fn health_check_detailed(
    State(state): State<Arc<AppState>>,
) -> (StatusCode, Json<DetailedHealthResponse>) {
    let mut overall_healthy = true;

    // Check PostgreSQL
    let db_status = check_database(&state.db_pool).await;
    if db_status.status != "healthy" {
        overall_healthy = false;
    }

    // Check Redis
    let redis_status = check_redis(&state.redis_pool).await;
    if redis_status.status != "healthy" {
        overall_healthy = false;
    }

    let response = DetailedHealthResponse {
        status: if overall_healthy {
            "healthy".to_string()
        } else {
            "degraded".to_string()
        },
        version: env!("CARGO_PKG_VERSION").to_string(),
        service: "rust-work-service".to_string(),
        dependencies: DependencyStatus {
            database: db_status,
            redis: redis_status,
        },
    };

    let status_code = if overall_healthy {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (status_code, Json(response))
}

/// Check PostgreSQL connectivity and latency
async fn check_database(pool: &sqlx::PgPool) -> ComponentStatus {
    let start = std::time::Instant::now();

    match sqlx::query("SELECT 1").execute(pool).await {
        Ok(_) => {
            let latency = start.elapsed().as_millis() as u64;
            info!(latency_ms = latency, "Database health check passed");
            ComponentStatus {
                status: "healthy".to_string(),
                latency_ms: Some(latency),
                error: None,
            }
        }
        Err(e) => {
            error!(error = %e, "Database health check failed");
            ComponentStatus {
                status: "unhealthy".to_string(),
                latency_ms: None,
                error: Some(e.to_string()),
            }
        }
    }
}

/// Check Redis connectivity and latency
async fn check_redis(pool: &bb8::Pool<bb8_redis::RedisConnectionManager>) -> ComponentStatus {
    let start = std::time::Instant::now();

    match pool.get().await {
        Ok(mut conn) => {
            use bb8_redis::redis::cmd;
            let result: Result<String, bb8_redis::redis::RedisError> = cmd("PING")
                .query_async(&mut *conn)
                .await;
            
            match result {
                Ok(_) => {
                    let latency = start.elapsed().as_millis() as u64;
                    info!(latency_ms = latency, "Redis health check passed");
                    ComponentStatus {
                        status: "healthy".to_string(),
                        latency_ms: Some(latency),
                        error: None,
                    }
                }
                Err(e) => {
                    error!(error = %e, "Redis ping failed");
                    ComponentStatus {
                        status: "unhealthy".to_string(),
                        latency_ms: None,
                        error: Some(e.to_string()),
                    }
                }
            }
        }
        Err(e) => {
            error!(error = %e, "Failed to get Redis connection");
            ComponentStatus {
                status: "unhealthy".to_string(),
                latency_ms: None,
                error: Some(e.to_string()),
            }
        }
    }
}
