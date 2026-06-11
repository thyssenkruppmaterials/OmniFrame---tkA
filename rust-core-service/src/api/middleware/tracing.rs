// Created and developed by Jai Singh
//! Request tracing middleware

use axum::{
    extract::Request,
    middleware::Next,
    response::Response,
};
use std::time::Instant;
use tracing::info;
use uuid::Uuid;

/// Request tracing middleware that adds timing and request ID
pub async fn tracing_middleware(
    mut request: Request,
    next: Next,
) -> Response {
    let start = Instant::now();
    
    // Generate or extract request ID
    let request_id = request
        .headers()
        .get("x-request-id")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    // Add request ID to extensions
    request.extensions_mut().insert(RequestId(request_id.clone()));

    // Extract request info for logging
    let method = request.method().clone();
    let uri = request.uri().clone();
    let path = uri.path().to_string();

    // Execute request
    let response = next.run(request).await;

    // Calculate duration
    let duration = start.elapsed();
    let status = response.status();

    // Log request completion
    info!(
        request_id = %request_id,
        method = %method,
        path = %path,
        status = %status.as_u16(),
        duration_ms = %duration.as_millis(),
        "Request completed"
    );

    // Record metrics
    metrics::histogram!(
        "http.request.duration_ms",
        "method" => method.to_string(),
        "path" => sanitize_path(&path),
        "status" => status.as_u16().to_string()
    ).record(duration.as_millis() as f64);

    metrics::counter!(
        "http.requests",
        "method" => method.to_string(),
        "status" => status.as_u16().to_string()
    ).increment(1);

    response
}

/// Request ID wrapper
#[derive(Clone)]
pub struct RequestId(pub String);

/// Sanitize path for metrics (replace IDs with placeholders)
fn sanitize_path(path: &str) -> String {
    // Replace UUIDs with {id}
    let uuid_regex = regex_lite::Regex::new(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    ).unwrap();
    let sanitized = uuid_regex.replace_all(path, "{id}");

    // Replace numeric IDs with {id}
    let numeric_regex = regex_lite::Regex::new(r"/\d+(/|$)").unwrap();
    numeric_regex.replace_all(&sanitized, "/{id}$1").to_string()
}

// Created and developed by Jai Singh
