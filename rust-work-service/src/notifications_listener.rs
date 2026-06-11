// Created and developed by Jai Singh
//! `LISTEN notification_created` consumer (Tier 2 #2).
//!
//! Spawned once at boot. On each Postgres NOTIFY (emitted by the
//! AFTER INSERT trigger added in migration 275), parses the JSON
//! payload, builds a `WsEvent::Notification`, and broadcasts it via
//! the existing `broadcast::Sender<WsEvent>` so all connected WS
//! clients with a matching org subscription receive it.
//!
//! The bell-icon FE consumer (`src/hooks/use-notifications.ts`) does
//! defence-in-depth `event.user_id === currentUserId` filtering before
//! prepending to the in-memory feed, so even though the WS fan-out is
//! org-scoped (not per-user), the recipient experience is per-user.
//!
//! Logging is `tracing::debug!` per-event because notifications are a
//! low-volume bucket (a "real event" rate is order of low single
//! digits per user per day).
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

use crate::observability::metrics;
use crate::pglistener::{self, NotifyFrame};
use crate::websocket::WsEvent;

/// LISTEN channel name. Centralised so the consolidated multi-
/// channel listener in `main.rs` and the legacy single-channel
/// [`run`] both reference the same string.
pub const CHANNEL: &str = "notification_created";

#[derive(Debug, Deserialize)]
struct Notification {
    notification_id: Uuid,
    user_id: Uuid,
    organization_id: Uuid,
    #[serde(default)]
    kind: Option<String>,
    title: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    link: Option<String>,
    #[serde(default)]
    severity: Option<String>,
}

/// Per-frame handler. Safe to call from the consolidated multi-
/// channel dispatcher in `main.rs`.
pub async fn handle(frame: &NotifyFrame, ws_tx: &broadcast::Sender<WsEvent>) {
    match serde_json::from_str::<Notification>(&frame.payload) {
        Ok(n) => {
            metrics::WORK_NOTIFICATIONS_TOTAL
                .with_label_values(&["enqueue"])
                .inc();
            let event = WsEvent::Notification {
                notification_id: n.notification_id,
                user_id: n.user_id,
                organization_id: n.organization_id,
                kind: n.kind.unwrap_or_default(),
                title: n.title,
                body: n.body,
                link: n.link,
                severity: n.severity,
            };
            if let Err(e) = crate::websocket::broadcast_event(ws_tx, event) {
                debug!(
                    ?e,
                    "notifications_listener: no WS subscribers (ignored)"
                );
            }
        }
        Err(e) => {
            warn!(
                ?e,
                payload = %frame.payload,
                "notifications_listener: bad payload (skipped)"
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
