// Created and developed by Jai Singh
//! NEW v2 routes — multi-session pool.
//!
//! `/sap/v2/sessions{,/...}` — the GUI tile grid drives these to bind /
//! release / pin pool slots.

use agent_types::{OkResponse, PinSlotRequest, RpcMethod, SessionPoolSnapshot, SessionState};
use axum::extract::{Path, State};
use axum::Json;
use serde_json::Value;

use crate::routes::AppContext;

pub async fn list(State(ctx): State<AppContext>) -> Json<SessionPoolSnapshot> {
    Json(ctx.state.snapshot_pool())
}

pub async fn connect(Path(slot_id): Path<u8>, State(ctx): State<AppContext>) -> Json<OkResponse> {
    if slot_id as usize >= agent_types::SESSION_POOL_SIZE {
        return Json(OkResponse {
            ok: false,
            message: Some(format!(
                "slot_id out of range (0..{})",
                agent_types::SESSION_POOL_SIZE
            )),
        });
    }
    ctx.state
        .session_pool
        .set_state(slot_id, SessionState::Connecting);
    let resp: Value = match ctx
        .helper
        .call::<_, Value>(
            RpcMethod::SapConnect,
            serde_json::json!({"slot_id": slot_id}),
        )
        .await
    {
        Ok(v) => v,
        Err(e) => {
            ctx.state
                .session_pool
                .record_error(slot_id, format!("rpc: {e}"));
            return Json(OkResponse {
                ok: false,
                message: Some(format!("rpc: {e}")),
            });
        }
    };
    let ok = resp.get("ok").and_then(Value::as_bool).unwrap_or(false);
    if ok {
        let conn_idx = resp.get("conn_idx").and_then(Value::as_i64).unwrap_or(0) as i32;
        let sess_idx = resp
            .get("sess_idx")
            .and_then(Value::as_i64)
            .unwrap_or(slot_id as i64) as i32;
        ctx.state
            .session_pool
            .pin(slot_id, conn_idx, sess_idx, None);
        Json(OkResponse::ok())
    } else {
        let err = resp
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("connect failed")
            .to_string();
        ctx.state.session_pool.record_error(slot_id, err.clone());
        Json(OkResponse {
            ok: false,
            message: Some(err),
        })
    }
}

pub async fn disconnect(
    Path(slot_id): Path<u8>,
    State(ctx): State<AppContext>,
) -> Json<OkResponse> {
    let _resp: Value = ctx
        .helper
        .call::<_, Value>(
            RpcMethod::SapDisconnect,
            serde_json::json!({"slot_id": slot_id}),
        )
        .await
        .unwrap_or_else(|_| serde_json::json!({"ok": true}));
    ctx.state.session_pool.release(slot_id);
    Json(OkResponse::ok())
}

pub async fn pin(
    Path(slot_id): Path<u8>,
    State(ctx): State<AppContext>,
    Json(req): Json<PinSlotRequest>,
) -> Json<OkResponse> {
    // `sap.session` (Python `handle_session_set`) sets a slot's
    // (conn_idx, sess_idx) explicitly. The Rust shell owns the
    // pool-pin bookkeeping below — the helper just binds the COM
    // handle.
    let resp = ctx
        .helper
        .call::<_, Value>(
            RpcMethod::SapSession,
            serde_json::json!({
                "slot_id": slot_id,
                "conn_idx": req.conn_idx,
                "sess_idx": req.sess_idx,
                "label": req.label,
            }),
        )
        .await;
    match resp {
        Ok(_) => {
            ctx.state
                .session_pool
                .pin(slot_id, req.conn_idx, req.sess_idx, req.label);
            Json(OkResponse::ok())
        }
        Err(e) => {
            ctx.state
                .session_pool
                .record_error(slot_id, format!("pin: {e}"));
            Json(OkResponse {
                ok: false,
                message: Some(format!("pin: {e}")),
            })
        }
    }
}

pub async fn release(Path(slot_id): Path<u8>, State(ctx): State<AppContext>) -> Json<OkResponse> {
    ctx.state.session_pool.release(slot_id);
    Json(OkResponse::ok())
}

// Created and developed by Jai Singh
