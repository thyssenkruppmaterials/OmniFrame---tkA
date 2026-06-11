// Created and developed by Jai Singh
//! Authentication middleware for rust-dashboard-service

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use std::sync::Arc;
use tracing::{info, warn};

use crate::auth::{AuthenticatedUser, AuthError, extract_bearer_token, extract_service_key};
use crate::AppState;

/// Middleware that requires authentication for all requests
pub async fn require_auth(
    State(state): State<Arc<AppState>>,
    mut request: Request,
    next: Next,
) -> Response {
    let headers = request.headers();
    
    // Check for service API key first (internal calls)
    if let Some(service_key) = extract_service_key(headers) {
        if state.auth_client.validate_service_key(service_key) {
            info!("Authenticated via service API key");
            // For service calls, create a system user context
            let system_user = AuthenticatedUser {
                user_id: "system".to_string(),
                email: None,
                organization_id: None,
                role: Some("service".to_string()),
                permissions: vec!["*".to_string()],
            };
            request.extensions_mut().insert(system_user);
            return next.run(request).await;
        }
    }
    
    // Check for Bearer token (user calls)
    let token = match extract_bearer_token(headers) {
        Some(t) => t.to_string(),
        None => {
            warn!("Missing authentication");
            return AuthError::MissingAuth.into_response();
        }
    };
    
    // Validate token via rust-core-service
    match state.auth_client.validate_token(&token).await {
        Ok(user) => {
            info!(user_id = %user.user_id, "User authenticated");
            request.extensions_mut().insert(user);
            next.run(request).await
        }
        Err(e) => {
            warn!(error = ?e, "Authentication failed");
            e.into_response()
        }
    }
}

/// Middleware that validates organization context
#[allow(dead_code)]
pub async fn require_organization(
    State(_state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    // Get authenticated user from request extensions
    let user = match request.extensions().get::<AuthenticatedUser>() {
        Some(u) => u,
        None => {
            return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({
                "error": "Authentication required"
            }))).into_response();
        }
    };
    
    // Check for organization context
    if user.organization_id.is_none() && user.role.as_deref() != Some("service") {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({
            "error": "Organization context required"
        }))).into_response();
    }
    
    next.run(request).await
}

/// Extractor for authenticated user
#[allow(dead_code)]
pub async fn get_current_user(
    request: &Request,
) -> Result<AuthenticatedUser, AuthError> {
    request
        .extensions()
        .get::<AuthenticatedUser>()
        .cloned()
        .ok_or(AuthError::MissingAuth)
}

// Created and developed by Jai Singh
