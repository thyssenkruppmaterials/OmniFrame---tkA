// Created and developed by Jai Singh
//! Tier 2 #1 (2026-05-06) — entity-focus REST endpoints.
//!
//! Three endpoints mounted under `/api/v1/entity-focus/*`, all
//! behind `require_auth`:
//!
//!   - `POST /heartbeat` — refreshes (or starts) a focus lease.
//!     Body: `{ entity_kind, entity_id }`. The route resolves
//!     `user_id + organization_id` from the JWT claims and writes
//!     the HSET + ZSET entries via `entity_focus::redis::track_focus`.
//!     Broadcasts `EntityFocus { action: "enter" }` on first
//!     heartbeat or `action: "heartbeat"` on subsequent refreshes.
//!     FE cadence: every 15s while the row is selected (half of
//!     the 30s TTL).
//!
//!   - `DELETE /` — explicit untrack on row deselect / dialog close.
//!     Body: `{ entity_kind, entity_id }`. Removes the HSET row and
//!     broadcasts `EntityFocus { action: "leave" }` immediately
//!     instead of waiting for the 30s evictor.
//!
//!   - `GET /users?entity_kind=X&entity_id=Y` — bootstrap snapshot.
//!     Returns the current set of users focused on the entity. Called
//!     by late-joining tabs so they see existing focus pills before
//!     WS catches up.
//!
//! Org-scope security:
//!   - All endpoints resolve `org_id` from the JWT, NEVER from the
//!     request body. Cross-tenant calls are impossible by construction.
//!   - The deny-by-default org filter on the WS send loop covers
//!     `EntityFocus` for free (`organization_id` is REQUIRED on the
//!     variant). FE consumers add a defence-in-depth check anyway.

use axum::{
    extract::{Extension, Query, State},
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::api::error::{ApiError, ApiResult};
use crate::auth::AuthenticatedUser;
use crate::entity_focus::redis as focus_redis;
use crate::entity_focus::redis::FocusOutcome;
use crate::websocket::WsEvent;
use crate::AppState;

/// Heartbeat / DELETE request body. The route resolves user_id +
/// org_id from JWT claims; clients SHOULD NOT supply them in the
/// body (we'd ignore the values regardless).
#[derive(Debug, Deserialize)]
pub struct EntityFocusBody {
    /// Free-form entity-class label, e.g. `"ticket"`, `"work_task"`,
    /// `"rr_lx03_data"`. Validated for non-empty + length only.
    pub entity_kind: String,
    /// Identifier of the row being focused. UUIDs and other formats
    /// (e.g. row_id integers, business keys) all welcome — kept as
    /// `String` so the schema doesn't pin to UUID.
    pub entity_id: String,
}

#[derive(Debug, Deserialize)]
pub struct EntityFocusUsersQuery {
    pub entity_kind: String,
    pub entity_id: String,
}

#[derive(Debug, Serialize)]
pub struct EntityFocusHeartbeatResponse {
    /// `"enter"` or `"heartbeat"` — mirrors the broadcast `action`
    /// so the FE can correlate.
    pub action: &'static str,
}

#[derive(Debug, Serialize)]
pub struct EntityFocusUntrackResponse {
    /// `true` iff a row was actually removed (we then broadcast
    /// `action: "leave"`). Idempotent on `false` — no broadcast.
    pub removed: bool,
}

#[derive(Debug, Serialize)]
pub struct EntityFocusUsersResponse {
    pub users: Vec<focus_redis::FocusUserPublic>,
}

/// Resolve `(user_id, organization_id)` from the JWT claims. Returns
/// 400/403 on malformed claims, mirroring `presence.rs`.
fn require_user_and_org(user: &AuthenticatedUser) -> ApiResult<(Uuid, Uuid)> {
    let user_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;
    let org_id_str = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;
    let org_uuid = Uuid::parse_str(org_id_str)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;
    Ok((user_uuid, org_uuid))
}

/// Defensive validation for `entity_kind` / `entity_id`. Both must be
/// non-empty, ≤ 128 chars, and free of pipe (`|`) characters since the
/// ZSET expiration encoding uses `|` as a delimiter.
fn validate_entity_kind_id(entity_kind: &str, entity_id: &str) -> ApiResult<()> {
    if entity_kind.is_empty() || entity_kind.len() > 128 {
        return Err(ApiError::BadRequest(
            "entity_kind must be 1..=128 chars".to_string(),
        ));
    }
    if entity_id.is_empty() || entity_id.len() > 128 {
        return Err(ApiError::BadRequest(
            "entity_id must be 1..=128 chars".to_string(),
        ));
    }
    if entity_kind.contains('|') || entity_id.contains('|') {
        return Err(ApiError::BadRequest(
            "entity_kind/entity_id must not contain '|'".to_string(),
        ));
    }
    Ok(())
}

pub async fn heartbeat(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Json(req): Json<EntityFocusBody>,
) -> ApiResult<Json<EntityFocusHeartbeatResponse>> {
    let (user_uuid, org_uuid) = require_user_and_org(&user)?;
    validate_entity_kind_id(&req.entity_kind, &req.entity_id)?;

    let outcome = focus_redis::track_focus(
        &state.redis_pool,
        org_uuid,
        &req.entity_kind,
        &req.entity_id,
        user_uuid,
    )
    .await
    .map_err(|e| {
        warn!(
            ?e,
            user_id = %user_uuid,
            org_id = %org_uuid,
            entity_kind = %req.entity_kind,
            entity_id = %req.entity_id,
            "entity_focus::heartbeat: redis error"
        );
        ApiError::ServiceUnavailable("Entity focus backend unavailable".to_string())
    })?;

    let action = match outcome {
        FocusOutcome::Entered => "enter",
        FocusOutcome::Refreshed => "heartbeat",
    };

    let event = WsEvent::EntityFocus {
        entity_kind: req.entity_kind.clone(),
        entity_id: req.entity_id.clone(),
        user_id: user_uuid,
        organization_id: org_uuid,
        action: action.to_string(),
    };
    if let Err(e) = crate::websocket::broadcast_event(&state.ws_broadcast, event) {
        debug!(
            ?e,
            user_id = %user_uuid,
            org_id = %org_uuid,
            "entity_focus::heartbeat: no WS subscribers (ignored)"
        );
    }

    Ok(Json(EntityFocusHeartbeatResponse { action }))
}

pub async fn untrack(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Json(req): Json<EntityFocusBody>,
) -> ApiResult<Json<EntityFocusUntrackResponse>> {
    let (user_uuid, org_uuid) = require_user_and_org(&user)?;
    validate_entity_kind_id(&req.entity_kind, &req.entity_id)?;

    let removed = focus_redis::untrack_focus(
        &state.redis_pool,
        org_uuid,
        &req.entity_kind,
        &req.entity_id,
        user_uuid,
    )
    .await
    .map_err(|e| {
        warn!(
            ?e,
            user_id = %user_uuid,
            org_id = %org_uuid,
            "entity_focus::untrack: redis error"
        );
        ApiError::ServiceUnavailable("Entity focus backend unavailable".to_string())
    })?;

    if removed {
        let event = WsEvent::EntityFocus {
            entity_kind: req.entity_kind.clone(),
            entity_id: req.entity_id.clone(),
            user_id: user_uuid,
            organization_id: org_uuid,
            action: "leave".to_string(),
        };
        if let Err(e) = crate::websocket::broadcast_event(&state.ws_broadcast, event) {
            debug!(
                ?e,
                user_id = %user_uuid,
                org_id = %org_uuid,
                "entity_focus::untrack: no WS subscribers (ignored)"
            );
        }
    }

    Ok(Json(EntityFocusUntrackResponse { removed }))
}

pub async fn users(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Query(q): Query<EntityFocusUsersQuery>,
) -> ApiResult<Json<EntityFocusUsersResponse>> {
    let (_user_uuid, org_uuid) = require_user_and_org(&user)?;
    validate_entity_kind_id(&q.entity_kind, &q.entity_id)?;

    let users = focus_redis::get_focus_users(
        &state.redis_pool,
        org_uuid,
        &q.entity_kind,
        &q.entity_id,
    )
    .await
    .map_err(|e| {
        warn!(
            ?e,
            org_id = %org_uuid,
            entity_kind = %q.entity_kind,
            entity_id = %q.entity_id,
            "entity_focus::users: redis error"
        );
        ApiError::ServiceUnavailable("Entity focus backend unavailable".to_string())
    })?;

    Ok(Json(EntityFocusUsersResponse { users }))
}

/// Build the entity-focus router, mounted at `/api/v1/entity-focus`.
pub fn entity_focus_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/heartbeat", post(heartbeat))
        .route("/", delete(untrack))
        .route("/users", get(users))
}

// Created and developed by Jai Singh
