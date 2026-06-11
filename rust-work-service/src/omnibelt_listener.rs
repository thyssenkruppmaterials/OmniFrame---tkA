// Created and developed by Jai Singh
//! `LISTEN omnibelt_config_changed` consumer.
//!
//! P2 of the OmniBelt MVP rollout (2026-05-24).
//!
//! Driven by the `omnibelt_role_config_notify` AFTER trigger from
//! migration 327 — fires on every INSERT/UPDATE/DELETE of an
//! `omnibelt_role_config` row with payload `{ "org_id": "<uuid>" }`.
//!
//! On each frame this handler:
//!
//! 1. Parses the payload to extract `org_id`.
//! 2. DELs all `omnibelt:bootstrap:{org_id}:*` keys from Redis so the
//!    next bootstrap fetch (from any user in the org) by
//!    `rust-dashboard-service` observes the new config rather than
//!    serving the now-stale 30s-cached payload.
//! 3. Broadcasts `WsEvent::OmnibeltConfigChanged { organization_id }`
//!    to every connected client in that org. The frontend
//!    `useOmnibeltConfigInvalidator` subscribes via the existing
//!    `workServiceWs` singleton and invalidates the
//!    `['omnibelt', 'bootstrap']` TanStack Query.
//!
//! Steps 2 and 3 are independent — a failure in one MUST NOT cancel
//! the other (Redis hiccups shouldn't stop the FE invalidation; FE
//! send-loop errors shouldn't leave stale Redis entries). Both
//! errors are logged at `warn`.

use bb8::Pool;
use bb8_redis::redis::AsyncCommands;
use bb8_redis::RedisConnectionManager;
use serde::Deserialize;
use sqlx::PgPool;
use tokio::sync::broadcast;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::pglistener::{self, NotifyFrame};
use crate::websocket::WsEvent;

/// LISTEN channel name. Must match the literal in
/// `notify_omnibelt_config_change()` (migration 327).
pub const CHANNEL: &str = "omnibelt_config_changed";

/// Key glob deleted from Redis on every notification. The
/// `rust-dashboard-service` writes individual keys
/// `omnibelt:bootstrap:{org_id}:{user_id}`, so the SCAN+DEL pattern
/// covers every user in the org with a single sweep.
fn cache_key_pattern(org_id: &Uuid) -> String {
    format!("omnibelt:bootstrap:{}:*", org_id)
}

#[derive(Debug, Deserialize)]
struct Notification {
    org_id: Uuid,
}

/// Per-frame handler. Called by the consolidated multi-channel
/// dispatcher in `main.rs`.
pub async fn handle(
    frame: &NotifyFrame,
    redis_pool: &Pool<RedisConnectionManager>,
    ws_tx: &broadcast::Sender<WsEvent>,
) {
    let n: Notification = match serde_json::from_str(&frame.payload) {
        Ok(n) => n,
        Err(e) => {
            warn!(
                ?e,
                payload = %frame.payload,
                "omnibelt_listener: bad payload (skipped)"
            );
            return;
        }
    };

    invalidate_cache(redis_pool, &n.org_id).await;

    let event = WsEvent::OmnibeltConfigChanged {
        organization_id: n.org_id,
    };
    if let Err(e) = crate::websocket::broadcast_event(ws_tx, event) {
        debug!(?e, "omnibelt_listener: no WS subscribers (ignored)");
    }
}

/// SCAN for matching keys and DEL them in a single batch. Logs and
/// swallows every Redis error — config-change notifications are
/// best-effort and the FE invalidate path still fires regardless.
async fn invalidate_cache(pool: &Pool<RedisConnectionManager>, org_id: &Uuid) {
    let pattern = cache_key_pattern(org_id);
    let mut conn = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            warn!(error = %e, "omnibelt_listener: redis pool acquire failed");
            return;
        }
    };

    // SCAN cursor loop — Redis recommends SCAN over KEYS for
    // production workloads. Cap iterations to a sane upper bound so
    // a runaway cursor doesn't tie up the connection.
    let mut cursor: u64 = 0;
    let mut iterations = 0;
    loop {
        let res: Result<(u64, Vec<String>), _> = bb8_redis::redis::cmd("SCAN")
            .arg(cursor)
            .arg("MATCH")
            .arg(&pattern)
            .arg("COUNT")
            .arg(100)
            .query_async(&mut *conn)
            .await;
        let (next_cursor, keys) = match res {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, pattern = %pattern, "omnibelt_listener: SCAN failed");
                return;
            }
        };
        if !keys.is_empty() {
            if let Err(e) = conn.del::<_, ()>(&keys).await {
                warn!(error = %e, count = keys.len(), "omnibelt_listener: DEL failed");
            } else {
                debug!(
                    count = keys.len(),
                    pattern = %pattern,
                    "omnibelt_listener: invalidated bootstrap cache keys"
                );
            }
        }
        if next_cursor == 0 {
            break;
        }
        cursor = next_cursor;
        iterations += 1;
        if iterations > 100 {
            warn!(
                pattern = %pattern,
                "omnibelt_listener: SCAN exceeded 100 iterations — bailing out"
            );
            break;
        }
    }
}

#[allow(dead_code)]
pub async fn run(
    pool: PgPool,
    redis_pool: Pool<RedisConnectionManager>,
    ws_tx: broadcast::Sender<WsEvent>,
) {
    pglistener::run(pool, CHANNEL, move |frame| {
        let redis_pool = redis_pool.clone();
        let ws_tx = ws_tx.clone();
        async move { handle(&frame, &redis_pool, &ws_tx).await }
    })
    .await;
}

// Created and developed by Jai Singh
