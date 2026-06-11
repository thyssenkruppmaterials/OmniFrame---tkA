// Created and developed by Jai Singh
//! `/health`, `/status`, `/metrics`, `/realtime/status`, `/agent-token/*`,
//! `/shutdown` route handlers.

use std::process::exit;

use agent_types::{
    AgentTokenCheckResponse, AgentTokenRotateResponse, HealthResponse, OkResponse,
    RealtimeStatusResponse, StatusResponse, AGENT_VERSION_STR, CAPABILITIES,
};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use chrono::Utc;
use uuid::Uuid;

use crate::routes::AppContext;
use crate::state::AgentState;

pub async fn health(State(ctx): State<AppContext>) -> Json<HealthResponse> {
    let primary_slot = ctx.state.session_pool.get(0);
    let sap_connected = matches!(
        primary_slot.as_ref().map(|s| s.state),
        Some(agent_types::SessionState::Idle) | Some(agent_types::SessionState::Busy)
    );
    Json(HealthResponse {
        ok: true,
        version: AGENT_VERSION_STR.to_string(),
        sap_connected,
        started_at: ctx.state.started_at.to_rfc3339(),
        citrix: AgentState::detect_citrix(),
        install_dir: Some(ctx.state.install_dir.clone()),
        capabilities: CAPABILITIES.iter().map(|s| s.to_string()).collect(),
    })
}

pub async fn status(State(ctx): State<AppContext>) -> Json<StatusResponse> {
    let primary = ctx.state.session_pool.get(0);
    let sap_connected = matches!(
        primary.as_ref().map(|s| s.state),
        Some(agent_types::SessionState::Idle) | Some(agent_types::SessionState::Busy)
    );
    let supabase = ctx.state.supabase.read();
    Json(StatusResponse {
        version: AGENT_VERSION_STR.to_string(),
        sap_connected,
        supabase_configured: supabase.access_token.is_some(),
        supabase_logged_in: supabase.access_token.is_some(),
        user_email: supabase.user_email.clone(),
        sap_conn_idx: primary.as_ref().and_then(|s| s.conn_idx),
        sap_sess_idx: primary.as_ref().and_then(|s| s.sess_idx),
        citrix: AgentState::detect_citrix(),
        six_session_pool: ctx.state.snapshot_pool(),
    })
}

pub async fn metrics(State(ctx): State<AppContext>) -> impl IntoResponse {
    let body = crate::metrics::render(&ctx.state, &ctx.helper, &ctx.ws);
    (
        StatusCode::OK,
        [(
            axum::http::header::CONTENT_TYPE,
            "text/plain; version=0.0.4",
        )],
        body,
    )
}

pub async fn shutdown(State(ctx): State<AppContext>) -> Json<OkResponse> {
    tracing::info!("/shutdown called — initiating graceful exit");
    let helper = ctx.helper.clone();
    tokio::spawn(async move {
        // Give the response a beat to flush before pulling the rug.
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        let _ = helper.shutdown().await;
        exit(0);
    });
    Json(OkResponse::with_message("agent shutting down"))
}

pub async fn realtime_status(State(ctx): State<AppContext>) -> Json<RealtimeStatusResponse> {
    let m = ctx.ws.metrics();
    let last_message_at_epoch = m.last_message_at.map(|t| {
        let elapsed = t.elapsed();
        // Best-effort wall-clock estimate via the elapsed time.
        let now_epoch = chrono::Utc::now().timestamp() as f64;
        now_epoch - elapsed.as_secs_f64()
    });
    Json(RealtimeStatusResponse {
        ws_connected: m.connected,
        reconnect_count: m.reconnect_count,
        watchdog_trips: m.watchdog_trips,
        last_message_at_epoch,
        last_reconnect_reason: m.last_reason,
    })
}

pub async fn agent_token_check(
    State(ctx): State<AppContext>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let supplied = headers
        .get("X-Agent-Token")
        .or_else(|| headers.get("x-agent-token"))
        .and_then(|h| h.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let expected = ctx.state.agent_token.read().token.clone();
    if expected.is_empty() {
        // No token minted — treat as "valid for legacy clients" same as
        // the v1.x behaviour.
        return (
            StatusCode::OK,
            Json(AgentTokenCheckResponse {
                ok: true,
                valid: true,
            }),
        );
    }
    if supplied == expected {
        (
            StatusCode::OK,
            Json(AgentTokenCheckResponse {
                ok: true,
                valid: true,
            }),
        )
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(AgentTokenCheckResponse {
                ok: false,
                valid: false,
            }),
        )
    }
}

pub async fn agent_token_rotate(State(ctx): State<AppContext>) -> Json<AgentTokenRotateResponse> {
    let new_token = Uuid::new_v4().to_string();
    {
        let mut tok = ctx.state.agent_token.write();
        tok.token = new_token.clone();
        tok.minted_at = Some(Utc::now());
    }
    Json(AgentTokenRotateResponse {
        ok: true,
        agent_token: new_token,
        rotated_at: Utc::now(),
    })
}

// Created and developed by Jai Singh
