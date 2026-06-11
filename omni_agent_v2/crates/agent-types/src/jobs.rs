// Created and developed by Jai Singh
//! `rust-work-service` job control plane wire types.
//!
//! The agent talks to `/api/v1/sap-agents/jobs/{claim,complete,fail,heartbeat}`
//! exactly the way the Python v1.x agent does. Shapes mirror what
//! `rust-work-service::api::sap_agent_jobs` accepts.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;

/// `POST /api/v1/sap-agents/jobs/claim` — request body. The work
/// service uses `assigned_agent_id` to pin a job to a specific agent
/// for fair-share + ordering.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct JobClaimRequest {
    pub agent_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    /// Lease length the agent is asking for, in seconds. Server caps
    /// at 300s today. Defaults to 60 when omitted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease_seconds: Option<u32>,
}

/// Response body for `/jobs/claim`. `job` is `None` if no work was
/// available; `active_job_id` is set when the agent is already holding
/// a running job (claim is refused).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct JobClaimResponse {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job: Option<Job>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_job_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// `POST /api/v1/sap-agents/jobs/{id}/complete`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct JobCompleteRequest {
    #[serde(default)]
    pub result: HashMap<String, Value>,
}

/// `POST /api/v1/sap-agents/jobs/{id}/fail`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct JobFailRequest {
    pub error: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    #[serde(default)]
    pub result: HashMap<String, Value>,
}

/// `POST /api/v1/sap-agents/jobs/{id}/heartbeat`. Refreshes the lease
/// and reports the agent's current step so the FE can render a live
/// progress label.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct JobHeartbeatRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    /// Lease extension to ask for. Defaults server-side to the
    /// agent's last `lease_seconds`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease_seconds: Option<u32>,
}

/// Canonical job row as returned by the work service.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Job {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub endpoint: String,
    pub payload: Value,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assigned_agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claimed_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claimed_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease_expires_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    /// Triggered-by-FE metadata. Loose-typed because the schema differs
    /// across trigger types; the agent only forwards relevant fields
    /// to handlers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger_meta: Option<Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Local-server `POST /jobs/claim` response (vs the work-service one
/// above). The local endpoint wraps the work-service call and returns
/// the same shape, so the FE can poll either side interchangeably
/// during the v1→v2 cutover.
pub type LocalJobClaimResponse = JobClaimResponse;

/// Body of `POST /api/v1/sap-console/lines` — the agent batches recent
/// stdout/stderr lines + posts them so the FE's "SAP Console" card can
/// surface them in <100ms via WS fan-out.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConsoleLineBatch {
    pub agent_id: String,
    pub lines: Vec<ConsoleLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConsoleLine {
    /// Agent-side wall clock when the line was printed. Not the relay
    /// time — important when a backlog drains after a reconnect.
    pub ts: DateTime<Utc>,
    /// `"info" | "warn" | "error" | "debug" | "trace"`. Small fixed
    /// vocabulary that the FE renders as colour pills.
    pub level: String,
    pub message: String,
    /// Per-slot stream id so the GUI tile drawer can filter lines
    /// to "the slot I'm watching". 0 when the log isn't slot-scoped.
    #[serde(default)]
    pub slot_id: u8,
    /// Monotonic-per-process sequence number so the GUI can resume a
    /// drawer view via `?since_seq=N` without losing or duplicating
    /// lines.
    pub seq: u64,
}

// Created and developed by Jai Singh
