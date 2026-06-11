// Created and developed by Jai Singh
//! Health check endpoints
//!
//! Provides basic and detailed health status for the streaming service.

use axum::{extract::State, Json};
use serde::Serialize;
use std::time::Instant;

use crate::AppState;

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
    pub exacq: ExacqHealth,
    pub redis: RedisHealth,
    pub session: SessionHealth,
}

#[derive(Debug, Serialize)]
pub struct ExacqHealth {
    pub connected: bool,
    pub base_url: String,
    pub latency_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct RedisHealth {
    pub enabled: bool,
    pub connected: bool,
    pub latency_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct SessionHealth {
    pub valid: bool,
    pub session_id: Option<String>,
    pub ttl_remaining: Option<u64>,
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
    // Check ExacqVision connectivity
    let exacq_health = {
        let session_check_start = Instant::now();
        let session_valid = state.session_manager.is_session_valid().await;
        let latency = session_check_start.elapsed().as_millis() as u64;
        
        ExacqHealth {
            connected: session_valid,
            base_url: state.config.exacq.base_url.clone(),
            latency_ms: latency,
        }
    };

    // Check Redis health
    let redis_health = if let Some(ref cache_service) = state.cache_service {
        match cache_service.health_check().await {
            Ok(health) => RedisHealth {
                enabled: true,
                connected: health.connected,
                latency_ms: health.latency_ms,
            },
            Err(_) => RedisHealth {
                enabled: true,
                connected: false,
                latency_ms: 0,
            },
        }
    } else {
        RedisHealth {
            enabled: false,
            connected: false,
            latency_ms: 0,
        }
    };

    // Get session info
    let session_health = if let Some(info) = state.session_manager.get_session_info().await {
        SessionHealth {
            valid: true,
            session_id: Some(format!("{}...", &info.session_id[..8.min(info.session_id.len())])),
            ttl_remaining: Some(info.ttl_remaining),
        }
    } else {
        SessionHealth {
            valid: false,
            session_id: None,
            ttl_remaining: None,
        }
    };

    // Determine overall status
    let overall_status = if exacq_health.connected {
        if redis_health.enabled && !redis_health.connected {
            "degraded" // ExacqVision works but no caching
        } else {
            "healthy"
        }
    } else {
        "unhealthy"
    };

    Json(DetailedHealthResponse {
        status: overall_status.to_string(),
        version: crate::VERSION.to_string(),
        timestamp: chrono::Utc::now().timestamp(),
        exacq: exacq_health,
        redis: redis_health,
        session: session_health,
    })
}

// Created and developed by Jai Singh
