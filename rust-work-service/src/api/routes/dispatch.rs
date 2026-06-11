// Created and developed by Jai Singh
//! Dispatch broadcast REST endpoints — Tier 2 #3 (2026-05-06).
//!
//! One endpoint mounted under `/api/v1/dispatch/*`, behind
//! `require_auth`:
//!
//!   - `POST /broadcast` — supervisor-initiated "broadcast to all
//!     operators in zone X / with role Y / in user-list Z". Resolves
//!     the target user list server-side (org-scoped — cross-org IDs
//!     silently filtered + warn-logged) and fans out a single
//!     `WsEvent::PushedWork` carrying the broadcast targeting fields
//!     (`target_zone`, `target_role`, `target_user_ids`,
//!     `broadcast_message`). FE recipients (`use-pushed-work.ts`)
//!     branch on whether targeting fields are set and self-filter
//!     their participation in the broadcast.
//!
//! Authz:
//!   - The route is behind `require_auth` for the JWT.
//!   - Inline supervisor / manager / admin role check (see
//!     `require_supervisor` below). The FE `BroadcastDialog` is only
//!     mounted in admin RBAC-gated routes, but the server-side check
//!     is the authoritative boundary.
//!
//! Org-scope security:
//!   - All target queries filter on `organization_id` from the JWT,
//!     never from the request body. `target_user_ids` is intersected
//!     with `user_profiles.organization_id = $org`, so cross-tenant
//!     pushes are impossible by construction. Cross-org IDs are
//!     silently filtered (the resolved-count tells the supervisor
//!     "this matched N operators in your org").
//!
//! Mirrors `entity_focus.rs` for handler structure, error mapping,
//! request/response types. `PushedWork` constructor matches the
//! single-user push patterns in `api/routes/work.rs` (the four new
//! optional broadcast fields are `Some(...)` here vs. `None` for
//! single-user pushes).
//!
//! Recovery 2026-05-06 PM — replaced the throwaway stub the parallel
//! sprint left behind. See the reconciliation footnote in
//! `Implementations/Implement-Richer-Dispatch-Broadcast-Tier2-3.md`.

use axum::{
    extract::{Extension, State},
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{info, warn};
use uuid::Uuid;

use crate::api::error::{ApiError, ApiResult};
use crate::auth::AuthenticatedUser;
use crate::observability::metrics;
use crate::websocket::WsEvent;
use crate::AppState;

/// Maximum broadcast message length. Anything longer is almost
/// certainly an accidental file-paste; the FE textarea also clamps at
/// this size for parity.
const MAX_MESSAGE_LEN: usize = 1000;

/// Maximum size of an explicit `target_user_ids` list. Sized to
/// accommodate "every operator in the org" for any tenant we expect
/// to onboard while still bounding the worst-case SQL `= ANY($)`
/// list. Larger lists almost certainly want a role / zone target.
const MAX_TARGET_USER_IDS: usize = 500;

/// Supported priority labels — matches the FE's `PRIORITIES` const.
/// Kept lenient (not enforced as an enum) so future product additions
/// don't require a Rust release; we just pass it through to the
/// `WsEvent::PushedWork.priority` field verbatim.
const DEFAULT_PRIORITY: &str = "normal";

#[derive(Debug, Deserialize)]
pub struct BroadcastRequest {
    /// Required. The supervisor's broadcast text. Rendered as the
    /// toast body on every recipient's WS handler.
    pub message: String,
    /// Optional priority label (`critical | hot | normal | low`).
    /// Forwarded into `WsEvent::PushedWork.priority`. Defaults to
    /// `"normal"` when missing.
    #[serde(default)]
    pub priority: Option<String>,
    /// Targeting — exactly one of these SHOULD be set (the FE enforces
    /// this; the route tolerates combinations and labels the metric
    /// `mixed`).
    #[serde(default)]
    pub target_zone: Option<String>,
    #[serde(default)]
    pub target_role: Option<String>,
    #[serde(default)]
    pub target_user_ids: Option<Vec<Uuid>>,
    /// Optional deep-link to a specific work task. When set, the FE
    /// recipient invalidates the work queue + pulses the matching row.
    /// When omitted, a sentinel `Uuid::nil()` task_id is used.
    #[serde(default)]
    pub work_task_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct BroadcastResponse {
    /// Count of org-scoped users that matched the targeting criteria.
    /// NOT a delivery confirmation — operators who are offline or
    /// disconnected at broadcast time miss the toast (broadcasts are
    /// not persisted; see roadmap follow-on note).
    pub resolved_user_count: usize,
    /// Which target axis the route used to resolve the recipient
    /// list. `"mixed"` when more than one of `target_zone /
    /// target_role / target_user_ids` was supplied.
    pub target_type: &'static str,
}

/// Resolve `(user_id, organization_id)` from JWT claims. Returns
/// 400/403 on malformed claims, mirroring `presence.rs` /
/// `entity_focus.rs` / `notifications.rs`.
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

/// Inline supervisor authz check. Mirrors the convention from
/// `push_to_user` in `api/routes/work.rs` (no separate middleware in
/// `rust-work-service` today). Accepts users with:
///   - permission containing `*`, `manage`, or `supervisor`, OR
///   - role of `admin | super_admin | supervisor | manager`.
fn require_supervisor(user: &AuthenticatedUser) -> ApiResult<()> {
    let allowed = user
        .permissions
        .iter()
        .any(|p| p == "*" || p.contains("manage") || p.contains("supervisor"))
        || matches!(
            user.role.as_deref(),
            Some("admin" | "super_admin" | "supervisor" | "manager")
        );
    if !allowed {
        return Err(ApiError::Forbidden(
            "Supervisor / manager role required to broadcast".to_string(),
        ));
    }
    Ok(())
}

/// Tag the broadcast by which targeting field(s) were supplied.
/// Multi-target requests bucket as `"mixed"` (still resolved + sent;
/// the metric label just records the shape).
fn classify_target(req: &BroadcastRequest) -> &'static str {
    let mut count = 0;
    if req.target_zone.is_some() {
        count += 1;
    }
    if req.target_role.is_some() {
        count += 1;
    }
    if req.target_user_ids.is_some() {
        count += 1;
    }
    if count > 1 {
        return "mixed";
    }
    if req.target_zone.is_some() {
        "zone"
    } else if req.target_role.is_some() {
        "role"
    } else if req.target_user_ids.is_some() {
        "users"
    } else {
        "none"
    }
}

/// Resolve target user_ids for a zone broadcast. Returns active
/// (heartbeat in last 5 min) operators in the supplied zone within
/// the supervisor's org. Mirrors the existing `get_active_workers`
/// freshness window so a supervisor's "broadcast to zone K1" matches
/// the zone roster they see in the Operation Control UI.
async fn resolve_zone(
    pool: &sqlx::PgPool,
    org_id: Uuid,
    zone: &str,
) -> ApiResult<Vec<Uuid>> {
    let rows: Vec<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT user_id
          FROM public.worker_heartbeats
         WHERE organization_id = $1
           AND current_zone = $2
           AND last_heartbeat >= NOW() - INTERVAL '5 minutes'
        "#,
    )
    .bind(org_id)
    .bind(zone)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        warn!(?e, %org_id, %zone, "dispatch::resolve_zone: db error");
        ApiError::Database(e)
    })?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Resolve target user_ids for a role broadcast. Returns ALL users in
/// the org with the requested role (online or offline — the WS fan-out
/// only reaches connected sockets, but we tell the supervisor how many
/// users in total match so they understand the broadcast's intent).
async fn resolve_role(
    pool: &sqlx::PgPool,
    org_id: Uuid,
    role: &str,
) -> ApiResult<Vec<Uuid>> {
    let rows: Vec<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT id
          FROM public.user_profiles
         WHERE organization_id = $1
           AND role::text = $2
        "#,
    )
    .bind(org_id)
    .bind(role)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        warn!(?e, %org_id, %role, "dispatch::resolve_role: db error");
        ApiError::Database(e)
    })?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Intersect a caller-supplied user_id list with the supervisor's org.
/// Cross-tenant IDs are silently filtered (and warn-logged for the
/// audit trail) — the resolved count tells the supervisor which IDs
/// landed.
async fn resolve_explicit_users(
    pool: &sqlx::PgPool,
    org_id: Uuid,
    requested: &[Uuid],
) -> ApiResult<Vec<Uuid>> {
    let rows: Vec<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT id
          FROM public.user_profiles
         WHERE organization_id = $1
           AND id = ANY($2)
        "#,
    )
    .bind(org_id)
    .bind(requested)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        warn!(?e, %org_id, "dispatch::resolve_explicit_users: db error");
        ApiError::Database(e)
    })?;
    let resolved: Vec<Uuid> = rows.into_iter().map(|(id,)| id).collect();
    if resolved.len() != requested.len() {
        let dropped = requested.len() - resolved.len();
        warn!(
            %org_id,
            requested = requested.len(),
            resolved = resolved.len(),
            dropped,
            "dispatch::broadcast: dropped cross-org / unknown user_ids"
        );
    }
    Ok(resolved)
}

pub async fn broadcast(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Json(req): Json<BroadcastRequest>,
) -> ApiResult<Json<BroadcastResponse>> {
    let (supervisor_uuid, org_uuid) = require_user_and_org(&user)?;
    require_supervisor(&user)?;

    // Validate body shape.
    let trimmed_message = req.message.trim();
    if trimmed_message.is_empty() {
        return Err(ApiError::BadRequest(
            "message must not be empty".to_string(),
        ));
    }
    if trimmed_message.len() > MAX_MESSAGE_LEN {
        return Err(ApiError::BadRequest(format!(
            "message must be ≤ {} characters",
            MAX_MESSAGE_LEN
        )));
    }
    if req.target_zone.is_none()
        && req.target_role.is_none()
        && req.target_user_ids.is_none()
    {
        return Err(ApiError::BadRequest(
            "At least one of target_zone / target_role / target_user_ids must be set"
                .to_string(),
        ));
    }
    if let Some(ref ids) = req.target_user_ids {
        if ids.len() > MAX_TARGET_USER_IDS {
            return Err(ApiError::BadRequest(format!(
                "target_user_ids must be ≤ {} entries",
                MAX_TARGET_USER_IDS
            )));
        }
    }

    let target_type = classify_target(&req);

    // Resolve the union of all target sets the request asked for. We
    // dedupe at the end so a user matching multiple criteria still
    // receives ONE broadcast (the FE branches on `target_user_ids` so
    // a user listed twice in the underlying targeting could otherwise
    // accept the broadcast twice).
    let mut resolved: Vec<Uuid> = Vec::new();
    if let Some(zone) = req.target_zone.as_deref() {
        resolved.extend(resolve_zone(&state.db_pool, org_uuid, zone).await?);
    }
    if let Some(role) = req.target_role.as_deref() {
        resolved.extend(resolve_role(&state.db_pool, org_uuid, role).await?);
    }
    if let Some(ref ids) = req.target_user_ids {
        resolved.extend(resolve_explicit_users(&state.db_pool, org_uuid, ids).await?);
    }
    resolved.sort();
    resolved.dedup();

    let priority = req
        .priority
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_PRIORITY)
        .to_string();

    // The `task_id` field on `WsEvent::PushedWork` is required; we
    // forward the supplied `work_task_id` when present, else use a
    // sentinel `Uuid::nil()`. The FE branches on `isBroadcast`
    // (= any targeting field set OR `broadcast_message` set) BEFORE
    // reading `task_id`, so a nil sentinel doesn't trigger a stray
    // task-update path.
    let task_id = req.work_task_id.unwrap_or_else(Uuid::nil);

    let event = WsEvent::PushedWork {
        task_id,
        // For broadcasts, `user_id` carries the supervisor / pusher
        // (NOT the recipient) — see the variant doc-comment in
        // `websocket/mod.rs`. Audit trails read this as
        // "broadcast initiated by X". Recipients self-filter via
        // `target_user_ids` instead of trusting `user_id`.
        user_id: supervisor_uuid,
        // `material / location / count_number` are required on the
        // variant but are only meaningful for single-user pushes.
        // Empty strings are wire-compatible — the FE renders the
        // toast from `broadcast_message` when `isBroadcast` is true,
        // so these fields stay invisible to recipients.
        material: String::new(),
        location: String::new(),
        count_number: String::new(),
        priority,
        organization_id: Some(org_uuid),
        target_zone: req.target_zone.clone(),
        target_role: req.target_role.clone(),
        target_user_ids: if resolved.is_empty() {
            // Distinguish "broadcast resolved zero users" from
            // "no list supplied" — when the supervisor targeted by
            // zone/role and nobody matched, we still emit the broadcast
            // (in case a matching socket connects right after) but with
            // an empty `target_user_ids` list. Recipients then never
            // pass the `includes(currentUserId)` check — the broadcast
            // is effectively a no-op for everyone, which is the
            // expected UX.
            Some(Vec::new())
        } else {
            Some(resolved.clone())
        },
        broadcast_message: Some(trimmed_message.to_string()),
    };
    if let Err(e) = crate::websocket::broadcast_event(&state.ws_broadcast, event) {
        warn!(
            ?e,
            org_id = %org_uuid,
            "dispatch::broadcast: WS send failed (no subscribers)"
        );
    }

    metrics::WORK_DISPATCH_BROADCAST_TOTAL
        .with_label_values(&[target_type])
        .inc();

    info!(
        supervisor_id = %supervisor_uuid,
        org_id = %org_uuid,
        target_type,
        resolved_user_count = resolved.len(),
        message_len = trimmed_message.len(),
        "dispatch::broadcast: broadcast sent"
    );

    Ok(Json(BroadcastResponse {
        resolved_user_count: resolved.len(),
        target_type,
    }))
}

/// Build the dispatch router, mounted at `/api/v1/dispatch`.
pub fn dispatch_routes() -> Router<Arc<AppState>> {
    Router::new().route("/broadcast", post(broadcast))
}

// Created and developed by Jai Singh
