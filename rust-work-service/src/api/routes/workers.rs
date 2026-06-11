// Created and developed by Jai Singh
//! Worker management API endpoints
//!
//! Handles worker status tracking and heartbeats for workforce management.

use axum::{
    extract::{Extension, Path, State},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;

use crate::api::error::{ApiError, ApiResult};
use crate::auth::AuthenticatedUser;
use crate::db::{self, CycleCountTask, HeartbeatRequest, HeartbeatResponse, WorkerStatus};
use crate::AppState;

/// Get active workers in the organization
pub async fn get_workers(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
) -> ApiResult<Json<Vec<WorkerStatus>>> {
    let org_id = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;

    let org_uuid = Uuid::parse_str(org_id)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    let workers = db::get_active_workers(&state.db_pool, org_uuid).await?;

    info!(
        user_id = %user.user_id,
        org_id = %org_id,
        worker_count = workers.len(),
        "Retrieved active workers"
    );

    Ok(Json(workers))
}

/// Get tasks assigned to a specific worker
pub async fn get_worker_tasks(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Path(worker_id): Path<Uuid>,
) -> ApiResult<Json<Vec<CycleCountTask>>> {
    let org_id = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;
    // Verify user has permission (either viewing their own tasks or has supervisor role)
    let user_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;
    let org_uuid = Uuid::parse_str(org_id)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    // For now, allow viewing own tasks or if user has manager/admin permissions
    let is_own_tasks = worker_id == user_uuid;
    let has_supervisor_access = user
        .permissions
        .iter()
        .any(|p| p == "*" || p.contains("manage") || p.contains("supervisor"));

    if !is_own_tasks && !has_supervisor_access {
        return Err(ApiError::Forbidden(
            "Cannot view other workers' tasks without supervisor access".to_string(),
        ));
    }

    let tasks = db::get_worker_tasks(&state.db_pool, worker_id, org_uuid).await?;

    info!(
        requesting_user = %user.user_id,
        worker_id = %worker_id,
        task_count = tasks.len(),
        "Retrieved worker tasks"
    );

    Ok(Json(tasks))
}

/// Send heartbeat to update worker status
pub async fn send_heartbeat(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Json(request): Json<HeartbeatRequest>,
) -> ApiResult<Json<HeartbeatResponse>> {
    let org_id = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;

    let user_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;
    let org_uuid = Uuid::parse_str(org_id)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    let status = request.status.unwrap_or_else(|| "online".to_string());

    // Validate status value
    let valid_statuses = ["online", "offline", "busy", "break", "idle"];
    if !valid_statuses.contains(&status.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "Invalid status '{}'. Must be one of: {}",
            status,
            valid_statuses.join(", ")
        )));
    }

    // Defense in depth: if the client passes a full location in the zone
    // field (e.g. "K1-60-02-2" instead of "K1"), collapse it to the first
    // dash-separated segment. Also auto-derive zone from location when
    // client omits it.
    let normalized_zone = match (&request.zone, &request.location) {
        (Some(z), _) if z.contains('-') => z
            .split('-')
            .next()
            .filter(|s| !s.is_empty())
            .map(String::from),
        (Some(z), _) => Some(z.clone()),
        (None, Some(loc)) => loc
            .split('-')
            .next()
            .filter(|s| !s.is_empty() && *s != "<<empty>>")
            .map(String::from),
        (None, None) => None,
    };

    db::upsert_heartbeat(
        &state.db_pool,
        user_uuid,
        org_uuid,
        request.task_id,
        request.task_type,
        normalized_zone,
        request.location,
        status,
    )
    .await?;

    let now = Utc::now();

    info!(
        user_id = %user.user_id,
        org_id = %org_id,
        "Worker heartbeat updated"
    );

    Ok(Json(HeartbeatResponse {
        success: true,
        message: "Heartbeat updated".to_string(),
        timestamp: now,
    }))
}

/// Create the workers routes router
pub fn workers_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(get_workers))
        .route("/:id/tasks", get(get_worker_tasks))
        .route("/heartbeat", post(send_heartbeat))
}

// Created and developed by Jai Singh
