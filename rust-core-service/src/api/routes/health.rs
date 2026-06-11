// Created and developed by Jai Singh
//! Health check endpoints

use axum::{extract::State, Json};
use serde::Serialize;

use crate::AppState;
use crate::db::health as db_health;

/// Basic health check response
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub timestamp: i64,
}

/// Detailed health check response
#[derive(Debug, Serialize)]
pub struct DetailedHealthResponse {
    pub status: String,
    pub version: String,
    pub timestamp: i64,
    pub database: DatabaseHealth,
    pub redis: RedisHealth,
    pub session_cache: SessionCacheStatus,
    pub uptime_seconds: u64,
}

#[derive(Debug, Serialize)]
pub struct DatabaseHealth {
    pub connected: bool,
    pub latency_ms: u64,
    pub pool_size: u32,
    pub idle_connections: u32,
}

#[derive(Debug, Serialize)]
pub struct RedisHealth {
    pub connected: bool,
    pub latency_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct SessionCacheStatus {
    pub enabled: bool,
    pub ttl_seconds: u64,
    pub cache_endpoint: String,
}

/// Simple health check endpoint
pub async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        version: crate::VERSION.to_string(),
        timestamp: chrono::Utc::now().timestamp(),
    })
}

/// Detailed health check with component status
pub async fn detailed_health(
    State(state): State<AppState>,
) -> Json<DetailedHealthResponse> {
    // Check database health
    let db_health = match db_health::health_check(&state.db_pool).await {
        Ok(metrics) => DatabaseHealth {
            connected: metrics.healthy,
            latency_ms: metrics.health_check_latency_ms,
            pool_size: metrics.total_connections,
            idle_connections: metrics.idle_connections,
        },
        Err(e) => {
            tracing::error!(error = %e, "Database health check failed");
            DatabaseHealth {
                connected: false,
                latency_ms: 0,
                pool_size: 0,
                idle_connections: 0,
            }
        }
    };

    // Check Redis health (if available)
    let redis_health = if let Some(ref cache_service) = state.cache_service {
        match cache_service.health_check().await {
            Ok(health) => RedisHealth {
                connected: health.connected,
                latency_ms: health.latency_ms,
            },
            Err(e) => {
                tracing::error!(error = %e, "Redis health check failed");
                RedisHealth {
                    connected: false,
                    latency_ms: 0,
                }
            }
        }
    } else {
        RedisHealth {
            connected: false,
            latency_ms: 0,
        }
    };

    // Session cache status
    let session_cache = SessionCacheStatus {
        enabled: state.session_service.is_some() && redis_health.connected,
        ttl_seconds: 900, // 15 minutes
        cache_endpoint: "/api/v1/auth/validate-with-profile".to_string(),
    };

    // Service is healthy if database is connected (Redis is optional)
    let overall_status = if db_health.connected {
        if redis_health.connected {
            "healthy"
        } else {
            "degraded" // DB works but no caching
        }
    } else {
        "unhealthy"
    };

    let uptime_seconds = state.startup_time.elapsed().as_secs();

    Json(DetailedHealthResponse {
        status: overall_status.to_string(),
        version: crate::VERSION.to_string(),
        timestamp: chrono::Utc::now().timestamp(),
        database: db_health,
        redis: redis_health,
        session_cache,
        uptime_seconds,
    })
}

// Created and developed by Jai Singh
