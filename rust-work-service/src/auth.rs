// Created and developed by Jai Singh
//! Authentication client for rust-work-service
//!
//! Validates JWT tokens by calling rust-core-service.
//! Supports service API keys for internal service-to-service calls.

use axum::{
    http::HeaderMap,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use moka::future::Cache;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, error, info, instrument, warn};

/// Authentication configuration
#[derive(Debug, Clone)]
pub struct AuthConfig {
    /// URL of rust-core-service
    pub rust_core_url: String,
    /// Service API key for authenticating with rust-core-service
    pub service_api_key: String,
    /// Overall request timeout in seconds (default 15)
    pub timeout_secs: u64,
    /// TTL (seconds) for the in-process JWT-validation cache. `0`
    /// disables caching entirely (every request hits rust-core).
    /// Default 30s — short enough that a mid-token permission/role
    /// change or a revocation takes effect within the window, long
    /// enough to collapse per-request validation under WS-reconnect
    /// load. (`AUTH_CACHE_TTL_SECS`)
    pub cache_ttl_secs: u64,
    /// Maximum number of distinct tokens held in the validation cache.
    /// Bounds memory; least-recently-used entries are evicted beyond
    /// this. (`AUTH_CACHE_MAX_CAPACITY`, default 10_000)
    pub cache_max_capacity: u64,
}

impl AuthConfig {
    /// Create AuthConfig from environment variables
    pub fn from_env() -> Self {
        let (cache_ttl_secs, cache_max_capacity) = Self::cache_settings_from_env();
        Self {
            rust_core_url: std::env::var("RUST_CORE_URL")
                .unwrap_or_else(|_| "http://localhost:8010".to_string()),
            service_api_key: std::env::var("RUST_CORE_API_KEY")
                .expect("RUST_CORE_API_KEY must be set"),
            timeout_secs: std::env::var("AUTH_TIMEOUT_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(15),
            cache_ttl_secs,
            cache_max_capacity,
        }
    }

    /// Read `(cache_ttl_secs, cache_max_capacity)` from the environment
    /// with their defaults. Shared by [`AuthConfig::from_env`] and the
    /// call site in `main.rs` that threads the other fields from the app
    /// `Config`, so the defaults live in exactly one place.
    /// `AUTH_CACHE_TTL_SECS` default 30, `AUTH_CACHE_MAX_CAPACITY` default 10_000.
    pub fn cache_settings_from_env() -> (u64, u64) {
        let ttl = std::env::var("AUTH_CACHE_TTL_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30);
        let cap = std::env::var("AUTH_CACHE_MAX_CAPACITY")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(10_000);
        (ttl, cap)
    }
}

/// Validated user information extracted from JWT
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthenticatedUser {
    /// Unique user identifier
    pub user_id: String,
    /// User's email address
    pub email: Option<String>,
    /// Organization the user belongs to
    pub organization_id: Option<String>,
    /// User's role within the organization
    pub role: Option<String>,
    /// List of granted permissions
    pub permissions: Vec<String>,
}

/// HTTP client for validating tokens against rust-core-service.
///
/// Holds an optional in-process L1 cache (`moka`) keyed on the full JWT
/// string. On a cache hit the cached `AuthenticatedUser` is returned
/// without any HTTP round-trip to rust-core-service. Only successful
/// validations are cached; errors (invalid/expired/forbidden) and
/// upstream failures are never stored, so a revoked or rejected token is
/// re-checked on every request. The cache entry lifetime is bounded by
/// `cache_ttl_secs`, which also bounds how long a *successful*
/// validation can outlive a mid-token authorization change.
///
/// The value is stored as `Arc<AuthenticatedUser>` (not a bare
/// `AuthenticatedUser`). A hit then clones a single pointer instead of
/// deep-copying the user's `Vec<String>` permissions and several
/// `String`s on every protected request. The same `Arc` is threaded
/// through the auth middleware into request extensions so route
/// handlers share it with no further deep clone.
#[derive(Clone)]
pub struct AuthClient {
    http_client: reqwest::Client,
    config: AuthConfig,
    /// `Some` when `cache_ttl_secs > 0`; cloning shares the same
    /// underlying cache (moka is internally `Arc`-backed).
    cache: Option<Cache<String, Arc<AuthenticatedUser>>>,
}

impl AuthClient {
    /// Create a new AuthClient with the given configuration
    pub fn new(config: AuthConfig) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .connect_timeout(Duration::from_secs(5))
            .pool_idle_timeout(Duration::from_secs(90))
            .build()
            .expect("Failed to create HTTP client");

        let cache = if config.cache_ttl_secs > 0 {
            Some(
                Cache::builder()
                    .max_capacity(config.cache_max_capacity)
                    .time_to_live(Duration::from_secs(config.cache_ttl_secs))
                    .build(),
            )
        } else {
            None
        };

        info!(
            timeout_secs = config.timeout_secs,
            cache_ttl_secs = config.cache_ttl_secs,
            cache_max_capacity = config.cache_max_capacity,
            cache_enabled = cache.is_some(),
            "Auth client created"
        );

        Self {
            http_client,
            config,
            cache,
        }
    }

    /// Validate a JWT token, serving from the in-process cache when a
    /// fresh successful validation exists for this exact token.
    ///
    /// Cache semantics:
    /// - **hit** → return the cached `AuthenticatedUser`, no rust-core call.
    /// - **miss** → call rust-core; on success populate the cache, on
    ///   any error return it WITHOUT caching (so rejections/revocations
    ///   are re-evaluated next request).
    ///
    /// When caching is disabled (`cache_ttl_secs == 0`) this is a thin
    /// pass-through to the upstream validation.
    ///
    /// Returns `Arc<AuthenticatedUser>` so a cache hit is a pointer
    /// clone rather than a deep copy of the user's permissions/strings;
    /// the caller (auth middleware) shares this `Arc` straight into
    /// request extensions.
    #[instrument(skip(self, token))]
    pub async fn validate_token(&self, token: &str) -> Result<Arc<AuthenticatedUser>, AuthError> {
        let Some(cache) = &self.cache else {
            return self.validate_token_uncached(token).await.map(Arc::new);
        };

        if let Some(user) = cache.get(token).await {
            crate::observability::metrics::WORK_AUTH_CACHE_TOTAL
                .with_label_values(&["hit"])
                .inc();
            return Ok(user);
        }

        crate::observability::metrics::WORK_AUTH_CACHE_TOTAL
            .with_label_values(&["miss"])
            .inc();

        // Miss: validate upstream. `?` short-circuits on error BEFORE the
        // insert below, so failures are never cached.
        let user = Arc::new(self.validate_token_uncached(token).await?);
        cache.insert(token.to_string(), Arc::clone(&user)).await;
        debug!("auth cache populated for validated token");
        Ok(user)
    }

    /// Validate a JWT token via rust-core-service with one automatic retry
    /// on timeout. This always performs the upstream round-trip; the cache
    /// layer lives in [`validate_token`].
    async fn validate_token_uncached(&self, token: &str) -> Result<AuthenticatedUser, AuthError> {
        let mut last_err = AuthError::ServiceUnavailable;
        for attempt in 0..2u8 {
            match self.try_validate_token(token).await {
                Ok(user) => return Ok(user),
                Err(AuthError::ServiceUnavailable) if attempt == 0 => {
                    warn!("Auth service unavailable (attempt 1), retrying in 2s…");
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    last_err = AuthError::ServiceUnavailable;
                }
                Err(e) => return Err(e),
            }
        }
        error!("Auth service unavailable after retry");
        Err(last_err)
    }

    /// Single attempt to validate a token against rust-core-service.
    async fn try_validate_token(&self, token: &str) -> Result<AuthenticatedUser, AuthError> {
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
    /// No authentication credentials provided
    MissingAuth,
    /// Token is invalid or expired
    InvalidToken,
    /// User lacks required permissions
    Forbidden,
    /// Authentication service is unavailable
    ServiceUnavailable,
    /// Unexpected error from authentication service
    ServiceError(String),
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AuthError::MissingAuth => (StatusCode::UNAUTHORIZED, "Authentication required"),
            AuthError::InvalidToken => (StatusCode::UNAUTHORIZED, "Invalid or expired token"),
            AuthError::Forbidden => (StatusCode::FORBIDDEN, "Access denied"),
            AuthError::ServiceUnavailable => {
                (StatusCode::SERVICE_UNAVAILABLE, "Auth service unavailable")
            }
            AuthError::ServiceError(ref msg) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "error": "Authentication error",
                        "details": msg
                    })),
                )
                    .into_response();
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
    headers.get("X-Service-Key").and_then(|v| v.to_str().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    #[test]
    fn extract_bearer_token_returns_token_for_valid_header() {
        let mut headers = HeaderMap::new();
        headers.insert("Authorization", "Bearer abc123".parse().unwrap());
        assert_eq!(extract_bearer_token(&headers), Some("abc123"));
    }

    #[test]
    fn extract_bearer_token_returns_none_for_missing_header() {
        let headers = HeaderMap::new();
        assert_eq!(extract_bearer_token(&headers), None);
    }

    #[test]
    fn extract_bearer_token_returns_none_for_non_bearer() {
        let mut headers = HeaderMap::new();
        headers.insert("Authorization", "Basic dXNlcjpwYXNz".parse().unwrap());
        assert_eq!(extract_bearer_token(&headers), None);
    }

    #[test]
    fn validate_service_key_accepts_exact_match() {
        let config = AuthConfig {
            rust_core_url: "http://localhost:8010".into(),
            service_api_key: "test-key-123".into(),
            timeout_secs: 15,
            cache_ttl_secs: 30,
            cache_max_capacity: 10_000,
        };
        let client = AuthClient::new(config);
        assert!(client.validate_service_key("test-key-123"));
    }

    #[test]
    fn validate_service_key_rejects_prefix_only() {
        let config = AuthConfig {
            rust_core_url: "http://localhost:8010".into(),
            service_api_key: "test-key-123".into(),
            timeout_secs: 15,
            cache_ttl_secs: 30,
            cache_max_capacity: 10_000,
        };
        let client = AuthClient::new(config);
        assert!(!client.validate_service_key("test-key"));
        assert!(!client.validate_service_key("wrong-key"));
    }

    #[test]
    fn extract_service_key_returns_key_when_present() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Service-Key", "my-secret".parse().unwrap());
        assert_eq!(extract_service_key(&headers), Some("my-secret"));
    }

    /// Build a config pointing at an unreachable upstream so any test
    /// that actually performs the rust-core round-trip fails fast/loud,
    /// while cache-hit tests never touch the network at all.
    fn unreachable_config(cache_ttl_secs: u64) -> AuthConfig {
        AuthConfig {
            rust_core_url: "http://127.0.0.1:1".into(), // nothing listens here
            service_api_key: "k".into(),
            timeout_secs: 1,
            cache_ttl_secs,
            cache_max_capacity: 16,
        }
    }

    fn sample_user() -> AuthenticatedUser {
        AuthenticatedUser {
            user_id: "u1".into(),
            email: Some("a@b.c".into()),
            organization_id: Some("org-1".into()),
            role: Some("admin".into()),
            permissions: vec!["work:read".into()],
        }
    }

    #[test]
    fn cache_disabled_when_ttl_zero() {
        let client = AuthClient::new(unreachable_config(0));
        assert!(
            client.cache.is_none(),
            "ttl=0 must disable the in-process auth cache"
        );
    }

    #[test]
    fn cache_enabled_when_ttl_positive() {
        let client = AuthClient::new(unreachable_config(30));
        assert!(
            client.cache.is_some(),
            "ttl>0 must enable the in-process auth cache"
        );
    }

    #[tokio::test]
    async fn validate_token_serves_cached_user_without_upstream() {
        // Upstream is unreachable. If the cache-hit path works, no network
        // call is made and this returns the cached user immediately. If
        // caching were broken, it would fall through to the refused
        // upstream and error — making this a true wiring test.
        let client = AuthClient::new(unreachable_config(30));
        let token = "header.payload.sig";
        client
            .cache
            .as_ref()
            .unwrap()
            .insert(token.to_string(), Arc::new(sample_user()))
            .await;

        let got = client
            .validate_token(token)
            .await
            .expect("a cached validation must be served without any upstream call");
        assert_eq!(got.user_id, "u1");
        assert_eq!(got.organization_id.as_deref(), Some("org-1"));
        assert_eq!(got.permissions, vec!["work:read".to_string()]);
    }

    #[tokio::test]
    async fn failed_validation_is_not_cached() {
        // A miss against the unreachable upstream must return an error and
        // must NOT populate the cache — otherwise a transient outage (or a
        // rejected token) could be "remembered" as a result. This is the
        // security-relevant invariant: only successes are cached.
        let client = AuthClient::new(unreachable_config(30));
        let token = "never.valid.token";

        let err = client.validate_token(token).await;
        assert!(matches!(err, Err(AuthError::ServiceUnavailable)));

        let cached = client.cache.as_ref().unwrap().get(token).await;
        assert!(
            cached.is_none(),
            "an errored validation must never be cached"
        );
    }
}

// Created and developed by Jai Singh
