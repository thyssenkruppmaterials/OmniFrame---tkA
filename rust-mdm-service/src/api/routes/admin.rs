use axum::{
    extract::{Path, Query, Request, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::state::AppState;

fn get_user(request: &Request) -> Option<&AuthenticatedUser> {
    request.extensions().get::<AuthenticatedUser>()
}

fn get_org_id(request: &Request) -> Result<String, (StatusCode, Json<serde_json::Value>)> {
    let user = request.extensions().get::<AuthenticatedUser>()
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Not authenticated"}))))?;
    user.organization_id.clone()
        .ok_or_else(|| (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "No organization context"}))))
}

#[derive(Debug, Deserialize)]
pub struct DeviceListQuery {
    pub page: Option<i64>,
    pub per_page: Option<i64>,
    pub status: Option<String>,
    pub group_id: Option<Uuid>,
    pub search: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DeviceListResponse {
    pub devices: Vec<serde_json::Value>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
}

pub async fn list_devices(
    State(state): State<Arc<AppState>>,
    request: Request,
) -> Result<Json<DeviceListResponse>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = get_org_id(&request)?;
    let query: DeviceListQuery = Query::try_from_uri(request.uri())
        .map(|q| q.0)
        .unwrap_or(DeviceListQuery { page: None, per_page: None, status: None, group_id: None, search: None });

    let page = query.page.unwrap_or(1).max(1);
    let per_page = query.per_page.unwrap_or(25).clamp(1, 100);
    let offset = (page - 1) * per_page;

    let mut sql = String::from("SELECT row_to_json(d) FROM mdm_devices d WHERE d.organization_id = $1::uuid");
    let mut count_sql = String::from("SELECT COUNT(*) FROM mdm_devices WHERE organization_id = $1::uuid");

    if let Some(ref status) = query.status {
        let cond = format!(" AND d.status = '{}'", status.replace('\'', "''"));
        sql.push_str(&cond);
        count_sql.push_str(&cond.replace("d.", ""));
    }
    if let Some(ref search) = query.search {
        let escaped = search.replace('\'', "''");
        let cond = format!(
            " AND (d.device_name ILIKE '%{}%' OR d.serial_number ILIKE '%{}%' OR d.model ILIKE '%{}%')",
            escaped, escaped, escaped
        );
        sql.push_str(&cond);
        count_sql.push_str(&cond.replace("d.", ""));
    }

    sql.push_str(&format!(" ORDER BY d.created_at DESC LIMIT {} OFFSET {}", per_page, offset));

    let devices = sqlx::query_as::<_, (serde_json::Value,)>(&sql)
        .bind(&org_id)
        .fetch_all(&state.db_pool)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to list devices");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Database error"})))
        })?;

    let total: (i64,) = sqlx::query_as(&count_sql)
        .bind(&org_id)
        .fetch_one(&state.db_pool)
        .await
        .unwrap_or((0,));

    Ok(Json(DeviceListResponse {
        devices: devices.into_iter().map(|d| d.0).collect(),
        total: total.0,
        page,
        per_page,
    }))
}

pub async fn get_device(
    State(state): State<Arc<AppState>>,
    Path(device_id): Path<Uuid>,
    request: Request,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = get_org_id(&request)?;

    let device = sqlx::query_as::<_, (serde_json::Value,)>(
        "SELECT row_to_json(d) FROM mdm_devices d WHERE d.id = $1 AND d.organization_id = $2::uuid"
    )
    .bind(device_id)
    .bind(&org_id)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to get device");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Database error"})))
    })?;

    match device {
        Some(d) => Ok(Json(d.0)),
        None => Err((StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Device not found"})))),
    }
}

#[derive(Debug, Deserialize)]
pub struct QueueCommandRequest {
    pub command_type: String,
    pub payload: Option<serde_json::Value>,
    pub priority: Option<i32>,
    pub scheduled_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub async fn queue_command(
    State(state): State<Arc<AppState>>,
    Path(device_id): Path<Uuid>,
    request: Request,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = get_org_id(&request)?;
    let user = get_user(&request).cloned();

    let body_bytes = axum::body::to_bytes(request.into_body(), 1024 * 64).await
        .map_err(|_| (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Invalid body"}))))?;
    let cmd_req: QueueCommandRequest = serde_json::from_slice(&body_bytes)
        .map_err(|_| (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Invalid JSON"}))))?;

    let device_org: Option<(String,)> = sqlx::query_as(
        "SELECT organization_id::text FROM mdm_devices WHERE id = $1"
    )
    .bind(device_id)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to verify device");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Database error"})))
    })?;

    match &device_org {
        Some((dev_org,)) if dev_org == &org_id => {},
        Some(_) => return Err((StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "Device not in your organization"})))),
        None => return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Device not found"})))),
    }

    let command_uuid = Uuid::new_v4();
    let correlation_id = Uuid::new_v4();
    let priority = cmd_req.priority.unwrap_or(5);

    let command_id: (Uuid,) = sqlx::query_as(
        "INSERT INTO mdm_commands (organization_id, device_id, command_uuid, command_type, payload, priority, scheduled_at, status, correlation_id)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'Queued', $8)
         RETURNING id"
    )
    .bind(&org_id)
    .bind(device_id)
    .bind(command_uuid)
    .bind(&cmd_req.command_type)
    .bind(&cmd_req.payload)
    .bind(priority)
    .bind(cmd_req.scheduled_at)
    .bind(correlation_id)
    .fetch_one(&state.db_pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to queue command");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Failed to queue command"})))
    })?;

    write_command_event(
        &state.db_pool, command_id.0, "queued", None, Some("Queued"),
        user.as_ref().map(|u| u.user_id.as_str()), "user", correlation_id,
    ).await;

    crate::metrics::record_command_queued(&cmd_req.command_type);

    Ok(Json(serde_json::json!({
        "id": command_id.0,
        "command_uuid": command_uuid,
        "device_id": device_id,
        "command_type": cmd_req.command_type,
        "status": "Queued",
        "correlation_id": correlation_id,
    })))
}

pub async fn list_commands(
    State(state): State<Arc<AppState>>,
    request: Request,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = get_org_id(&request)?;
    let query: DeviceListQuery = Query::try_from_uri(request.uri())
        .map(|q| q.0)
        .unwrap_or(DeviceListQuery { page: None, per_page: None, status: None, group_id: None, search: None });

    let page = query.page.unwrap_or(1).max(1);
    let per_page = query.per_page.unwrap_or(25).clamp(1, 100);
    let offset = (page - 1) * per_page;

    let commands = sqlx::query_as::<_, (serde_json::Value,)>(
        "SELECT row_to_json(c) FROM mdm_commands c WHERE c.organization_id = $1::uuid ORDER BY c.created_at DESC LIMIT $2 OFFSET $3"
    )
    .bind(&org_id)
    .bind(per_page)
    .bind(offset)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to list commands");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Database error"})))
    })?;

    Ok(Json(serde_json::json!({
        "commands": commands.into_iter().map(|c| c.0).collect::<Vec<_>>(),
        "page": page,
        "per_page": per_page,
    })))
}

pub async fn write_command_event(
    pool: &sqlx::PgPool,
    command_id: Uuid,
    event_type: &str,
    previous_status: Option<&str>,
    new_status: Option<&str>,
    actor_id: Option<&str>,
    actor_type: &str,
    correlation_id: Uuid,
) {
    let result = sqlx::query(
        "INSERT INTO mdm_command_events (command_id, event_type, previous_status, new_status, actor_id, actor_type, correlation_id)
         VALUES ($1, $2, $3, $4, $5::uuid, $6, $7)"
    )
    .bind(command_id)
    .bind(event_type)
    .bind(previous_status)
    .bind(new_status)
    .bind(actor_id)
    .bind(actor_type)
    .bind(correlation_id)
    .execute(pool)
    .await;

    if let Err(e) = result {
        tracing::warn!(error = %e, command_id = %command_id, "Failed to write command event");
    }
}
