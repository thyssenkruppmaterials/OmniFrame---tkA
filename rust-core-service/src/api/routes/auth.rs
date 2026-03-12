//! Authentication endpoints
//!
//! Provides JWT validation with session caching and profile enrichment.
//! The validate_with_profile endpoint is the primary endpoint for Python
//! to use, returning complete user context including profile data.

use axum::{
    extract::{Path, State},
    Extension,
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api::error::{ApiError, ApiResult};
use crate::api::middleware::AuthenticatedUser;
use crate::AppState;
use crate::auth::hash_token;
use crate::cache::session::CachedSession;
use crate::db::queries::auth::AuthQueries;

/// Token validation request
#[derive(Debug, Deserialize)]
pub struct ValidateTokenRequest {
    pub token: String,
}

/// Token validation response (basic - for backwards compatibility)
#[derive(Debug, Serialize)]
pub struct ValidateTokenResponse {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

/// Complete authentication response with profile data
/// 
/// This is the primary response type for the validate-with-profile endpoint.
/// Contains everything Python needs without making additional database calls.
#[derive(Debug, Serialize)]
pub struct ValidateWithProfileResponse {
    /// Whether the token is valid
    pub valid: bool,
    /// Whether the response came from cache
    pub cached: bool,
    
    // === User identity ===
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    
    // === Authorization ===
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Vec<String>>,
    
    // === Profile data ===
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub department: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    
    // === Token metadata ===
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
    
    // === Error handling ===
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Validate a JWT token (basic validation - backwards compatible)
pub async fn validate_token(
    State(state): State<AppState>,
    Json(request): Json<ValidateTokenRequest>,
) -> Json<ValidateTokenResponse> {
    let result = state.jwt_validator.validate_token_result(&request.token).await;

    // If valid, also fetch permissions
    let permissions = if result.valid {
        if let Some(ref user_id) = result.user_id {
            match state.rbac_service.get_user_permissions(user_id).await {
                Ok(perms) => Some(perms.into_iter().collect()),
                Err(e) => {
                    tracing::warn!(error = %e, "Failed to fetch permissions");
                    None
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    Json(ValidateTokenResponse {
        valid: result.valid,
        user_id: result.user_id,
        email: result.email,
        role: result.role,
        permissions,
        error: result.error,
        expires_at: result.expires_at,
    })
}

/// Validate JWT token with full profile enrichment and session caching
/// 
/// This is the PRIMARY endpoint for Python authentication. It:
/// 1. Checks session cache first (fast path)
/// 2. On cache miss: validates JWT, fetches profile from DB, fetches permissions
/// 3. Caches the complete session for 15 minutes
/// 4. Returns everything Python needs in a single response
/// 
/// This eliminates the need for Python to make separate Supabase calls for profile data.
pub async fn validate_with_profile(
    State(state): State<AppState>,
    Json(request): Json<ValidateTokenRequest>,
) -> Json<ValidateWithProfileResponse> {
    let token = &request.token;
    let token_hash = hash_token(token);
    
    // === FAST PATH: Check session cache first ===
    if let Some(ref session_service) = state.session_service {
        match session_service.get_session(&token_hash).await {
            Ok(Some(cached)) => {
                tracing::debug!(user_id = %cached.user_id, "Session cache hit");
                metrics::counter!("auth.cache_hit").increment(1);
                
                // Refresh session in background (extend TTL without blocking)
                let ss = session_service.clone();
                let hash = token_hash.clone();
                tokio::spawn(async move {
                    if let Err(e) = ss.refresh_session(&hash).await {
                        tracing::warn!(error = %e, "Failed to refresh session");
                    }
                });
                
                return Json(ValidateWithProfileResponse {
                    valid: true,
                    cached: true,
                    user_id: Some(cached.user_id),
                    email: Some(cached.email),
                    role: Some(cached.role),
                    permissions: Some(cached.permissions),
                    organization_id: cached.organization_id,
                    full_name: cached.full_name,
                    avatar_url: cached.avatar_url,
                    department: cached.department,
                    job_title: cached.job_title,
                    status: cached.status,
                    expires_at: None, // Session TTL managed by cache
                    error: None,
                });
            }
            Ok(None) => {
                tracing::debug!("Session cache miss");
                metrics::counter!("auth.cache_miss").increment(1);
            }
            Err(e) => {
                tracing::warn!(error = %e, "Session cache error, falling back to validation");
                metrics::counter!("auth.cache_error").increment(1);
            }
        }
    }
    
    // === SLOW PATH: Validate JWT and fetch profile ===
    let jwt_result = state.jwt_validator.validate_token_result(token).await;
    
    if !jwt_result.valid {
        tracing::warn!(error = ?jwt_result.error, "JWT validation failed");
        metrics::counter!("auth.validation_failed").increment(1);
        return Json(ValidateWithProfileResponse {
            valid: false,
            cached: false,
            user_id: None,
            email: None,
            role: None,
            permissions: None,
            organization_id: None,
            full_name: None,
            avatar_url: None,
            department: None,
            job_title: None,
            status: None,
            expires_at: None,
            error: jwt_result.error,
        });
    }
    
    let user_id = match jwt_result.user_id.as_ref() {
        Some(id) => id.clone(),
        None => {
            return Json(ValidateWithProfileResponse {
                valid: false,
                cached: false,
                user_id: None,
                email: None,
                role: None,
                permissions: None,
                organization_id: None,
                full_name: None,
                avatar_url: None,
                department: None,
                job_title: None,
                status: None,
                expires_at: None,
                error: Some("Token missing user_id claim".to_string()),
            });
        }
    };
    
    // Parse user_id as UUID for database queries
    let user_uuid = match Uuid::parse_str(&user_id) {
        Ok(uuid) => uuid,
        Err(_) => {
            return Json(ValidateWithProfileResponse {
                valid: false,
                cached: false,
                user_id: Some(user_id),
                email: jwt_result.email,
                role: None,
                permissions: None,
                organization_id: None,
                full_name: None,
                avatar_url: None,
                department: None,
                job_title: None,
                status: None,
                expires_at: None,
                error: Some("Invalid user_id format".to_string()),
            });
        }
    };
    
    // Fetch permissions from RBAC service
    let permissions: Vec<String> = match state.rbac_service.get_user_permissions(&user_id).await {
        Ok(perms) => perms.into_iter().collect(),
        Err(e) => {
            tracing::warn!(error = %e, user_id = %user_id, "Failed to fetch permissions");
            vec![]
        }
    };
    
    // Fetch user profile from database
    let auth_queries = AuthQueries::new(state.db_pool.clone());
    let profile = match auth_queries.get_user_profile(user_uuid).await {
        Ok(Some(p)) => {
            tracing::debug!(user_id = %user_id, "Profile fetched from database");
            Some(p)
        }
        Ok(None) => {
            tracing::warn!(user_id = %user_id, "No profile found in database");
            None
        }
        Err(e) => {
            tracing::error!(error = %e, user_id = %user_id, "Database error fetching profile");
            None
        }
    };
    
    // Determine role - prefer profile role_text, fall back to JWT role
    let role = profile.as_ref()
        .and_then(|p| p.role_text.clone())  // role enum cast to text
        .or_else(|| jwt_result.role.clone())
        .unwrap_or_else(|| "authenticated".to_string());
    
    // Build response - department/job_title not in actual schema, return None
    let response = ValidateWithProfileResponse {
        valid: true,
        cached: false,
        user_id: Some(user_id.clone()),
        email: jwt_result.email.clone().or_else(|| profile.as_ref().and_then(|p| p.email.clone())),
        role: Some(role.clone()),
        permissions: Some(permissions.clone()),
        organization_id: profile.as_ref().and_then(|p| p.organization_id.map(|id| id.to_string())),
        full_name: profile.as_ref().and_then(|p| p.full_name.clone()),
        avatar_url: profile.as_ref().and_then(|p| p.avatar_url.clone()),
        department: None,  // Not in actual schema
        job_title: None,   // Not in actual schema
        status: profile.as_ref().and_then(|p| p.status.clone()),
        expires_at: jwt_result.expires_at,
        error: None,
    };
    
    // === Cache the session for future requests ===
    if let Some(ref session_service) = state.session_service {
        let now = chrono::Utc::now().timestamp();
        let cached_session = CachedSession {
            user_id: user_id.clone(),
            email: response.email.clone().unwrap_or_default(),
            role: role.clone(),
            organization_id: response.organization_id.clone(),
            permissions: permissions.clone(),
            created_at: now,
            last_activity: now,
            full_name: response.full_name.clone(),
            avatar_url: response.avatar_url.clone(),
            department: response.department.clone(),
            job_title: response.job_title.clone(),
            status: response.status.clone(),
        };
        
        if let Err(e) = session_service.set_session(&token_hash, &cached_session).await {
            tracing::warn!(error = %e, "Failed to cache session");
        } else {
            tracing::debug!(user_id = %user_id, "Session cached successfully");
            metrics::counter!("auth.session_cached").increment(1);
        }
    }
    
    // Update last_seen in background (non-blocking)
    let db_pool = state.db_pool.clone();
    tokio::spawn(async move {
        let queries = AuthQueries::new(db_pool);
        if let Err(e) = queries.update_last_seen(user_uuid).await {
            tracing::warn!(error = %e, "Failed to update last_seen");
        }
    });
    
    metrics::counter!("auth.validation_success").increment(1);
    Json(response)
}

/// Get user permissions response
#[derive(Debug, Serialize)]
pub struct PermissionsResponse {
    pub user_id: String,
    pub permissions: Vec<String>,
    pub roles: Vec<RoleInfo>,
}

#[derive(Debug, Serialize)]
pub struct RoleInfo {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Get permissions for a user
///
/// Authorization: callers can only access their own permissions unless they
/// have the `service` role or hold `admin:*` / `users:manage` permissions.
pub async fn get_permissions(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthenticatedUser>,
    Path(user_id): Path<String>,
) -> ApiResult<Json<PermissionsResponse>> {
    // Authorization: only self-access or service/admin
    if auth_user.user_id != user_id
        && auth_user.role != "service"
        && !auth_user.permissions.iter().any(|p| p == "admin:*" || p == "users:manage")
    {
        return Err(ApiError::Forbidden(
            "You can only access your own permissions".to_string(),
        ));
    }

    // Get permissions
    let permissions = state.rbac_service
        .get_user_permissions(&user_id)
        .await
        .map_err(|e| ApiError::Database(e))?;

    // Get roles
    let _user_uuid = Uuid::parse_str(&user_id)
        .map_err(|_| ApiError::BadRequest("Invalid user ID format".to_string()))?;
    
    let roles = state.rbac_service
        .get_user_roles(&user_id)
        .await
        .map_err(|e| ApiError::Database(e))?;

    let role_infos: Vec<RoleInfo> = roles
        .into_iter()
        .map(|r| RoleInfo {
            id: r.role_id.to_string(),
            name: r.role_name,
            description: r.description,
        })
        .collect();

    Ok(Json(PermissionsResponse {
        user_id,
        permissions: permissions.into_iter().collect(),
        roles: role_infos,
    }))
}

/// Session invalidation request
#[derive(Debug, Deserialize)]
pub struct InvalidateSessionRequest {
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub token_hash: Option<String>,
    #[serde(default)]
    pub invalidate_all: bool,
}

/// Session invalidation response
#[derive(Debug, Serialize)]
pub struct InvalidateSessionResponse {
    pub success: bool,
    pub sessions_invalidated: u64,
}

/// Invalidate user session(s)
///
/// Authorization: callers can only invalidate their own sessions unless they
/// have the `service` role or hold `admin:*` / `users:manage` permissions.
pub async fn invalidate_session(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthenticatedUser>,
    Json(request): Json<InvalidateSessionRequest>,
) -> ApiResult<Json<InvalidateSessionResponse>> {
    // Authorization: only self-access or service/admin for user-targeted invalidation
    if let Some(ref target_user_id) = request.user_id {
        if auth_user.user_id != *target_user_id
            && auth_user.role != "service"
            && !auth_user.permissions.iter().any(|p| p == "admin:*" || p == "users:manage")
        {
            return Err(ApiError::Forbidden(
                "You can only invalidate your own sessions".to_string(),
            ));
        }
    }

    // Check if session service is available
    let session_service = state.session_service.as_ref()
        .ok_or_else(|| ApiError::Cache("Session service is not available".to_string()))?;
    
    let sessions_invalidated = if request.invalidate_all {
        if let Some(ref user_id) = request.user_id {
            session_service
                .invalidate_user_sessions(user_id)
                .await
                .map_err(|e| ApiError::Cache(e.to_string()))?
        } else {
            return Err(ApiError::BadRequest(
                "user_id required when invalidate_all is true".to_string()
            ));
        }
    } else if let Some(ref token_hash) = request.token_hash {
        session_service
            .invalidate_session(token_hash)
            .await
            .map_err(|e| ApiError::Cache(e.to_string()))?;
        1
    } else {
        return Err(ApiError::BadRequest(
            "Either token_hash or user_id with invalidate_all required".to_string()
        ));
    };

    // Also invalidate RBAC cache
    if let Some(ref user_id) = request.user_id {
        state.rbac_service.invalidate_cache(user_id);
    }

    Ok(Json(InvalidateSessionResponse {
        success: true,
        sessions_invalidated,
    }))
}
