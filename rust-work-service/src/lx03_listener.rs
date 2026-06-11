// Created and developed by Jai Singh
//! `LISTEN lx03_data_changed` consumer.
//!
//! Spawned once at boot. On each Postgres NOTIFY (emitted by the
//! trigger added in migration 274), parses the JSON payload, builds a
//! `WsEvent::Lx03DataChanged`, and broadcasts it via the existing
//! `broadcast::Sender<WsEvent>` so all connected WS clients with a
//! matching org subscription receive it.
//!
//! Replaces the unfiltered `supabase.channel('lx03-data-changes')`
//! callsite in `src/hooks/use-lx03-data.ts`. See
//! `memorybank/OmniFrame/Implementations/Migrate-Tier1-Deferred-Channels-To-Rust-WS.md`.
//!
//! IMPORTANT (org_id nullability):
//!   `rr_lx03_data.organization_id` is NULLABLE in the schema. The
//!   trigger emits `organization_id: null` for those rows; the Rust
//!   send-loop treats events with no org_id as "system-wide" and
//!   broadcasts to every connected client. The frontend handler
//!   defends-in-depth by ignoring events whose `organization_id`
//!   doesn't match the user's org.
//!
//! 2026-05-07 — switched from a hand-rolled `PgListener` reconnect
//! loop to [`crate::pglistener::run`] so the listener can survive a
//! silent TCP drop. See
//! `memorybank/OmniFrame/Implementations/Implement-Resilient-PgListener.md`.

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
pub const CHANNEL: &str = "lx03_data_changed";

#[derive(Debug, Deserialize)]
struct Notification {
    row_id: Uuid,
    #[serde(default)]
    organization_id: Option<Uuid>,
    op: String,
}

/// Per-frame handler. Safe to call from the consolidated multi-
/// channel dispatcher in `main.rs`.
pub async fn handle(frame: &NotifyFrame, ws_tx: &broadcast::Sender<WsEvent>) {
    match serde_json::from_str::<Notification>(&frame.payload) {
        Ok(n) => {
            let event = WsEvent::Lx03DataChanged {
                row_id: n.row_id,
                organization_id: n.organization_id,
                op: n.op,
            };
            if let Err(e) = crate::websocket::broadcast_event(ws_tx, event) {
                debug!(?e, "lx03_listener: no WS subscribers (ignored)");
            }
        }
        Err(e) => {
            warn!(
                ?e,
                payload = %frame.payload,
                "lx03_listener: bad payload (skipped)"
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
