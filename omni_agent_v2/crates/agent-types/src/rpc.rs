// Created and developed by Jai Singh
//! JSON-RPC 2.0 envelope + method catalog for the Python helper sidecar.
//!
//! The Rust agent shell speaks line-delimited JSON-RPC over stdio to a
//! long-lived Python subprocess (`sap_helper.py`) that owns every COM
//! call. Each Rust [`crate::sap`] request type maps to exactly one
//! [`RpcMethod`] variant — the dispatch table lives in `agent-core`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

/// Canonical method names. Implements [`std::fmt::Display`] so it
/// serializes to the dotted-namespace string the helper expects
/// (`"sap.connect"`, `"sap.query"`, etc.).
///
/// The variant list IS the wire contract. It MUST match — verbatim —
/// the methods registered by `python/sap_helper.py` + `python/handlers/*.py`
/// via `dispatcher.register(...)`. The Python side is canonical because
/// it's the actual server that dispatches the calls; this enum is the
/// strongly-typed mirror Worker A's Rust shell uses to drive it.
///
/// `packaging/check_rpc_contract.py` cross-checks the two sides on every
/// validation run. If you add a variant here, add the matching
/// `dispatcher.register(...)` call in a handler module — and vice versa.
///
/// NOTE: `sap.reversal.computeInverse` is intentionally NOT in this
/// enum. The Rust agent answers `/sap/reversal/compute-inverse` locally
/// (see `agent_core::reversal`) without round-tripping through the
/// helper. The Python side exposes `sap.reverseTransaction` as a stub
/// that returns `{ok:false, owner:"rust-reversal-service"}` so the
/// helper still owns a slot for future SAP-side reversal flows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RpcMethod {
    // ── Connection lifecycle ─────────────────────────────────────────
    /// Bind a SAP session to a pool slot. Params:
    /// `{"slot_id": u8, "conn_idx": Option<i32>, "sess_idx": Option<i32>}`.
    SapConnect,
    /// Release a pool slot.
    SapDisconnect,
    /// Full pool snapshot — every slot + its current binding.
    SapSessions,
    /// Set a slot's `(conn_idx, sess_idx)` explicitly (no pinning).
    /// Mirrors v1.x `POST /sap/session`.
    SapSession,
    /// Pin a slot to a specific `(conn_idx, sess_idx)` with optional
    /// `pin_by_criteria` so the binding survives SAP GUI restart.
    SapSelectSession,
    /// Clear the pin on a slot.
    SapUnpinSession,
    /// Lightweight readiness check (no COM touch).
    SapHealth,
    /// Enumerate every SAP GUI connection + session visible on the host.
    SapFleet,

    // ── Mutations ───────────────────────────────────────────────────
    /// LT12 confirm transfer order.
    SapConfirmTo,
    /// LT01 bin-to-bin transfer.
    SapTransferInventory,
    /// LS02N putaway / removal block flip.
    SapBinBlocks,
    /// MM02 storage-bin update.
    SapMaterialMasterBin,
    /// MM02 storage-types update.
    SapMaterialMasterStorageTypes,
    /// LS01N create storage bin.
    SapCreateStorageBin,
    /// MM03 read storage-bin (dry-run preview).
    SapMaterialMasterReadBin,
    /// MM03 read storage-types (dry-run preview).
    SapMaterialMasterReadStorageTypes,

    // ── Queries ─────────────────────────────────────────────────────
    /// Generic query dispatcher. The Python side switches on the
    /// `handler` param (`"lt10"`, `"lt24"`, `"mb52"`, `"mmbe"`).
    SapQuery,
    /// Enumerate the registered query handlers (static catalog).
    SapQueryHandlers,

    // ── Composite flows ─────────────────────────────────────────────
    SapProcessShipment,
    /// DB-only read of putaway status. Returns 501 from the Rust route
    /// today; helper integration follows in v2.0.1.
    SapShipmentProgress,
    SapImportLt22,
    SapZmm60Lookup,
    /// LX25 inventory completion (multi-warehouse fan-out).
    SapLx25InventoryCompletion,

    // ── Recording ───────────────────────────────────────────────────
    SapRecordingStart,
    SapRecordingStop,
    SapRecordingStatus,
    SapRecordingList,
    SapRecordingGet,
    SapRecordingDelete,
    SapRecordingTranslate,
    SapRecordingReplay,

    // ── Reversal (helper-side slot for future SAP-side reversal
    //     flows; the Rust shell short-circuits the pure-function path
    //     via `agent_core::reversal` and never sends this).
    SapReverseTransaction,
}

impl std::fmt::Display for RpcMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            RpcMethod::SapConnect => "sap.connect",
            RpcMethod::SapDisconnect => "sap.disconnect",
            RpcMethod::SapSessions => "sap.sessions",
            RpcMethod::SapSession => "sap.session",
            RpcMethod::SapSelectSession => "sap.selectSession",
            RpcMethod::SapUnpinSession => "sap.unpinSession",
            RpcMethod::SapHealth => "sap.health",
            RpcMethod::SapFleet => "sap.fleet",
            RpcMethod::SapConfirmTo => "sap.confirmTo",
            RpcMethod::SapTransferInventory => "sap.transferInventory",
            RpcMethod::SapBinBlocks => "sap.binBlocks",
            RpcMethod::SapMaterialMasterBin => "sap.materialMasterBin",
            RpcMethod::SapMaterialMasterStorageTypes => "sap.materialMasterStorageTypes",
            RpcMethod::SapCreateStorageBin => "sap.createStorageBin",
            RpcMethod::SapMaterialMasterReadBin => "sap.materialMasterReadBin",
            RpcMethod::SapMaterialMasterReadStorageTypes => "sap.materialMasterReadStorageTypes",
            RpcMethod::SapQuery => "sap.query",
            RpcMethod::SapQueryHandlers => "sap.queryHandlers",
            RpcMethod::SapProcessShipment => "sap.processShipment",
            RpcMethod::SapShipmentProgress => "sap.shipmentProgress",
            RpcMethod::SapImportLt22 => "sap.importLt22",
            RpcMethod::SapZmm60Lookup => "sap.zmm60Lookup",
            RpcMethod::SapLx25InventoryCompletion => "sap.lx25InventoryCompletion",
            RpcMethod::SapRecordingStart => "sap.recording.start",
            RpcMethod::SapRecordingStop => "sap.recording.stop",
            RpcMethod::SapRecordingStatus => "sap.recording.status",
            RpcMethod::SapRecordingList => "sap.recording.list",
            RpcMethod::SapRecordingGet => "sap.recording.get",
            RpcMethod::SapRecordingDelete => "sap.recording.delete",
            RpcMethod::SapRecordingTranslate => "sap.recording.translate",
            RpcMethod::SapRecordingReplay => "sap.recording.replay",
            RpcMethod::SapReverseTransaction => "sap.reverseTransaction",
        };
        f.write_str(s)
    }
}

impl RpcMethod {
    /// Used by the helper supervisor for log labels and metric tags.
    /// Same as `Display` but without the `sap.` prefix so prom labels
    /// stay short.
    pub fn metric_label(&self) -> &'static str {
        match self {
            RpcMethod::SapConnect => "connect",
            RpcMethod::SapDisconnect => "disconnect",
            RpcMethod::SapSessions => "sessions",
            RpcMethod::SapSession => "session",
            RpcMethod::SapSelectSession => "select_session",
            RpcMethod::SapUnpinSession => "unpin_session",
            RpcMethod::SapHealth => "health",
            RpcMethod::SapFleet => "fleet",
            RpcMethod::SapConfirmTo => "confirm_to",
            RpcMethod::SapTransferInventory => "transfer_inventory",
            RpcMethod::SapBinBlocks => "bin_blocks",
            RpcMethod::SapMaterialMasterBin => "mm02_bin",
            RpcMethod::SapMaterialMasterStorageTypes => "mm02_storage_types",
            RpcMethod::SapCreateStorageBin => "create_bin",
            RpcMethod::SapMaterialMasterReadBin => "mm03_read_bin",
            RpcMethod::SapMaterialMasterReadStorageTypes => "mm03_read_storage_types",
            RpcMethod::SapQuery => "query",
            RpcMethod::SapQueryHandlers => "query_handlers",
            RpcMethod::SapProcessShipment => "process_shipment",
            RpcMethod::SapShipmentProgress => "shipment_progress",
            RpcMethod::SapImportLt22 => "import_lt22",
            RpcMethod::SapZmm60Lookup => "zmm60_lookup",
            RpcMethod::SapLx25InventoryCompletion => "lx25_inventory_completion",
            RpcMethod::SapRecordingStart => "recording_start",
            RpcMethod::SapRecordingStop => "recording_stop",
            RpcMethod::SapRecordingStatus => "recording_status",
            RpcMethod::SapRecordingList => "recording_list",
            RpcMethod::SapRecordingGet => "recording_get",
            RpcMethod::SapRecordingDelete => "recording_delete",
            RpcMethod::SapRecordingTranslate => "recording_translate",
            RpcMethod::SapRecordingReplay => "recording_replay",
            RpcMethod::SapReverseTransaction => "reverse_transaction",
        }
    }
}

/// JSON-RPC 2.0 request envelope. Generic over the params type so each
/// handler can stay strongly-typed at the boundary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcRequest<P> {
    /// Always `"2.0"`.
    pub jsonrpc: String,
    pub id: u64,
    /// Serialized via [`RpcMethod`]'s [`std::fmt::Display`] impl.
    #[serde(with = "rpc_method_serde")]
    pub method: RpcMethod,
    pub params: P,
}

impl<P> RpcRequest<P> {
    pub fn new(id: u64, method: RpcMethod, params: P) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            method,
            params,
        }
    }
}

/// JSON-RPC 2.0 response envelope. Exactly one of `result` / `error`
/// is set (server-side guarantee per RFC; we double-check at parse
/// time in the supervisor).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcResponse<R> {
    pub jsonrpc: String,
    pub id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<R>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

/// JSON-RPC error envelope. `code` follows the standard catalog:
/// `-32700` parse error, `-32600` invalid request, `-32601` method not
/// found, `-32602` invalid params, `-32603` internal error. The
/// supervisor adds two custom codes:
/// `-32000` helper crashed, `-32001` helper timeout.
#[derive(Debug, Clone, Serialize, Deserialize, Error)]
#[error("RPC error {code}: {message}")]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    pub const PARSE_ERROR: i32 = -32700;
    pub const INVALID_REQUEST: i32 = -32600;
    pub const METHOD_NOT_FOUND: i32 = -32601;
    pub const INVALID_PARAMS: i32 = -32602;
    pub const INTERNAL_ERROR: i32 = -32603;
    /// Custom — helper subprocess exited unexpectedly.
    pub const HELPER_CRASHED: i32 = -32000;
    /// Custom — per-call timeout exceeded.
    pub const HELPER_TIMEOUT: i32 = -32001;
    /// Custom — supervisor channel closed during a pending call.
    pub const CHANNEL_CLOSED: i32 = -32002;

    pub fn new(code: i32, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }
    pub fn helper_crashed(message: impl Into<String>) -> Self {
        Self::new(Self::HELPER_CRASHED, message)
    }
    pub fn helper_timeout(message: impl Into<String>) -> Self {
        Self::new(Self::HELPER_TIMEOUT, message)
    }
    pub fn channel_closed(message: impl Into<String>) -> Self {
        Self::new(Self::CHANNEL_CLOSED, message)
    }
}

/// Helper-initiated notification (no `id` → no response expected).
/// Used for batched console-line streaming so the helper can emit
/// `print()`-style output without blocking on a round-trip.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcNotification {
    pub jsonrpc: String,
    /// Free-form, but we publish a tiny known vocabulary the
    /// supervisor knows how to route:
    /// `"log.line"` (one console line), `"log.batch"` (vec of lines),
    /// `"session.stateChanged"` (slot_id + new state).
    pub method: String,
    pub params: Value,
}

/// Serde helper to keep `RpcMethod` round-trippable as a string.
mod rpc_method_serde {
    use super::RpcMethod;
    use serde::{Deserialize, Deserializer, Serializer};
    use std::str::FromStr;

    pub fn serialize<S: Serializer>(value: &RpcMethod, ser: S) -> Result<S::Ok, S::Error> {
        ser.serialize_str(&value.to_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(de: D) -> Result<RpcMethod, D::Error> {
        let raw = String::deserialize(de)?;
        RpcMethod::from_str(&raw).map_err(serde::de::Error::custom)
    }
}

impl std::str::FromStr for RpcMethod {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s {
            "sap.connect" => RpcMethod::SapConnect,
            "sap.disconnect" => RpcMethod::SapDisconnect,
            "sap.sessions" => RpcMethod::SapSessions,
            "sap.session" => RpcMethod::SapSession,
            "sap.selectSession" => RpcMethod::SapSelectSession,
            "sap.unpinSession" => RpcMethod::SapUnpinSession,
            "sap.health" => RpcMethod::SapHealth,
            "sap.fleet" => RpcMethod::SapFleet,
            "sap.confirmTo" => RpcMethod::SapConfirmTo,
            "sap.transferInventory" => RpcMethod::SapTransferInventory,
            "sap.binBlocks" => RpcMethod::SapBinBlocks,
            "sap.materialMasterBin" => RpcMethod::SapMaterialMasterBin,
            "sap.materialMasterStorageTypes" => RpcMethod::SapMaterialMasterStorageTypes,
            "sap.createStorageBin" => RpcMethod::SapCreateStorageBin,
            "sap.materialMasterReadBin" => RpcMethod::SapMaterialMasterReadBin,
            "sap.materialMasterReadStorageTypes" => RpcMethod::SapMaterialMasterReadStorageTypes,
            "sap.query" => RpcMethod::SapQuery,
            "sap.queryHandlers" => RpcMethod::SapQueryHandlers,
            "sap.processShipment" => RpcMethod::SapProcessShipment,
            "sap.shipmentProgress" => RpcMethod::SapShipmentProgress,
            "sap.importLt22" => RpcMethod::SapImportLt22,
            "sap.zmm60Lookup" => RpcMethod::SapZmm60Lookup,
            "sap.lx25InventoryCompletion" => RpcMethod::SapLx25InventoryCompletion,
            "sap.recording.start" => RpcMethod::SapRecordingStart,
            "sap.recording.stop" => RpcMethod::SapRecordingStop,
            "sap.recording.status" => RpcMethod::SapRecordingStatus,
            "sap.recording.list" => RpcMethod::SapRecordingList,
            "sap.recording.get" => RpcMethod::SapRecordingGet,
            "sap.recording.delete" => RpcMethod::SapRecordingDelete,
            "sap.recording.translate" => RpcMethod::SapRecordingTranslate,
            "sap.recording.replay" => RpcMethod::SapRecordingReplay,
            "sap.reverseTransaction" => RpcMethod::SapReverseTransaction,
            other => return Err(format!("unknown RPC method: {other}")),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_method() {
        for m in [
            RpcMethod::SapConnect,
            RpcMethod::SapQuery,
            RpcMethod::SapReverseTransaction,
            RpcMethod::SapLx25InventoryCompletion,
            RpcMethod::SapRecordingTranslate,
        ] {
            let s = m.to_string();
            let back: RpcMethod = s.parse().unwrap();
            assert_eq!(m, back);
        }
    }

    #[test]
    fn request_serializes_method_as_string() {
        let req = RpcRequest::new(7, RpcMethod::SapConfirmTo, serde_json::json!({"a": 1}));
        let json = serde_json::to_string(&req).unwrap();
        assert!(
            json.contains("\"method\":\"sap.confirmTo\""),
            "unexpected serialization: {json}"
        );
        assert!(json.contains("\"id\":7"));
        assert!(json.contains("\"jsonrpc\":\"2.0\""));
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(RpcError::PARSE_ERROR, -32700);
        assert_eq!(RpcError::HELPER_CRASHED, -32000);
    }
}

// Created and developed by Jai Singh
