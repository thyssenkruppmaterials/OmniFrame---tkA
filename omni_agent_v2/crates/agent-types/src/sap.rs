// Created and developed by Jai Singh
//! SAP handler request / response shapes.
//!
//! Every type here mirrors a Pydantic model in the v1.x Python agent
//! (`omni_agent/agent.py` + sibling modules). The field names + JSON
//! defaults are wire-compatible with what the browser admin UI already
//! sends, so the FE doesn't need a coordinated release to talk to the
//! v2 Rust agent.
//!
//! Each request struct ALSO inlines [`crate::session::SessionTarget`]
//! via `#[serde(flatten)]` so the FE can route a call to a specific
//! pool slot by passing `session_id: N` in the body (NEW in v2).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

use crate::session::SessionTarget;

// ───────────────────────────────────────────────────────────────────
//  LT12 — Confirm Transfer Order
// ───────────────────────────────────────────────────────────────────

/// `POST /sap/confirm-to` — mirrors `agent.py:ConfirmTORequest`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConfirmToRequest {
    pub to_number: String,
    pub warehouse: String,
    #[serde(flatten)]
    pub target: SessionTarget,
}

/// `POST /sap/confirm-to` response — Python returns `{ok, message,
/// already_confirmed?, two_step?, error?}`. We keep the loose shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConfirmToResponse {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub already_confirmed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub two_step: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<bool>,
}

// ───────────────────────────────────────────────────────────────────
//  LT01 — Transfer Inventory (bin-to-bin)
// ───────────────────────────────────────────────────────────────────

/// `POST /sap/transfer-inventory` — mirrors `agent.py:TransferInventoryRequest`.
/// v2.0.1 fields (stock_category / special_stock_indicator /
/// special_stock_number / print_destination) default to `""` so older
/// FE callers stay wire-compatible. Capability flag `lt01-stock-fields`
/// advertises that the agent honours them.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TransferInventoryRequest {
    pub warehouse: String,
    pub material: String,
    pub quantity: String,
    #[serde(default)]
    pub plant: String,
    #[serde(default)]
    pub storage_location: String,
    #[serde(default)]
    pub batch: String,
    pub source_storage_type: String,
    pub source_storage_bin: String,
    pub dest_storage_type: String,
    pub dest_storage_bin: String,
    #[serde(default = "default_movement_type")]
    pub movement_type: String,
    #[serde(default)]
    pub stock_category: String,
    #[serde(default)]
    pub special_stock_indicator: String,
    #[serde(default)]
    pub special_stock_number: String,
    #[serde(default)]
    pub print_destination: String,
    #[serde(flatten)]
    pub target: SessionTarget,
}

fn default_movement_type() -> String {
    "999".to_string()
}

// ───────────────────────────────────────────────────────────────────
//  LS02N — Bin Blocks
// ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct BinBlocksRequest {
    pub warehouse: String,
    pub storage_type: String,
    pub storage_bin: String,
    pub putaway_block: bool,
    pub stock_removal_block: bool,
    #[serde(flatten)]
    pub target: SessionTarget,
}

// ───────────────────────────────────────────────────────────────────
//  MM02 — Material Master Bin
// ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MaterialMasterBinRequest {
    pub material: String,
    pub plant: String,
    pub warehouse: String,
    pub storage_type: String,
    /// Empty string CLEARS the current bin (matches Python semantics).
    #[serde(default)]
    pub storage_bin: String,
    #[serde(flatten)]
    pub target: SessionTarget,
}

// ───────────────────────────────────────────────────────────────────
//  LS01N — Create Storage Bin
// ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CreateStorageBinRequest {
    pub warehouse: String,
    pub storage_type: String,
    pub storage_bin: String,
    #[serde(flatten)]
    pub target: SessionTarget,
}

// ───────────────────────────────────────────────────────────────────
//  MM02 — Material Master Storage Types
// ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MaterialMasterStorageTypesRequest {
    pub material: String,
    pub plant: String,
    pub warehouse: String,
    pub org_storage_type: String,
    #[serde(default)]
    pub removal_storage_type: String,
    #[serde(default)]
    pub placement_storage_type: String,
    #[serde(flatten)]
    pub target: SessionTarget,
}

// ───────────────────────────────────────────────────────────────────
//  MM03 — Material Master Read (dry-run preview)
// ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MaterialMasterReadBinRequest {
    pub material: String,
    pub plant: String,
    pub warehouse: String,
    pub storage_type: String,
    #[serde(flatten)]
    pub target: SessionTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MaterialMasterReadBinResponse {
    pub ok: bool,
    pub material: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_bin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MaterialMasterReadStorageTypesRequest {
    pub material: String,
    pub plant: String,
    pub warehouse: String,
    pub org_storage_type: String,
    #[serde(flatten)]
    pub target: SessionTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MaterialMasterReadStorageTypesResponse {
    pub ok: bool,
    pub material: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_removal: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_placement: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
}

// ───────────────────────────────────────────────────────────────────
//  /sap/query — Generic dispatch (LT10 / LT24 / MB52 / MMBE)
// ───────────────────────────────────────────────────────────────────

/// `POST /sap/query` request — `handler` is one of `"lt10"`, `"lt24"`,
/// `"mb52"`, `"mmbe"`. `params` is handler-specific (the FE knows what
/// to send for each).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct QueryRequest {
    pub handler: String,
    #[serde(default)]
    pub params: HashMap<String, Value>,
    #[serde(default)]
    pub use_bulk_export: bool,
    #[serde(flatten)]
    pub target: SessionTarget,
}

/// `POST /sap/query` response. Loose-typed `rows` since each handler
/// emits a different column set; the FE inspects `columns` to lay out
/// the data-grid.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct QueryResponse {
    pub ok: bool,
    #[serde(default)]
    pub columns: Vec<String>,
    #[serde(default)]
    pub rows: Vec<Value>,
    #[serde(default)]
    pub total: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ───────────────────────────────────────────────────────────────────
//  /sap/process-shipment — full shipment flow (Finaltesting.vbs)
// ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ProcessShipmentRequest {
    pub delivery: String,
    #[serde(default = "default_item")]
    pub item: String,
    #[serde(default)]
    pub serials: Vec<String>,
    pub to_number: String,
    pub warehouse: String,
    #[serde(default = "default_tracking")]
    pub tracking: String,
    #[serde(flatten)]
    pub target: SessionTarget,
}

fn default_item() -> String {
    "0010".to_string()
}
fn default_tracking() -> String {
    "Tracking".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ProcessShipmentResponse {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed_step: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

// ───────────────────────────────────────────────────────────────────
//  /sap/import-lt22 — LT22 outbound TO import
// ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Lt22ImportRequest {
    pub warehouse: String,
    #[serde(default)]
    pub storage_type: String,
    #[serde(default)]
    pub show_verified: bool,
    #[serde(default = "default_true")]
    pub show_open_waiting: bool,
    #[serde(default = "default_layout_variant")]
    pub layout_variant: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date_to: Option<String>,
    pub organization_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub triggered_by: Option<String>,
    pub import_run_id: String,
    #[serde(default = "default_true")]
    pub use_bulk_export: bool,
    #[serde(flatten)]
    pub target: SessionTarget,
}

fn default_true() -> bool {
    true
}
fn default_layout_variant() -> String {
    "ONEBOXAPPX".to_string()
}

// ───────────────────────────────────────────────────────────────────
//  /sap/zmm60/lookup — price lookup
// ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Zmm60LookupRequest {
    pub material: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plant: Option<String>,
    #[serde(flatten)]
    pub target: SessionTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Zmm60LookupResponse {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plant: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ───────────────────────────────────────────────────────────────────
//  /sap/lx25/inventory-completion — multi-warehouse fan-out
// ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Lx25WarehouseSpec {
    pub warehouse: String,
    pub variant: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct Lx25InventoryCompletionRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warehouses: Option<Vec<Lx25WarehouseSpec>>,
    #[serde(flatten, default)]
    pub target: SessionTarget,
}

// ───────────────────────────────────────────────────────────────────
//  /sap/reversal/compute-inverse  (pure-function, no SAP round-trip)
// ───────────────────────────────────────────────────────────────────

/// `POST /sap/reversal/compute-inverse` — mirrors the Python
/// `reversal_engine.InverseRequest` shape. We re-implement
/// `compute_inverse` in Rust (see `agent_core::reversal`); no helper
/// round-trip needed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct InverseRequest {
    pub action: String,
    #[serde(default)]
    pub payload: HashMap<String, Value>,
    #[serde(default)]
    pub prev_state: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct InverseResponse {
    pub ok: bool,
    pub reversible: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inverse_payload: Option<HashMap<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

// ───────────────────────────────────────────────────────────────────
//  /sap/sessions, /sap/session, /sap/select-session, /sap/unpin-session
// ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SessionSelectRequest {
    pub conn_idx: i32,
    pub sess_idx: i32,
}

// ───────────────────────────────────────────────────────────────────
//  /sap/connect / /sap/disconnect / /sap/shipment-progress
// ───────────────────────────────────────────────────────────────────

/// Empty bodies are fine — `POST /sap/connect` doesn't take params in
/// the v1.x agent. We still wrap it so the handler signature stays
/// uniform.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct SapConnectRequest {
    #[serde(flatten, default)]
    pub target: SessionTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct SapDisconnectRequest {
    #[serde(flatten, default)]
    pub target: SessionTarget,
}

// Created and developed by Jai Singh
