// Created and developed by Jai Singh
//! Authentication client for rust-ai-service
//!
//! Validates JWT tokens by calling rust-core-service.
//! Falls back to service API key for internal calls.

use axum::{
    http::HeaderMap,
    response::{IntoResponse, Response},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::{error, instrument, warn};

/// Authentication configuration
#[derive(Debug, Clone)]
pub struct AuthConfig {
    pub rust_core_url: String,
    pub service_api_key: String,
}

impl AuthConfig {
    pub fn from_env() -> Self {
        Self {
            rust_core_url: std::env::var("RUST_CORE_URL")
                .unwrap_or_else(|_| "http://localhost:8010".to_string()),
            service_api_key: std::env::var("RUST_CORE_API_KEY")
                .expect("RUST_CORE_API_KEY must be set"),
        }
    }
}

/// Validated user information from JWT
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthenticatedUser {
    pub user_id: String,
    pub email: Option<String>,
    pub organization_id: Option<String>,
    pub role: Option<String>,
    pub permissions: Vec<String>,
}

/// Auth client for validating tokens
#[derive(Clone)]
pub struct AuthClient {
    http_client: reqwest::Client,
    config: AuthConfig,
}

impl AuthClient {
    pub fn new(config: AuthConfig) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .expect("Failed to create HTTP client");
        
        Self { http_client, config }
    }
    
    /// Validate a JWT token via rust-core-service
    #[instrument(skip(self, token))]
    pub async fn validate_token(&self, token: &str) -> Result<AuthenticatedUser, AuthError> {
        let url = format!("{}/api/v1/auth/validate-with-profile", self.config.rust_core_url);
        
        let response = self.http_client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("X-Service-Key", &self.config.service_api_key)
            .json(&serde_json::json!({"token": token}))
            .send()
            .await
            .map_err(|e| {
                error!(error = %e, "Failed to connect to auth service");
                AuthError::ServiceUnavailable
            })?;
        
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            warn!(status = %status, body = %body, "Auth validation failed");
            
            return match status.as_u16() {
                401 => Err(AuthError::InvalidToken),
                403 => Err(AuthError::Forbidden),
                _ => Err(AuthError::ServiceError(body)),
            };
        }
        
        #[derive(Deserialize)]
        struct ValidationResponse {
            valid: bool,
            user_id: Option<String>,
            email: Option<String>,
            organization_id: Option<String>,
            role: Option<String>,
            permissions: Option<Vec<String>>,
            #[allow(dead_code)]
            error: Option<String>,
        }
        
        let result: ValidationResponse = response.json().await.map_err(|e| {
            error!(error = %e, "Failed to parse auth response");
            AuthError::ServiceError(e.to_string())
        })?;
        
        if !result.valid {
            return Err(AuthError::InvalidToken);
        }
        
        Ok(AuthenticatedUser {
            user_id: result.user_id.ok_or(AuthError::InvalidToken)?,
            email: result.email,
            organization_id: result.organization_id,
            role: result.role,
            permissions: result.permissions.unwrap_or_default(),
        })
    }
    
    /// Validate service API key (for internal service-to-service calls)
    pub fn validate_service_key(&self, key: &str) -> bool {
        // SECURITY: Only accept the exact configured service API key.
        // The previous starts_with("onbx_") pattern accepted ANY key with that prefix,
        // bypassing proper authentication. Centralized DB validation is done by rust-core-service.
        key == self.config.service_api_key
    }
}

/// Authentication errors
#[derive(Debug)]
pub enum AuthError {
    MissingAuth,
    InvalidToken,
    Forbidden,
    ServiceUnavailable,
    ServiceError(String),
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AuthError::MissingAuth => (StatusCode::UNAUTHORIZED, "Authentication required"),
            AuthError::InvalidToken => (StatusCode::UNAUTHORIZED, "Invalid or expired token"),
            AuthError::Forbidden => (StatusCode::FORBIDDEN, "Access denied"),
            AuthError::ServiceUnavailable => (StatusCode::SERVICE_UNAVAILABLE, "Auth service unavailable"),
            AuthError::ServiceError(ref msg) => {
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
                    "error": "Authentication error",
                    "details": msg
                }))).into_response();
            }
        };
        
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

/// Extract Bearer token from Authorization header
pub fn extract_bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
}

/// Extract service API key from X-Service-Key header
pub fn extract_service_key(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("X-Service-Key")
        .and_then(|v| v.to_str().ok())
}

// Created and developed by Jai Singh
