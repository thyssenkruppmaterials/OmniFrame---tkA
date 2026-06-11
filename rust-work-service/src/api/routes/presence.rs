// Created and developed by Jai Singh
//! Server-side presence REST endpoints (Option 2 — `ADR-Presence-Architecture-Next-Steps`).
//!
//! Three endpoints mounted under `/api/v1/presence/*`, all behind
//! `require_auth`:
//!
//!   - `POST /heartbeat` — the FE's heartbeat. Writes the payload to
//!     Redis (HSET + ZSET expiry + SADD orgs) and broadcasts a
//!     `WsEvent::PresenceJoined` (first time we see this user_id this
//!     session) or `WsEvent::PresenceUpdated` (subsequent heartbeats).
//!     Returns the broadcast type for telemetry.
//!
//!   - `GET /online` — bootstrap snapshot. Returns the current
//!     `presence:org:{org_id}` HSET as a list. Called by new tabs
//!     before the WS catches up so the user sees an immediate
//!     "who's online" panel state.
//!
//!   - `DELETE /` — explicit untrack ("Appear Offline" / sign-out).
//!     Removes the HSET row and broadcasts `PresenceLeft` immediately
//!     instead of waiting for the 30s evictor.
//!
//! The deny-by-default org filter on the existing WS send loop covers
//! the new variants for free (each carries a required `Uuid`
//! `organization_id`); FE callers add a defence-in-depth org check
//! anyway.

use axum::{
    extract::{Extension, State},
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::api::error::{ApiError, ApiResult};
use crate::auth::AuthenticatedUser;
use crate::observability::metrics;
use crate::presence::redis as presence_redis;
use crate::presence::redis::TrackOutcome;
use crate::websocket::WsEvent;
use crate::AppState;

/// Heartbeat request body.
///
/// Mirrors `PresencePayload` from `src/lib/presence/types.ts` minus
/// `current_page` (Phase B3 dropped that field for privacy + payload
/// size). Kept loose: the route only needs to forward the JSON to
/// Redis and to other tabs, so we don't enforce field types beyond
/// the basics. Future FE additions land without a Rust release.
#[derive(Debug, Deserialize)]
pub struct PresenceHeartbeatRequest {
    /// Free-form payload — the FE serialises its `PresencePayload`
    /// here. We pass it through to Redis verbatim.
    #[serde(flatten)]
    pub payload: serde_json::Map<String, Value>,
}

/// Heartbeat response. The `broadcast` field telegraphs which
/// `WsEvent` was fanned out so the FE can correlate (e.g. for a "we
/// just joined the org's presence set" toast).
#[derive(Debug, Serialize)]
pub struct PresenceHeartbeatResponse {
    /// `"PresenceJoined"` (first heartbeat this session) or
    /// `"PresenceUpdated"` (subsequent). Mirrors the `WsEvent::type`
    /// the route just broadcast.
    pub broadcast: &'static str,
}

/// `GET /online` response shape.
#[derive(Debug, Serialize)]
pub struct PresenceOnlineResponse {
    pub users: Vec<PresenceUserPublic>,
}

/// One row of the `GET /online` response. The route returns the raw
/// JSON payload the FE wrote on its last heartbeat — same shape as a
/// `PresencePayload` value in the FE.
#[derive(Debug, Serialize)]
pub struct PresenceUserPublic {
    pub user_id: String,
    /// The full payload the FE last sent. Forwarded verbatim so any
    /// schema drift is the FE's problem, not ours.
    pub payload: Value,
}

/// `DELETE /` returns a tiny ack body so the FE can verify the
/// untrack was honoured (vs. silently discarded by an upstream).
#[derive(Debug, Serialize)]
pub struct PresenceUntrackResponse {
    /// `true` when we actually removed an HSET row (we then
    /// broadcast `PresenceLeft`). `false` when the user wasn't in the
    /// HSET to begin with (no broadcast, but the request is idempotent).
    pub removed: bool,
}

/// Resolve `(user_id, organization_id)` from the authenticated user.
/// Returns the parsed UUIDs or a 400/403 if claims are malformed /
/// missing, mirroring the convention in `workers.rs`.
fn require_user_and_org(user: &AuthenticatedUser) -> ApiResult<(String, Uuid)> {
    let org_id_str = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;
    let org_uuid = Uuid::parse_str(org_id_str)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;
    // Presence stores `user_id` as a `String` — the FE happens to use
    // UUIDs today but the Redis schema doesn't enforce that, so we
    // pass the raw claim string through.
    Ok((user.user_id.clone(), org_uuid))
}

pub async fn heartbeat(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Json(req): Json<PresenceHeartbeatRequest>,
) -> ApiResult<Json<PresenceHeartbeatResponse>> {
    let (user_id, org_uuid) = require_user_and_org(&user)?;
    let payload_value = Value::Object(req.payload);

    // 1. Persist + decide join vs. update.
    let outcome = presence_redis::track_presence(
        &state.redis_pool,
        org_uuid,
        &user_id,
        &payload_value,
    )
    .await
    .map_err(|e| {
        warn!(
            ?e,
            user_id = %user_id,
            org_id = %org_uuid,
            "presence::heartbeat: redis error"
        );
        ApiError::ServiceUnavailable("Presence backend unavailable".to_string())
    })?;

    // 2. Broadcast the matching WsEvent. Send is fire-and-forget;
    //    `Err(SendError)` means no current subscribers — perfectly
    //    fine when we're the only tab open.
    let (event, label) = match outcome {
        TrackOutcome::Joined => (
            WsEvent::PresenceJoined {
                user_id: user_id.clone(),
                organization_id: org_uuid,
                payload: payload_value,
            },
            "PresenceJoined",
        ),
        TrackOutcome::Updated => (
            WsEvent::PresenceUpdated {
                user_id: user_id.clone(),
                organization_id: org_uuid,
                payload: payload_value,
            },
            "PresenceUpdated",
        ),
    };

    if let Err(e) = crate::websocket::broadcast_event(&state.ws_broadcast, event) {
        debug!(
            ?e,
            user_id = %user_id,
            org_id = %org_uuid,
            label,
            "presence::heartbeat: no WS subscribers (ignored)"
        );
    }

    // INFO on join (rare per session), DEBUG on update (rate-limited
    // by the FE's 30s heartbeat but still high cardinality at fleet
    // scale).
    match outcome {
        TrackOutcome::Joined => info!(
            user_id = %user_id,
            org_id = %org_uuid,
            "presence: user joined"
        ),
        TrackOutcome::Updated => debug!(
            user_id = %user_id,
            org_id = %org_uuid,
            "presence: heartbeat"
        ),
    }

    Ok(Json(PresenceHeartbeatResponse { broadcast: label }))
}

pub async fn online(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
) -> ApiResult<Json<PresenceOnlineResponse>> {
    let (caller_user_id, org_uuid) = require_user_and_org(&user)?;

    let raw = presence_redis::get_org_presence(&state.redis_pool, org_uuid)
        .await
        .map_err(|e| {
            warn!(
                ?e,
                org_id = %org_uuid,
                "presence::online: redis error"
            );
            ApiError::ServiceUnavailable("Presence backend unavailable".to_string())
        })?;

    // Deterministic ordering: sort by user_id so consecutive snapshot
    // calls produce stable lists (helps the FE diff cleanly).
    let mut users: Vec<PresenceUserPublic> = raw
        .into_iter()
        .map(|(user_id, payload)| PresenceUserPublic { user_id, payload })
        .collect();
    users.sort_by(|a, b| a.user_id.cmp(&b.user_id));

    debug!(
        caller_user_id = %caller_user_id,
        org_id = %org_uuid,
        count = users.len(),
        "presence::online: snapshot served"
    );

    Ok(Json(PresenceOnlineResponse { users }))
}

pub async fn untrack(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
) -> ApiResult<Json<PresenceUntrackResponse>> {
    let (user_id, org_uuid) = require_user_and_org(&user)?;

    let removed = presence_redis::untrack_presence(&state.redis_pool, org_uuid, &user_id)
        .await
        .map_err(|e| {
            warn!(
                ?e,
                user_id = %user_id,
                org_id = %org_uuid,
                "presence::untrack: redis error"
            );
            ApiError::ServiceUnavailable("Presence backend unavailable".to_string())
        })?;

    if removed {
        // Broadcast PresenceLeft immediately — don't wait the 30s for
        // the evictor to notice.
        let event = WsEvent::PresenceLeft {
            user_id: user_id.clone(),
            organization_id: org_uuid,
        };
        if let Err(e) = crate::websocket::broadcast_event(&state.ws_broadcast, event) {
            debug!(
                ?e,
                user_id = %user_id,
                org_id = %org_uuid,
                "presence::untrack: no WS subscribers for PresenceLeft (ignored)"
            );
        }
        info!(
            user_id = %user_id,
            org_id = %org_uuid,
            "presence: user left (explicit)"
        );
    } else {
        // No row to remove — still ack so the FE can treat it as
        // idempotent. Counter not bumped because untrack already
        // gates on `removed > 0`.
        debug!(
            user_id = %user_id,
            org_id = %org_uuid,
            "presence::untrack: no row to remove (idempotent ack)"
        );
    }

    let _ = metrics::WORK_PRESENCE_ACTIVE_USERS.with_label_values(&[&metrics::org_hash_label(&org_uuid)]);

    Ok(Json(PresenceUntrackResponse { removed }))
}

/// Build the presence routes router, mounted by `main.rs` at
/// `/api/v1/presence`.
pub fn presence_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/heartbeat", post(heartbeat))
        .route("/online", get(online))
        .route("/", delete(untrack))
}

// Created and developed by Jai Singh
