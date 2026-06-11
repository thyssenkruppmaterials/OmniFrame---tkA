// Created and developed by Jai Singh
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
use sqlx::Acquire;
use std::sync::Arc;
use tracing::{info, warn};
use uuid::Uuid;

use crate::api::error::{ApiError, ApiResult};
use crate::auth::AuthenticatedUser;
use crate::db::{
    self, ClaimCapacity, ClaimTaskResponse, CompleteCycleCountRequest, CycleCountTask,
    PushCycleCountRequest, QueueStats, SkipTaskRequest, TaskOperationResponse,
};
use crate::observability::metrics;
use crate::websocket::WsEvent;
use crate::AppState;

/// Get pending cycle counts in the queue.
///
/// Per-operator: the result excludes counts THIS operator has actively
/// deferred (mirrors `claim_next_cycle_count` Phase 2). Counts deferred
/// by OTHER operators stay visible — they're in those operators'
/// personal skip-lists, not a global block-list.
pub async fn get_queue(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
) -> ApiResult<Json<Vec<CycleCountTask>>> {
    let org_id = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;

    let user_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;
    let org_uuid = Uuid::parse_str(org_id)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    // Pure SELECT candidate scan — route to the read replica. The claim
    // path that subsequently locks/updates each row still hits the primary
    // via `state.db_pool`, so a 50-100 ms replication lag at worst produces
    // a stale candidate list whose stale entries get rejected by the
    // row-lock + status re-check inside `claim_next_cycle_count`.
    let tasks = db::get_pending_cycle_counts(&state.read_pool, org_uuid, user_uuid).await?;

    info!(
        user_id = %user.user_id,
        org_id = %org_id,
        task_count = tasks.len(),
        "Retrieved work queue"
    );

    Ok(Json(tasks))
}

/// Get queue statistics.
///
/// Per-operator: the `pending` count excludes counts THIS operator has
/// actively deferred so the dashboard number matches what they'd
/// actually claim. `deferred_pending` stays org-global as an
/// admin/observability signal.
pub async fn get_stats(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
) -> ApiResult<Json<QueueStats>> {
    let org_id = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;

    let user_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;
    let org_uuid = Uuid::parse_str(org_id)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    // Pure aggregation — route to the read replica.
    let stats = db::get_queue_stats(&state.read_pool, org_uuid, user_uuid).await?;

    info!(
        user_id = %user.user_id,
        org_id = %org_id,
        pending = stats.pending,
        in_progress = stats.in_progress,
        "Retrieved queue stats"
    );

    Ok(Json(stats))
}

/// Optional request body for `POST /api/v1/work/claim`. Both fields default
/// when missing so legacy clients (no body) keep working with cycle_count
/// + server-managed capacity.
#[derive(Debug, Default, Clone, serde::Deserialize)]
#[serde(default)]
pub struct ClaimNextRequest {
    /// `cycle_count` (default), `zone_audit`, `pick`, …
    pub task_type: Option<String>,
    /// Optional client-supplied capacity hint. Server clamps to the
    /// per-worker total cap and per-type cap regardless.
    pub capacity: Option<u32>,
}

/// Claim the next available task for `task_type` via the generic
/// `DispatchStrategyRegistry` (Item 12 — plan §2.1 + §2.5 + §2.6).
///
/// For `task_type='cycle_count'` (default) the dispatcher delegates to
/// the existing `claim_next_cycle_count` SQL path verbatim, preserving
/// all 18 invariants from §2.1. The strategy's `filter_candidate` runs
/// AFTER the SQL ranker as a late filter (never as a replacement).
///
/// For other task types, the dispatcher composes the strategy's
/// `static_sql()` against `work_tasks` filtered to the type — these
/// paths are stubs today and may return `None` until follow-on plans
/// (Picking, Zoning) wire the full ranker.
pub async fn claim_next(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    body: Option<Json<ClaimNextRequest>>,
) -> ApiResult<Json<ClaimTaskResponse>> {
    let org_id = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;

    let user_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;
    let org_uuid = Uuid::parse_str(org_id)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    let req = body.map(|Json(b)| b).unwrap_or_default();
    let task_type = req
        .task_type
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("cycle_count");

    let strategy = state.strategy_registry.get(task_type).ok_or_else(|| {
        ApiError::BadRequest(format!("Unknown task_type '{}'", task_type))
    })?;

    let settings = state
        .settings_cache
        .resolved(&state.db_pool, org_uuid, task_type)
        .await;

    let capacity = ClaimCapacity {
        requested_capacity: req.capacity,
    };

    // Item 14 — wrap the DB ranker in a histogram timer. Strategy
    // resolution above already happened; we time the SQL path because
    // that's the dominant cost.
    let timer_started = std::time::Instant::now();
    let task_result = db::claim_next_task(
        &state.db_pool,
        org_uuid,
        user_uuid,
        task_type,
        strategy,
        settings,
        capacity,
    )
    .await;
    let elapsed = timer_started.elapsed().as_secs_f64();

    let task = match task_result {
        Ok(t) => {
            let outcome = if t.is_some() { "hit" } else { "miss" };
            metrics::WORK_CLAIM_DURATION
                .with_label_values(&[task_type, "ranker", outcome])
                .observe(elapsed);
            let priority_label = t
                .as_ref()
                .map(|task| task.priority.as_str())
                .unwrap_or("none");
            metrics::WORK_CLAIM_TOTAL
                .with_label_values(&[task_type, priority_label, outcome])
                .inc();
            t
        }
        Err(e) => {
            metrics::WORK_CLAIM_DURATION
                .with_label_values(&[task_type, "ranker", "error"])
                .observe(elapsed);
            metrics::WORK_CLAIM_TOTAL
                .with_label_values(&[task_type, "none", "error"])
                .inc();
            return Err(e.into());
        }
    };

    let response = match task {
        Some(ref t) => {
            info!(
                user_id = %user.user_id,
                task_type = %task_type,
                count_id = %t.id,
                count_number = %t.count_number,
                "User claimed task"
            );

            let _ = crate::websocket::broadcast_event(&state.ws_broadcast, WsEvent::TaskAssigned {
                task_id: t.id,
                user_id: user_uuid,
                priority: t.priority.clone(),
                location: t.location.clone(),
                material: t.material_number.clone(),
                organization_id: Some(org_uuid),
            });

            let _ = crate::websocket::broadcast_event(&state.ws_broadcast, WsEvent::TaskStatusChanged {
                task_id: t.id,
                old_status: "pending".to_string(),
                new_status: t.status.clone(),
                reason: Some("claim".to_string()),
                organization_id: Some(org_uuid),
            });

            ClaimTaskResponse {
                success: true,
                message: format!("Claimed task {}", t.count_number),
                task: task,
            }
        }
        None => {
            info!(user_id = %user.user_id, task_type = %task_type, "No tasks available");

            // T-3 (2026-05-18) — admin-only canary. If the queue
            // actually contains unassigned-pending rows, emit
            // `ClaimBlockedByZone` so the admin shell can render a
            // ribbon and a human can investigate the cascade. The
            // helper runs a single cheap two-count read; if it
            // errors we swallow the error (the canary is best-effort
            // and never blocks the claim response). Only emit for
            // `cycle_count` today — generic types live in
            // `work_tasks` and don't share the soft-reservation
            // cascade shape (see ADR F5 reframed 2026-05-18).
            if task_type == "cycle_count" {
                if let Ok((unassigned, stuck)) =
                    db::count_unassigned_and_stuck_pending(&state.db_pool, org_uuid).await
                {
                    if unassigned > 0 {
                        let _ = crate::websocket::broadcast_event(
                            &state.ws_broadcast,
                            WsEvent::ClaimBlockedByZone {
                                organization_id: org_uuid,
                                user_id: user_uuid,
                                task_type: task_type.to_string(),
                                unassigned_pending: unassigned,
                                stuck_pending_assigned: stuck,
                            },
                        );
                    }
                }
            }

            ClaimTaskResponse {
                success: false,
                message: "No tasks available".to_string(),
                task: None,
            }
        }
    };

    Ok(Json(response))
}

/// Push a cycle count to a specific user
pub async fn push_to_user(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Json(request): Json<PushCycleCountRequest>,
) -> ApiResult<Json<ClaimTaskResponse>> {
    let org_id = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;
    let pusher_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;
    let org_uuid = Uuid::parse_str(org_id)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    let has_supervisor_access = user
        .permissions
        .iter()
        .any(|p| p == "*" || p.contains("manage") || p.contains("supervisor"));
    if !has_supervisor_access {
        return Err(ApiError::Forbidden(
            "Supervisor access required to push work".to_string(),
        ));
    }

    let task =
        db::push_cycle_count(&state.db_pool, request.count_id, request.user_id, pusher_uuid, org_uuid)
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
            let _ = crate::websocket::broadcast_event(&state.ws_broadcast, WsEvent::PushedWork {
                task_id: t.id,
                user_id: request.user_id,
                material: t.material_number.clone(),
                location: t.location.clone(),
                count_number: t.count_number.clone(),
                priority: t.priority.clone(),
                organization_id: Some(org_uuid),
                target_zone: None,
                target_role: None,
                target_user_ids: None,
                broadcast_message: None,
            });

            // Also broadcast status change
            let _ = crate::websocket::broadcast_event(&state.ws_broadcast, WsEvent::TaskAssigned {
                task_id: t.id,
                user_id: request.user_id,
                priority: t.priority.clone(),
                location: t.location.clone(),
                material: t.material_number.clone(),
                organization_id: Some(org_uuid),
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
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Path(task_id): Path<Uuid>,
) -> ApiResult<Json<TaskOperationResponse>> {
    let org_id = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;
    let user_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;
    let org_uuid = Uuid::parse_str(org_id)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    let success = db::start_cycle_count(&state.db_pool, task_id, user_uuid, org_uuid).await?;

    let response = if success {
        info!(
            user_id = %user.user_id,
            task_id = %task_id,
            "Started cycle count"
        );

        // Broadcast status change
        let _ = crate::websocket::broadcast_event(&state.ws_broadcast, WsEvent::TaskStatusChanged {
            task_id,
            old_status: "pending".to_string(),
            new_status: "in_progress".to_string(),
            reason: Some("start".to_string()),
            organization_id: Some(org_uuid),
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
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Path(task_id): Path<Uuid>,
    Json(request): Json<CompleteCycleCountRequest>,
) -> ApiResult<Json<TaskOperationResponse>> {
    let org_id = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;
    let user_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;
    let org_uuid = Uuid::parse_str(org_id)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    let final_status = db::complete_cycle_count(
        &state.db_pool,
        task_id,
        user_uuid,
        org_uuid,
        request.counted_quantity,
        request.notes,
    )
    .await?;

    let response = match final_status {
        Some(ref status) => {
            info!(
                user_id = %user.user_id,
                task_id = %task_id,
                counted_quantity = request.counted_quantity,
                final_status = %status,
                "Completed cycle count"
            );

            let _ = crate::websocket::broadcast_event(&state.ws_broadcast, WsEvent::TaskStatusChanged {
                task_id,
                old_status: "in_progress".to_string(),
                new_status: status.clone(),
                reason: Some("complete".to_string()),
                organization_id: Some(org_uuid),
            });

            TaskOperationResponse {
                success: true,
                message: format!("Cycle count completed (status: {})", status),
            }
        }
        None => {
            warn!(
                user_id = %user.user_id,
                task_id = %task_id,
                "Failed to complete cycle count"
            );
            TaskOperationResponse {
                success: false,
                message: "Cycle count not found or not assigned to you"
                    .to_string(),
            }
        }
    };

    Ok(Json(response))
}

/// Release a cycle count back to the queue
pub async fn release_task(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Path(task_id): Path<Uuid>,
) -> ApiResult<Json<TaskOperationResponse>> {
    let org_id = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;
    let user_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;
    let org_uuid = Uuid::parse_str(org_id)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    let has_supervisor_access = user
        .permissions
        .iter()
        .any(|p| p == "*" || p.contains("manage") || p.contains("supervisor"));

    let success = db::release_cycle_count(&state.db_pool, task_id, org_uuid, user_uuid, has_supervisor_access).await?;

    let response = if success {
        info!(
            user_id = %user.user_id,
            task_id = %task_id,
            "Released cycle count back to queue"
        );

        // Broadcast status change
        let _ = crate::websocket::broadcast_event(&state.ws_broadcast, WsEvent::TaskStatusChanged {
            task_id,
            old_status: "in_progress".to_string(),
            new_status: "pending".to_string(),
            reason: Some("release".to_string()),
            organization_id: Some(org_uuid),
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
    Extension(user): Extension<Arc<AuthenticatedUser>>,
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
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Path(task_id): Path<Uuid>,
) -> ApiResult<Json<TaskOperationResponse>> {
    let org_id = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;
    let user_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;
    let org_uuid = Uuid::parse_str(org_id)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    let success = db::acknowledge_pushed_count(&state.db_pool, task_id, user_uuid, org_uuid).await?;

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

/// Skip/defer a cycle count for the current operator
pub async fn skip_task(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Path(task_id): Path<Uuid>,
    Json(request): Json<SkipTaskRequest>,
) -> ApiResult<Json<TaskOperationResponse>> {
    let user_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;

    let success =
        db::skip_cycle_count(&state.db_pool, task_id, user_uuid, request.reason).await?;

    let response = if success {
        info!(
            user_id = %user.user_id,
            task_id = %task_id,
            "Skipped/deferred cycle count"
        );

        // Resolve org for the broadcast filter (skip endpoint doesn't take it
        // from the path; pull it from the user context).
        let skip_org_uuid = user
            .organization_id
            .as_deref()
            .and_then(|o| Uuid::parse_str(o).ok());
        let _ = crate::websocket::broadcast_event(&state.ws_broadcast, WsEvent::TaskStatusChanged {
            task_id,
            old_status: "in_progress".to_string(),
            new_status: "pending".to_string(),
            reason: Some("skip".to_string()),
            organization_id: skip_org_uuid,
        });

        TaskOperationResponse {
            success: true,
            message: "Count skipped and deferred".to_string(),
        }
    } else {
        warn!(
            user_id = %user.user_id,
            task_id = %task_id,
            "Failed to skip cycle count"
        );
        TaskOperationResponse {
            success: false,
            message: "Count not found or not assigned to you".to_string(),
        }
    };

    Ok(Json(response))
}

// ---------------------------------------------------------------------------
//  Phase 0b / Phase 2 — Operation Control + generic batch endpoints
// ---------------------------------------------------------------------------

/// Operation Control drag-reassign request.
#[derive(serde::Deserialize)]
pub struct ReassignZoneRequest {
    pub zone: String,
    pub from_user_id: Uuid,
    pub to_user_id: Uuid,
    pub mode: String, // "soft" | "hard"
}

/// Operation Control drag-reassign response.
#[derive(serde::Serialize)]
pub struct ReassignZoneResponse {
    pub tasks_moved: i32,
    pub events_written: i32,
    pub idempotency_key: Option<String>,
}

/// `POST /api/v1/work/reassign_zone` — calls the SECURITY DEFINER
/// `reassign_work_zone()` RPC. Idempotency-Key header is forwarded into the
/// RPC so replays return the recorded payload without redoing the work.
pub async fn reassign_zone(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    headers: axum::http::HeaderMap,
    Json(req): Json<ReassignZoneRequest>,
) -> ApiResult<Json<ReassignZoneResponse>> {
    let org_id_str = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;
    let org_uuid = Uuid::parse_str(org_id_str)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    if !matches!(req.mode.as_str(), "soft" | "hard") {
        return Err(ApiError::BadRequest("mode must be soft or hard".to_string()));
    }

    let idem = headers
        .get("Idempotency-Key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Item 14 — replay-hit detection. If an Idempotency-Key was provided
    // AND a recorded response already exists, the SECURITY DEFINER RPC
    // below will short-circuit and return the cached payload. We peek at
    // `work_request_idempotency` to count those replays. The peek can
    // race a concurrent first execution; that's an acceptable tolerance
    // for telemetry (counts replay rate, not auth boundary).
    if let Some(ref key) = idem {
        let exists: Option<(bool,)> = sqlx::query_as(
            r#"SELECT EXISTS(
                 SELECT 1 FROM public.work_request_idempotency
                  WHERE organization_id = $1
                    AND idempotency_key = $2
                    AND route = 'reassign_work_zone'
                    AND expires_at > now()
               )"#,
        )
        .bind(org_uuid)
        .bind(key)
        .fetch_optional(&state.db_pool)
        .await
        .ok()
        .flatten();
        if exists.map(|(b,)| b).unwrap_or(false) {
            metrics::WORK_IDEMPOTENCY_HITS_TOTAL
                .with_label_values(&["reassign_zone"])
                .inc();
        }
    }

    let row: (serde_json::Value,) = sqlx::query_as(
        r#"SELECT public.reassign_work_zone($1, $2, $3, $4, $5, $6)"#,
    )
    .bind(org_uuid)
    .bind(&req.zone)
    .bind(req.from_user_id)
    .bind(req.to_user_id)
    .bind(&req.mode)
    .bind(idem.as_deref())
    .fetch_one(&state.db_pool)
    .await
    .map_err(|e| ApiError::Internal(format!("reassign_zone failed: {}", e)))?;

    let v = row.0;
    let resp = ReassignZoneResponse {
        tasks_moved: v.get("tasks_moved").and_then(|x| x.as_i64()).unwrap_or(0) as i32,
        events_written: v.get("events_written").and_then(|x| x.as_i64()).unwrap_or(0) as i32,
        idempotency_key: v.get("idempotency_key").and_then(|x| x.as_str()).map(String::from),
    };

    info!(
        user_id = %user.user_id,
        org_id  = %org_uuid,
        zone    = %req.zone,
        mode    = %req.mode,
        tasks_moved = resp.tasks_moved,
        "Operation Control: zone reassigned"
    );

    let _ = crate::websocket::broadcast_event(&state.ws_broadcast, WsEvent::TaskStatusChanged {
        task_id: Uuid::nil(),
        old_status: "reassigned".to_string(),
        new_status: req.mode.clone(),
        reason: Some(format!("zone:{}", req.zone)),
        organization_id: Some(org_uuid),
    });

    Ok(Json(resp))
}

/// `POST /api/v1/work/push_batch` — atomic multi-task push with per-task
/// savepoints (Phase 2.3). Replaces the N round-trip `Promise.allSettled`
/// fan-out in the supervisor desktop.
#[derive(serde::Deserialize)]
pub struct PushBatchRequest {
    pub task_ids: Vec<Uuid>,
    pub user_id: Uuid,
}

#[derive(serde::Serialize)]
pub struct PushBatchResultRow {
    pub task_id: Uuid,
    pub ok: bool,
    pub error: Option<String>,
}

pub async fn push_batch(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Json(req): Json<PushBatchRequest>,
) -> ApiResult<Json<Vec<PushBatchResultRow>>> {
    let org_id_str = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;
    let org_uuid = Uuid::parse_str(org_id_str)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    // Dedupe argument list defensively (Phase 1.5 — push_batch dedupes its
    // own task_ids, not just the wrapping idempotency key).
    let mut seen = std::collections::HashSet::new();
    let unique_ids: Vec<Uuid> = req.task_ids.into_iter().filter(|id| seen.insert(*id)).collect();

    let pushed_by =
        Uuid::parse_str(&user.user_id).unwrap_or_default();

    // Plan §2.3 — wrap the batch in a single transaction with per-task
    // SAVEPOINTs. A single failure rolls back its savepoint only; sibling
    // tasks stay committed. This replaces the previous "N independent
    // transactions" loop where a partial failure could leak a row into
    // an assigned-but-not-acknowledged state with no atomic rollback.
    let mut outer_tx = state
        .db_pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(format!("push_batch begin failed: {}", e)))?;

    let mut out = Vec::with_capacity(unique_ids.len());
    let mut events = Vec::with_capacity(unique_ids.len());

    // Item 14 — time the per-task savepoint loop. push_batch is hard-coded
    // to cycle_count today; if that ever fans out, we'd thread the
    // task_type through the request and switch this label.
    let push_loop_started = std::time::Instant::now();
    let push_task_type = "cycle_count";

    for tid in unique_ids {
        // Nested begin() emits a SAVEPOINT under the outer transaction.
        let mut sp = match outer_tx.begin().await {
            Ok(sp) => sp,
            Err(e) => {
                metrics::WORK_PUSH_FAILURE_TOTAL
                    .with_label_values(&[push_task_type, "savepoint_begin"])
                    .inc();
                out.push(PushBatchResultRow {
                    task_id: tid,
                    ok: false,
                    error: Some(format!("savepoint begin failed: {}", e)),
                });
                continue;
            }
        };

        match db::push_cycle_count_in_tx(&mut sp, tid, req.user_id, pushed_by, org_uuid).await {
            Ok(Some(task)) => {
                if let Err(e) = sp.commit().await {
                    metrics::WORK_PUSH_FAILURE_TOTAL
                        .with_label_values(&[push_task_type, "savepoint_release"])
                        .inc();
                    out.push(PushBatchResultRow {
                        task_id: tid,
                        ok: false,
                        error: Some(format!("savepoint release failed: {}", e)),
                    });
                    continue;
                }
                events.push((tid, task));
                out.push(PushBatchResultRow { task_id: tid, ok: true, error: None });
            }
            Ok(None) => {
                let _ = sp.rollback().await;
                metrics::WORK_PUSH_FAILURE_TOTAL
                    .with_label_values(&[push_task_type, "not_pushable"])
                    .inc();
                out.push(PushBatchResultRow {
                    task_id: tid,
                    ok: false,
                    error: Some("not pushable (zone locked, missing, or completed)".to_string()),
                });
            }
            Err(e) => {
                let _ = sp.rollback().await;
                metrics::WORK_PUSH_FAILURE_TOTAL
                    .with_label_values(&[push_task_type, "db_error"])
                    .inc();
                out.push(PushBatchResultRow {
                    task_id: tid,
                    ok: false,
                    error: Some(e.to_string()),
                });
            }
        }
    }

    metrics::WORK_PUSH_DURATION
        .with_label_values(&[push_task_type, "batch"])
        .observe(push_loop_started.elapsed().as_secs_f64());

    outer_tx
        .commit()
        .await
        .map_err(|e| ApiError::Internal(format!("push_batch commit failed: {}", e)))?;

    // Broadcast WS events only after the outer commit succeeds — otherwise
    // subscribers could see "pushed" notifications for rows the database
    // never persisted.
    for (tid, task) in events {
        let _ = crate::websocket::broadcast_event(&state.ws_broadcast, WsEvent::PushedWork {
            task_id: tid,
            user_id: req.user_id,
            material: task.material_number.clone(),
            location: task.location.clone(),
            count_number: task.count_number.clone(),
            priority: task.priority.clone(),
            organization_id: Some(org_uuid),
            target_zone: None,
            target_role: None,
            target_user_ids: None,
            broadcast_message: None,
        });
    }

    Ok(Json(out))
}

/// `POST /api/v1/work/push_top_n` — Operation Control queue-strip drop:
/// pushes the top-N pending tasks of (task_type, priority) to one operator.
#[derive(serde::Deserialize)]
pub struct PushTopNRequest {
    pub task_type: String,
    pub priority: String,
    pub user_id: Uuid,
    pub n: i32,
}

#[derive(serde::Serialize)]
pub struct PushTopNResponse {
    pub pushed: i32,
    pub idempotency_key: Option<String>,
}

pub async fn push_top_n(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    headers: axum::http::HeaderMap,
    Json(req): Json<PushTopNRequest>,
) -> ApiResult<Json<PushTopNResponse>> {
    let org_id_str = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;
    let org_uuid = Uuid::parse_str(org_id_str)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))?;

    let n = req.n.max(1).min(50);
    let candidates: Vec<(Uuid,)> = sqlx::query_as(
        r#"SELECT id FROM work_tasks
            WHERE organization_id = $1
              AND task_type = $2
              AND priority = $3
              AND status = 'pending'
              AND assigned_to IS NULL
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT $4"#,
    )
    .bind(org_uuid)
    .bind(&req.task_type)
    .bind(&req.priority)
    .bind(n)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    let pushed_by = Uuid::parse_str(&user.user_id).unwrap_or_default();
    let mut pushed = 0i32;
    for (tid,) in candidates {
        if let Ok(Some(task)) =
            db::push_cycle_count(&state.db_pool, tid, req.user_id, pushed_by, org_uuid).await
        {
            pushed += 1;
            let _ = crate::websocket::broadcast_event(&state.ws_broadcast, WsEvent::PushedWork {
                task_id: tid,
                user_id: req.user_id,
                material: task.material_number.clone(),
                location: task.location.clone(),
                count_number: task.count_number.clone(),
                priority: task.priority.clone(),
                organization_id: Some(org_uuid),
                target_zone: None,
                target_role: None,
                target_user_ids: None,
                broadcast_message: None,
            });
        }
    }

    Ok(Json(PushTopNResponse {
        pushed,
        idempotency_key: headers
            .get("Idempotency-Key")
            .and_then(|v| v.to_str().ok())
            .map(String::from),
    }))
}

/// `POST /api/v1/work/ws-token` — issue a 5-minute signed subscribe token
/// (Phase 2.0 v1 decision). The WS upgrade handler verifies the token before
/// accepting any subscribe message.
#[derive(serde::Serialize)]
pub struct WsTokenResponse {
    pub token: String,
    pub expires_in_seconds: u64,
}

pub async fn issue_ws_token(
    Extension(user): Extension<Arc<AuthenticatedUser>>,
) -> ApiResult<Json<WsTokenResponse>> {
    let user_uuid = Uuid::parse_str(&user.user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID".to_string()))?;
    let org_uuid = user
        .organization_id
        .as_deref()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;

    let token = crate::ws_token::issue(user_uuid, org_uuid);
    Ok(Json(WsTokenResponse {
        token,
        expires_in_seconds: 300,
    }))
}

/// `GET /metrics` — Prometheus exposition. Returns 503 if the metrics
/// dependency is not compiled in (initial scaffold; the dep gates further
/// telemetry work in Phase 12).
pub async fn metrics_endpoint() -> Result<String, axum::http::StatusCode> {
    crate::observability::metrics::render_text()
        .ok_or(axum::http::StatusCode::SERVICE_UNAVAILABLE)
}

/// Create the work routes router
pub fn work_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/queue", get(get_queue))
        .route("/queue/stats", get(get_stats))
        .route("/claim", post(claim_next))
        .route("/push", post(push_to_user))
        .route("/push_batch", post(push_batch))
        .route("/push_top_n", post(push_top_n))
        .route("/reassign_zone", post(reassign_zone))
        .route("/ws-token", post(issue_ws_token))
        .route("/tasks/:id", get(get_task))
        .route("/tasks/:id/start", post(start_task))
        .route("/tasks/:id/complete", post(complete_task))
        .route("/tasks/:id/release", post(release_task))
        .route("/tasks/:id/skip", post(skip_task))
        .route("/tasks/:id/acknowledge", post(acknowledge_push))
}

// Created and developed by Jai Singh
