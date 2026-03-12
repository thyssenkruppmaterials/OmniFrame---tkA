//! API error handling

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use thiserror::Error;

/// API error types
#[derive(Debug, Error)]
pub enum ApiError {
    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Too many requests")]
    RateLimitExceeded,

    #[error("Rate limited: {0}")]
    RateLimited(String),

    #[error("Internal server error: {0}")]
    Internal(String),

    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Cache error: {0}")]
    Cache(String),

    #[error("JWT error: {0}")]
    Jwt(String),
}

/// API error response body
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            ApiError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", msg.clone()),
            ApiError::Forbidden(msg) => (StatusCode::FORBIDDEN, "FORBIDDEN", msg.clone()),
            ApiError::NotFound(msg) => (StatusCode::NOT_FOUND, "NOT_FOUND", msg.clone()),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "BAD_REQUEST", msg.clone()),
            ApiError::Conflict(msg) => (StatusCode::CONFLICT, "CONFLICT", msg.clone()),
            ApiError::RateLimitExceeded => (
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED",
                "Too many requests, please try again later".to_string(),
            ),
            ApiError::RateLimited(msg) => (
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMITED",
                msg.clone(),
            ),
            ApiError::Internal(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL_ERROR",
                msg.clone(),
            ),
            ApiError::Database(e) => {
                tracing::error!(error = %e, "Database error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "DATABASE_ERROR",
                    "Database operation failed".to_string(),
                )
            }
            ApiError::Cache(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "CACHE_ERROR",
                msg.clone(),
            ),
            ApiError::Jwt(msg) => (StatusCode::UNAUTHORIZED, "JWT_ERROR", msg.clone()),
        };

        // Log errors
        match status {
            StatusCode::INTERNAL_SERVER_ERROR => {
                tracing::error!(code = %code, message = %message, "API error");
            }
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                tracing::warn!(code = %code, message = %message, "Auth error");
            }
            _ => {
                tracing::debug!(code = %code, message = %message, "API error");
            }
        }

        // Record metrics
        metrics::counter!(
            "api.errors",
            "status" => status.as_str().to_string(),
            "code" => code.to_string()
        ).increment(1);

        let body = ErrorResponse {
            error: message,
            code: code.to_string(),
            details: None,
        };

        (status, Json(body)).into_response()
    }
}

/// Result type for API handlers
pub type ApiResult<T> = Result<T, ApiError>;
