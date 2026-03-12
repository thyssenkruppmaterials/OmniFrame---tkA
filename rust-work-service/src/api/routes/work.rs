//! Work queue API endpoints
//!
//! Handles work queue operations for cycle counts including:
//! - Viewing the queue
//! - Claiming tasks
//! - Pushing tasks to users
//! - Starting, completing, and releasing tasks
//!
//! All task state changes broadcast WsEvent messages for real-time updates.

use axum::{
    extract::{Extension, Path, State},
    routing::{get, post},
    Json, Router,
};
use std::sync::Arc;
use tracing::{info, warn};
use uuid::Uuid;

use crate::api::error::{ApiError, ApiResult};
use crate::auth::AuthenticatedUser;
use crate::db::{
    self, ClaimTaskResponse, CompleteCycleCountRequest, CycleCountTask, PushCycleCountRequest,
    QueueStats, TaskOperationResponse,
};
use crate::websocket::WsEvent;
use crate::AppState;

/// Get pending cycle counts in the queue
pub async fn get_queue(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> ApiResult<Json<Vec<CycleCountTask>>> {
    let org_id = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;

    let org_uuid = Uuid::parse_str(org_id)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    let tasks = db::get_pending_cycle_counts(&state.db_pool, org_uuid).await?;

    info!(
        user_id = %user.user_id,
        org_id = %org_id,
        task_count = tasks.len(),
        "Retrieved work queue"
    );

    Ok(Json(tasks))
}

/// Get queue statistics
pub async fn get_stats(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> ApiResult<Json<QueueStats>> {
    let org_id = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;

    let org_uuid = Uuid::parse_str(org_id)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    let stats = db::get_queue_stats(&state.db_pool, org_uuid).await?;

    info!(
        user_id = %user.user_id,
        org_id = %org_id,
        pending = stats.pending,
        in_progress = stats.in_progress,
        "Retrieved queue stats"
    );

    Ok(Json(stats))
}

/// Claim the next available cycle count
pub async fn claim_next(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> ApiResult<Json<ClaimTaskResponse>> {
    let org_id = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;

    let user_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;
    let org_uuid = Uuid::parse_str(org_id)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    let task = db::claim_next_cycle_count(&state.db_pool, user_uuid, org_uuid).await?;

    let response = match task {
        Some(ref t) => {
            info!(
                user_id = %user.user_id,
                count_id = %t.id,
                count_number = %t.count_number,
                "User claimed cycle count"
            );

            // Broadcast TaskAssigned event
            let _ = state.ws_broadcast.send(WsEvent::TaskAssigned {
                task_id: t.id,
                user_id: user_uuid,
                priority: t.priority.clone(),
                location: t.location.clone(),
                material: t.material_number.clone(),
            });

            // Broadcast status change (pending -> assigned/in_progress)
            let _ = state.ws_broadcast.send(WsEvent::TaskStatusChanged {
                task_id: t.id,
                old_status: "pending".to_string(),
                new_status: t.status.clone(),
            });

            ClaimTaskResponse {
                success: true,
                message: format!("Claimed cycle count {}", t.count_number),
                task: task,
            }
        }
        None => {
            info!(user_id = %user.user_id, "No pending cycle counts available");
            ClaimTaskResponse {
                success: false,
                message: "No pending cycle counts available".to_string(),
                task: None,
            }
        }
    };

    Ok(Json(response))
}

/// Push a cycle count to a specific user
pub async fn push_to_user(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(request): Json<PushCycleCountRequest>,
) -> ApiResult<Json<ClaimTaskResponse>> {
    let pusher_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;

    let task =
        db::push_cycle_count(&state.db_pool, request.count_id, request.user_id, pusher_uuid)
            .await?;

    let response = match task {
        Some(ref t) => {
            info!(
                pusher_id = %user.user_id,
                target_user_id = %request.user_id,
                count_id = %t.id,
                count_number = %t.count_number,
                "Pushed cycle count to user"
            );

            // Broadcast PushedWork event for real-time notification
            let _ = state.ws_broadcast.send(WsEvent::PushedWork {
                task_id: t.id,
                user_id: request.user_id,
                material: t.material_number.clone(),
                location: t.location.clone(),
                count_number: t.count_number.clone(),
                priority: t.priority.clone(),
            });

            // Also broadcast status change
            let _ = state.ws_broadcast.send(WsEvent::TaskAssigned {
                task_id: t.id,
                user_id: request.user_id,
                priority: t.priority.clone(),
                location: t.location.clone(),
                material: t.material_number.clone(),
            });

            ClaimTaskResponse {
                success: true,
                message: format!("Pushed cycle count {} to user", t.count_number),
                task: task,
            }
        }
        None => {
            warn!(
                pusher_id = %user.user_id,
                count_id = %request.count_id,
                "Failed to push cycle count - not found or not available"
            );
            ClaimTaskResponse {
                success: false,
                message: "Cycle count not found or not available for pushing".to_string(),
                task: None,
            }
        }
    };

    Ok(Json(response))
}

/// Start a cycle count task (mark as in_progress)
pub async fn start_task(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(task_id): Path<Uuid>,
) -> ApiResult<Json<TaskOperationResponse>> {
    let user_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;

    let success = db::start_cycle_count(&state.db_pool, task_id, user_uuid).await?;

    let response = if success {
        info!(
            user_id = %user.user_id,
            task_id = %task_id,
            "Started cycle count"
        );

        // Broadcast status change
        let _ = state.ws_broadcast.send(WsEvent::TaskStatusChanged {
            task_id,
            old_status: "pending".to_string(),
            new_status: "in_progress".to_string(),
        });

        TaskOperationResponse {
            success: true,
            message: "Cycle count started".to_string(),
        }
    } else {
        warn!(
            user_id = %user.user_id,
            task_id = %task_id,
            "Failed to start cycle count"
        );
        TaskOperationResponse {
            success: false,
            message: "Cycle count not found, not assigned to you, or not in pending status"
                .to_string(),
        }
    };

    Ok(Json(response))
}

/// Complete a cycle count task
pub async fn complete_task(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(task_id): Path<Uuid>,
    Json(request): Json<CompleteCycleCountRequest>,
) -> ApiResult<Json<TaskOperationResponse>> {
    let user_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;

    let success = db::complete_cycle_count(
        &state.db_pool,
        task_id,
        user_uuid,
        request.counted_quantity,
        request.notes,
    )
    .await?;

    let response = if success {
        info!(
            user_id = %user.user_id,
            task_id = %task_id,
            counted_quantity = request.counted_quantity,
            "Completed cycle count"
        );

        // Broadcast status change
        let _ = state.ws_broadcast.send(WsEvent::TaskStatusChanged {
            task_id,
            old_status: "in_progress".to_string(),
            new_status: "completed".to_string(),
        });

        TaskOperationResponse {
            success: true,
            message: "Cycle count completed".to_string(),
        }
    } else {
        warn!(
            user_id = %user.user_id,
            task_id = %task_id,
            "Failed to complete cycle count"
        );
        TaskOperationResponse {
            success: false,
            message: "Cycle count not found, not assigned to you, or not in progress".to_string(),
        }
    };

    Ok(Json(response))
}

/// Release a cycle count back to the queue
pub async fn release_task(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(task_id): Path<Uuid>,
) -> ApiResult<Json<TaskOperationResponse>> {
    let success = db::release_cycle_count(&state.db_pool, task_id).await?;

    let response = if success {
        info!(
            user_id = %user.user_id,
            task_id = %task_id,
            "Released cycle count back to queue"
        );

        // Broadcast status change
        let _ = state.ws_broadcast.send(WsEvent::TaskStatusChanged {
            task_id,
            old_status: "in_progress".to_string(),
            new_status: "pending".to_string(),
        });

        TaskOperationResponse {
            success: true,
            message: "Cycle count released back to queue".to_string(),
        }
    } else {
        warn!(
            user_id = %user.user_id,
            task_id = %task_id,
            "Failed to release cycle count"
        );
        TaskOperationResponse {
            success: false,
            message: "Cycle count not found or already completed".to_string(),
        }
    };

    Ok(Json(response))
}

/// Get a single task by ID
pub async fn get_task(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(task_id): Path<Uuid>,
) -> ApiResult<Json<CycleCountTask>> {
    let org_id = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;

    let org_uuid = Uuid::parse_str(org_id)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    let task = db::get_cycle_count_by_id(&state.db_pool, task_id, org_uuid).await?;

    match task {
        Some(t) => {
            info!(
                user_id = %user.user_id,
                task_id = %task_id,
                "Retrieved task"
            );
            Ok(Json(t))
        }
        None => {
            warn!(
                user_id = %user.user_id,
                task_id = %task_id,
                "Task not found"
            );
            Err(ApiError::NotFound(format!("Task {} not found", task_id)))
        }
    }
}

/// Acknowledge a pushed cycle count
pub async fn acknowledge_push(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(task_id): Path<Uuid>,
) -> ApiResult<Json<TaskOperationResponse>> {
    let user_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;

    let success = db::acknowledge_pushed_count(&state.db_pool, task_id, user_uuid).await?;

    let response = if success {
        info!(
            user_id = %user.user_id,
            task_id = %task_id,
            "Acknowledged pushed cycle count"
        );
        TaskOperationResponse {
            success: true,
            message: "Push acknowledged".to_string(),
        }
    } else {
        warn!(
            user_id = %user.user_id,
            task_id = %task_id,
            "Failed to acknowledge push"
        );
        TaskOperationResponse {
            success: false,
            message: "Pushed count not found, not assigned to you, or already acknowledged"
                .to_string(),
        }
    };

    Ok(Json(response))
}

/// Create the work routes router
pub fn work_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/queue", get(get_queue))
        .route("/queue/stats", get(get_stats))
        .route("/claim", post(claim_next))
        .route("/push", post(push_to_user))
        .route("/tasks/:id", get(get_task))
        .route("/tasks/:id/start", post(start_task))
        .route("/tasks/:id/complete", post(complete_task))
        .route("/tasks/:id/release", post(release_task))
        .route("/tasks/:id/acknowledge", post(acknowledge_push))
}
