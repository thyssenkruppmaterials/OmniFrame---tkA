// Created and developed by Jai Singh
//! Background tokio task that evicts expired focus leases.
//!
//! Mirror of `presence::evictor::run` in shape; runs on its own
//! 30s tick to keep failure domains isolated. Same cadence as
//! presence — the focus TTL (30s) makes 30s the minimum useful
//! sweep window without paying double Redis ops.
//!
//! Cadence rationale (mirrors presence, with the FOCUS_TTL_SECONDS
//! budget halved):
//!   - FE heartbeat is every 15s. A user who closes their tab
//!     mid-edit will be evicted within a 30s TTL plus at most one
//!     30s evictor pass — i.e. 30–60s before colleagues see
//!     `EntityFocus { action: "leave" }`. Acceptable for a
//!     soft-locking UX (the goal is awareness, not exclusion).
//!   - 30s lets us share the cadence with the presence evictor
//!     in the SRE's mental model — both subsystems operate on the
//!     same wall-clock rhythm.

use std::time::Duration;

use tokio::sync::broadcast;
use tracing::{debug, info, warn};

use crate::entity_focus::redis;
use crate::observability::metrics;
use crate::websocket::WsEvent;

/// How often the focus evictor wakes up to sweep expired leases.
/// Matches `presence::evictor::EVICTOR_TICK` so SREs see one
/// rhythm. The TTL itself is 30s (`redis::FOCUS_TTL_SECONDS`),
/// half of presence's 90s — see the module-level doc comment.
pub const FOCUS_EVICTOR_TICK: Duration = Duration::from_secs(30);

/// Long-running tokio task. Spawned once at boot from `main.rs`
/// alongside the presence evictor. Runs INDEPENDENTLY (separate
/// `tokio::spawn`) so a transient Redis hiccup that breaks our
/// loop doesn't stall the presence evictor too.
pub async fn run(pool: redis::RedisPool, ws_tx: broadcast::Sender<WsEvent>) {
    info!(
        cadence_secs = FOCUS_EVICTOR_TICK.as_secs(),
        ttl_secs = redis::FOCUS_TTL_SECONDS,
        "entity_focus::evictor spawned"
    );

    let mut ticker = tokio::time::interval(FOCUS_EVICTOR_TICK);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        ticker.tick().await;

        let orgs = match redis::list_known_orgs(&pool).await {
            Ok(orgs) => orgs,
            Err(e) => {
                warn!(?e, "entity_focus::evictor: list_known_orgs failed; will retry next tick");
                continue;
            }
        };

        if orgs.is_empty() {
            debug!("entity_focus::evictor: no orgs in iteration set");
            continue;
        }

        let mut total_evicted: usize = 0;
        for org_id in orgs {
            let evicted = match redis::evict_expired(&pool, org_id).await {
                Ok(v) => v,
                Err(e) => {
                    warn!(
                        ?e,
                        org_id = %org_id,
                        "entity_focus::evictor: evict_expired failed (org skipped)"
                    );
                    continue;
                }
            };

            for ef in &evicted {
                let event = WsEvent::EntityFocus {
                    entity_kind: ef.entity_kind.clone(),
                    entity_id: ef.entity_id.clone(),
                    user_id: ef.user_id,
                    organization_id: org_id,
                    action: "leave".to_string(),
                };
                if let Err(e) = crate::websocket::broadcast_event(&ws_tx, event) {
                    debug!(
                        ?e,
                        user_id = %ef.user_id,
                        org_id = %org_id,
                        entity_kind = %ef.entity_kind,
                        entity_id = %ef.entity_id,
                        "entity_focus::evictor: no WS subscribers (ignored)"
                    );
                }
            }

            if !evicted.is_empty() {
                debug!(
                    evicted = evicted.len(),
                    org_id = %org_id,
                    "entity_focus::evictor: swept expired leases"
                );
                total_evicted += evicted.len();
            }

            // Gauge sample + lazy iteration-set cleanup.
            match redis::count_org_focus(&pool, org_id).await {
                Ok(count) => {
                    let org_hash = metrics::org_hash_label(&org_id);
                    metrics::WORK_ENTITY_FOCUS_ACTIVE
                        .with_label_values(&[&org_hash])
                        .set(count);
                    if count == 0 {
                        if let Err(e) = redis::forget_org(&pool, org_id).await {
                            warn!(
                                ?e,
                                org_id = %org_id,
                                "entity_focus::evictor: forget_org failed"
                            );
                        }
                    }
                }
                Err(e) => {
                    warn!(
                        ?e,
                        org_id = %org_id,
                        "entity_focus::evictor: count_org_focus failed"
                    );
                }
            }
        }

        if total_evicted > 0 {
            debug!(
                total_evicted,
                "entity_focus::evictor: tick complete"
            );
        }
    }
}

// Created and developed by Jai Singh
