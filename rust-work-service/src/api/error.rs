//! API error types for rust-work-service
//!
//! Provides a unified error type for all API responses.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use thiserror::Error;

/// API error response body
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

/// Unified API error type
///
/// All variants have `IntoResponse` implementations and form the complete
/// REST error surface. Some variants are not yet used by route handlers
/// but are kept for API completeness.
#[derive(Debug, Error)]
#[allow(dead_code)] // Variants form complete REST error surface with IntoResponse impls
pub enum ApiError {
    /// Authentication required or token invalid
    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    /// Resource not found
    #[error("Not found: {0}")]
    NotFound(String),

    /// Bad request - invalid input
    #[error("Bad request: {0}")]
    BadRequest(String),

    /// Internal server error
    #[error("Internal error: {0}")]
    Internal(String),

    /// Forbidden - insufficient permissions
    #[error("Forbidden: {0}")]
    Forbidden(String),

    /// Conflict - resource already exists or state conflict
    #[error("Conflict: {0}")]
    Conflict(String),

    /// Service unavailable - dependency failure
    #[error("Service unavailable: {0}")]
    ServiceUnavailable(String),

    /// Database error
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error_response) = match &self {
            ApiError::Unauthorized(msg) => (
                StatusCode::UNAUTHORIZED,
                ErrorResponse {
                    error: msg.clone(),
                    details: None,
                    code: Some("UNAUTHORIZED".to_string()),
                },
            ),
            ApiError::NotFound(msg) => (
                StatusCode::NOT_FOUND,
                ErrorResponse {
                    error: msg.clone(),
                    details: None,
                    code: Some("NOT_FOUND".to_string()),
                },
            ),
            ApiError::BadRequest(msg) => (
                StatusCode::BAD_REQUEST,
                ErrorResponse {
                    error: msg.clone(),
                    details: None,
                    code: Some("BAD_REQUEST".to_string()),
                },
            ),
            ApiError::Internal(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                ErrorResponse {
                    error: "Internal server error".to_string(),
                    details: Some(msg.clone()),
                    code: Some("INTERNAL_ERROR".to_string()),
                },
            ),
            ApiError::Forbidden(msg) => (
                StatusCode::FORBIDDEN,
                ErrorResponse {
                    error: msg.clone(),
                    details: None,
                    code: Some("FORBIDDEN".to_string()),
                },
            ),
            ApiError::Conflict(msg) => (
                StatusCode::CONFLICT,
                ErrorResponse {
                    error: msg.clone(),
                    details: None,
                    code: Some("CONFLICT".to_string()),
                },
            ),
            ApiError::ServiceUnavailable(msg) => (
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorResponse {
                    error: msg.clone(),
                    details: None,
                    code: Some("SERVICE_UNAVAILABLE".to_string()),
                },
            ),
            ApiError::Database(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                ErrorResponse {
                    error: "Database error".to_string(),
                    details: Some(e.to_string()),
                    code: Some("DATABASE_ERROR".to_string()),
                },
            ),
        };

        (status, Json(error_response)).into_response()
    }
}

/// Type alias for API results
pub type ApiResult<T> = Result<T, ApiError>;
