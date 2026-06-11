// Created and developed by Jai Singh
//! `/sap/recording/*` route handlers. Forward to PythonHelper for the
//! actions that touch SAP, return loose-typed JSON for parity with the
//! v1.x agent.

use agent_rpc::PythonHelper;
use agent_types::{RecordingStartRequest, RecordingTranslateRequest, RpcMethod};
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde_json::Value;

use crate::routes::AppContext;

async fn rpc_loose<P: serde::Serialize>(
    helper: &PythonHelper,
    method: RpcMethod,
    params: P,
) -> Json<Value> {
    if !helper.is_alive() {
        return Json(serde_json::json!({"ok": false, "error": "Python helper not alive"}));
    }
    match helper.call::<_, Value>(method, params).await {
        Ok(v) => Json(v),
        Err(e) => Json(serde_json::json!({"ok": false, "error": format!("{e}")})),
    }
}

pub async fn start(
    State(ctx): State<AppContext>,
    Json(req): Json<RecordingStartRequest>,
) -> Json<Value> {
    rpc_loose(&ctx.helper, RpcMethod::SapRecordingStart, &req).await
}

pub async fn stop(State(ctx): State<AppContext>) -> Json<Value> {
    rpc_loose(
        &ctx.helper,
        RpcMethod::SapRecordingStop,
        serde_json::json!({}),
    )
    .await
}

pub async fn status(State(ctx): State<AppContext>) -> Json<Value> {
    rpc_loose(
        &ctx.helper,
        RpcMethod::SapRecordingStatus,
        serde_json::json!({}),
    )
    .await
}

/// `GET /sap/recording/list` — FS-only on the helper side. v1.x reads
/// from `%TEMP%/omniframe_recordings/*.json`. Stub returns 501 for the
/// v2.0.0-alpha bring-up; helper integration follows in v2.0.1.
pub async fn list() -> (axum::http::StatusCode, Json<Value>) {
    (
        axum::http::StatusCode::NOT_IMPLEMENTED,
        Json(serde_json::json!({
            "ok": false,
            "error": "recording list is not yet wired in v2.0.0-alpha"
        })),
    )
}

pub async fn get_one(Path(rec_id): Path<String>) -> (axum::http::StatusCode, Json<Value>) {
    (
        axum::http::StatusCode::NOT_IMPLEMENTED,
        Json(serde_json::json!({
            "ok": false,
            "rec_id": rec_id,
            "error": "recording get is not yet wired in v2.0.0-alpha"
        })),
    )
}

pub async fn delete_one(Path(rec_id): Path<String>) -> (axum::http::StatusCode, Json<Value>) {
    (
        axum::http::StatusCode::NOT_IMPLEMENTED,
        Json(serde_json::json!({
            "ok": false,
            "rec_id": rec_id,
            "error": "recording delete is not yet wired in v2.0.0-alpha"
        })),
    )
}

pub async fn translate(
    Path(rec_id): Path<String>,
    State(ctx): State<AppContext>,
    Json(req): Json<RecordingTranslateRequest>,
) -> Json<Value> {
    let body = serde_json::json!({
        "rec_id": rec_id,
        "name": req.name,
        "kind": req.kind,
        "input_overrides": req.input_overrides,
    });
    rpc_loose(&ctx.helper, RpcMethod::SapRecordingTranslate, body).await
}

pub async fn replay(
    Path(rec_id): Path<String>,
    State(ctx): State<AppContext>,
    headers: HeaderMap,
) -> Json<Value> {
    let confirm = headers
        .get("X-Recording-Allow-Replay")
        .or_else(|| headers.get("x-recording-allow-replay"))
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_ascii_lowercase());
    if confirm.as_deref() != Some("yes") {
        return Json(serde_json::json!({
            "ok": false,
            "error": "Replay is opt-in. Send header 'X-Recording-Allow-Replay: yes' to confirm.",
        }));
    }
    let body = serde_json::json!({"rec_id": rec_id});
    rpc_loose(&ctx.helper, RpcMethod::SapRecordingReplay, body).await
}

// Created and developed by Jai Singh
