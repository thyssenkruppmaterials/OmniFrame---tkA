// Created and developed by Jai Singh
//! Authentication client for rust-dashboard-service
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    #[test]
    fn extract_bearer_token_returns_token_for_valid_header() {
        let mut headers = HeaderMap::new();
        headers.insert("Authorization", "Bearer my-jwt-token-123".parse().unwrap());
        assert_eq!(extract_bearer_token(&headers), Some("my-jwt-token-123"));
    }

    #[test]
    fn extract_bearer_token_returns_none_when_missing() {
        let headers = HeaderMap::new();
        assert_eq!(extract_bearer_token(&headers), None);
    }

    #[test]
    fn extract_bearer_token_returns_none_for_non_bearer_scheme() {
        let mut headers = HeaderMap::new();
        headers.insert("Authorization", "Basic abc123".parse().unwrap());
        assert_eq!(extract_bearer_token(&headers), None);
    }

    #[test]
    fn extract_service_key_returns_key_when_present() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Service-Key", "onbx_da_secret_key_abc".parse().unwrap());
        assert_eq!(extract_service_key(&headers), Some("onbx_da_secret_key_abc"));
    }

    #[test]
    fn validate_service_key_accepts_exact_match_and_rejects_others() {
        let config = AuthConfig {
            rust_core_url: "http://localhost:8010".to_string(),
            service_api_key: "onbx_da_correct_key".to_string(),
        };
        let client = AuthClient::new(config);

        assert!(client.validate_service_key("onbx_da_correct_key"));
        assert!(!client.validate_service_key("onbx_da_wrong_key"));
        assert!(!client.validate_service_key(""));
        assert!(!client.validate_service_key("onbx_da_correct_key_extra"));
    }

    #[test]
    fn authenticated_user_serializes_all_fields_correctly() {
        let user = AuthenticatedUser {
            user_id: "user-abc-123".to_string(),
            email: Some("test@onebox.ai".to_string()),
            organization_id: Some("org-xyz-789".to_string()),
            role: Some("admin".to_string()),
            permissions: vec!["read".to_string(), "write".to_string()],
        };
        let json = serde_json::to_value(&user).unwrap();

        assert_eq!(json["user_id"], "user-abc-123");
        assert_eq!(json["email"], "test@onebox.ai");
        assert_eq!(json["organization_id"], "org-xyz-789");
        assert_eq!(json["role"], "admin");
        assert_eq!(json["permissions"], serde_json::json!(["read", "write"]));
    }

    #[test]
    fn authenticated_user_deserializes_with_empty_permissions() {
        let json_str = r#"{
            "user_id": "u1",
            "email": null,
            "organization_id": null,
            "role": null,
            "permissions": []
        }"#;
        let user: AuthenticatedUser = serde_json::from_str(json_str).unwrap();

        assert_eq!(user.user_id, "u1");
        assert!(user.email.is_none());
        assert!(user.organization_id.is_none());
        assert!(user.role.is_none());
        assert!(user.permissions.is_empty());
    }
}

// Created and developed by Jai Singh
