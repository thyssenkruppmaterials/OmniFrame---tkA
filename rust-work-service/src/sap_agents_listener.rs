// Created and developed by Jai Singh
//! `LISTEN sap_agent_changed` consumer.
//!
//! Spawned once at boot. On each Postgres NOTIFY (emitted by the
//! trigger added in migration 270), parses the JSON payload, builds a
//! `WsEvent::SapAgentChanged`, and broadcasts it via the existing
//! `broadcast::Sender<WsEvent>` so all connected WS clients with a
//! matching org subscription receive it.
//!
//! Replaces the highest-fanout `supabase.channel(postgres_changes)`
//! consumer in the app — `omniframe-agent-detection-fleet` and
//! `sap-agents-fleet`. See the "Sprint after Option 2" section of
//! `memorybank/OmniFrame/Decisions/Roadmap-Rust-WS-Unlocks.md`.
//!
//! Logging is intentionally `tracing::debug!` rather than `info!`
//! because `sap_agents` heartbeats every 30s — at fleet scale this is
//! a high-cardinality log line.
//!
//! 2026-05-07 — switched from a hand-rolled `PgListener` reconnect
//! loop to [`crate::pglistener::run`] so the listener can survive a
//! silent TCP drop. See
//! `memorybank/OmniFrame/Implementations/Implement-Resilient-PgListener.md`.

use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::PgPool;
use tokio::sync::broadcast;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::pglistener::{self, NotifyFrame};
use crate::websocket::WsEvent;

/// LISTEN channel name. Centralised so the consolidated multi-
/// channel listener in `main.rs` and the legacy single-channel
/// [`run`] both reference the same string.
pub const CHANNEL: &str = "sap_agent_changed";

/// Wire shape produced by `notify_sap_agent_changed()` (migration 270).
///
/// Keep `#[serde(rename_all = "snake_case")]` off so the field names
/// match the JSON keys verbatim — the trigger emits snake_case keys
/// already.
#[derive(Debug, Deserialize)]
struct Notification {
    agent_id: String,
    organization_id: Uuid,
    status: String,
    /// `last_seen_at` is `NOT NULL` in the schema today (migration 247),
    /// but the listener tolerates `null` so a future schema relaxation
    /// (or a malformed manual NOTIFY) doesn't crash the consumer.
    #[serde(default)]
    last_seen_at: Option<DateTime<Utc>>,
    op: String,
}

/// Per-frame handler. Safe to call from the consolidated multi-
/// channel dispatcher in `main.rs`.
pub async fn handle(frame: &NotifyFrame, ws_tx: &broadcast::Sender<WsEvent>) {
    match serde_json::from_str::<Notification>(&frame.payload) {
        Ok(n) => {
            let event = WsEvent::SapAgentChanged {
                agent_id: n.agent_id,
                organization_id: n.organization_id,
                status: n.status,
                last_seen_at: n.last_seen_at,
                op: n.op,
            };
            if let Err(e) = crate::websocket::broadcast_event(ws_tx, event) {
                debug!(?e, "sap_agents_listener: no WS subscribers (ignored)");
            }
        }
        Err(e) => {
            warn!(
                ?e,
                payload = %frame.payload,
                "sap_agents_listener: bad payload (skipped)"
            );
        }
    }
}

#[allow(dead_code)]
pub async fn run(pool: PgPool, ws_tx: broadcast::Sender<WsEvent>) {
    pglistener::run(pool, CHANNEL, move |frame| {
        let ws_tx = ws_tx.clone();
        async move { handle(&frame, &ws_tx).await }
    })
    .await;
}

// Created and developed by Jai Singh
