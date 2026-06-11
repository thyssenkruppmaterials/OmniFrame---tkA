// Created and developed by Jai Singh
//! Notifications REST endpoints — Tier 2 #2 (2026-05-06).
//!
//! Three endpoints mounted under `/api/v1/notifications/*`, all
//! behind `require_auth`:
//!
//!   - `GET /` — bootstrap fetch for the bell-icon popover. Returns
//!     the latest N notifications for the current user (org-scoped),
//!     plus the current unread count. Optional query params:
//!     `unread_only=true` to filter to unread, `limit=N` (default 50,
//!     clamped to 1..=200).
//!
//!   - `POST /:id/read` — mark a single notification as read.
//!     Idempotent — already-read rows return `{ marked: false }`.
//!
//!   - `POST /read-all` — bulk mark every unread notification as read
//!     for the current user (org-scoped). Returns how many flipped.
//!
//! Org-scope security:
//!   - All endpoints resolve `(user_id, organization_id)` from JWT
//!     claims, NEVER from the body. The `require_auth` middleware sits
//!     above. Every SQL query has both `user_id = $1` AND
//!     `organization_id = $2` in the WHERE clause as defence-in-depth
//!     on top of the RLS policy from migration 275 (which enforces
//!     the same predicate at the DB layer).
//!
//! Mirrors `presence.rs` for the JWT-claim resolution helper +
//! `entity_focus.rs` for the request/response shape conventions.
//!
//! Recovery 2026-05-06 PM — replaced the throwaway stub the parallel
//! sprint left behind. See the reconciliation footnote in
//! `Implementations/Implement-Notifications-Panel-Tier2-2.md`.

use axum::{
    extract::{Extension, Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::api::error::{ApiError, ApiResult};
use crate::auth::AuthenticatedUser;
use crate::observability::metrics;
use crate::AppState;

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 200;

/// One row of the user's notification feed. Mirrors the FE
/// `NotificationRow` type in `src/lib/work-service/notifications.client.ts`.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct NotificationRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub organization_id: Uuid,
    /// `notifications.type` enum cast to text:
    /// `info | warning | error | success`. Nullable for resilience —
    /// the column is `NOT NULL` today but the FE tolerates `null`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
    /// Free-form event-class label, e.g. `'sap_job_complete'`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    pub read: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize, Default)]
pub struct ListQuery {
    /// When `true`, only unread rows are returned. Defaults to `false`
    /// (the bell-icon popover shows recent rows including read ones).
    #[serde(default)]
    pub unread_only: Option<bool>,
    /// Max rows to return. Defaults to `DEFAULT_LIMIT`, clamped to
    /// `1..=MAX_LIMIT`.
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct ListResponse {
    pub notifications: Vec<NotificationRow>,
    /// Total count of unread rows for this user in this org. Cheaper
    /// than `notifications.iter().filter(read=false).count()` for the
    /// FE because the popover only fetches the latest 50 — the unread
    /// count can be larger.
    pub unread_count: i64,
}

#[derive(Debug, Serialize)]
pub struct MarkReadResponse {
    /// `true` when we actually flipped an unread row to read; `false`
    /// when the row was already read or didn't belong to the caller
    /// (idempotent on either case).
    pub marked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct MarkAllReadResponse {
    /// Count of rows newly flipped to read.
    pub count: i64,
}

/// Resolve `(user_id, organization_id)` from the JWT claims. Returns
/// 400/403 on malformed claims, mirroring `presence.rs` /
/// `entity_focus.rs`.
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

pub async fn list(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Query(q): Query<ListQuery>,
) -> ApiResult<Json<ListResponse>> {
    let (user_uuid, org_uuid) = require_user_and_org(&user)?;
    let unread_only = q.unread_only.unwrap_or(false);
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

    // Note: we cast `type::text` because the column is a Postgres enum
    // (`notification_type`) and sqlx::FromRow can't auto-decode an
    // enum without the matching Rust type. Casting to text keeps the
    // route immune to enum-value additions.
    let rows: Vec<NotificationRow> = if unread_only {
        sqlx::query_as::<_, NotificationRow>(
            r#"
            SELECT
                id,
                user_id,
                organization_id,
                type::text AS severity,
                kind,
                title,
                message AS body,
                action_url AS link,
                read,
                read_at,
                created_at
            FROM public.notifications
            WHERE user_id = $1
              AND organization_id = $2
              AND read = false
            ORDER BY created_at DESC
            LIMIT $3
            "#,
        )
        .bind(user_uuid)
        .bind(org_uuid)
        .bind(limit)
        .fetch_all(&state.db_pool)
        .await
    } else {
        sqlx::query_as::<_, NotificationRow>(
            r#"
            SELECT
                id,
                user_id,
                organization_id,
                type::text AS severity,
                kind,
                title,
                message AS body,
                action_url AS link,
                read,
                read_at,
                created_at
            FROM public.notifications
            WHERE user_id = $1
              AND organization_id = $2
            ORDER BY created_at DESC
            LIMIT $3
            "#,
        )
        .bind(user_uuid)
        .bind(org_uuid)
        .bind(limit)
        .fetch_all(&state.db_pool)
        .await
    }
    .map_err(|e| {
        warn!(
            ?e,
            user_id = %user_uuid,
            org_id = %org_uuid,
            "notifications::list: db error"
        );
        ApiError::Database(e)
    })?;

    let unread_count: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)::bigint
          FROM public.notifications
         WHERE user_id = $1
           AND organization_id = $2
           AND read = false
        "#,
    )
    .bind(user_uuid)
    .bind(org_uuid)
    .fetch_one(&state.db_pool)
    .await
    .map_err(|e| {
        warn!(
            ?e,
            user_id = %user_uuid,
            org_id = %org_uuid,
            "notifications::list: unread count failed"
        );
        ApiError::Database(e)
    })?;

    metrics::WORK_NOTIFICATIONS_TOTAL
        .with_label_values(&["bootstrap"])
        .inc();

    debug!(
        user_id = %user_uuid,
        org_id = %org_uuid,
        returned = rows.len(),
        unread = unread_count.0,
        "notifications::list: served"
    );

    Ok(Json(ListResponse {
        notifications: rows,
        unread_count: unread_count.0,
    }))
}

pub async fn mark_read(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<MarkReadResponse>> {
    let (user_uuid, org_uuid) = require_user_and_org(&user)?;

    // RETURNING read_at lets us tell the FE whether we actually flipped
    // a row (Some(...)) vs. the row was already read / didn't belong
    // to the caller (None). Idempotent on either case.
    let row: Option<(DateTime<Utc>,)> = sqlx::query_as(
        r#"
        UPDATE public.notifications
           SET read = true,
               read_at = NOW()
         WHERE id = $1
           AND user_id = $2
           AND organization_id = $3
           AND read = false
        RETURNING read_at
        "#,
    )
    .bind(id)
    .bind(user_uuid)
    .bind(org_uuid)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| {
        warn!(
            ?e,
            user_id = %user_uuid,
            org_id = %org_uuid,
            notification_id = %id,
            "notifications::mark_read: db error"
        );
        ApiError::Database(e)
    })?;

    match row {
        Some((read_at,)) => {
            metrics::WORK_NOTIFICATIONS_TOTAL
                .with_label_values(&["mark_read"])
                .inc();
            info!(
                user_id = %user_uuid,
                org_id = %org_uuid,
                notification_id = %id,
                "notifications::mark_read: flipped"
            );
            Ok(Json(MarkReadResponse {
                marked: true,
                read_at: Some(read_at),
            }))
        }
        None => {
            debug!(
                user_id = %user_uuid,
                org_id = %org_uuid,
                notification_id = %id,
                "notifications::mark_read: no-op (not found / already read)"
            );
            Ok(Json(MarkReadResponse {
                marked: false,
                read_at: None,
            }))
        }
    }
}

pub async fn mark_all_read(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
) -> ApiResult<Json<MarkAllReadResponse>> {
    let (user_uuid, org_uuid) = require_user_and_org(&user)?;

    // Bulk update + RETURNING so we know how many flipped without an
    // additional SELECT. Idempotent — already-read rows are excluded
    // by the WHERE clause.
    let updated: Vec<(Uuid,)> = sqlx::query_as(
        r#"
        UPDATE public.notifications
           SET read = true,
               read_at = NOW()
         WHERE user_id = $1
           AND organization_id = $2
           AND read = false
        RETURNING id
        "#,
    )
    .bind(user_uuid)
    .bind(org_uuid)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| {
        warn!(
            ?e,
            user_id = %user_uuid,
            org_id = %org_uuid,
            "notifications::mark_all_read: db error"
        );
        ApiError::Database(e)
    })?;

    let count = updated.len() as i64;
    metrics::WORK_NOTIFICATIONS_TOTAL
        .with_label_values(&["mark_all_read"])
        .inc();
    info!(
        user_id = %user_uuid,
        org_id = %org_uuid,
        count,
        "notifications::mark_all_read: bulk flipped"
    );

    Ok(Json(MarkAllReadResponse { count }))
}

/// Build the notifications router, mounted at `/api/v1/notifications`.
pub fn notifications_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list))
        .route("/:id/read", post(mark_read))
        .route("/read-all", post(mark_all_read))
}

// Created and developed by Jai Singh
