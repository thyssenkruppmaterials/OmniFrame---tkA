// Created and developed by Jai Singh
//! In-process command stubs — the 8 canonical Tauri command signatures
//! enumerated in Worker A's task spec.
//!
//! Worker C's bin currently routes through HTTP-loopback (see
//! `src/main.rs` + `src/commands.rs`). The in-process variant lives
//! here so when Worker C is ready to switch to "share an
//! `Arc<AgentCore>`" they can drop these into `tauri::generate_handler!`
//! without rewriting either side. They're intentionally `pub async fn`
//! (no `#[tauri::command]` here) so the lib stays Tauri-free; the bin
//! adds a thin shim like:
//!
//! ```ignore
//! #[tauri::command]
//! async fn get_session_states(
//!     state: tauri::State<'_, agent_gui::InProcessCommands>,
//! ) -> Result<agent_gui::SessionPoolSnapshot, String> {
//!     state.get_session_states().await
//! }
//! ```

use std::sync::Arc;

use agent_core::AgentCore;
use agent_rpc::PythonHelper;
use agent_types::{RpcMethod, SapSession};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::snapshot::{ConsoleSnapshotLine, SessionPoolSnapshot};

/// Flat metrics snapshot for the GUI top bar.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AgentMetrics {
    pub jobs_processed: u64,
    pub helper_alive: bool,
    pub helper_restart_count: u64,
    pub ws_connected: bool,
    pub ws_reconnect_count: u64,
    pub ws_watchdog_trips: u64,
}

/// Tauri-managed state holder. Worker C calls
/// `app.manage(InProcessCommands::new(core))` once `AgentCore` has
/// booted; subsequent commands extract via `tauri::State`.
pub struct InProcessCommands {
    core: RwLock<Option<Arc<AgentCore>>>,
}

impl Default for InProcessCommands {
    fn default() -> Self {
        Self::new()
    }
}

impl InProcessCommands {
    pub fn new() -> Self {
        Self {
            core: RwLock::new(None),
        }
    }

    pub fn install(&self, core: Arc<AgentCore>) {
        *self.core.write() = Some(core);
    }

    fn require(&self) -> Result<Arc<AgentCore>, String> {
        self.core
            .read()
            .clone()
            .ok_or_else(|| "AgentCore not yet initialised".to_string())
    }

    fn helper(&self) -> Result<PythonHelper, String> {
        Ok(self.require()?.helper.clone())
    }

    // ── 1. get_session_states ───────────────────────────────────────
    pub async fn get_session_states(&self) -> Result<SessionPoolSnapshot, String> {
        let core = self.require()?;
        Ok(SessionPoolSnapshot::from_types(core.state.snapshot_pool()))
    }

    // ── 2. connect_session ──────────────────────────────────────────
    pub async fn connect_session(&self, slot_id: u8) -> Result<(), String> {
        let core = self.require()?;
        let helper = self.helper()?;
        let resp = helper
            .call::<_, Value>(
                RpcMethod::SapConnect,
                serde_json::json!({"slot_id": slot_id}),
            )
            .await
            .map_err(|e| format!("rpc: {e}"))?;
        let ok = resp.get("ok").and_then(Value::as_bool).unwrap_or(false);
        if !ok {
            let err = resp
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            core.state.session_pool.record_error(slot_id, err.clone());
            return Err(err);
        }
        let conn_idx = resp.get("conn_idx").and_then(Value::as_i64).unwrap_or(0) as i32;
        let sess_idx = resp
            .get("sess_idx")
            .and_then(Value::as_i64)
            .unwrap_or(slot_id as i64) as i32;
        core.state
            .session_pool
            .pin(slot_id, conn_idx, sess_idx, None);
        Ok(())
    }

    // ── 3. disconnect_session ───────────────────────────────────────
    pub async fn disconnect_session(&self, slot_id: u8) -> Result<(), String> {
        let core = self.require()?;
        let helper = self.helper()?;
        let _ = helper
            .call::<_, Value>(
                RpcMethod::SapDisconnect,
                serde_json::json!({"slot_id": slot_id}),
            )
            .await;
        core.state.session_pool.release(slot_id);
        Ok(())
    }

    // ── 4. list_sap_sessions ────────────────────────────────────────
    pub async fn list_sap_sessions(&self) -> Result<Vec<SapSession>, String> {
        let helper = self.helper()?;
        // `sap.fleet` enumerates every (conn, sess) visible to SAP GUI.
        // The Python side returns `{ok, connections: [{conn_idx, sessions: [...]}]}`;
        // we flatten to the legacy `Vec<SapSession>` shape Worker C's
        // picker UI consumes.
        let v: Value = helper
            .call::<_, Value>(RpcMethod::SapFleet, serde_json::json!({}))
            .await
            .map_err(|e| format!("rpc: {e}"))?;
        let mut out: Vec<SapSession> = Vec::new();
        if let Some(arr) = v.get("connections").and_then(|c| c.as_array()) {
            for conn in arr {
                let conn_idx = conn
                    .get("conn_idx")
                    .and_then(|c| c.as_i64())
                    .unwrap_or_default() as i32;
                if let Some(sessions) = conn.get("sessions").and_then(|s| s.as_array()) {
                    for sess in sessions {
                        let sess_idx = sess
                            .get("sess_idx")
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
        Ok(out)
    }

    // ── 5. pin_sap_session ──────────────────────────────────────────
    pub async fn pin_sap_session(
        &self,
        slot_id: u8,
        conn_idx: i32,
        sess_idx: i32,
    ) -> Result<(), String> {
        let core = self.require()?;
        let helper = self.helper()?;
        helper
            .call::<_, Value>(
                RpcMethod::SapSession,
                serde_json::json!({
                    "slot_id": slot_id,
                    "conn_idx": conn_idx,
                    "sess_idx": sess_idx,
                }),
            )
            .await
            .map_err(|e| format!("rpc: {e}"))?;
        core.state
            .session_pool
            .pin(slot_id, conn_idx, sess_idx, None);
        Ok(())
    }

    // ── 6. run_quick_action ─────────────────────────────────────────
    pub async fn run_quick_action(
        &self,
        slot_id: u8,
        action: String,
        payload: Value,
    ) -> Result<Value, String> {
        let helper = self.helper()?;
        let method = match action.as_str() {
            "confirm_to" => RpcMethod::SapConfirmTo,
            "transfer_inventory" => RpcMethod::SapTransferInventory,
            "bin_blocks" => RpcMethod::SapBinBlocks,
            "material_master_bin" => RpcMethod::SapMaterialMasterBin,
            "material_master_storage_types" => RpcMethod::SapMaterialMasterStorageTypes,
            "create_storage_bin" => RpcMethod::SapCreateStorageBin,
            other => return Err(format!("unknown quick-action: {other}")),
        };
        let mut params = payload.clone();
        if let Value::Object(ref mut m) = params {
            m.insert("session_id".into(), serde_json::json!(slot_id));
        }
        helper
            .call::<_, Value>(method, params)
            .await
            .map_err(|e| format!("rpc: {e}"))
    }

    // ── 7. get_console_tail ─────────────────────────────────────────
    pub async fn get_console_tail(
        &self,
        slot_id: u8,
        since_seq: u64,
    ) -> Result<Vec<ConsoleSnapshotLine>, String> {
        // Placeholder — the in-process console buffer wires up in
        // v2.0.1 (Worker A's follow-up). The bin's HTTP loopback
        // long-poll on `/console/tail?slot=N&since_seq=X` is the
        // source of truth today.
        let _ = (slot_id, since_seq);
        Ok(vec![])
    }

    // ── 8. get_agent_metrics ────────────────────────────────────────
    pub async fn get_agent_metrics(&self) -> Result<AgentMetrics, String> {
        let core = self.require()?;
        let helper_st = core.helper.status();
        let ws_metrics = core.ws.metrics();
        Ok(AgentMetrics {
            jobs_processed: core
                .state
                .jobs_processed
                .load(std::sync::atomic::Ordering::Relaxed),
            helper_alive: core.helper.is_alive(),
            helper_restart_count: helper_st.restart_count,
            ws_connected: ws_metrics.connected,
            ws_reconnect_count: ws_metrics.reconnect_count,
            ws_watchdog_trips: ws_metrics.watchdog_trips,
        })
    }
}

// Created and developed by Jai Singh
