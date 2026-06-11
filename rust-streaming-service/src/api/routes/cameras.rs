// Created and developed by Jai Singh
//! Camera endpoints
//!
//! Provides routes for listing cameras, getting details, and PTZ control.

use axum::{
    extract::{Path, State, Query},
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::{debug, info, instrument};

use crate::AppState;
use crate::api::error::{ApiError, ApiResult};
use crate::exacq::models::{Camera, CameraListResponse, CameraResponse, PtzCommand};

/// Query parameters for camera list
#[derive(Debug, Deserialize)]
pub struct ListCamerasQuery {
    /// Filter by camera name (partial match)
    pub name: Option<String>,
    /// Filter by online status
    pub online: Option<bool>,
    /// Filter by PTZ capability
    pub ptz: Option<bool>,
}

/// List all cameras
#[instrument(skip(state))]
pub async fn list_cameras(
    State(state): State<AppState>,
    Query(query): Query<ListCamerasQuery>,
) -> ApiResult<Json<CameraListResponse>> {
    debug!(?query, "Listing cameras");

    // Get session
    let session_id = state.session_manager
        .get_session()
        .await
        .map_err(|e| ApiError::Session(e.to_string()))?;

    // Try to get cameras from cache first
    let cache_key = "cameras:list";
    if let Some(ref cache) = state.cache_service {
        if let Ok(Some(cameras)) = cache.get::<Vec<Camera>>(cache_key).await {
            debug!("Returning cameras from cache");
            let filtered = filter_cameras(cameras, &query);
            return Ok(Json(CameraListResponse {
                total: filtered.len(),
                cameras: filtered,
                timestamp: chrono::Utc::now(),
            }));
        }
    }

    // Fetch from ExacqVision
    let cameras = state.exacq_client
        .get_devices(&session_id)
        .await
        .map_err(|e| ApiError::Exacq(e.to_string()))?;

    // Cache the result
    if let Some(ref cache) = state.cache_service {
        if let Err(e) = cache.set(cache_key, &cameras, Some(std::time::Duration::from_secs(60))).await {
            tracing::warn!(error = %e, "Failed to cache cameras list");
        }
    }

    let filtered = filter_cameras(cameras, &query);
    
    info!(count = filtered.len(), "Retrieved cameras list");

    Ok(Json(CameraListResponse {
        total: filtered.len(),
        cameras: filtered,
        timestamp: chrono::Utc::now(),
    }))
}

/// Filter cameras based on query parameters
fn filter_cameras(cameras: Vec<Camera>, query: &ListCamerasQuery) -> Vec<Camera> {
    cameras.into_iter()
        .filter(|cam| {
            // Filter by name
            if let Some(ref name) = query.name {
                if !cam.name.to_lowercase().contains(&name.to_lowercase()) {
                    return false;
                }
            }
            // Filter by online status
            if let Some(online) = query.online {
                if cam.online != online {
                    return false;
                }
            }
            // Filter by PTZ capability
            if let Some(ptz) = query.ptz {
                if cam.ptz_enabled != ptz {
                    return false;
                }
            }
            true
        })
        .collect()
}

/// Get camera details by ID
#[instrument(skip(state))]
pub async fn get_camera(
    State(state): State<AppState>,
    Path(camera_id): Path<i64>,
) -> ApiResult<Json<CameraResponse>> {
    debug!(camera_id, "Getting camera details");

    // Get session
    let session_id = state.session_manager
        .get_session()
        .await
        .map_err(|e| ApiError::Session(e.to_string()))?;

    // Try cache first
    let cache_key = format!("camera:{}", camera_id);
    if let Some(ref cache) = state.cache_service {
        if let Ok(Some(camera)) = cache.get::<Camera>(&cache_key).await {
            debug!("Returning camera from cache");
            return Ok(Json(CameraResponse {
                camera,
                timestamp: chrono::Utc::now(),
            }));
        }
    }

    // Fetch from ExacqVision
    let camera = state.exacq_client
        .get_camera(&session_id, camera_id)
        .await
        .map_err(|e| ApiError::Exacq(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound(format!("Camera {} not found", camera_id)))?;

    // Cache the result
    if let Some(ref cache) = state.cache_service {
        if let Err(e) = cache.set(&cache_key, &camera, Some(std::time::Duration::from_secs(300))).await {
            tracing::warn!(error = %e, "Failed to cache camera details");
        }
    }

    info!(camera_id, camera_name = %camera.name, "Retrieved camera details");

    Ok(Json(CameraResponse {
        camera,
        timestamp: chrono::Utc::now(),
    }))
}

/// PTZ command request
#[derive(Debug, Deserialize)]
pub struct PtzRequest {
    /// PTZ action
    pub action: String,
    /// Speed (0-100)
    #[serde(default = "default_speed")]
    pub speed: u8,
    /// Preset number (for goto_preset action)
    pub preset: Option<u8>,
}

fn default_speed() -> u8 {
    50
}

/// PTZ command response
#[derive(Debug, Serialize)]
pub struct PtzResponse {
    pub success: bool,
    pub camera_id: i64,
    pub action: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

/// Send PTZ command to camera
#[instrument(skip(state))]
pub async fn ptz_command(
    State(state): State<AppState>,
    Path(camera_id): Path<i64>,
    Json(request): Json<PtzRequest>,
) -> ApiResult<Json<PtzResponse>> {
    debug!(camera_id, action = %request.action, "Sending PTZ command");

    // Validate action
    let valid_actions = [
        "pan_left", "pan_right", "tilt_up", "tilt_down",
        "zoom_in", "zoom_out", "stop", "goto_preset",
        "home", "focus_near", "focus_far", "iris_open", "iris_close",
    ];
    
    if !valid_actions.contains(&request.action.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "Invalid PTZ action '{}'. Valid actions: {:?}",
            request.action, valid_actions
        )));
    }

    // Get session
    let session_id = state.session_manager
        .get_session()
        .await
        .map_err(|e| ApiError::Session(e.to_string()))?;

    // Build PTZ command
    let command = PtzCommand {
        action: request.action.clone(),
        speed: request.speed,
        preset: request.preset,
    };

    // Send command
    let success = state.exacq_client
        .send_ptz_command(&session_id, camera_id, &command)
        .await
        .map_err(|e| ApiError::Exacq(e.to_string()))?;

    info!(
        camera_id,
        action = %request.action,
        success,
        "PTZ command sent"
    );

    Ok(Json(PtzResponse {
        success,
        camera_id,
        action: request.action,
        timestamp: chrono::Utc::now(),
    }))
}

// Created and developed by Jai Singh
