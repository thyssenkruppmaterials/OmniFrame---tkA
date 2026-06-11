// Created and developed by Jai Singh
//! Bin-internal Tauri commands.
//!
//! Compiled with `main.rs` only (the bin requires the `gui` feature
//! per `Cargo.toml`'s `required-features`). All command bodies long-
//! poll / round-trip the headless `agent.exe` over `127.0.0.1:8765`
//! using the shared `crate::AppState::http` client. The helper
//! functions (`fetch_session_pool`, `fetch_agent_metrics`,
//! `long_poll_console_tail`) are also called by the background pollers
//! Worker C wired in `main.rs`.

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;
use tracing::warn;

use agent_types::{ConsoleLine, SapSession, SessionSlot as TypesSessionSlot, SESSION_POOL_SIZE};

use crate::AppState;

/// `commands::SessionPoolSnapshot` — the local twin of
/// `agent_gui::SessionPoolSnapshot`. Worker C's `main.rs` references
/// this type by-name (`commands::SessionPoolSnapshot`) so we keep it
/// here rather than re-exporting.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SessionPoolSnapshot {
    pub sessions: Vec<TypesSessionSlot>,
    pub polled_at: chrono::DateTime<chrono::Utc>,
}

impl SessionPoolSnapshot {
    pub fn offline() -> Self {
        Self {
            sessions: (0..SESSION_POOL_SIZE)
                .map(|i| TypesSessionSlot::empty(i as u8))
                .collect(),
            polled_at: chrono::Utc::now(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WsStatus {
    pub connected: bool,
    pub reconnect_count: u64,
    pub watchdog_trips: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AgentMetrics {
    pub jobs_processed: u64,
    pub helper_alive: bool,
    pub helper_restart_count: u64,
    pub ws_status: WsStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AgentSettings {
    pub agent_base_url: String,
    pub auto_start_helper: bool,
    pub log_level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct BuildInfo {
    pub gui_version: &'static str,
    pub agent_version: String,
}

// ── Internal HTTP helpers (also called by background pollers) ──────

pub(crate) async fn fetch_session_pool(
    state: &Arc<AppState>,
) -> Result<SessionPoolSnapshot, String> {
    let url = format!("{}/sap/v2/sessions", state.base_url());
    let resp = state
        .http
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("session pool: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("session pool: {} {}", resp.status(), url));
    }
    let snap: agent_types::SessionPoolSnapshot = resp
        .json()
        .await
        .map_err(|e| format!("session pool decode: {e}"))?;
    Ok(SessionPoolSnapshot {
        sessions: snap.sessions.to_vec(),
        polled_at: chrono::Utc::now(),
    })
}

pub(crate) async fn fetch_agent_metrics(state: &Arc<AppState>) -> Result<AgentMetrics, String> {
    // We pull two endpoints: /metrics (Prometheus text) for jobs +
    // helper restarts, and /realtime/status for the WS counters.
    let realtime: agent_types::RealtimeStatusResponse = state
        .http
        .get(format!("{}/realtime/status", state.base_url()))
        .send()
        .await
        .map_err(|e| format!("realtime status: {e}"))?
        .json()
        .await
        .map_err(|e| format!("realtime decode: {e}"))?;
    let metrics_text = state
        .http
        .get(format!("{}/metrics", state.base_url()))
        .send()
        .await
        .map_err(|e| format!("metrics: {e}"))?
        .text()
        .await
        .map_err(|e| format!("metrics text: {e}"))?;
    let mut jobs_processed = 0u64;
    let mut helper_alive = false;
    let mut helper_restart_count = 0u64;
    for line in metrics_text.lines() {
        if let Some(rest) = line.strip_prefix("agent_jobs_processed_total ") {
            jobs_processed = rest.trim().parse().unwrap_or(0);
        } else if let Some(rest) = line.strip_prefix("agent_helper_alive ") {
            helper_alive = rest.trim() == "1";
        } else if let Some(rest) = line.strip_prefix("agent_helper_restart_total ") {
            helper_restart_count = rest.trim().parse().unwrap_or(0);
        }
    }
    Ok(AgentMetrics {
        jobs_processed,
        helper_alive,
        helper_restart_count,
        ws_status: WsStatus {
            connected: realtime.ws_connected,
            reconnect_count: realtime.reconnect_count,
            watchdog_trips: realtime.watchdog_trips,
            last_reason: realtime.last_reconnect_reason,
        },
    })
}

pub(crate) async fn long_poll_console_tail(
    state: &Arc<AppState>,
    slot_id: u8,
) -> Result<Vec<ConsoleLine>, String> {
    // The agent's `/console/tail?slot=N&since_seq=X` endpoint hasn't
    // landed yet (Worker A v2.0.1). Until it does we sleep + poll
    // /metrics so the GUI stays responsive without busy-looping.
    let cursors = state.console_cursors.lock().await;
    let _ = cursors[slot_id as usize];
    drop(cursors);
    tokio::time::sleep(Duration::from_millis(crate::CONSOLE_LONG_POLL_TIMEOUT_MS)).await;
    Ok(vec![])
}

// ── Tauri commands ─────────────────────────────────────────────────

#[tauri::command]
pub async fn get_session_states(
    state: State<'_, Arc<AppState>>,
) -> Result<SessionPoolSnapshot, String> {
    fetch_session_pool(state.inner()).await
}

#[tauri::command]
pub async fn connect_session(slot_id: u8, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    post_empty(
        state.inner(),
        &format!("/sap/v2/sessions/{slot_id}/connect"),
    )
    .await
}

#[tauri::command]
pub async fn disconnect_session(
    slot_id: u8,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    post_empty(
        state.inner(),
        &format!("/sap/v2/sessions/{slot_id}/disconnect"),
    )
    .await
}

#[tauri::command]
pub async fn list_sap_sessions(state: State<'_, Arc<AppState>>) -> Result<Vec<SapSession>, String> {
    let url = format!("{}/sap/sessions", state.base_url());
    state
        .http
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("list_sap_sessions: {e}"))?
        .json()
        .await
        .map_err(|e| format!("list_sap_sessions decode: {e}"))
}

#[tauri::command]
pub async fn pin_sap_session(
    slot_id: u8,
    conn_idx: i32,
    sess_idx: i32,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let url = format!("{}/sap/v2/sessions/{slot_id}/pin", state.base_url());
    let body = serde_json::json!({"conn_idx": conn_idx, "sess_idx": sess_idx});
    let resp = state
        .http
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("pin: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("pin: {} {}", resp.status(), url));
    }
    Ok(())
}

#[tauri::command]
pub async fn release_session(slot_id: u8, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    post_empty(
        state.inner(),
        &format!("/sap/v2/sessions/{slot_id}/release"),
    )
    .await
}

#[tauri::command]
pub async fn run_quick_action(
    slot_id: u8,
    action: String,
    payload: serde_json::Value,
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let path = match action.as_str() {
        "confirm_to" => "/sap/confirm-to",
        "transfer_inventory" => "/sap/transfer-inventory",
        "bin_blocks" => "/sap/bin-blocks",
        "material_master_bin" => "/sap/material-master-bin",
        "material_master_storage_types" => "/sap/material-master-storage-types",
        "create_storage_bin" => "/sap/create-storage-bin",
        other => return Err(format!("unknown quick-action: {other}")),
    };
    let mut body = payload.clone();
    if let serde_json::Value::Object(ref mut m) = body {
        m.insert("session_id".into(), serde_json::json!(slot_id));
    }
    state
        .http
        .post(format!("{}{path}", state.base_url()))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("quick-action: {e}"))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("quick-action decode: {e}"))
}

#[tauri::command]
pub async fn get_console_tail(
    slot_id: u8,
    since_seq: u64,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ConsoleLine>, String> {
    let _ = since_seq; // wired in v2.0.1
    long_poll_console_tail(state.inner(), slot_id).await
}

#[tauri::command]
pub async fn get_agent_metrics(state: State<'_, Arc<AppState>>) -> Result<AgentMetrics, String> {
    fetch_agent_metrics(state.inner()).await
}

#[tauri::command]
pub async fn get_ws_status(state: State<'_, Arc<AppState>>) -> Result<WsStatus, String> {
    fetch_agent_metrics(state.inner())
        .await
        .map(|m| m.ws_status)
}

#[tauri::command]
pub async fn get_settings(state: State<'_, Arc<AppState>>) -> Result<AgentSettings, String> {
    Ok(AgentSettings {
        agent_base_url: state.base_url(),
        auto_start_helper: true,
        log_level: "info".into(),
    })
}

#[tauri::command]
pub async fn update_settings(
    settings: AgentSettings,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    *state.base_url.lock() = settings.agent_base_url.clone();
    Ok(())
}

#[tauri::command]
pub async fn get_build_info() -> Result<BuildInfo, String> {
    Ok(BuildInfo {
        gui_version: env!("CARGO_PKG_VERSION"),
        agent_version: agent_types::AGENT_VERSION_STR.to_string(),
    })
}

#[tauri::command]
pub async fn open_log_directory(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    // Best-effort — fetch the install_dir from /health and let the
    // OS open the folder. Worker C will polish this in v2.0.1.
    let url = format!("{}/health", state.base_url());
    let resp = state
        .http
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("health: {e}"))?;
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("health decode: {e}"))?;
    let install_dir = body
        .get("install_dir")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(".");
    warn!(
        install_dir,
        "open_log_directory stub — TODO open OS file explorer"
    );
    Ok(())
}

async fn post_empty(state: &Arc<AppState>, path: &str) -> Result<(), String> {
    let url = format!("{}{path}", state.base_url());
    let resp = state
        .http
        .post(&url)
        .send()
        .await
        .map_err(|e| format!("POST {path}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("POST {path}: {}", resp.status()));
    }
    Ok(())
}

// Created and developed by Jai Singh
