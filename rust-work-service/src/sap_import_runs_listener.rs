// Created and developed by Jai Singh
//! `LISTEN sap_import_run_changed` consumer.
//!
//! Spawned once at boot. On each Postgres NOTIFY (emitted by the
//! trigger added in migration 272), parses the JSON payload, builds a
//! `WsEvent::ImportRunStatusChanged`, and broadcasts it via the
//! existing `broadcast::Sender<WsEvent>` so all connected WS clients
//! with a matching org subscription receive it.
//!
//! Replaces the per-run ephemeral
//! `supabase.channel('lt22-import-run-{id}')` callsite in
//! `src/features/outbound/components/import-lt22-dialog.tsx`. See
//! `memorybank/OmniFrame/Implementations/Migrate-Tier1-Deferred-Channels-To-Rust-WS.md`.
//!
//! Logging is `tracing::debug!` per-event because import runs UPDATE
//! frequently while running (per-row import progress signals).
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
pub const CHANNEL: &str = "sap_import_run_changed";

#[derive(Debug, Deserialize)]
struct Notification {
    run_id: Uuid,
    organization_id: Uuid,
    status: String,
    #[serde(default)]
    rows_imported: Option<i64>,
    op: String,
}

/// Per-frame handler. Safe to call from the consolidated multi-
/// channel dispatcher in `main.rs`.
pub async fn handle(frame: &NotifyFrame, ws_tx: &broadcast::Sender<WsEvent>) {
    match serde_json::from_str::<Notification>(&frame.payload) {
        Ok(n) => {
            let event = WsEvent::ImportRunStatusChanged {
                run_id: n.run_id,
                organization_id: n.organization_id,
                status: n.status,
                rows_imported: n.rows_imported,
                op: n.op,
            };
            if let Err(e) = crate::websocket::broadcast_event(ws_tx, event) {
                debug!(
                    ?e,
                    "sap_import_runs_listener: no WS subscribers (ignored)"
                );
            }
        }
        Err(e) => {
            warn!(
                ?e,
                payload = %frame.payload,
                "sap_import_runs_listener: bad payload (skipped)"
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
