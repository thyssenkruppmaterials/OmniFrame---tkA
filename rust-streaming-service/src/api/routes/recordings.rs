//! Recording endpoints
//!
//! Provides access to recorded video clips from ExacqVision.

use axum::{
    body::Body,
    extract::{Path, State, Query},
    http::{header, StatusCode},
    response::Response,
    Json,
};
use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tracing::{debug, error, info, instrument};

use crate::AppState;
use crate::api::error::{ApiError, ApiResult};
use crate::exacq::models::Recording;

/// Query parameters for listing recordings
#[derive(Debug, Deserialize)]
pub struct ListRecordingsQuery {
    /// Start time filter (ISO 8601)
    pub start_time: Option<DateTime<Utc>>,
    /// End time filter (ISO 8601)
    pub end_time: Option<DateTime<Utc>>,
    /// Recording type filter (continuous, motion, alarm)
    pub recording_type: Option<String>,
    /// Maximum number of recordings to return
    #[serde(default = "default_limit")]
    pub limit: u32,
    /// Offset for pagination
    #[serde(default)]
    pub offset: u32,
}

fn default_limit() -> u32 {
    50
}

/// Recordings list response
#[derive(Debug, Serialize)]
pub struct RecordingsResponse {
    pub recordings: Vec<Recording>,
    pub total: usize,
    pub camera_id: i64,
    pub timestamp: DateTime<Utc>,
}

/// List recordings for a camera
#[instrument(skip(state))]
pub async fn list_recordings(
    State(state): State<AppState>,
    Path(camera_id): Path<i64>,
    Query(query): Query<ListRecordingsQuery>,
) -> ApiResult<Json<RecordingsResponse>> {
    debug!(camera_id, ?query, "Listing recordings");

    // Get session
    let session_id = state.session_manager
        .get_session()
        .await
        .map_err(|e| ApiError::Session(e.to_string()))?;

    // Build query URL for ExacqVision recordings API
    let mut url = format!(
        "{}/recording.web?s={}&camera={}",
        state.exacq_client.base_url(), session_id, camera_id
    );

    if let Some(start) = query.start_time {
        url.push_str(&format!("&start={}", start.format("%Y-%m-%dT%H:%M:%SZ")));
    }
    if let Some(end) = query.end_time {
        url.push_str(&format!("&end={}", end.format("%Y-%m-%dT%H:%M:%SZ")));
    }
    if let Some(ref rec_type) = query.recording_type {
        url.push_str(&format!("&type={}", rec_type));
    }
    url.push_str(&format!("&limit={}&offset={}", query.limit, query.offset));

    debug!(url = %url, "Fetching recordings");

    // Fetch recordings from ExacqVision
    let response = state.exacq_client
        .http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| ApiError::Exacq(e.to_string()))?;

    let status = response.status();
    let text = response.text().await.map_err(|e| ApiError::Exacq(e.to_string()))?;

    if !status.is_success() {
        return Err(ApiError::Exacq(format!("Failed to fetch recordings: {} - {}", status, text)));
    }

    // Parse recordings response
    let recordings: Vec<Recording> = serde_json::from_str(&text)
        .or_else(|_| {
            // Try parsing as a wrapper object
            #[derive(Deserialize)]
            struct RecordingsWrapper {
                recordings: Vec<Recording>,
            }
            serde_json::from_str::<RecordingsWrapper>(&text).map(|w| w.recordings)
        })
        .unwrap_or_default();

    info!(
        camera_id,
        count = recordings.len(),
        "Retrieved recordings list"
    );

    Ok(Json(RecordingsResponse {
        total: recordings.len(),
        recordings,
        camera_id,
        timestamp: Utc::now(),
    }))
}

/// Query parameters for recording download
#[derive(Debug, Deserialize)]
pub struct DownloadQuery {
    /// Recording ID
    pub recording_id: String,
    /// Start time (optional, for clip extraction)
    pub start_time: Option<DateTime<Utc>>,
    /// End time (optional, for clip extraction)
    pub end_time: Option<DateTime<Utc>>,
    /// Format (mp4, avi, etc.)
    #[serde(default = "default_format")]
    pub format: String,
}

fn default_format() -> String {
    "mp4".to_string()
}

/// Download recording clip
#[instrument(skip(state))]
pub async fn download_recording(
    State(state): State<AppState>,
    Path(camera_id): Path<i64>,
    Query(query): Query<DownloadQuery>,
) -> Result<Response, ApiError> {
    debug!(camera_id, recording_id = %query.recording_id, "Downloading recording");

    // Get session
    let session_id = state.session_manager
        .get_session()
        .await
        .map_err(|e| ApiError::Session(e.to_string()))?;

    // Build download URL
    let mut url = format!(
        "{}/recording.web/download?s={}&camera={}&recording={}",
        state.exacq_client.base_url(), session_id, camera_id, query.recording_id
    );

    if let Some(start) = query.start_time {
        url.push_str(&format!("&start={}", start.format("%Y-%m-%dT%H:%M:%SZ")));
    }
    if let Some(end) = query.end_time {
        url.push_str(&format!("&end={}", end.format("%Y-%m-%dT%H:%M:%SZ")));
    }
    url.push_str(&format!("&format={}", query.format));

    debug!(url = %url, "Fetching recording download");

    // Get streaming response
    let response = state.exacq_client
        .http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| ApiError::Exacq(e.to_string()))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(ApiError::Exacq(format!("Download failed: {} - {}", status, text)));
    }

    // Get content length if available
    let content_length = response.content_length();
    
    // Get content type
    // Note: Using string literal for header name due to http crate version mismatch
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("video/mp4")
        .to_string();

    // Stream the response
    let stream = response.bytes_stream();
    let body_stream = stream.map(|result| {
        result.map_err(|e| {
            error!(error = %e, "Download stream error");
            std::io::Error::new(std::io::ErrorKind::Other, e)
        })
    });

    let body = Body::from_stream(body_stream);

    // Build filename
    let filename = format!("recording_{}_{}.{}", camera_id, query.recording_id, query.format);

    let mut response_builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", filename)
        );

    if let Some(len) = content_length {
        response_builder = response_builder.header(header::CONTENT_LENGTH, len);
    }

    let response = response_builder
        .body(body)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    info!(
        camera_id,
        recording_id = %query.recording_id,
        "Started recording download"
    );

    Ok(response)
}

/// Query parameters for playback stream
#[derive(Debug, Deserialize)]
pub struct PlaybackQuery {
    /// Recording ID
    pub recording_id: String,
    /// Start time within recording
    pub start_time: Option<DateTime<Utc>>,
    /// Playback speed (0.5, 1.0, 2.0, etc.)
    #[serde(default = "default_speed")]
    pub speed: f32,
    /// Video width
    pub width: Option<u32>,
    /// Video height
    pub height: Option<u32>,
}

fn default_speed() -> f32 {
    1.0
}

/// Stream recording playback (MJPEG)
#[instrument(skip(state))]
pub async fn playback_stream(
    State(state): State<AppState>,
    Path(camera_id): Path<i64>,
    Query(query): Query<PlaybackQuery>,
) -> Result<Response, ApiError> {
    debug!(camera_id, recording_id = %query.recording_id, "Starting playback stream");

    // Get session
    let session_id = state.session_manager
        .get_session()
        .await
        .map_err(|e| ApiError::Session(e.to_string()))?;

    let width = query.width.unwrap_or(state.config.default_video_width);
    let height = query.height.unwrap_or(state.config.default_video_height);

    // Build playback URL (ExacqVision uses video.web with recording parameter)
    let mut url = format!(
        "{}/video.web?s={};camera={};recording={};w={};h={};format=6;speed={}",
        state.exacq_client.base_url(), 
        session_id, 
        camera_id, 
        query.recording_id,
        width,
        height,
        query.speed
    );

    if let Some(start) = query.start_time {
        url.push_str(&format!(";start={}", start.format("%Y-%m-%dT%H:%M:%SZ")));
    }

    debug!(url = %url, "Starting playback stream");

    // Get streaming response
    let response = state.exacq_client
        .http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| ApiError::Stream(e.to_string()))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(ApiError::Stream(format!("Playback failed: {} - {}", status, text)));
    }

    // Get content type
    // Note: Using string literal for header name due to http crate version mismatch
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("multipart/x-mixed-replace; boundary=myboundary")
        .to_string();

    // Stream the response
    let stream = response.bytes_stream();
    let body_stream = stream.map(|result| {
        result.map_err(|e| {
            error!(error = %e, "Playback stream error");
            std::io::Error::new(std::io::ErrorKind::Other, e)
        })
    });

    let body = Body::from_stream(body_stream);

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
        .header(header::PRAGMA, "no-cache")
        .header("X-Accel-Buffering", "no")
        .body(body)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    info!(
        camera_id,
        recording_id = %query.recording_id,
        speed = query.speed,
        "Started playback stream"
    );

    Ok(response)
}
