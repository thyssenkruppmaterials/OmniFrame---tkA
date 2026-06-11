// Created and developed by Jai Singh
use axum::{extract::State, Json};
use std::sync::Arc;

use crate::state::AppState;

pub async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "rust-mdm-service",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

pub async fn health_check_detailed(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let db_ok = sqlx::query("SELECT 1")
        .execute(&state.db_pool)
        .await
        .is_ok();

    let redis_ok = if let Some(ref pool) = state.redis_pool {
        pool.get().await.is_ok()
    } else {
        false
    };

    let mdm_enabled = state.config.mdm_enabled();
    let telemetry_enabled = state.config.telemetry_enabled();

    let overall = if db_ok { "healthy" } else { "degraded" };

    Json(serde_json::json!({
        "status": overall,
        "service": "rust-mdm-service",
        "version": env!("CARGO_PKG_VERSION"),
        "dependencies": {
            "postgres": if db_ok { "connected" } else { "disconnected" },
            "redis": if redis_ok { "connected" } else { "disconnected" },
        },
        "features": {
            "mdm": mdm_enabled,
            "telemetry": telemetry_enabled,
        }
    }))
}

pub async fn metrics_handler(
    State(metrics_handle): State<metrics_exporter_prometheus::PrometheusHandle>,
) -> String {
    metrics_handle.render()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn health_check_returns_healthy() {
        let result = health_check().await;
        assert_eq!(result.0["status"], "healthy");
        assert_eq!(result.0["service"], "rust-mdm-service");
    }
}

// Created and developed by Jai Singh
