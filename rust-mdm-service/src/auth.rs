use axum::{
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::{error, instrument, warn};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthenticatedUser {
    pub user_id: String,
    pub email: Option<String>,
    pub organization_id: Option<String>,
    pub role: Option<String>,
    pub permissions: Vec<String>,
}

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

    #[instrument(skip(self, token))]
    pub async fn validate_token(&self, token: &str) -> Result<AuthenticatedUser, AuthError> {
        let url = format!("{}/api/v1/auth/validate-with-profile", self.config.rust_core_url);

        let response = self
            .http_client
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

    pub fn validate_service_key(&self, key: &str) -> bool {
        key == self.config.service_api_key
    }
}

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
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "Authentication error", "details": msg })),
                ).into_response();
            }
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

pub fn extract_bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers.get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
}

pub fn extract_service_key(headers: &HeaderMap) -> Option<&str> {
    headers.get("X-Service-Key").and_then(|v| v.to_str().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    #[test]
    fn extract_bearer_token_works() {
        let mut headers = HeaderMap::new();
        headers.insert("Authorization", "Bearer abc123".parse().unwrap());
        assert_eq!(extract_bearer_token(&headers), Some("abc123"));
    }

    #[test]
    fn extract_bearer_token_returns_none_for_missing() {
        let headers = HeaderMap::new();
        assert_eq!(extract_bearer_token(&headers), None);
    }

    #[test]
    fn extract_service_key_works() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Service-Key", "key123".parse().unwrap());
        assert_eq!(extract_service_key(&headers), Some("key123"));
    }
}
