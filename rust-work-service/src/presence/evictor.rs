// Created and developed by Jai Singh
//! Background tokio task that evicts expired presence rows.
//!
//! Mirror of `settings::listener::run` and
//! `sap_agents_listener::run` in shape, but driven by a 30s wall-clock
//! tick rather than a Postgres NOTIFY pipe.
//!
//! Cadence (30s) was picked because:
//!   - The FE's foreground heartbeat is 30s. A user who closes their
//!     last tab will be evicted within a 90s TTL plus at most one
//!     30s evictor pass — i.e. 90–120s before colleagues see the
//!     `PresenceLeft` event. This is well inside the "awareness" UX
//!     budget for a logistics warehouse.
//!   - 30s is also low enough that an evictor restart loop (after a
//!     transient Redis hiccup) doesn't materially miss eviction
//!     windows.
//!   - Tighter cadence (e.g. 10s) costs more `ZRANGEBYSCORE` ops on
//!     Redis without buying the user any noticeable awareness boost.

use std::time::Duration;

use tokio::sync::broadcast;
use tracing::{debug, info, warn};

use crate::observability::metrics;
use crate::presence::redis;
use crate::websocket::WsEvent;

/// How often the evictor wakes up to sweep expired presence rows.
///
/// Tuned in concert with `redis::PRESENCE_TTL_SECONDS` (90s) — see
/// the module-level doc comment for the rationale.
pub const EVICTOR_TICK: Duration = Duration::from_secs(30);

/// Long-running tokio task. Spawned once at boot from `main.rs`,
/// alongside the `settings::listener::run` and `sap_agents_listener`
/// spawns.
///
/// On each tick:
///   1. Read the `presence:orgs` SET to know which orgs have rows
///      worth scanning.
///   2. For each org, call `evict_expired(...)` — this returns the
///      list of `user_id`s whose `expires_at` is in the past.
///   3. For each evicted user_id, broadcast `WsEvent::PresenceLeft`
///      via the existing `broadcast::Sender<WsEvent>`.
///   4. Sample the org's HSET cardinality and update the
///      `work_presence_active_users` gauge. If the HSET is empty,
///      drop the org from the iteration set.
///
/// All Redis errors are logged at `tracing::warn!` and the task
/// continues — a transient Redis hiccup will surface as a missed
/// eviction this cycle, picked up on the next.
pub async fn run(pool: redis::RedisPool, ws_tx: broadcast::Sender<WsEvent>) {
    info!(
        cadence_secs = EVICTOR_TICK.as_secs(),
        ttl_secs = redis::PRESENCE_TTL_SECONDS,
        "presence::evictor spawned"
    );

    let mut ticker = tokio::time::interval(EVICTOR_TICK);
    // Skip missed ticks on resume — we don't want to "make up" a
    // backlog of evictions if the runtime stalled, since each tick is
    // independent.
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        ticker.tick().await;

        let orgs = match redis::list_known_orgs(&pool).await {
            Ok(orgs) => orgs,
            Err(e) => {
                warn!(?e, "presence::evictor: list_known_orgs failed; will retry next tick");
                continue;
            }
        };

        if orgs.is_empty() {
            debug!("presence::evictor: no orgs in iteration set");
            continue;
        }

        let mut total_evicted: usize = 0;
        for org_id in orgs {
            // Step 2: evict expired entries. The function returns the
            // list of `user_id`s that were removed so we can broadcast.
            let evicted = match redis::evict_expired(&pool, org_id).await {
                Ok(v) => v,
                Err(e) => {
                    warn!(
                        ?e,
                        org_id = %org_id,
                        "presence::evictor: evict_expired failed (org skipped)"
                    );
                    continue;
                }
            };

            // Step 3: broadcast `PresenceLeft` for each evicted user.
            // Send is fire-and-forget — `Err(SendError)` means there
            // are no subscribers right now, which is the steady state
            // when no tabs are connected.
            for user_id in &evicted {
                let event = WsEvent::PresenceLeft {
                    user_id: user_id.clone(),
                    organization_id: org_id,
                };
                if let Err(e) = crate::websocket::broadcast_event(&ws_tx, event) {
                    debug!(
                        ?e,
                        user_id = %user_id,
                        org_id = %org_id,
                        "presence::evictor: no WS subscribers for PresenceLeft (ignored)"
                    );
                }
            }

            if !evicted.is_empty() {
                debug!(
                    evicted = evicted.len(),
                    org_id = %org_id,
                    "presence::evictor: swept expired rows"
                );
                total_evicted += evicted.len();
            }

            // Step 4: gauge sample + lazy iteration-set cleanup.
            match redis::count_org_presence(&pool, org_id).await {
                Ok(count) => {
                    let org_hash = metrics::org_hash_label(&org_id);
                    metrics::WORK_PRESENCE_ACTIVE_USERS
                        .with_label_values(&[&org_hash])
                        .set(count);
                    if count == 0 {
                        // Drop empty org from the iteration set so we
                        // don't scan it forever. A future track will
                        // re-add it via SADD.
                        if let Err(e) = redis::forget_org(&pool, org_id).await {
                            warn!(
                                ?e,
                                org_id = %org_id,
                                "presence::evictor: forget_org failed"
                            );
                        }
                    }
                }
                Err(e) => {
                    warn!(
                        ?e,
                        org_id = %org_id,
                        "presence::evictor: count_org_presence failed"
                    );
                }
            }
        }

        if total_evicted > 0 {
            debug!(
                total_evicted,
                "presence::evictor: tick complete"
            );
        }
    }
}

// Created and developed by Jai Singh
