use axum::{
    extract::{Request, State, Query},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use std::sync::Arc;
use tracing::{info, warn};

use crate::auth::{extract_bearer_token, extract_service_key, AuthenticatedUser, AuthError};
use crate::state::AppState;

pub async fn require_auth(
    State(state): State<Arc<AppState>>,
    mut request: Request,
    next: Next,
) -> Response {
    let headers = request.headers();

    if let Some(service_key) = extract_service_key(headers) {
        if state.auth_client.validate_service_key(service_key) {
            info!("Authenticated via service API key");
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

    let token = match extract_bearer_token(headers) {
        Some(t) => t.to_string(),
        None => {
            warn!("Missing authentication");
            return AuthError::MissingAuth.into_response();
        }
    };

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

pub async fn require_organization(
    State(_state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    let user = match request.extensions().get::<AuthenticatedUser>() {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Authentication required" })),
            ).into_response();
        }
    };

    if user.organization_id.is_none() && user.role.as_deref() != Some("service") {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Organization context required" })),
        ).into_response();
    }

    next.run(request).await
}

#[derive(Deserialize)]
pub struct TokenQuery {
    pub token: Option<String>,
}

pub async fn require_auth_or_query_token(
    State(state): State<Arc<AppState>>,
    Query(query): Query<TokenQuery>,
    mut request: Request,
    next: Next,
) -> Response {
    let headers = request.headers();

    if let Some(service_key) = extract_service_key(headers) {
        if state.auth_client.validate_service_key(service_key) {
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

    if let Some(bearer) = extract_bearer_token(headers) {
        match state.auth_client.validate_token(bearer).await {
            Ok(user) => {
                request.extensions_mut().insert(user);
                return next.run(request).await;
            }
            Err(e) => {
                warn!(error = ?e, "Bearer token validation failed");
                return e.into_response();
            }
        }
    }

    if let Some(ref token_str) = query.token {
        let raw = token_str.strip_prefix("Bearer ").unwrap_or(token_str);
        match state.auth_client.validate_token(raw).await {
            Ok(user) => {
                info!(user_id = %user.user_id, "Authenticated via query token");
                request.extensions_mut().insert(user);
                return next.run(request).await;
            }
            Err(e) => {
                warn!(error = ?e, "Query token validation failed");
                return e.into_response();
            }
        }
    }

    AuthError::MissingAuth.into_response()
}

pub async fn require_telemetry_auth(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    let secret = request.headers()
        .get("X-Telemetry-Token")
        .and_then(|v| v.to_str().ok());

    let expected = state.config.telemetry_shared_secret.as_deref();

    match (secret, expected) {
        (Some(provided), Some(expected_val)) if provided == expected_val => {
            next.run(request).await
        }
        (_, None) => {
            next.run(request).await
        }
        _ => {
            warn!("Telemetry auth failed");
            (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Invalid telemetry token"}))).into_response()
        }
    }
}
