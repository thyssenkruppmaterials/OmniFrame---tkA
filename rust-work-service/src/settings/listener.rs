// Created and developed by Jai Singh
//! `LISTEN work_engine_settings_changed` consumer.
//!
//! Spawned once at boot; keeps the in-memory `SettingsCache` warm by
//! invalidating per-org entries when a manager flips a setting via the
//! Configurability Surface.
//!
//! Increments `work_settings_refresh_total{outcome=...}` so Phase 12
//! observability can detect a silent NOTIFY pipe (Postgres → pg_listen).
//!
//! 2026-05-07 — switched from a hand-rolled `PgListener` reconnect
//! loop to [`crate::pglistener::run`] so the listener can survive a
//! silent TCP drop (Railway proxy / Supabase pgbouncer
//! idle-killing the dedicated socket between long-tail NOTIFYs).

use std::sync::Arc;

use serde::Deserialize;
use sqlx::PgPool;
use tracing::{info, warn};
use uuid::Uuid;

use super::cache::SettingsCache;
use crate::observability::metrics;
use crate::pglistener::{self, NotifyFrame};

/// Channel name. Centralised so the consolidated listener in
/// `main.rs` and the legacy [`run`] both reference the same string
/// (and so a future rename is a single-site change).
pub const CHANNEL: &str = "work_engine_settings_changed";

#[derive(Debug, Deserialize)]
struct Notification {
    organization_id: Option<Uuid>,
    table: Option<String>,
    op: Option<String>,
}

/// Per-frame handler. Pure side-effect (cache invalidation +
/// metric bump), no I/O beyond the cache write. Safe to call from
/// the consolidated multi-channel dispatcher in `main.rs`.
pub async fn handle(frame: &NotifyFrame, cache: &Arc<SettingsCache>) {
    let parsed: Result<Notification, _> = serde_json::from_str(&frame.payload);
    match parsed {
        Ok(n) => {
            if let Some(org) = n.organization_id {
                cache.invalidate(org).await;
                info!(?org, table = ?n.table, op = ?n.op, "settings invalidated");
            } else {
                cache.invalidate_all().await;
            }
            metrics::WORK_SETTINGS_REFRESH_TOTAL
                .with_label_values(&["success"])
                .inc();
        }
        Err(e) => {
            warn!(?e, payload = %frame.payload, "settings_listener: bad payload");
            cache.invalidate_all().await;
            metrics::WORK_SETTINGS_REFRESH_TOTAL
                .with_label_values(&["error"])
                .inc();
        }
    }
}

/// Long-running tokio task — single-channel variant. Preserved for
/// the public crate surface; the binary's `main.rs` now spawns a
/// consolidated [`crate::pglistener::run_multi`] task that calls
/// [`handle`] directly. New callers should prefer the consolidated
/// path so the Supabase `max_connections` budget stays bounded.
#[allow(dead_code)]
pub async fn run(pool: PgPool, cache: Arc<SettingsCache>) {
    pglistener::run(pool, CHANNEL, move |frame| {
        let cache = cache.clone();
        async move {
            handle(&frame, &cache).await;
        }
    })
    .await;
}

// Created and developed by Jai Singh
