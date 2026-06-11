// Created and developed by Jai Singh
//! `/health`, `/status`, `/metrics`, `/realtime/status` response types.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::session::SessionPoolSnapshot;

/// `GET /health` response. Mirrors `omni_agent/agent.py::health()` —
/// the FE polls this every 5s in some flows so adding required fields
/// here is a wire-contract break. Only ADD `Option<>` fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct HealthResponse {
    /// Always `true` when the agent responds at all — kept as `bool`
    /// (vs the Python `ok` field) so a Rust caller can pattern-match
    /// without parsing JSON twice.
    pub ok: bool,
    /// `AGENT_VERSION_STR` (e.g. `"v2.0.0-alpha"`). The FE compares
    /// this against the latest published agent version to nag the
    /// operator when an upgrade is available.
    pub version: String,
    /// `sap_connected` is true iff slot 0 (the legacy "primary" slot)
    /// is `Idle` or `Busy`. v1.x clients that don't know about the
    /// pool keep working off this single bit.
    pub sap_connected: bool,
    /// Process boot time as ISO-8601, mirrors the v1.x shape.
    pub started_at: String,
    /// True if any of the Citrix heuristics in `detect_citrix()` hit.
    /// FE renders a small badge in the agent diagnostics card.
    pub citrix: bool,
    /// Path to the agent installation directory, used by the FE
    /// "Open log folder" affordance.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_dir: Option<String>,
    /// Capability list — see `agent_types::constants::CAPABILITIES`.
    pub capabilities: Vec<String>,
}

/// `GET /status` response. Richer than `/health` — embeds the full
/// session-pool snapshot so a single round-trip is enough to populate
/// the GUI tile grid + the diagnostics card.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct StatusResponse {
    pub version: String,
    pub sap_connected: bool,
    pub supabase_configured: bool,
    pub supabase_logged_in: bool,
    /// Best-effort current user email, sourced from the cached
    /// Supabase session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_email: Option<String>,
    /// Legacy single-session indices. We populate from slot 0 so v1.x
    /// FE callers keep seeing what they used to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sap_conn_idx: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sap_sess_idx: Option<i32>,
    pub citrix: bool,
    /// NEW in v2 — full pool snapshot for the GUI tile grid.
    pub six_session_pool: SessionPoolSnapshot,
}

/// `GET /realtime/status` — surfaces the WS client's reconnect /
/// watchdog telemetry so the FE can render a "Realtime: degraded" pill.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RealtimeStatusResponse {
    pub ws_connected: bool,
    pub reconnect_count: u64,
    pub watchdog_trips: u64,
    /// Epoch seconds of the last inbound frame. `None` before the
    /// first connect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_message_at_epoch: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_reconnect_reason: Option<String>,
}

/// `POST /agent-token/rotate` response. Returns the freshly-minted
/// token so the FE can immediately stash it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AgentTokenRotateResponse {
    pub ok: bool,
    pub agent_token: String,
    pub rotated_at: DateTime<Utc>,
}

/// `GET /agent-token/check` response. Returns 200 with `ok: true` when
/// the supplied `X-Agent-Token` matches the cached one; 401 otherwise
/// (axum response built by the handler; this is the OK body).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AgentTokenCheckResponse {
    pub ok: bool,
    /// Echoed back so the FE can confirm symmetric exchange. Always
    /// true when ok==true.
    #[serde(default)]
    pub valid: bool,
}

/// Standard error envelope returned by every endpoint when something
/// goes wrong. Mirrors the Python `{"ok": false, "error": "..."}` shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ErrorResponse {
    pub ok: bool,
    pub error: String,
    /// Optional structured-error key for the FE to gate alerts on
    /// (e.g. `"sap_not_connected"`, `"helper_unavailable"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

impl ErrorResponse {
    pub fn new(error: impl Into<String>) -> Self {
        Self {
            ok: false,
            error: error.into(),
            code: None,
        }
    }
    pub fn with_code(error: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            ok: false,
            error: error.into(),
            code: Some(code.into()),
        }
    }
}

/// Generic `{"ok": true, ...}` envelope used by the routes that don't
/// have a richer typed response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct OkResponse {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl OkResponse {
    pub fn ok() -> Self {
        Self {
            ok: true,
            message: None,
        }
    }
    pub fn with_message(message: impl Into<String>) -> Self {
        Self {
            ok: true,
            message: Some(message.into()),
        }
    }
}

// Created and developed by Jai Singh
