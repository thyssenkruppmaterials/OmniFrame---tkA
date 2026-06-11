// Created and developed by Jai Singh
//! SAP route handlers.
//!
//! Most of these forward to `PythonHelper.call(method, params)`. The
//! exceptions are:
//!
//!   * `/sap/reversal/compute-inverse` — pure-fn (Rust-native).
//!   * `/sap/query-handlers` — static catalog (Rust-native).
//!   * `/sap/shipment-progress` — read-only DB proxy (stub for now).

use std::collections::HashMap;

use agent_rpc::PythonHelper;
use agent_types::{
    BinBlocksRequest, ConfirmToRequest, ConfirmToResponse, CreateStorageBinRequest, InverseRequest,
    InverseResponse, Lt22ImportRequest, Lx25InventoryCompletionRequest, MaterialMasterBinRequest,
    MaterialMasterReadBinRequest, MaterialMasterReadBinResponse,
    MaterialMasterReadStorageTypesRequest, MaterialMasterReadStorageTypesResponse,
    MaterialMasterStorageTypesRequest, OkResponse, ProcessShipmentRequest, ProcessShipmentResponse,
    QueryRequest, QueryResponse, RpcMethod, SapConnectRequest, SapDisconnectRequest, SapSession,
    SessionSelectRequest, TransferInventoryRequest, Zmm60LookupRequest, Zmm60LookupResponse,
};
use axum::extract::{Query, State};
use axum::Json;
use serde::Serialize;

use crate::routes::AppContext;

/// Valid `handler` discriminators that the Python `sap.query` dispatcher
/// recognises. Kept here so the Rust route can reject unknown handlers
/// early instead of round-tripping a guaranteed METHOD_NOT_FOUND.
const KNOWN_QUERY_HANDLERS: &[&str] = &["lt10", "lt24", "mb52", "mmbe"];

fn is_known_query_handler(handler: &str) -> bool {
    let lc = handler.to_ascii_lowercase();
    KNOWN_QUERY_HANDLERS.contains(&lc.as_str())
}

async fn rpc_call_typed<P, R>(
    helper: &PythonHelper,
    method: RpcMethod,
    params: P,
    fallback_err: impl Into<String>,
) -> R
where
    P: Serialize,
    R: serde::de::DeserializeOwned + ErrorEmbeddable,
{
    if !helper.is_alive() {
        return R::with_error(format!("Python helper not alive — {}", fallback_err.into()));
    }
    match helper.call::<_, R>(method, params).await {
        Ok(v) => v,
        Err(e) => R::with_error(format!("rpc {method}: {e}")),
    }
}

/// Trait so `rpc_call_typed` can stuff an error string into the
/// response shape without each route re-implementing the boilerplate.
pub trait ErrorEmbeddable {
    fn with_error(message: String) -> Self;
}

macro_rules! impl_err_embeddable {
    ($ty:ty, |$m:ident| $body:expr) => {
        impl ErrorEmbeddable for $ty {
            fn with_error($m: String) -> Self {
                $body
            }
        }
    };
}

impl_err_embeddable!(ConfirmToResponse, |m| ConfirmToResponse {
    ok: false,
    message: None,
    already_confirmed: None,
    two_step: None,
    error: Some(m),
    warning: None,
});
impl_err_embeddable!(QueryResponse, |m| QueryResponse {
    ok: false,
    columns: vec![],
    rows: vec![],
    total: 0,
    meta: None,
    error: Some(m),
});
impl_err_embeddable!(MaterialMasterReadBinResponse, |m| {
    MaterialMasterReadBinResponse {
        ok: false,
        material: String::new(),
        current_bin: None,
        error: Some(m),
        step: None,
    }
});
impl_err_embeddable!(MaterialMasterReadStorageTypesResponse, |m| {
    MaterialMasterReadStorageTypesResponse {
        ok: false,
        material: String::new(),
        current_removal: None,
        current_placement: None,
        error: Some(m),
        step: None,
    }
});
impl_err_embeddable!(Zmm60LookupResponse, |m| Zmm60LookupResponse {
    ok: false,
    material: None,
    plant: None,
    price: None,
    currency: None,
    error: Some(m),
});
impl_err_embeddable!(ProcessShipmentResponse, |m| ProcessShipmentResponse {
    ok: false,
    failed_step: Some(0),
    error: Some(m),
    message: None,
});
impl_err_embeddable!(OkResponse, |m| OkResponse {
    ok: false,
    message: Some(m),
});

// ── connect / disconnect / sessions ────────────────────────────────

pub async fn connect(
    State(ctx): State<AppContext>,
    Json(req): Json<SapConnectRequest>,
) -> Json<OkResponse> {
    let resp: OkResponse = rpc_call_typed(
        &ctx.helper,
        RpcMethod::SapConnect,
        &req,
        "could not connect",
    )
    .await;
    Json(resp)
}

pub async fn disconnect(
    State(ctx): State<AppContext>,
    Json(req): Json<SapDisconnectRequest>,
) -> Json<OkResponse> {
    let resp: OkResponse = rpc_call_typed(
        &ctx.helper,
        RpcMethod::SapDisconnect,
        &req,
        "could not disconnect",
    )
    .await;
    Json(resp)
}

pub async fn list_sessions(State(ctx): State<AppContext>) -> Json<Vec<SapSession>> {
    if !ctx.helper.is_alive() {
        return Json(vec![]);
    }
    match ctx
        .helper
        .call::<_, serde_json::Value>(RpcMethod::SapFleet, serde_json::json!({}))
        .await
    {
        Ok(v) => {
            // `sap.fleet` returns `{ok, connections: [{conn_idx, sessions: [...]}]}`.
            // Flatten to the legacy `Vec<SapSession>` shape the v1.x FE expects.
            let mut out: Vec<SapSession> = Vec::new();
            if let Some(arr) = v.get("connections").and_then(|c| c.as_array()) {
                for conn in arr {
                    let conn_idx = conn
                        .get("conn_idx")
                        .and_then(|c| c.as_i64())
                        .unwrap_or_default() as i32;
                    if let Some(sessions) = conn.get("sessions").and_then(|s| s.as_array()) {
                        for sess in sessions {
                            let sess_idx =
                                sess.get("sess_idx")
                                    .and_then(|s| s.as_i64())
                                    .unwrap_or_default() as i32;
                            let str_field = |k: &str| {
                                sess.get(k)
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string()
                            };
                            out.push(SapSession {
                                conn_idx,
                                sess_idx,
                                system: str_field("system"),
                                client: str_field("client"),
                                user: str_field("user"),
                                transaction: str_field("transaction"),
                                program: str_field("program"),
                                session_title: str_field("label"),
                                pinned: false,
                                pinned_slot: None,
                            });
                        }
                    }
                }
            }
            Json(out)
        }
        Err(e) => {
            tracing::warn!(error = %e, "list_sessions rpc failed");
            Json(vec![])
        }
    }
}

pub async fn session_info(
    State(_ctx): State<AppContext>,
    Json(req): Json<SessionSelectRequest>,
) -> Json<serde_json::Value> {
    // Mirrors v1.x `/sap/session` → echoes the conn/sess back so the FE
    // can confirm pinning without a follow-up `/sap/sessions` round-trip.
    Json(serde_json::json!({
        "ok": true,
        "conn_idx": req.conn_idx,
        "sess_idx": req.sess_idx,
    }))
}

pub async fn select_session(
    State(ctx): State<AppContext>,
    Json(req): Json<SessionSelectRequest>,
) -> Json<OkResponse> {
    // Pin against slot 0 (the legacy primary slot) so v1.x clients keep
    // working without targeting a v2 slot.
    ctx.state
        .session_pool
        .pin(0, req.conn_idx, req.sess_idx, None);
    Json(OkResponse::ok())
}

pub async fn unpin_session(State(ctx): State<AppContext>) -> Json<OkResponse> {
    ctx.state.session_pool.release(0);
    Json(OkResponse::ok())
}

#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)]
pub struct ShipmentProgressQuery {
    #[serde(default)]
    pub to_number: Option<String>,
    #[serde(default)]
    pub warehouse: Option<String>,
}

/// `/sap/shipment-progress` — DB-only read of putaway status. Stub for
/// now (Worker D mirrors the agent module + Worker B owns the helper);
/// returns 501 so the FE can detect the gap without crashing.
pub async fn shipment_progress(
    Query(_q): Query<ShipmentProgressQuery>,
) -> (axum::http::StatusCode, Json<serde_json::Value>) {
    (
        axum::http::StatusCode::NOT_IMPLEMENTED,
        Json(serde_json::json!({
            "ok": false,
            "error": "shipment-progress is not yet wired in the v2 Rust agent — coming in v2.0.1"
        })),
    )
}

// ── Mutations ──────────────────────────────────────────────────────

pub async fn confirm_to(
    State(ctx): State<AppContext>,
    Json(req): Json<ConfirmToRequest>,
) -> Json<ConfirmToResponse> {
    let resp = rpc_call_typed::<_, ConfirmToResponse>(
        &ctx.helper,
        RpcMethod::SapConfirmTo,
        &req,
        "confirm_to",
    )
    .await;
    Json(resp)
}

pub async fn transfer_inventory(
    State(ctx): State<AppContext>,
    Json(req): Json<TransferInventoryRequest>,
) -> Json<OkResponse> {
    let resp = rpc_call_typed::<_, OkResponse>(
        &ctx.helper,
        RpcMethod::SapTransferInventory,
        &req,
        "transfer_inventory",
    )
    .await;
    Json(resp)
}

pub async fn bin_blocks(
    State(ctx): State<AppContext>,
    Json(req): Json<BinBlocksRequest>,
) -> Json<OkResponse> {
    let resp =
        rpc_call_typed::<_, OkResponse>(&ctx.helper, RpcMethod::SapBinBlocks, &req, "bin_blocks")
            .await;
    Json(resp)
}

pub async fn material_master_bin(
    State(ctx): State<AppContext>,
    Json(req): Json<MaterialMasterBinRequest>,
) -> Json<OkResponse> {
    let resp = rpc_call_typed::<_, OkResponse>(
        &ctx.helper,
        RpcMethod::SapMaterialMasterBin,
        &req,
        "material_master_bin",
    )
    .await;
    Json(resp)
}

pub async fn material_master_storage_types(
    State(ctx): State<AppContext>,
    Json(req): Json<MaterialMasterStorageTypesRequest>,
) -> Json<OkResponse> {
    let resp = rpc_call_typed::<_, OkResponse>(
        &ctx.helper,
        RpcMethod::SapMaterialMasterStorageTypes,
        &req,
        "material_master_storage_types",
    )
    .await;
    Json(resp)
}

pub async fn create_storage_bin(
    State(ctx): State<AppContext>,
    Json(req): Json<CreateStorageBinRequest>,
) -> Json<OkResponse> {
    let resp = rpc_call_typed::<_, OkResponse>(
        &ctx.helper,
        RpcMethod::SapCreateStorageBin,
        &req,
        "create_storage_bin",
    )
    .await;
    Json(resp)
}

pub async fn material_master_read_bin(
    State(ctx): State<AppContext>,
    Json(req): Json<MaterialMasterReadBinRequest>,
) -> Json<MaterialMasterReadBinResponse> {
    let resp = rpc_call_typed::<_, MaterialMasterReadBinResponse>(
        &ctx.helper,
        RpcMethod::SapMaterialMasterReadBin,
        &req,
        "mm03_read_bin",
    )
    .await;
    Json(resp)
}

pub async fn material_master_read_storage_types(
    State(ctx): State<AppContext>,
    Json(req): Json<MaterialMasterReadStorageTypesRequest>,
) -> Json<MaterialMasterReadStorageTypesResponse> {
    let resp = rpc_call_typed::<_, MaterialMasterReadStorageTypesResponse>(
        &ctx.helper,
        RpcMethod::SapMaterialMasterReadStorageTypes,
        &req,
        "mm03_read_storage_types",
    )
    .await;
    Json(resp)
}

// ── Queries ────────────────────────────────────────────────────────

pub async fn query(
    State(ctx): State<AppContext>,
    Json(req): Json<QueryRequest>,
) -> Json<QueryResponse> {
    if !is_known_query_handler(&req.handler) {
        return Json(QueryResponse {
            ok: false,
            columns: vec![],
            rows: vec![],
            total: 0,
            meta: None,
            error: Some(format!(
                "Unknown handler '{}'. Available: {}",
                req.handler,
                KNOWN_QUERY_HANDLERS.join(", ")
            )),
        });
    }
    // The Python `sap.query` dispatcher switches on the `handler` field
    // inside the params object, so we forward the whole request.
    let resp =
        rpc_call_typed::<_, QueryResponse>(&ctx.helper, RpcMethod::SapQuery, &req, "query").await;
    Json(resp)
}

pub async fn list_query_handlers() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "handlers": [
            {"id": "lt10", "name": "LT10"},
            {"id": "lt24", "name": "LT24"},
            {"id": "mb52", "name": "MB52"},
            {"id": "mmbe", "name": "MMBE"},
        ],
    }))
}

// ── Composite flows ────────────────────────────────────────────────

pub async fn process_shipment(
    State(ctx): State<AppContext>,
    Json(req): Json<ProcessShipmentRequest>,
) -> Json<ProcessShipmentResponse> {
    let resp = rpc_call_typed::<_, ProcessShipmentResponse>(
        &ctx.helper,
        RpcMethod::SapProcessShipment,
        &req,
        "process_shipment",
    )
    .await;
    Json(resp)
}

pub async fn import_lt22(
    State(ctx): State<AppContext>,
    Json(req): Json<Lt22ImportRequest>,
) -> Json<serde_json::Value> {
    if !ctx.helper.is_alive() {
        return Json(serde_json::json!({
            "ok": false,
            "error": "Python helper not alive"
        }));
    }
    match ctx
        .helper
        .call::<_, serde_json::Value>(RpcMethod::SapImportLt22, &req)
        .await
    {
        Ok(v) => Json(v),
        Err(e) => Json(serde_json::json!({"ok": false, "error": format!("{e}")})),
    }
}

pub async fn zmm60_lookup(
    State(ctx): State<AppContext>,
    Json(req): Json<Zmm60LookupRequest>,
) -> Json<Zmm60LookupResponse> {
    let resp = rpc_call_typed::<_, Zmm60LookupResponse>(
        &ctx.helper,
        RpcMethod::SapZmm60Lookup,
        &req,
        "zmm60_lookup",
    )
    .await;
    Json(resp)
}

pub async fn lx25_completion(
    State(ctx): State<AppContext>,
    Json(req): Json<Lx25InventoryCompletionRequest>,
) -> Json<serde_json::Value> {
    if !ctx.helper.is_alive() {
        return Json(serde_json::json!({
            "ok": false,
            "error": "Python helper not alive"
        }));
    }
    match ctx
        .helper
        .call::<_, serde_json::Value>(RpcMethod::SapLx25InventoryCompletion, &req)
        .await
    {
        Ok(v) => Json(v),
        Err(e) => Json(serde_json::json!({"ok": false, "error": format!("{e}")})),
    }
}

// ── Pure-function: reversal engine ─────────────────────────────────

pub async fn reversal_compute_inverse(Json(req): Json<InverseRequest>) -> Json<InverseResponse> {
    Json(crate::reversal::build_response(&req))
}

// silence unused warnings until consumers catch up
#[allow(dead_code)]
fn _force_use_hashmap(_: HashMap<String, serde_json::Value>) {}

// Created and developed by Jai Singh
