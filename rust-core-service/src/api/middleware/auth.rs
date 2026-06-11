// Created and developed by Jai Singh
//! Authentication middleware for Axum

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use std::collections::HashSet;
use std::sync::Arc;
use uuid::Uuid;

use crate::AppState;
use crate::auth::{jwt::{JwtValidator, extract_bearer_token, hash_token}, rbac::RbacService};
use crate::cache::session::SessionService;

/// Shared authentication state
#[derive(Clone)]
pub struct AuthState {
    pub jwt_validator: Arc<JwtValidator>,
    pub rbac_service: Arc<RbacService>,
    pub session_service: Option<Arc<SessionService>>,
}

/// Authenticated user information extracted from JWT
#[derive(Clone, Debug)]
pub struct AuthenticatedUser {
    pub user_id: String,
    pub email: Option<String>,
    pub role: String,
    pub permissions: HashSet<String>,
    /// Organization ID from the user's profile (populated via cached session).
    /// - `Some(id)` for authenticated users with an organization assignment.
    /// - `None` for service-to-service calls or users without an org (gives access to all orgs).
    pub organization_id: Option<Uuid>,
}

/// Authentication middleware
///
/// Validates JWT tokens and extracts user information.
/// Caches sessions to avoid repeated validation (if session service is available).
pub async fn auth_middleware(
    State(state): State<AuthState>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // Extract Authorization header
    let auth_header = request
        .headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Extract bearer token
    let token = extract_bearer_token(auth_header)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Hash token for cache lookup
    let token_hash = hash_token(token);

    // Check session cache first (if available)
    if let Some(ref session_service) = state.session_service {
        if let Ok(Some(cached_session)) = session_service.get_session(&token_hash).await {
            // Refresh session in background
            let ss = session_service.clone();
            let hash = token_hash.clone();
            tokio::spawn(async move {
                let _ = ss.refresh_session(&hash).await;
            });

            let user = AuthenticatedUser {
                user_id: cached_session.user_id,
                email: Some(cached_session.email),
                role: cached_session.role,
                organization_id: cached_session.organization_id.and_then(|id| Uuid::parse_str(&id).ok()),
                permissions: cached_session.permissions.into_iter().collect(),
            };

            request.extensions_mut().insert(user);
            return Ok(next.run(request).await);
        }
    }

    // Validate JWT cryptographically
    let claims = state.jwt_validator
        .validate_token(token)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "JWT validation failed");
            StatusCode::UNAUTHORIZED
        })?;

    // Fetch permissions from RBAC
    let permissions = state.rbac_service
        .get_user_permissions(&claims.sub)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "Failed to fetch permissions");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Intentionally do NOT write to the session cache from middleware:
    // we don't have `organization_id` here, and `validate_with_profile` treats
    // any cached session without organization_id as a cache miss, causing a
    // re-fetch storm. Let `validate_with_profile` own all cache writes.
    // See: memorybank/OmniFrame/Debug/Performance-Review-2026-05-19-Production-Slowness.md
    let _ = token_hash; // keep variable in scope for future cache reads

    let user = AuthenticatedUser {
        user_id: claims.sub,
        email: claims.email,
        role: claims.role,
        permissions,
        organization_id: None, // Not available from JWT claims; populated via cached session after validate_with_profile
    };

    request.extensions_mut().insert(user);
    Ok(next.run(request).await)
}

/// Primary authentication middleware for rust-core-service
///
/// Validates requests using either:
/// 1. **Service API Key** (`X-Service-Key` header) — for service-to-service calls,
///    validated against the database via `ApiKeyValidator`.
/// 2. **JWT Bearer Token** (`Authorization: Bearer <token>`) — for user calls,
///    validated cryptographically via `JwtValidator` with RBAC permission lookup.
///
/// Returns 401 Unauthorized if neither credential is present or valid.
///
/// On success, injects [`AuthenticatedUser`] into request extensions so downstream
/// handlers can access the caller's identity and permissions.
///
/// # Usage
/// ```rust,ignore
/// let protected = Router::new()
///     .route("/api", get(handler))
///     .layer(axum::middleware::from_fn_with_state(state.clone(), require_auth));
/// ```
pub async fn require_auth(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    let headers = request.headers();

    // 1. Check for service API key (internal service-to-service calls).
    //    Short-circuit if the value is JWT-shaped (starts with "eyJ"): some
    //    callers were sending the user JWT in BOTH `Authorization: Bearer` AND
    //    `X-Service-Key`, which produced ~50 doomed DB lookups per second
    //    against the 2-row `service_api_keys` table. See:
    //    memorybank/OmniFrame/Debug/Performance-Review-2026-05-19-Production-Slowness.md
    if let Some(service_key) = headers
        .get("X-Service-Key")
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.starts_with("eyJ"))
    {
        match state.api_key_validator.validate(service_key).await {
            Ok(validated_service) => {
                tracing::info!(
                    service = %validated_service.service_name,
                    "Authenticated via service API key"
                );
                metrics::counter!("auth.middleware.api_key_success").increment(1);

                let user = AuthenticatedUser {
                    user_id: format!("service:{}", validated_service.service_name),
                    email: None,
                    role: "service".to_string(),
                    permissions: validated_service.permissions.into_iter().collect(),
                    organization_id: None, // Service accounts access all orgs
                };
                request.extensions_mut().insert(user);
                return next.run(request).await;
            }
            Err(e) => {
                tracing::debug!(error = %e, "API key validation failed, trying JWT");
                // Fall through to JWT validation
            }
        }
    }

    // 2. Check for Bearer token (user calls)
    let auth_header = match headers
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
    {
        Some(h) => h.to_string(),
        None => {
            metrics::counter!("auth.middleware.missing_auth").increment(1);
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({
                    "error": "Unauthorized",
                    "message": "Authentication required. Provide a Bearer token or X-Service-Key header."
                })),
            )
                .into_response();
        }
    };

    let token = match extract_bearer_token(&auth_header) {
        Ok(t) => t,
        Err(_) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({
                    "error": "Unauthorized",
                    "message": "Invalid Authorization header format. Expected 'Bearer <token>'."
                })),
            )
                .into_response();
        }
    };

    let token_hash = hash_token(token);

    // Check session cache first (if Redis is available)
    if let Some(ref session_service) = state.session_service {
        if let Ok(Some(cached_session)) = session_service.get_session(&token_hash).await {
            let ss = session_service.clone();
            let hash = token_hash.clone();
            tokio::spawn(async move {
                let _ = ss.refresh_session(&hash).await;
            });

            let user = AuthenticatedUser {
                user_id: cached_session.user_id,
                email: Some(cached_session.email),
                role: cached_session.role,
                organization_id: cached_session.organization_id.and_then(|id| Uuid::parse_str(&id).ok()),
                permissions: cached_session.permissions.into_iter().collect(),
            };
            request.extensions_mut().insert(user);
            return next.run(request).await;
        }
    }

    // Validate JWT cryptographically
    let claims = match state.jwt_validator.validate_token(token).await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "JWT validation failed");
            metrics::counter!("auth.middleware.jwt_failed").increment(1);
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({
                    "error": "Unauthorized",
                    "message": format!("Invalid or expired token: {}", e)
                })),
            )
                .into_response();
        }
    };

    // Fetch permissions from RBAC
    let permissions = match state.rbac_service.get_user_permissions(&claims.sub).await {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(error = %e, "Failed to fetch user permissions");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Internal server error",
                    "message": "Failed to load user permissions"
                })),
            )
                .into_response();
        }
    };

    // Same rationale as `auth_middleware` above: do NOT cache from this path
    // because organization_id is unavailable. `validate_with_profile` is the
    // canonical cache writer.
    let _ = token_hash;

    metrics::counter!("auth.middleware.jwt_success").increment(1);

    let user = AuthenticatedUser {
        user_id: claims.sub,
        email: claims.email,
        role: claims.role,
        permissions,
        organization_id: None, // Not available from JWT claims; populated via cached session after validate_with_profile
    };

    tracing::debug!(
        user_id = %user.user_id,
        role = %user.role,
        "User authenticated via JWT"
    );

    request.extensions_mut().insert(user);
    next.run(request).await
}

/// Optional authentication - doesn't fail if no token provided
pub async fn optional_auth_middleware(
    State(state): State<AuthState>,
    mut request: Request,
    next: Next,
) -> Response {
    // Try to extract Authorization header
    if let Some(auth_header) = request
        .headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
    {
        // Try to extract and validate token
        if let Ok(token) = extract_bearer_token(auth_header) {
            let token_hash = hash_token(token);

            // Check cache first (if available)
            if let Some(ref session_service) = state.session_service {
                if let Ok(Some(cached_session)) = session_service.get_session(&token_hash).await {
                    let user = AuthenticatedUser {
                        user_id: cached_session.user_id,
                        email: Some(cached_session.email),
                        role: cached_session.role,
                        organization_id: cached_session.organization_id.and_then(|id| Uuid::parse_str(&id).ok()),
                        permissions: cached_session.permissions.into_iter().collect(),
                    };
                    request.extensions_mut().insert(user);
                    return next.run(request).await;
                }
            }
            
            // Validate token and fetch permissions
            if let Ok(claims) = state.jwt_validator.validate_token(token).await {
                if let Ok(permissions) = state.rbac_service.get_user_permissions(&claims.sub).await {
                    let user = AuthenticatedUser {
                        user_id: claims.sub,
                        email: claims.email,
                        role: claims.role,
                        permissions,
                        organization_id: None, // Not available from JWT claims
                    };
                    request.extensions_mut().insert(user);
                }
            }
        }
    }

    next.run(request).await
}

/// Permission checking middleware generator
///
/// Creates middleware that checks for specific permissions.
pub fn require_permission(
    required: &'static str,
) -> impl Fn(
    axum::Extension<AuthenticatedUser>,
    Request,
    Next,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Response, StatusCode>> + Send>>
       + Clone {
    move |auth_user, request, next| {
        Box::pin(async move {
            if has_permission(&auth_user.permissions, required) {
                Ok(next.run(request).await)
            } else {
                tracing::warn!(
                    user_id = %auth_user.user_id,
                    required = required,
                    "Permission denied"
                );
                metrics::counter!("auth.permission_denied").increment(1);
                Err(StatusCode::FORBIDDEN)
            }
        })
    }
}

/// Check if permissions set contains required permission
fn has_permission(permissions: &HashSet<String>, required: &str) -> bool {
    // Check exact match
    if permissions.contains(required) {
        return true;
    }

    // Check wildcards
    if permissions.contains("*") || permissions.contains("admin:*") {
        return true;
    }

    // Check resource wildcards
    if let Some((resource, _action)) = required.split_once(':') {
        let wildcard = format!("{}:*", resource);
        if permissions.contains(&wildcard) {
            return true;
        }
    }

    false
}

// Created and developed by Jai Singh
