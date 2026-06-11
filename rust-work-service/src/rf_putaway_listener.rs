// Created and developed by Jai Singh
//! `LISTEN rf_putaway_operation_changed` consumer.
//!
//! Spawned once at boot. On each Postgres NOTIFY (emitted by the
//! trigger added in migration 276), parses the JSON payload, builds a
//! `WsEvent::RfPutawayChanged`, and broadcasts it via the existing
//! `broadcast::Sender<WsEvent>` so all connected WS clients with a
//! matching org subscription receive it.
//!
//! Phase 4 of the rust-work-service integration plan
//! (`.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md`).
//! The OmniFrame on-prem agent (`omni_agent/agent.py` v1.9.0) consumes
//! this variant via `omni_agent/work_service_ws.py` instead of its
//! previous direct Supabase Realtime subscription on the same table.
//!
//! Defensive design: bad payloads are logged via `tracing::error!` and
//! skipped. The listener task NEVER kills itself on a parse error.
//!
//! 2026-05-07 — switched from a hand-rolled `PgListener` reconnect
//! loop to [`crate::pglistener::run`] so the listener can survive a
//! silent TCP drop. See
//! `memorybank/OmniFrame/Implementations/Implement-Resilient-PgListener.md`.

use serde::Deserialize;
use sqlx::PgPool;
use tokio::sync::broadcast;
use tracing::{debug, error};
use uuid::Uuid;

use crate::pglistener::{self, NotifyFrame};
use crate::websocket::WsEvent;

/// LISTEN channel name. Centralised so the consolidated multi-
/// channel listener in `main.rs` and the legacy single-channel
/// [`run`] both reference the same string.
pub const CHANNEL: &str = "rf_putaway_operation_changed";

/// Wire shape produced by `notify_rf_putaway_changed()` (migration 276).
#[derive(Debug, Deserialize)]
struct Notification {
    row_id: Uuid,
    organization_id: Uuid,
    op: String,
    new: serde_json::Value,
}

/// Per-frame handler. Safe to call from the consolidated multi-
/// channel dispatcher in `main.rs`.
pub async fn handle(frame: &NotifyFrame, ws_tx: &broadcast::Sender<WsEvent>) {
    match serde_json::from_str::<Notification>(&frame.payload) {
        Ok(n) => {
            let event = WsEvent::RfPutawayChanged {
                row_id: n.row_id,
                organization_id: n.organization_id,
                op: n.op,
                new: n.new,
            };
            if let Err(e) = crate::websocket::broadcast_event(ws_tx, event) {
                debug!(?e, "rf_putaway_listener: no WS subscribers (ignored)");
            }
        }
        Err(e) => {
            // Phase 4 plan: parse failures must never kill the
            // listener task. Log at error level (not warn)
            // because a malformed payload here means the
            // trigger or schema drifted — operator should
            // investigate.
            error!(
                ?e,
                payload = %frame.payload,
                "rf_putaway_listener: bad payload (skipped)"
            );
        }
    }
}

#[allow(dead_code)]
pub async fn run(pool: PgPool, ws_tx: broadcast::Sender<WsEvent>) {
    pglistener::run(pool, CHANNEL, move |frame| {
        let ws_tx = ws_tx.clone();
        async move {
            handle(&frame, &ws_tx).await;
        }
    })
    .await;
}

// Created and developed by Jai Singh
