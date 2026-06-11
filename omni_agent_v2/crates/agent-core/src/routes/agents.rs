// Created and developed by Jai Singh
//! `/agents`, `/agents/{agent_id}` — read-only fleet listing.
//!
//! These forward to `rust-work-service /api/v1/sap-agents` so every
//! agent in the org sees the same fleet view. Returns an `Option<Json>`
//! since the v1.x agent answers with raw passthrough (the FE doesn't
//! care about the local agent re-modeling the shape).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde_json::Value;

use crate::routes::AppContext;

pub async fn list(State(ctx): State<AppContext>) -> (StatusCode, Json<Value>) {
    let bearer = ctx.state.jwt.read().bearer.clone();
    proxy_get(&ctx, "/api/v1/sap-agents", bearer.as_deref()).await
}

pub async fn get_one(
    State(ctx): State<AppContext>,
    Path(agent_id): Path<String>,
) -> (StatusCode, Json<Value>) {
    let bearer = ctx.state.jwt.read().bearer.clone();
    proxy_get(
        &ctx,
        &format!("/api/v1/sap-agents/{agent_id}"),
        bearer.as_deref(),
    )
    .await
}

async fn proxy_get(
    ctx: &AppContext,
    path: &str,
    bearer: Option<&str>,
) -> (StatusCode, Json<Value>) {
    let url = format!(
        "{}{}",
        ctx.config.work_service_url.trim_end_matches('/'),
        path
    );
    let mut req = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c.get(&url),
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"ok": false, "error": format!("http client: {e}")})),
            );
        }
    };
    if let Some(b) = bearer {
        req = req.header("Authorization", format!("Bearer {b}"));
    }
    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"ok": false, "error": format!("upstream: {e}")})),
            );
        }
    };
    let status = resp.status();
    let raw = resp.text().await.unwrap_or_default();
    let body: Value =
        serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({"raw": raw}));
    (
        StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK),
        Json(body),
    )
}

// Created and developed by Jai Singh
