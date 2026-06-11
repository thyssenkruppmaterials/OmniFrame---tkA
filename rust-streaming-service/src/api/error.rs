// Created and developed by Jai Singh
//! API error handling
//!
//! Centralized error types and response formatting.

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

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Internal server error: {0}")]
    Internal(String),

    #[error("ExacqVision error: {0}")]
    Exacq(String),

    #[error("Session error: {0}")]
    Session(String),

    #[error("Stream error: {0}")]
    Stream(String),

    #[error("Cache error: {0}")]
    Cache(String),

    #[error("WebSocket error: {0}")]
    WebSocket(String),
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
            ApiError::NotFound(msg) => (StatusCode::NOT_FOUND, "NOT_FOUND", msg.clone()),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "BAD_REQUEST", msg.clone()),
            ApiError::Internal(msg) => {
                tracing::error!(error = %msg, "Internal server error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL_ERROR",
                    msg.clone(),
                )
            }
            ApiError::Exacq(msg) => {
                tracing::error!(error = %msg, "ExacqVision error");
                (
                    StatusCode::BAD_GATEWAY,
                    "EXACQ_ERROR",
                    msg.clone(),
                )
            }
            ApiError::Session(msg) => {
                tracing::warn!(error = %msg, "Session error");
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "SESSION_ERROR",
                    msg.clone(),
                )
            }
            ApiError::Stream(msg) => {
                tracing::error!(error = %msg, "Stream error");
                (
                    StatusCode::BAD_GATEWAY,
                    "STREAM_ERROR",
                    msg.clone(),
                )
            }
            ApiError::Cache(msg) => {
                tracing::warn!(error = %msg, "Cache error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "CACHE_ERROR",
                    msg.clone(),
                )
            }
            ApiError::WebSocket(msg) => {
                tracing::error!(error = %msg, "WebSocket error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "WEBSOCKET_ERROR",
                    msg.clone(),
                )
            }
        };

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

/// Convert anyhow errors to API errors
impl From<anyhow::Error> for ApiError {
    fn from(err: anyhow::Error) -> Self {
        ApiError::Internal(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_error_variants_map_to_correct_status_codes() {
        let cases: Vec<(ApiError, StatusCode)> = vec![
            (ApiError::Unauthorized("bad".into()), StatusCode::UNAUTHORIZED),
            (ApiError::NotFound("missing".into()), StatusCode::NOT_FOUND),
            (ApiError::BadRequest("invalid".into()), StatusCode::BAD_REQUEST),
            (ApiError::Internal("oops".into()), StatusCode::INTERNAL_SERVER_ERROR),
            (ApiError::Exacq("timeout".into()), StatusCode::BAD_GATEWAY),
            (ApiError::Session("expired".into()), StatusCode::SERVICE_UNAVAILABLE),
            (ApiError::Stream("broken".into()), StatusCode::BAD_GATEWAY),
            (ApiError::Cache("miss".into()), StatusCode::INTERNAL_SERVER_ERROR),
            (ApiError::WebSocket("closed".into()), StatusCode::INTERNAL_SERVER_ERROR),
        ];

        for (error, expected_status) in cases {
            let response = error.into_response();
            assert_eq!(response.status(), expected_status);
        }
    }

    #[test]
    fn error_response_omits_details_when_none() {
        let resp = ErrorResponse {
            error: "Something failed".to_string(),
            code: "TEST_ERROR".to_string(),
            details: None,
        };
        let json = serde_json::to_value(&resp).unwrap();

        assert_eq!(json["error"], "Something failed");
        assert_eq!(json["code"], "TEST_ERROR");
        assert!(json.get("details").is_none());
    }

    #[test]
    fn error_response_includes_details_when_present() {
        let resp = ErrorResponse {
            error: "Validation failed".to_string(),
            code: "BAD_REQUEST".to_string(),
            details: Some(serde_json::json!({"field": "camera_id", "reason": "must be positive"})),
        };
        let json = serde_json::to_value(&resp).unwrap();

        assert_eq!(json["error"], "Validation failed");
        assert_eq!(json["details"]["field"], "camera_id");
        assert_eq!(json["details"]["reason"], "must be positive");
    }

    #[test]
    fn anyhow_error_converts_to_internal_api_error() {
        let anyhow_err = anyhow::anyhow!("unexpected failure");
        let api_err: ApiError = anyhow_err.into();

        match api_err {
            ApiError::Internal(msg) => assert_eq!(msg, "unexpected failure"),
            other => panic!("Expected ApiError::Internal, got {:?}", other),
        }
    }
}

// Created and developed by Jai Singh
