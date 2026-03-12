//! Video streaming endpoints
//!
//! Provides MJPEG stream proxying and snapshot capture from ExacqVision cameras.

use axum::{
    body::Body,
    extract::{Path, State, Query},
    http::{header, StatusCode},
    response::Response,
};
use base64::Engine;
use bytes::Bytes;
use futures_util::StreamExt;
use serde::Deserialize;
use tracing::{debug, error, info, instrument, warn};

use crate::AppState;
use crate::api::error::ApiError;
use crate::exacq::models::StreamParams;

/// Query parameters for video stream
#[derive(Debug, Deserialize)]
pub struct StreamQuery {
    /// Video width (default: from config)
    pub width: Option<u32>,
    /// Video height (default: from config)
    pub height: Option<u32>,
    /// Quality 1-10 (default: from config, higher is better)
    pub quality: Option<u8>,
}

/// MJPEG stream proxy
/// 
/// Proxies MJPEG video stream from ExacqVision with zero-copy forwarding.
/// The stream is forwarded directly to the client without buffering entire frames.
#[instrument(skip(state))]
pub async fn mjpeg_stream(
    State(state): State<AppState>,
    Path(camera_id): Path<i64>,
    Query(query): Query<StreamQuery>,
) -> Result<Response, ApiError> {
    debug!(camera_id, ?query, "Starting MJPEG stream");

    // Get session
    let session_id = state.session_manager
        .get_session()
        .await
        .map_err(|e| ApiError::Session(e.to_string()))?;

    // Build stream parameters
    let width = query.width.unwrap_or(state.config.default_video_width);
    let height = query.height.unwrap_or(state.config.default_video_height);
    let quality = query.quality.unwrap_or(state.config.default_video_quality).min(10).max(1);

    let params = StreamParams {
        session_id,
        camera_id,
        width,
        height,
        quality,
        format: 6, // MJPEG
    };

    info!(
        camera_id,
        width,
        height,
        quality,
        "Starting video stream proxy"
    );

    // Get streaming response from ExacqVision
    let response = state.exacq_client
        .get_stream(&params)
        .await
        .map_err(|e| ApiError::Stream(e.to_string()))?;

    // Get content type from upstream response
    // Note: Using string literal for header name due to http crate version mismatch
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("multipart/x-mixed-replace; boundary=myboundary")
        .to_string();

    // Convert reqwest response to axum body stream
    let stream = response.bytes_stream();
    
    // Map the stream to handle errors
    let body_stream = stream.map(|result| {
        result.map_err(|e| {
            error!(error = %e, "Stream error");
            std::io::Error::new(std::io::ErrorKind::Other, e)
        })
    });

    // Build response with streaming body
    let body = Body::from_stream(body_stream);

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
        .header(header::PRAGMA, "no-cache")
        .header(header::EXPIRES, "0")
        .header("X-Accel-Buffering", "no") // Disable nginx buffering
        .body(body)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(response)
}

/// Query parameters for snapshot
#[derive(Debug, Deserialize)]
pub struct SnapshotQuery {
    /// Image width (default: from config)
    pub width: Option<u32>,
    /// Image height (default: from config)
    pub height: Option<u32>,
    /// Quality 1-10 (default: from config, higher is better)
    pub quality: Option<u8>,
    /// Force fresh snapshot (bypass any caching)
    #[serde(default)]
    pub fresh: bool,
}

/// Capture a single snapshot from camera
#[instrument(skip(state))]
pub async fn snapshot(
    State(state): State<AppState>,
    Path(camera_id): Path<i64>,
    Query(query): Query<SnapshotQuery>,
) -> Result<Response, ApiError> {
    debug!(camera_id, ?query, "Capturing snapshot");

    // Get session
    let session_id = state.session_manager
        .get_session()
        .await
        .map_err(|e| ApiError::Session(e.to_string()))?;

    let width = query.width.unwrap_or(state.config.default_video_width);
    let height = query.height.unwrap_or(state.config.default_video_height);
    let quality = query.quality.unwrap_or(state.config.default_video_quality).min(10).max(1);

    // Check cache if not requesting fresh
    let cache_key = format!("snapshot:{}:{}x{}:q{}", camera_id, width, height, quality);
    if !query.fresh {
        if let Some(ref cache) = state.cache_service {
            if let Ok(Some(cached_bytes)) = cache.get_raw(&cache_key).await {
                if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&cached_bytes) {
                    debug!(camera_id, "Returning cached snapshot");
                    return Ok(build_snapshot_response(bytes.into()));
                }
            }
        }
    }

    // Fetch fresh snapshot
    let bytes = state.exacq_client
        .get_snapshot(&session_id, camera_id, width, height, quality)
        .await
        .map_err(|e| ApiError::Stream(e.to_string()))?;

    info!(
        camera_id,
        width,
        height,
        quality,
        size_bytes = bytes.len(),
        "Captured snapshot"
    );

    // Cache the snapshot briefly (5 seconds)
    if let Some(ref cache) = state.cache_service {
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        if let Err(e) = cache.set_with_ttl(&cache_key, &encoded, 5).await {
            warn!(error = %e, "Failed to cache snapshot");
        }
    }

    Ok(build_snapshot_response(bytes))
}

/// Build HTTP response for snapshot image
fn build_snapshot_response(bytes: Bytes) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header(header::CONTENT_LENGTH, bytes.len())
        .header(header::CACHE_CONTROL, "no-cache, max-age=0")
        .body(Body::from(bytes))
        .unwrap()
}
