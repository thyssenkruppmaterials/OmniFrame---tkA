// Created and developed by Jai Singh
//! Authentication middleware for rust-work-service
//!
//! Auth precedence (first match wins):
//!   1. `X-Service-Key` header — internal service-to-service calls.
//!   2. Bearer token where the unverified `kind` claim is `"agent"` —
//!      verified locally via `crate::agent_jwt` against
//!      `WORK_SERVICE_AGENT_JWT_SECRET`, plus a revocation check
//!      against `agent_service_keys.revoked_at` (cached in Redis for
//!      60 s — see `ADR-Agent-Identity-V2-Phase10`).
//!   3. Bearer token of any other shape — validated via
//!      `rust-core-service /api/v1/auth/validate-with-profile` (the
//!      pre-Phase-10 path that handles Supabase user JWTs).
//!
//! Both agent and user paths inject the same `Arc<AuthenticatedUser>`
//! shape into request extensions, so route handlers extract
//! `Extension<Arc<AuthenticatedUser>>` and share one heap allocation
//! (a hit on the L1 auth cache is a pointer clone, not a deep copy of
//! the user's permissions/strings). The agent path also injects the
//! typed `AuthIdentity::Agent { … }` discriminator so route handlers
//! that care about the difference (e.g. `require_admin`) can read it
//! straight from extensions.
//!
//! ## `AuthIdentity` enum
//!
//! Phase 10 introduces an explicit discriminator over the two sources
//! of authenticated identity (Supabase user JWT vs agent service-key
//! JWT). New code should prefer `Extension<AuthIdentity>` to make the
//! distinction explicit; routes pulling
//! `Extension<Arc<AuthenticatedUser>>` keep working unchanged.

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use std::sync::Arc;
use tracing::{debug, info, warn};

use crate::agent_jwt;
use crate::auth::{extract_bearer_token, extract_service_key, AuthenticatedUser, AuthError};
use crate::AppState;
use uuid::Uuid;

/// Phase 10 — typed identity injected into request extensions
/// alongside the legacy `AuthenticatedUser` shape.
///
/// Existing handlers using `Extension<Arc<AuthenticatedUser>>` keep
/// working. New handlers (or handlers that need to gate on agent vs
/// user) pull `Extension<AuthIdentity>` instead. The fields are
/// `#[allow(dead_code)]` until callers opt in — Phase 11 + the
/// per-handler audit pass will surface the discriminator across the
/// codebase.
#[derive(Debug, Clone)]
#[allow(dead_code)] // surfaced for handlers that opt into AuthIdentity directly
pub enum AuthIdentity {
    /// Authenticated by Supabase user JWT (validated via
    /// rust-core-service) OR by service API key (`X-Service-Key`).
    User {
        user_id: String,
        org_id: Option<String>,
        role: Option<String>,
    },
    /// Authenticated by agent service-key JWT (`kind: "agent"`,
    /// signed by `WORK_SERVICE_AGENT_JWT_SECRET`, verified locally).
    Agent {
        agent_id: String,
        org_id: Uuid,
        key_id: Uuid,
    },
}

#[allow(dead_code)] // surfaced for handlers that opt into AuthIdentity directly
impl AuthIdentity {
    /// Convenience: pull the org_id regardless of identity type. For
    /// `AuthIdentity::User { .. }` an org-less Supabase user (e.g. a
    /// freshly-signed-up account) returns `None`.
    pub fn organization_id(&self) -> Option<String> {
        match self {
            AuthIdentity::User { org_id, .. } => org_id.clone(),
            AuthIdentity::Agent { org_id, .. } => Some(org_id.to_string()),
        }
    }

    /// True for `AuthIdentity::Agent { .. }` regardless of the
    /// underlying key state. Routes that should reject agents (e.g.
    /// `/api/v1/agent-identity/register`) use this in
    /// `require_admin`.
    pub fn is_agent(&self) -> bool {
        matches!(self, AuthIdentity::Agent { .. })
    }
}

/// Reject `AuthIdentity::Agent { .. }` and any non-admin
/// `AuthIdentity::User { .. }`. Used by Phase 10 admin-only routes
/// and surfaced for downstream callers that want the same guard.
#[allow(dead_code)] // surfaced for handlers that opt into AuthIdentity directly
pub fn require_admin(identity: &AuthIdentity) -> Result<(), AuthError> {
    match identity {
        AuthIdentity::User { role, .. } => match role.as_deref() {
            Some("admin") | Some("superadmin") | Some("service") => Ok(()),
            _ => Err(AuthError::Forbidden),
        },
        AuthIdentity::Agent { .. } => Err(AuthError::Forbidden),
    }
}

/// Synthesise an `AuthenticatedUser` shape for an agent so legacy
/// handlers pulling `Extension<Arc<AuthenticatedUser>>` continue to work
/// when called with an agent JWT (the agent's stable `agent_id` lands
/// in `user_id`; `role` is `Some("agent")` for callers that want to
/// special-case it; `email` is `None`; `permissions` empty).
fn synthesise_agent_user(
    agent_id: &str,
    org_id: Uuid,
) -> AuthenticatedUser {
    AuthenticatedUser {
        user_id: agent_id.to_string(),
        email: None,
        organization_id: Some(org_id.to_string()),
        role: Some("agent".to_string()),
        permissions: Vec::new(),
    }
}

/// Check whether the agent-issued key has been revoked. The cached
/// answer (TTL 60 s) lives in Redis under
/// `agent-identity:revoked:<key_id>`; on a cache miss we fall through
/// to a single-row Postgres lookup against
/// `agent_service_keys.revoked_at`.
///
/// Returns `Ok(true)` when revoked (caller MUST 401), `Ok(false)`
/// when active, `Err(AuthError::ServiceUnavailable)` when both Redis
/// and Postgres are unreachable (fail-closed: a partial outage MUST
/// NOT silently let a revoked key slip through). On a Redis-only
/// outage we degrade gracefully to the DB hit.
async fn agent_key_is_revoked(state: &AppState, key_id: Uuid) -> Result<bool, AuthError> {
    use crate::api::routes::agent_identity::revocation_cache_key;

    let cache_key = revocation_cache_key(key_id);
    // ── Redis fast-path ──────────────────────────────────────────
    if let Ok(mut conn) = state.redis_pool.get().await {
        let cached: Option<String> = bb8_redis::redis::cmd("GET")
            .arg(&cache_key)
            .query_async(&mut *conn)
            .await
            .ok()
            .flatten();
        if let Some(v) = cached {
            return Ok(v == "1");
        }
    }

    // ── DB fallback ──────────────────────────────────────────────
    let row: Option<(Option<chrono::DateTime<chrono::Utc>>,)> = sqlx::query_as(
        "SELECT revoked_at FROM public.agent_service_keys WHERE id = $1",
    )
    .bind(key_id)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| {
        warn!(?e, %key_id, "middleware: agent_service_keys revocation lookup failed");
        AuthError::ServiceUnavailable
    })?;

    let revoked = match row {
        Some((Some(_),)) => true,
        Some((None,)) => false,
        None => {
            // Row deleted — treat as revoked (defence-in-depth: a
            // physically-missing row indicates a manual cleanup, the
            // safe interpretation is "no longer trustable").
            true
        }
    };

    // Best-effort cache write so the next call skips the DB hit.
    if let Ok(mut conn) = state.redis_pool.get().await {
        let val = if revoked { "1" } else { "0" };
        let _: Result<String, _> = bb8_redis::redis::cmd("SET")
            .arg(&cache_key)
            .arg(val)
            .arg("EX")
            .arg(60u64)
            .query_async(&mut *conn)
            .await;
    }

    Ok(revoked)
}

/// Middleware that requires authentication for all requests
///
/// Checks for authentication in the following order:
/// 1. X-Service-Key header (for service-to-service calls)
/// 2. Bearer JWT shaped like `kind: "agent"` (Phase 10 — local
///    verification against `WORK_SERVICE_AGENT_JWT_SECRET`)
/// 3. Bearer JWT of any other shape (legacy — validated via
///    `rust-core-service`)
///
/// On success, BOTH `AuthenticatedUser` and `AuthIdentity` are
/// inserted into request extensions. Route handlers can pull either.
pub async fn require_auth(
    State(state): State<Arc<AppState>>,
    mut request: Request,
    next: Next,
) -> Response {
    let headers = request.headers();

    // ── 1. Service API key (internal) ─────────────────────────────
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
            let identity = AuthIdentity::User {
                user_id: system_user.user_id.clone(),
                org_id: system_user.organization_id.clone(),
                role: system_user.role.clone(),
            };
            request.extensions_mut().insert(Arc::new(system_user));
            request.extensions_mut().insert(identity);
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

    // ── 2. Agent JWT (Phase 10) ───────────────────────────────────
    if agent_jwt::looks_like_agent_jwt(&token) {
        match agent_jwt::verify(&token) {
            Ok(claims) => {
                // Revocation gate. A revoked key MUST 401 even though
                // the JWT signature + expiry both check out — the
                // 60 s positive-cache window is the only acceptable
                // staleness budget for revocation effectiveness.
                match agent_key_is_revoked(&state, claims.key_id).await {
                    Ok(true) => {
                        warn!(
                            agent_id = %claims.sub,
                            key_id = %claims.key_id,
                            "Agent JWT rejected — service key has been revoked"
                        );
                        return AuthError::InvalidToken.into_response();
                    }
                    Ok(false) => {
                        debug!(
                            agent_id = %claims.sub,
                            org_id = %claims.org_id,
                            key_id = %claims.key_id,
                            "Authenticated via agent service-key JWT"
                        );
                        let synth = synthesise_agent_user(&claims.sub, claims.org_id);
                        let identity = AuthIdentity::Agent {
                            agent_id: claims.sub.clone(),
                            org_id: claims.org_id,
                            key_id: claims.key_id,
                        };
                        request.extensions_mut().insert(Arc::new(synth));
                        request.extensions_mut().insert(identity);
                        return next.run(request).await;
                    }
                    Err(e) => {
                        warn!(?e, "Agent JWT revocation lookup failed; rejecting fail-closed");
                        return AuthError::ServiceUnavailable.into_response();
                    }
                }
            }
            Err(e) => {
                // Token claimed `kind: "agent"` but failed local
                // verification. DON'T fall through to
                // rust-core-service — the user JWT path doesn't
                // accept `kind: "agent"` claims either, and falling
                // through would only paper over a real auth failure.
                warn!(?e, "Agent-shaped JWT failed local verification");
                return AuthError::InvalidToken.into_response();
            }
        }
    }

    // ── 3. Legacy user JWT (rust-core-service) ────────────────────
    match state.auth_client.validate_token(&token).await {
        Ok(mut user) => {
            // `user` is `Arc<AuthenticatedUser>` shared with the L1 auth
            // cache. The common path (org present) inserts the Arc into
            // extensions with no deep clone. Only the rare fallback
            // below — org missing from the auth response, e.g. a stale
            // upstream cache — clones the inner user (via
            // `Arc::make_mut`) so the resolved org never leaks back into
            // the shared cached entry.
            if user.organization_id.is_none() && user.role.as_deref() != Some("service") {
                if let Ok(uid) = Uuid::parse_str(&user.user_id) {
                    match sqlx::query_scalar::<_, Option<Uuid>>(
                        "SELECT organization_id FROM user_profiles WHERE id = $1",
                    )
                    .bind(uid)
                    .fetch_optional(&state.db_pool)
                    .await
                    {
                        Ok(Some(Some(org_id))) => {
                            info!(
                                user_id = %user.user_id,
                                org_id = %org_id,
                                "Resolved organization_id via direct DB fallback"
                            );
                            Arc::make_mut(&mut user).organization_id = Some(org_id.to_string());
                        }
                        Ok(_) => {
                            warn!(user_id = %user.user_id, "No organization_id in user_profiles");
                        }
                        Err(e) => {
                            warn!(
                                user_id = %user.user_id,
                                error = %e,
                                "Failed to query organization_id fallback"
                            );
                        }
                    }
                }
            }

            info!(user_id = %user.user_id, "User authenticated");
            let identity = AuthIdentity::User {
                user_id: user.user_id.clone(),
                org_id: user.organization_id.clone(),
                role: user.role.clone(),
            };
            request.extensions_mut().insert(user);
            request.extensions_mut().insert(identity);
            next.run(request).await
        }
        Err(e) => {
            warn!(error = ?e, "Authentication failed");
            e.into_response()
        }
    }
}

/// Middleware that validates organization context
///
/// Requires that the authenticated user has an organization_id set,
/// unless they have the "service" role.
#[allow(dead_code)]
pub async fn require_organization(
    State(_state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    // Get authenticated user from request extensions
    let user = match request.extensions().get::<Arc<AuthenticatedUser>>() {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({
                    "error": "Authentication required"
                })),
            )
                .into_response();
        }
    };

    // Check for organization context
    if user.organization_id.is_none() && user.role.as_deref() != Some("service") {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Organization context required"
            })),
        )
            .into_response();
    }

    next.run(request).await
}

/// Extractor for authenticated user from request extensions.
///
/// Returns the shared `Arc<AuthenticatedUser>` (a pointer clone), matching
/// what `require_auth` inserts and what route handlers extract via
/// `Extension<Arc<AuthenticatedUser>>`.
#[allow(dead_code)]
pub fn get_current_user(request: &Request) -> Result<Arc<AuthenticatedUser>, AuthError> {
    request
        .extensions()
        .get::<Arc<AuthenticatedUser>>()
        .cloned()
        .ok_or(AuthError::MissingAuth)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent_identity() -> AuthIdentity {
        AuthIdentity::Agent {
            agent_id: "host-A".into(),
            org_id: Uuid::nil(),
            key_id: Uuid::nil(),
        }
    }

    fn user_identity(role: Option<&str>) -> AuthIdentity {
        AuthIdentity::User {
            user_id: Uuid::new_v4().to_string(),
            org_id: Some(Uuid::new_v4().to_string()),
            role: role.map(|s| s.to_string()),
        }
    }

    #[test]
    fn require_admin_accepts_admin_user() {
        assert!(require_admin(&user_identity(Some("admin"))).is_ok());
        assert!(require_admin(&user_identity(Some("superadmin"))).is_ok());
        assert!(require_admin(&user_identity(Some("service"))).is_ok());
    }

    #[test]
    fn require_admin_rejects_non_admin_user() {
        assert!(require_admin(&user_identity(Some("operator"))).is_err());
        assert!(require_admin(&user_identity(None)).is_err());
    }

    #[test]
    fn require_admin_rejects_agent() {
        assert!(require_admin(&agent_identity()).is_err());
    }

    #[test]
    fn auth_identity_organization_id_unifies_user_and_agent_paths() {
        let agent = agent_identity();
        assert!(agent.organization_id().is_some());
        let user = user_identity(Some("admin"));
        assert!(user.organization_id().is_some());
        let orgless = AuthIdentity::User {
            user_id: "u".into(),
            org_id: None,
            role: None,
        };
        assert!(orgless.organization_id().is_none());
    }

    #[test]
    fn is_agent_discriminator_matches_variant() {
        assert!(agent_identity().is_agent());
        assert!(!user_identity(Some("admin")).is_agent());
    }

    #[test]
    fn synthesise_agent_user_lands_agent_id_in_user_id() {
        let synth = synthesise_agent_user("INDPDC1-Console-aclark", Uuid::nil());
        assert_eq!(synth.user_id, "INDPDC1-Console-aclark");
        assert_eq!(synth.role.as_deref(), Some("agent"));
        assert_eq!(synth.organization_id.as_deref(), Some(&*Uuid::nil().to_string()));
        assert!(synth.email.is_none());
        assert!(synth.permissions.is_empty());
    }
}

// Created and developed by Jai Singh
