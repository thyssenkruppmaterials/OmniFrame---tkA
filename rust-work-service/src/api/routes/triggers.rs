// Created and developed by Jai Singh
//! Phase 9 — `agent_triggers` CRUD + dry-run / match-preview routes.
//!
//! Mounted under `/api/v1/triggers` behind `require_auth`. Six routes:
//!
//! - `GET    /`             — list every enabled+disabled trigger for the caller's org.
//! - `POST   /`             — create; validates source_table / target_endpoint
//!   allowlists + DSL filter syntax server-side. Admin-only via the
//!   `agent_triggers admin write` RLS policy (migration 281).
//! - `PATCH  /:id`          — update.
//! - `DELETE /:id`          — true delete (FK with `created_by ON DELETE SET NULL`).
//! - `POST   /preview`      — dry-run: parse a candidate filter + run it
//!   against an admin-supplied row. Pure function; no side effects.
//! - `GET    /allowlists`   — return the source-table + target-endpoint +
//!   grammar-version allowlists so the FE form can render dropdowns
//!   from the server's truth.
//!
//! All routes resolve `organization_id` from the JWT — never from the
//! body. RLS on `agent_triggers` belt-and-braces the route guard.

use axum::{
    extract::{Extension, Path, State},
    routing::{delete, get, patch, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::api::error::{ApiError, ApiResult};
use crate::auth::AuthenticatedUser;
use crate::triggers::config::{
    is_allowed_source_table, is_allowed_target_endpoint, ALLOWED_SOURCE_TABLES,
    ALLOWED_TARGET_ENDPOINTS, DSL_GRAMMAR_VERSION,
};
use crate::triggers::dsl::parse_filter;
use crate::AppState;

// ────────────────────────────────────────────────────────────────────
// Wire types
// ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct TriggerRow {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub enabled: bool,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub source_table: String,
    pub source_events: Vec<String>,
    pub match_filter: Value,
    pub target_endpoint: String,
    pub payload_template: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_success_patch: Option<Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_by: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTriggerRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub source_table: String,
    pub source_events: Vec<String>,
    #[serde(default)]
    pub match_filter: Value,
    pub target_endpoint: String,
    #[serde(default)]
    pub payload_template: Value,
    #[serde(default)]
    pub post_success_patch: Option<Value>,
}

fn default_enabled() -> bool {
    false
}

#[derive(Debug, Deserialize)]
pub struct UpdateTriggerRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub source_table: Option<String>,
    #[serde(default)]
    pub source_events: Option<Vec<String>>,
    #[serde(default)]
    pub match_filter: Option<Value>,
    #[serde(default)]
    pub target_endpoint: Option<String>,
    #[serde(default)]
    pub payload_template: Option<Value>,
    #[serde(default)]
    pub post_success_patch: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct PreviewRequest {
    pub match_filter: Value,
    pub row: Value,
}

#[derive(Debug, Serialize)]
pub struct PreviewResponse {
    pub matched: bool,
    pub error: Option<PreviewError>,
}

#[derive(Debug, Serialize)]
pub struct PreviewError {
    pub pointer: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct AllowlistsResponse {
    pub source_tables: &'static [&'static str],
    pub target_endpoints: &'static [&'static str],
    pub source_events: &'static [&'static str],
    pub grammar_version: &'static str,
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

fn require_org(user: &AuthenticatedUser) -> ApiResult<Uuid> {
    let org_id_str = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".into()))?;
    Uuid::parse_str(org_id_str)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".into()))
}

fn require_admin(user: &AuthenticatedUser) -> ApiResult<()> {
    match user.role.as_deref() {
        Some("admin") | Some("superadmin") | Some("service") => Ok(()),
        _ => Err(ApiError::Forbidden(
            "agent_triggers mutations require admin or superadmin role".into(),
        )),
    }
}

fn require_user_id(user: &AuthenticatedUser) -> ApiResult<Uuid> {
    Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user_id in JWT".into()))
}

fn validate_request_shape(
    name: &str,
    source_table: &str,
    source_events: &[String],
    target_endpoint: &str,
    match_filter: &Value,
) -> ApiResult<()> {
    if name.trim().is_empty() {
        return Err(ApiError::BadRequest("name must not be empty".into()));
    }
    if !is_allowed_source_table(source_table) {
        return Err(ApiError::BadRequest(format!(
            "source_table '{}' is not allowlisted (allowed: {:?})",
            source_table, ALLOWED_SOURCE_TABLES
        )));
    }
    if !is_allowed_target_endpoint(target_endpoint) {
        return Err(ApiError::BadRequest(format!(
            "target_endpoint '{}' is not allowlisted (allowed: {:?})",
            target_endpoint, ALLOWED_TARGET_ENDPOINTS
        )));
    }
    if source_events.is_empty() {
        return Err(ApiError::BadRequest(
            "source_events must contain at least one of INSERT|UPDATE|DELETE".into(),
        ));
    }
    for op in source_events {
        if !matches!(op.as_str(), "INSERT" | "UPDATE" | "DELETE") {
            return Err(ApiError::BadRequest(format!(
                "source_events contains invalid op '{}' (allowed: INSERT, UPDATE, DELETE)",
                op
            )));
        }
    }
    if let Err(e) = parse_filter(match_filter) {
        return Err(ApiError::BadRequest(format!(
            "match_filter rejected by DSL parser at {}: {}",
            e.pointer, e.message
        )));
    }
    Ok(())
}

// ────────────────────────────────────────────────────────────────────
// Handlers
// ────────────────────────────────────────────────────────────────────

pub async fn list_triggers(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
) -> ApiResult<Json<Vec<TriggerRow>>> {
    let org_id = require_org(&user)?;
    let rows = sqlx::query_as::<_, TriggerRowDb>(
        r#"
        SELECT
            id, organization_id, enabled, name, description,
            source_table, source_events, match_filter, target_endpoint,
            payload_template, post_success_patch,
            created_at, updated_at, created_by
        FROM public.agent_triggers
        WHERE organization_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(org_id)
    .fetch_all(&state.db_pool)
    .await
    .map_err(ApiError::Database)?;

    let out: Vec<TriggerRow> = rows.into_iter().map(Into::into).collect();
    Ok(Json(out))
}

pub async fn create_trigger(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Json(req): Json<CreateTriggerRequest>,
) -> ApiResult<Json<TriggerRow>> {
    require_admin(&user)?;
    let org_id = require_org(&user)?;
    let user_id = require_user_id(&user)?;

    validate_request_shape(
        &req.name,
        &req.source_table,
        &req.source_events,
        &req.target_endpoint,
        &req.match_filter,
    )?;

    let inserted: TriggerRowDb = sqlx::query_as::<_, TriggerRowDb>(
        r#"
        INSERT INTO public.agent_triggers (
            organization_id, enabled, name, description,
            source_table, source_events, match_filter,
            target_endpoint, payload_template, post_success_patch,
            created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING
            id, organization_id, enabled, name, description,
            source_table, source_events, match_filter, target_endpoint,
            payload_template, post_success_patch,
            created_at, updated_at, created_by
        "#,
    )
    .bind(org_id)
    .bind(req.enabled)
    .bind(&req.name)
    .bind(&req.description)
    .bind(&req.source_table)
    .bind(&req.source_events)
    .bind(&req.match_filter)
    .bind(&req.target_endpoint)
    .bind(&req.payload_template)
    .bind(&req.post_success_patch)
    .bind(user_id)
    .fetch_one(&state.db_pool)
    .await
    .map_err(ApiError::Database)?;

    info!(
        trigger_id = %inserted.id,
        org_id = %org_id,
        name = %inserted.name,
        "agent_triggers: created"
    );
    Ok(Json(inserted.into()))
}

pub async fn update_trigger(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateTriggerRequest>,
) -> ApiResult<Json<TriggerRow>> {
    require_admin(&user)?;
    let org_id = require_org(&user)?;

    // Read-modify-write so we can validate the merged shape against
    // the DSL parser BEFORE issuing the UPDATE. RLS on the SELECT
    // means cross-org rows aren't visible.
    let existing: TriggerRowDb = sqlx::query_as::<_, TriggerRowDb>(
        r#"
        SELECT
            id, organization_id, enabled, name, description,
            source_table, source_events, match_filter, target_endpoint,
            payload_template, post_success_patch,
            created_at, updated_at, created_by
        FROM public.agent_triggers
        WHERE id = $1 AND organization_id = $2
        "#,
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(ApiError::Database)?
    .ok_or_else(|| ApiError::NotFound(format!("agent_triggers/{}", id)))?;

    let merged_name = req.name.clone().unwrap_or(existing.name.clone());
    let merged_source_table = req
        .source_table
        .clone()
        .unwrap_or(existing.source_table.clone());
    let merged_source_events = req
        .source_events
        .clone()
        .unwrap_or(existing.source_events.clone());
    let merged_target_endpoint = req
        .target_endpoint
        .clone()
        .unwrap_or(existing.target_endpoint.clone());
    let merged_match_filter = req
        .match_filter
        .clone()
        .unwrap_or(existing.match_filter.clone());

    validate_request_shape(
        &merged_name,
        &merged_source_table,
        &merged_source_events,
        &merged_target_endpoint,
        &merged_match_filter,
    )?;

    let merged_description = req
        .description
        .clone()
        .or_else(|| existing.description.clone());
    let merged_enabled = req.enabled.unwrap_or(existing.enabled);
    let merged_payload_template = req
        .payload_template
        .clone()
        .unwrap_or(existing.payload_template.clone());
    let merged_post_success_patch = req
        .post_success_patch
        .clone()
        .or_else(|| existing.post_success_patch.clone());

    let updated: TriggerRowDb = sqlx::query_as::<_, TriggerRowDb>(
        r#"
        UPDATE public.agent_triggers SET
            enabled            = $1,
            name               = $2,
            description        = $3,
            source_table       = $4,
            source_events      = $5,
            match_filter       = $6,
            target_endpoint    = $7,
            payload_template   = $8,
            post_success_patch = $9
        WHERE id = $10 AND organization_id = $11
        RETURNING
            id, organization_id, enabled, name, description,
            source_table, source_events, match_filter, target_endpoint,
            payload_template, post_success_patch,
            created_at, updated_at, created_by
        "#,
    )
    .bind(merged_enabled)
    .bind(&merged_name)
    .bind(&merged_description)
    .bind(&merged_source_table)
    .bind(&merged_source_events)
    .bind(&merged_match_filter)
    .bind(&merged_target_endpoint)
    .bind(&merged_payload_template)
    .bind(&merged_post_success_patch)
    .bind(id)
    .bind(org_id)
    .fetch_one(&state.db_pool)
    .await
    .map_err(ApiError::Database)?;

    info!(trigger_id = %id, org_id = %org_id, "agent_triggers: updated");
    Ok(Json(updated.into()))
}

pub async fn delete_trigger(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    require_admin(&user)?;
    let org_id = require_org(&user)?;
    let result = sqlx::query(
        "DELETE FROM public.agent_triggers WHERE id = $1 AND organization_id = $2",
    )
    .bind(id)
    .bind(org_id)
    .execute(&state.db_pool)
    .await
    .map_err(ApiError::Database)?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound(format!("agent_triggers/{}", id)));
    }
    info!(trigger_id = %id, org_id = %org_id, "agent_triggers: deleted");
    Ok(Json(serde_json::json!({ "ok": true, "deleted_id": id })))
}

pub async fn preview_match(
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Json(req): Json<PreviewRequest>,
) -> ApiResult<Json<PreviewResponse>> {
    // Admin-only — preview reveals whether a row matches a candidate
    // filter, which is admin-tier authoring functionality.
    require_admin(&user)?;
    debug!(
        user = %user.user_id,
        "agent_triggers: preview match"
    );
    match parse_filter(&req.match_filter) {
        Ok(filter) => {
            let matched = filter.eval(&req.row);
            Ok(Json(PreviewResponse {
                matched,
                error: None,
            }))
        }
        Err(e) => {
            warn!(pointer = %e.pointer, message = %e.message, "agent_triggers: preview parse failed");
            Ok(Json(PreviewResponse {
                matched: false,
                error: Some(PreviewError {
                    pointer: e.pointer,
                    message: e.message,
                }),
            }))
        }
    }
}

pub async fn allowlists(
    Extension(_user): Extension<Arc<AuthenticatedUser>>,
) -> Json<AllowlistsResponse> {
    // Public to authenticated callers — admins and operators alike
    // may want to see what tables / endpoints are permitted (e.g.
    // for the read-only preview pane). Doesn't leak anything not
    // already inferable from running the service.
    Json(AllowlistsResponse {
        source_tables: ALLOWED_SOURCE_TABLES,
        target_endpoints: ALLOWED_TARGET_ENDPOINTS,
        source_events: &["INSERT", "UPDATE", "DELETE"],
        grammar_version: DSL_GRAMMAR_VERSION,
    })
}

// ────────────────────────────────────────────────────────────────────
// sqlx mapper
// ────────────────────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct TriggerRowDb {
    id: Uuid,
    organization_id: Uuid,
    enabled: bool,
    name: String,
    description: Option<String>,
    source_table: String,
    source_events: Vec<String>,
    match_filter: Value,
    target_endpoint: String,
    payload_template: Value,
    post_success_patch: Option<Value>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    created_by: Option<Uuid>,
}

impl From<TriggerRowDb> for TriggerRow {
    fn from(d: TriggerRowDb) -> Self {
        TriggerRow {
            id: d.id,
            organization_id: d.organization_id,
            enabled: d.enabled,
            name: d.name,
            description: d.description,
            source_table: d.source_table,
            source_events: d.source_events,
            match_filter: d.match_filter,
            target_endpoint: d.target_endpoint,
            payload_template: d.payload_template,
            post_success_patch: d.post_success_patch,
            created_at: d.created_at,
            updated_at: d.updated_at,
            created_by: d.created_by,
        }
    }
}

// ────────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────────

pub fn triggers_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_triggers).post(create_trigger))
        .route("/preview", post(preview_match))
        .route("/allowlists", get(allowlists))
        .route("/:id", patch(update_trigger).delete(delete_trigger))
        // Allow PATCH and DELETE to coexist on `/:id`.
        .route("/:id/", patch(update_trigger))
        .route("/:id/", delete(delete_trigger))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn s(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn validate_rejects_disallowed_source_table() {
        let err = validate_request_shape(
            "Test",
            "user_profiles",
            &s(&["INSERT"]),
            "/sap/confirm-to",
            &json!({}),
        )
        .unwrap_err();
        match err {
            ApiError::BadRequest(msg) => assert!(msg.contains("source_table")),
            _ => panic!("expected BadRequest"),
        }
    }

    #[test]
    fn validate_rejects_disallowed_target_endpoint() {
        let err = validate_request_shape(
            "Test",
            "rf_putaway_operations",
            &s(&["INSERT"]),
            "/sap/connect",
            &json!({}),
        )
        .unwrap_err();
        match err {
            ApiError::BadRequest(msg) => assert!(msg.contains("target_endpoint")),
            _ => panic!("expected BadRequest"),
        }
    }

    #[test]
    fn validate_rejects_empty_source_events() {
        let err = validate_request_shape(
            "Test",
            "rf_putaway_operations",
            &[],
            "/sap/confirm-to",
            &json!({}),
        )
        .unwrap_err();
        match err {
            ApiError::BadRequest(msg) => assert!(msg.contains("source_events")),
            _ => panic!("expected BadRequest"),
        }
    }

    #[test]
    fn validate_rejects_invalid_op() {
        let err = validate_request_shape(
            "Test",
            "rf_putaway_operations",
            &s(&["TRUNCATE"]),
            "/sap/confirm-to",
            &json!({}),
        )
        .unwrap_err();
        match err {
            ApiError::BadRequest(msg) => assert!(msg.contains("invalid op")),
            _ => panic!("expected BadRequest"),
        }
    }

    #[test]
    fn validate_rejects_malformed_match_filter() {
        let err = validate_request_shape(
            "Test",
            "rf_putaway_operations",
            &s(&["INSERT"]),
            "/sap/confirm-to",
            &json!({"shell_exec": {"cmd": "rm -rf /"}}),
        )
        .unwrap_err();
        match err {
            ApiError::BadRequest(msg) => assert!(msg.contains("DSL parser")),
            _ => panic!("expected BadRequest"),
        }
    }

    #[test]
    fn validate_accepts_valid_request() {
        validate_request_shape(
            "Auto-Confirm",
            "rf_putaway_operations",
            &s(&["INSERT", "UPDATE"]),
            "/sap/confirm-to",
            &json!({"all": [{"eq": {"field": "to_status", "value": "Completed"}}]}),
        )
        .expect("valid request");
    }
}

// Created and developed by Jai Singh
