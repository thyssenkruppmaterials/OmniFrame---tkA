// Created and developed by Jai Singh
//! `rust-work-service /ws` event types.
//!
//! Wire-compatible with `rust-work-service::websocket::WsEvent` — we
//! re-declare ONLY the variants the agent consumes today (so a future
//! event added to the work service doesn't force a Rust release on the
//! agent). Unknown variants deserialize as [`WsEvent::Unknown`] so a
//! novel event-type from the server doesn't kill the WS reader loop.
//!
//! See `omni_agent/work_service_ws.py` for the v1.x reference impl.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// One-way envelope sent from the agent to the work service on every
/// WS connect. Mirrors the v1.x `{"type": "Subscribe", "organization_id": ...}`
/// shape — we keep `agent_id` + `capabilities` + `version` OPTIONAL on
/// the wire so legacy work-service builds that only know about the
/// `organization_id` field still accept us.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SubscribeMessage {
    /// Stable agent id (`<COMPUTERNAME>-<SESSIONNAME>-<USERNAME>`).
    pub agent_id: String,
    pub capabilities: Vec<String>,
    pub version: String,
    /// REQUIRED by `rust-work-service` to scope the subscription. We
    /// derive it from the cached Supabase session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organization_id: Option<Uuid>,
}

/// The exact wire envelope the work service publishes. We only declare
/// `#[serde(tag = "type")]` variants for events the agent actually
/// reacts to; everything else lands in [`WsEvent::Unknown`] via
/// `#[serde(other)]` on a sibling untagged enum (see [`WsEvent::deserialize`]).
///
/// NOTE: we can't use `#[serde(other)]` on a tagged enum directly, so
/// the `Unknown` variant relies on the fallback `untagged` flow below.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsEvent {
    /// `sap_agent_jobs` row INSERT/UPDATE — wakes the local job
    /// poller out of its idle backoff.
    SapJobStatusChanged {
        job_id: Uuid,
        organization_id: Uuid,
        status: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        step: Option<String>,
        op: String,
    },
    /// `rf_putaway_operations` row change — the trigger evaluator
    /// runs server-side now (Phase 9), so the agent doesn't act on
    /// this; the GUI forwards it to any open FE tabs.
    RfPutawayChanged {
        row_id: Uuid,
        organization_id: Uuid,
        op: String,
        new: Value,
    },
    /// Fleet console line — emitted whenever ANY agent in the org
    /// posts a console batch. We log it locally so the GUI's
    /// "Fleet console" panel can show peer-agent output.
    SapAgentConsoleLine {
        agent_id: String,
        organization_id: Uuid,
        level: String,
        message: String,
        ts: DateTime<Utc>,
    },
    /// Server-side trigger DSL evaluator fired — purely informational
    /// for the agent (the job is already queued via `sap_agent_jobs`,
    /// the agent will see it on the next `SapJobStatusChanged`).
    TriggerFired {
        trigger_id: Uuid,
        source_row_id: Uuid,
        target_endpoint: String,
        job_id: Uuid,
        organization_id: Uuid,
    },
    /// Fall-through for variants we haven't declared yet. The reader
    /// loop bumps a `unknown_event` counter so ops can spot a wire-
    /// contract drift without crashing.
    #[serde(other)]
    Unknown,
}

impl WsEvent {
    /// Stable variant name for metric labels / log fan-out keys.
    pub fn variant_name(&self) -> &'static str {
        match self {
            WsEvent::SapJobStatusChanged { .. } => "SapJobStatusChanged",
            WsEvent::RfPutawayChanged { .. } => "RfPutawayChanged",
            WsEvent::SapAgentConsoleLine { .. } => "SapAgentConsoleLine",
            WsEvent::TriggerFired { .. } => "TriggerFired",
            WsEvent::Unknown => "Unknown",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_known_variants() {
        let raw = r#"{
            "type":"SapJobStatusChanged",
            "job_id":"00000000-0000-0000-0000-000000000001",
            "organization_id":"00000000-0000-0000-0000-000000000002",
            "status":"queued",
            "op":"INSERT"
        }"#;
        let ev: WsEvent = serde_json::from_str(raw).unwrap();
        match ev {
            WsEvent::SapJobStatusChanged { status, .. } => assert_eq!(status, "queued"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn unknown_variant_lands_in_unknown() {
        let raw = r#"{"type":"WhoKnowsWhatv3","x":1}"#;
        let ev: WsEvent = serde_json::from_str(raw).unwrap();
        assert!(matches!(ev, WsEvent::Unknown));
    }

    #[test]
    fn subscribe_serializes_with_version() {
        let sub = SubscribeMessage {
            agent_id: "HOST-CONSOLE-USER".to_string(),
            capabilities: vec!["lt12".to_string()],
            version: "v2.0.0-alpha".to_string(),
            organization_id: Some(Uuid::nil()),
        };
        let s = serde_json::to_string(&sub).unwrap();
        assert!(s.contains("\"version\":\"v2.0.0-alpha\""));
        assert!(s.contains("\"agent_id\":\"HOST-CONSOLE-USER\""));
    }
}

// Created and developed by Jai Singh
