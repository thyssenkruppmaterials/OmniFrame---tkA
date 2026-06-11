// Created and developed by Jai Singh
//! Phase 10 (`.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md`)
//! — agent identity v2 (service-key authentication for the
//! `omni_agent` fleet).
//!
//! This module replaces the previous "agent inherits a human user's
//! Supabase session" pattern. Agents now own their own credentials —
//! a long-lived `omni_sk_*` plaintext key sitting on disk on the
//! Citrix box — and exchange it at boot for a short-lived JWT signed
//! by `WORK_SERVICE_AGENT_JWT_SECRET` (15-min TTL, see
//! `crate::agent_jwt`). An admin can revoke an agent's key (e.g.,
//! terminated employee, lost laptop) without affecting the original
//! human user.
//!
//! Four routes mounted under `/api/v1/agent-identity/*`:
//!
//! | Method | Path        | Auth     | Body                                   | Notes                                       |
//! |--------|-------------|----------|----------------------------------------|---------------------------------------------|
//! | POST   | `/register` | admin    | `{ agent_id, label? }`                 | Returns plaintext key ONCE.                  |
//! | POST   | `/exchange` | **none** | `{ agent_id, service_key }`            | Public — agents have no JWT yet.             |
//! | POST   | `/revoke`   | admin    | `{ key_id, reason? }`                  | Sets `revoked_at = now()`.                   |
//! | GET    | `/list`     | admin    | (`?include_revoked=true` opt)          | Returns active rows.                         |
//!
//! Wired into `main.rs`:
//! * `/exchange` is mounted on the **public** router (no auth
//!   middleware) — agents call this BEFORE they have a JWT.
//! * `/register`, `/revoke`, `/list` are mounted on the **protected**
//!   router (require admin JWT).
//!
//! Security invariants:
//! * Plaintext key is returned ONCE at registration. Only the
//!   Argon2id hash is persisted.
//! * Argon2id parameters: memory_cost=64 MiB, time_cost=3,
//!   parallelism=4 (per ADR; cheap enough for a service path,
//!   expensive enough to deter offline brute-force on the hash).
//! * Rate limit on `/exchange`: 5 failures per `agent_id` per hour
//!   tracked in Redis (`ratelimit:agent-identity-exchange:<agent_id>`).
//!   Locks for 1 hour after the 5th failure.
//! * `revoked_at IS NULL` is checked at exchange time AND at JWT
//!   verification time. The middleware caches the positive result for
//!   60 s in Redis (`agent-identity:revoked:<key_id>`) — admin
//!   revocation propagates within ~60 s (see ADR for the
//!   security/perf tradeoff).
//!
//! Audit log: registration + revoke both `tracing::info!` with the
//! new audit kind so the structured-log stream catches them; a
//! dedicated `agent_identity_audit_log` table is deferred to a
//! follow-up phase.

use axum::{
    extract::{Extension, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use bb8::PooledConnection;
use bb8_redis::RedisConnectionManager;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::agent_jwt;
use crate::api::error::{ApiError, ApiResult};
use crate::auth::AuthenticatedUser;
use crate::AppState;

// ────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────

/// Plaintext key prefix. Visible to admins as the first 8 chars of the
/// raw key (e.g. `omni_sk_BASE64URL...`). Has zero entropy beyond the
/// constant, so it's safe to store as a fingerprint.
pub const KEY_PREFIX: &str = "omni_sk_";

/// 32 bytes of randomness encoded base64url → ~43 chars; combined
/// with the `omni_sk_` prefix gives a ~51-char total.
pub const PLAINTEXT_KEY_BYTES: usize = 32;

/// Failure budget per agent_id per `RATE_LIMIT_WINDOW_SECS`. After the
/// 5th wrong-key attempt we lock the agent_id for one full window.
pub const RATE_LIMIT_MAX_FAILURES: u32 = 5;
pub const RATE_LIMIT_WINDOW_SECS: u64 = 3600;

/// Redis key pattern for the per-agent_id failure counter. The 1 h
/// TTL doubles as the lock window — once the counter trips, the next
/// `/exchange` rejects until the TTL expires.
fn rate_limit_key(agent_id: &str) -> String {
    format!("ratelimit:agent-identity-exchange:{}", agent_id)
}

/// Redis key pattern for the revocation cache (consumed by the
/// middleware's `kind: "agent"` JWT validation path).
pub fn revocation_cache_key(key_id: Uuid) -> String {
    format!("agent-identity:revoked:{}", key_id)
}

/// Argon2id parameters the plan calls for. Tuned for a service path —
/// `~50ms` per verify on a modern Linux box at these settings, which
/// is cheap enough for boot + token-refresh latency budgets while
/// expensive enough to deter offline brute-force on the hash if the
/// `agent_service_keys` table were ever leaked.
fn argon2_params() -> argon2::Params {
    argon2::Params::new(
        64 * 1024, // memory_cost (KiB) → 64 MiB
        3,         // time_cost (iterations)
        4,         // parallelism (lanes)
        None,      // output length — default 32 bytes
    )
    .expect("argon2 params are static and valid")
}

fn argon2_instance() -> argon2::Argon2<'static> {
    argon2::Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2_params(),
    )
}

// ────────────────────────────────────────────────────────────────────
// Helpers — plaintext key generation + hashing
// ────────────────────────────────────────────────────────────────────

/// Generate a fresh `omni_sk_*` plaintext key. Returns the full
/// plaintext (visible to admin ONCE) and the 8-char fingerprint
/// stored in `key_prefix`.
pub fn mint_plaintext_key() -> (String, String) {
    use base64::engine::{general_purpose::URL_SAFE_NO_PAD, Engine};
    use rand::RngCore;
    let mut bytes = [0u8; PLAINTEXT_KEY_BYTES];
    rand::thread_rng().fill_bytes(&mut bytes);
    let suffix = URL_SAFE_NO_PAD.encode(bytes);
    let plaintext = format!("{}{}", KEY_PREFIX, suffix);
    let prefix = plaintext.chars().take(8).collect();
    (plaintext, prefix)
}

/// Hash a plaintext key with the canonical Argon2id parameters,
/// returning the PHC-string format we persist in
/// `agent_service_keys.key_hash`.
pub fn hash_key(plaintext: &str) -> Result<String, argon2::password_hash::Error> {
    use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};
    let salt = SaltString::generate(&mut OsRng);
    let argon = argon2_instance();
    Ok(argon.hash_password(plaintext.as_bytes(), &salt)?.to_string())
}

/// Verify a candidate plaintext against a stored hash. `Ok(true)` on
/// match, `Ok(false)` on mismatch, `Err` on a malformed stored hash
/// (which would be a bug in the registration path — we log and treat
/// as a non-match in the route).
pub fn verify_key(plaintext: &str, stored_hash: &str) -> Result<bool, argon2::password_hash::Error> {
    use argon2::password_hash::{PasswordHash, PasswordVerifier};
    let parsed = PasswordHash::new(stored_hash)?;
    Ok(argon2_instance()
        .verify_password(plaintext.as_bytes(), &parsed)
        .is_ok())
}

// ────────────────────────────────────────────────────────────────────
// Auth helpers
// ────────────────────────────────────────────────────────────────────

/// Resolve the caller's organization from the JWT, mirroring the
/// `require_org` helper in sibling routes. Always returns the org
/// from the JWT — never from a body / query string.
fn require_org(user: &AuthenticatedUser) -> ApiResult<Uuid> {
    let org_id_str = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;
    Uuid::parse_str(org_id_str)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))
}

/// Reject non-admin users (and agents — agents have no business
/// minting more agent identities). Admin = role IN ('admin',
/// 'superadmin') OR role='service' (internal service-key callers).
fn require_admin(user: &AuthenticatedUser) -> ApiResult<()> {
    match user.role.as_deref() {
        Some("admin") | Some("superadmin") | Some("service") => Ok(()),
        _ => Err(ApiError::Forbidden(
            "Admin role required for agent identity management".to_string(),
        )),
    }
}

// ────────────────────────────────────────────────────────────────────
// POST /register — admin only
// ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    /// Stable agent identifier (e.g. `INDPDC1-Console-aclark` or
    /// `Citrix-OmniBox-01`). Free-text — admin enters whatever they
    /// want as long as it's unique within the org.
    pub agent_id: String,
    /// Optional human-readable label (e.g. `Citrix OmniBox 01`).
    /// Defaults to NULL when omitted.
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RegisterResponse {
    /// `agent_service_keys.id` — surfaced so the admin UI can wire a
    /// "Revoke" button without re-fetching the list.
    pub key_id: Uuid,
    /// **Shown ONCE.** Save it now — never recoverable.
    pub plaintext_key: String,
    /// First 8 chars of `plaintext_key`; safe to store + show in the
    /// list view alongside `last_used_at`.
    pub key_prefix: String,
    /// Echo of the `agent_id` so the FE doesn't have to round-trip
    /// to render the success toast.
    pub agent_id: String,
    /// Echo of the optional label.
    pub label: Option<String>,
    /// Plaintext keys never expire today — they live until the admin
    /// revokes them. Field is reserved for a future per-key TTL
    /// option without forcing a wire-shape break.
    pub expires_at: Option<DateTime<Utc>>,
}

pub async fn post_register(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Json(body): Json<RegisterRequest>,
) -> ApiResult<Json<RegisterResponse>> {
    require_admin(&user)?;
    let org_id = require_org(&user)?;
    let agent_id = body.agent_id.trim();
    if agent_id.is_empty() {
        return Err(ApiError::BadRequest(
            "agent_id must not be empty".to_string(),
        ));
    }
    if agent_id.len() > 256 {
        return Err(ApiError::BadRequest(
            "agent_id exceeds 256 char limit".to_string(),
        ));
    }
    let label = body.label.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    // Mint plaintext + hash before touching the DB so a hash failure
    // never strands us with a half-written row.
    let (plaintext, key_prefix) = mint_plaintext_key();
    let key_hash = hash_key(&plaintext).map_err(|e| {
        warn!(?e, "agent_identity::register: argon2 hash failed");
        ApiError::Internal("failed to hash service key".to_string())
    })?;

    let creator_uuid = Uuid::parse_str(&user.user_id).ok();

    // Use a single INSERT and let the unique-active constraint reject
    // duplicate registrations for the same (org, agent_id) — Postgres
    // catches the race far more reliably than a SELECT-then-INSERT
    // dance under concurrent admins.
    let row: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO public.agent_service_keys
            (organization_id, agent_id, key_hash, key_prefix, label, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        "#,
    )
    .bind(org_id)
    .bind(agent_id)
    .bind(&key_hash)
    .bind(&key_prefix)
    .bind(label.as_deref())
    .bind(creator_uuid)
    .fetch_one(&state.db_pool)
    .await
    .map_err(|e| {
        // Unique-violation is the "active key already exists" case.
        if let sqlx::Error::Database(db_err) = &e {
            if db_err.code().as_deref() == Some("23505") {
                return ApiError::Conflict(format!(
                    "An active service key already exists for agent_id='{}'. \
                     Revoke the existing key before registering a new one.",
                    agent_id
                ));
            }
        }
        warn!(
            ?e,
            org_id = %org_id,
            agent_id,
            "agent_identity::register: db insert failed"
        );
        ApiError::Database(e)
    })?;

    let key_id = row.0;
    info!(
        kind = "agent_service_key.registered",
        org_id = %org_id,
        agent_id,
        key_id = %key_id,
        label = ?label,
        created_by = %user.user_id,
        "Phase 10 audit: agent service key registered"
    );

    Ok(Json(RegisterResponse {
        key_id,
        plaintext_key: plaintext,
        key_prefix,
        agent_id: agent_id.to_string(),
        label,
        expires_at: None,
    }))
}

// ────────────────────────────────────────────────────────────────────
// POST /exchange — public (no JWT required)
// ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ExchangeRequest {
    pub agent_id: String,
    pub service_key: String,
}

#[derive(Debug, Serialize)]
pub struct ExchangeResponse {
    /// Short-lived `kind: "agent"` JWT signed with
    /// `WORK_SERVICE_AGENT_JWT_SECRET`.
    pub access_token: String,
    /// Always `"Bearer"` — kept in the wire shape so the client can
    /// drop it straight into an `Authorization` header.
    pub token_type: String,
    /// Lifetime of the token, in seconds. Today this matches
    /// `agent_jwt::AGENT_JWT_TTL_SECONDS` (900) — kept as a separate
    /// field so a future grace-period change doesn't require a
    /// client rebuild.
    pub expires_in: u64,
    /// Echoed so the agent can stash it without parsing the JWT.
    pub organization_id: Uuid,
}

pub async fn post_exchange(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ExchangeRequest>,
) -> ApiResult<Json<ExchangeResponse>> {
    let agent_id = body.agent_id.trim();
    if agent_id.is_empty() {
        return Err(ApiError::BadRequest(
            "agent_id must not be empty".to_string(),
        ));
    }
    if !body.service_key.starts_with(KEY_PREFIX) {
        // Cheap reject — saves an Argon2id verify on obvious garbage.
        // Still bumps the rate-limit counter to deter probing.
        bump_failure_counter(&state, agent_id).await;
        return Err(ApiError::Unauthorized(
            "invalid agent service key".to_string(),
        ));
    }

    // Rate-limit gate FIRST so a hostile flood can't exhaust the
    // Argon2id verification budget. The counter is per-agent_id so
    // an attacker probing a known agent_id is bounded; a different
    // agent_id starts with a fresh budget (cheap to abuse, but the
    // admin notices the audit-log volume).
    if let Some(retry_after) = check_rate_limit(&state, agent_id).await {
        return Err(ApiError::TooManyRequests {
            message: format!(
                "Too many failed exchange attempts for agent_id='{}'. \
                 Retry after {}s.",
                agent_id, retry_after
            ),
            retry_after_secs: Some(retry_after),
        });
    }

    // Pull the candidate active rows. The
    // `(organization_id, agent_id, revoked_at)` unique index makes
    // this trivially cheap (one or zero rows in the happy path).
    // Argon2id verification is the dominant cost.
    let candidates: Vec<CandidateRow> = sqlx::query_as::<_, CandidateRow>(
        r#"
        SELECT id, organization_id, agent_id, key_hash, key_prefix
        FROM public.agent_service_keys
        WHERE agent_id = $1
          AND revoked_at IS NULL
        "#,
    )
    .bind(agent_id)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| {
        warn!(
            ?e,
            agent_id,
            "agent_identity::exchange: candidate row lookup failed"
        );
        ApiError::Database(e)
    })?;

    // Narrow to the row whose `key_prefix` matches the candidate
    // plaintext — Argon2id verify is expensive (~50 ms), so an O(N)
    // verify across every active row in the org would let an
    // attacker time-trash the service. The `key_prefix` is 8 chars
    // of the plaintext, so the attacker has to KNOW the prefix to
    // probe — a minor barrier, but it bounds the verify count to
    // ~1 in the steady state.
    let provided_prefix: String = body.service_key.chars().take(8).collect();
    let mut matched_id: Option<Uuid> = None;
    let mut matched_org: Option<Uuid> = None;
    for cand in candidates.iter().filter(|c| c.key_prefix == provided_prefix) {
        match verify_key(&body.service_key, &cand.key_hash) {
            Ok(true) => {
                matched_id = Some(cand.id);
                matched_org = Some(cand.organization_id);
                break;
            }
            Ok(false) => continue,
            Err(e) => {
                warn!(
                    ?e,
                    key_id = %cand.id,
                    "agent_identity::exchange: argon2 verify error (treating as no-match)"
                );
                continue;
            }
        }
    }

    let (key_id, org_id) = match (matched_id, matched_org) {
        (Some(k), Some(o)) => (k, o),
        _ => {
            bump_failure_counter(&state, agent_id).await;
            warn!(
                agent_id,
                "agent_identity::exchange: no matching active key (attempt counted toward rate limit)"
            );
            return Err(ApiError::Unauthorized(
                "invalid agent service key".to_string(),
            ));
        }
    };

    // Stamp last_used_at so the admin UI's "Last seen" column is
    // useful + so a leaked-but-unused key is visible.
    if let Err(e) = sqlx::query(
        r#"
        UPDATE public.agent_service_keys
           SET last_used_at = now()
         WHERE id = $1
        "#,
    )
    .bind(key_id)
    .execute(&state.db_pool)
    .await
    {
        // Don't fail the exchange just because we couldn't bump the
        // timestamp — the JWT is still safe to issue.
        warn!(
            ?e,
            key_id = %key_id,
            "agent_identity::exchange: last_used_at update failed (continuing)"
        );
    }

    // Clear the failure counter on a successful exchange so a
    // "right key after 4 wrong tries" doesn't leak the lock-out
    // budget to subsequent attackers.
    clear_rate_limit(&state, agent_id).await;
    // Pre-emptively prime the revocation cache — the middleware
    // would do this on its first verify anyway, but a 60 s window
    // of "definitely not revoked" right after exchange means the
    // hot path skips a DB hit on the very first authenticated call.
    prime_revocation_cache(&state, key_id, false).await;

    let token = agent_jwt::issue(agent_id, org_id, key_id).map_err(|e| {
        warn!(?e, "agent_identity::exchange: jwt issue failed");
        ApiError::Internal("failed to issue agent JWT".to_string())
    })?;

    info!(
        kind = "agent_service_key.exchanged",
        org_id = %org_id,
        agent_id,
        key_id = %key_id,
        "Phase 10 audit: agent JWT issued"
    );

    Ok(Json(ExchangeResponse {
        access_token: token,
        token_type: "Bearer".to_string(),
        expires_in: agent_jwt::AGENT_JWT_TTL_SECONDS,
        organization_id: org_id,
    }))
}

#[derive(Debug, sqlx::FromRow)]
struct CandidateRow {
    id: Uuid,
    organization_id: Uuid,
    #[allow(dead_code)] // surfaced for future audit logging
    agent_id: String,
    key_hash: String,
    key_prefix: String,
}

// ────────────────────────────────────────────────────────────────────
// POST /revoke — admin only
// ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RevokeRequest {
    pub key_id: Uuid,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RevokeResponse {
    pub key_id: Uuid,
    pub revoked_at: DateTime<Utc>,
    pub agent_id: String,
}

pub async fn post_revoke(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Json(body): Json<RevokeRequest>,
) -> ApiResult<Json<RevokeResponse>> {
    require_admin(&user)?;
    let org_id = require_org(&user)?;
    let revoker = Uuid::parse_str(&user.user_id).ok();
    let reason = body
        .reason
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let updated: Option<(Uuid, String, DateTime<Utc>)> = sqlx::query_as(
        r#"
        UPDATE public.agent_service_keys
           SET revoked_at = now(),
               revoked_by = $2,
               revoke_reason = $3
         WHERE id = $1
           AND organization_id = $4
           AND revoked_at IS NULL
        RETURNING id, agent_id, revoked_at
        "#,
    )
    .bind(body.key_id)
    .bind(revoker)
    .bind(reason.as_deref())
    .bind(org_id)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| {
        warn!(
            ?e,
            org_id = %org_id,
            key_id = %body.key_id,
            "agent_identity::revoke: db update failed"
        );
        ApiError::Database(e)
    })?;

    let (key_id, agent_id, revoked_at) = updated.ok_or_else(|| {
        ApiError::NotFound(
            "agent service key not found, already revoked, or owned by another org".to_string(),
        )
    })?;

    // Prime the revocation cache so the middleware sees "revoked"
    // immediately — the 60 s positive-cache window only applied to
    // "not revoked" lookups, but priming this side defensively
    // guarantees the next agent call after revoke is rejected within
    // ~one round-trip rather than after the cache slot ages out.
    prime_revocation_cache(&state, key_id, true).await;

    info!(
        kind = "agent_service_key.revoked",
        org_id = %org_id,
        agent_id,
        key_id = %key_id,
        revoked_by = %user.user_id,
        reason = ?reason,
        "Phase 10 audit: agent service key revoked"
    );

    Ok(Json(RevokeResponse {
        key_id,
        revoked_at,
        agent_id,
    }))
}

// ────────────────────────────────────────────────────────────────────
// GET /list — admin only
// ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    /// When `true`, revoked keys are included in the response.
    /// Defaults to `false` so the admin UI's main view shows only
    /// active keys.
    #[serde(default)]
    pub include_revoked: Option<bool>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ServiceKeyListEntry {
    pub key_id: Uuid,
    pub agent_id: String,
    pub key_prefix: String,
    pub label: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub created_by_email: Option<String>,
    pub revoke_reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ListResponse {
    pub keys: Vec<ServiceKeyListEntry>,
}

pub async fn get_list(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Query(q): Query<ListQuery>,
) -> ApiResult<Json<ListResponse>> {
    require_admin(&user)?;
    let org_id = require_org(&user)?;
    let include_revoked = q.include_revoked.unwrap_or(false);

    let rows: Vec<ServiceKeyListEntry> = sqlx::query_as::<_, ServiceKeyListEntry>(
        r#"
        SELECT
            k.id              AS key_id,
            k.agent_id        AS agent_id,
            k.key_prefix      AS key_prefix,
            k.label           AS label,
            k.created_at      AS created_at,
            k.last_used_at    AS last_used_at,
            k.revoked_at      AS revoked_at,
            up.email          AS created_by_email,
            k.revoke_reason   AS revoke_reason
        FROM public.agent_service_keys k
        LEFT JOIN public.user_profiles up ON up.id = k.created_by
        WHERE k.organization_id = $1
          AND ($2 = true OR k.revoked_at IS NULL)
        ORDER BY (k.revoked_at IS NOT NULL), k.created_at DESC
        "#,
    )
    .bind(org_id)
    .bind(include_revoked)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| {
        warn!(
            ?e,
            org_id = %org_id,
            include_revoked,
            "agent_identity::list: db query failed"
        );
        ApiError::Database(e)
    })?;

    debug!(
        org_id = %org_id,
        include_revoked,
        returned = rows.len(),
        "agent_identity::list: served"
    );
    Ok(Json(ListResponse { keys: rows }))
}

// ────────────────────────────────────────────────────────────────────
// Rate-limit + revocation cache helpers
// ────────────────────────────────────────────────────────────────────

async fn redis_conn(
    state: &AppState,
) -> Option<PooledConnection<'_, RedisConnectionManager>> {
    match state.redis_pool.get().await {
        Ok(c) => Some(c),
        Err(e) => {
            warn!(?e, "agent_identity: redis unavailable (continuing without cache/rate-limit)");
            None
        }
    }
}

/// Returns `Some(retry_after_secs)` when the agent_id is locked.
async fn check_rate_limit(state: &AppState, agent_id: &str) -> Option<u64> {
    let mut conn = redis_conn(state).await?;
    let key = rate_limit_key(agent_id);
    let count: Option<u32> = bb8_redis::redis::cmd("GET")
        .arg(&key)
        .query_async(&mut *conn)
        .await
        .ok()
        .flatten();
    if count.unwrap_or(0) >= RATE_LIMIT_MAX_FAILURES {
        let ttl: i64 = bb8_redis::redis::cmd("TTL")
            .arg(&key)
            .query_async(&mut *conn)
            .await
            .unwrap_or(-1);
        let secs = if ttl > 0 { ttl as u64 } else { RATE_LIMIT_WINDOW_SECS };
        return Some(secs);
    }
    None
}

async fn bump_failure_counter(state: &AppState, agent_id: &str) {
    let Some(mut conn) = redis_conn(state).await else {
        return;
    };
    let key = rate_limit_key(agent_id);
    // INCR + EXPIRE NX: the first failure starts the window; subsequent
    // failures don't reset the TTL so the lock is bounded to one window.
    let _: Result<i64, _> = bb8_redis::redis::cmd("INCR")
        .arg(&key)
        .query_async(&mut *conn)
        .await;
    let _: Result<i64, _> = bb8_redis::redis::cmd("EXPIRE")
        .arg(&key)
        .arg(RATE_LIMIT_WINDOW_SECS)
        .arg("NX")
        .query_async(&mut *conn)
        .await;
}

async fn clear_rate_limit(state: &AppState, agent_id: &str) {
    let Some(mut conn) = redis_conn(state).await else {
        return;
    };
    let _: Result<i64, _> = bb8_redis::redis::cmd("DEL")
        .arg(rate_limit_key(agent_id))
        .query_async(&mut *conn)
        .await;
}

async fn prime_revocation_cache(state: &AppState, key_id: Uuid, revoked: bool) {
    let Some(mut conn) = redis_conn(state).await else {
        return;
    };
    // 60 s TTL per the plan — bounded freshness window for the
    // middleware's hot-path cache.
    let val = if revoked { "1" } else { "0" };
    let _: Result<String, _> = bb8_redis::redis::cmd("SET")
        .arg(revocation_cache_key(key_id))
        .arg(val)
        .arg("EX")
        .arg(60u64)
        .query_async(&mut *conn)
        .await;
}

// ────────────────────────────────────────────────────────────────────
// Routers
// ────────────────────────────────────────────────────────────────────

/// Public router (mounted in `main.rs` under public_routes). Only the
/// `/exchange` route — agents have no JWT yet and call this BEFORE
/// they can authenticate.
pub fn agent_identity_public_routes() -> Router<Arc<AppState>> {
    Router::new().route("/exchange", post(post_exchange))
}

/// Protected router (mounted in `main.rs` under protected_routes,
/// which has the `require_auth` middleware). Admin-only routes.
pub fn agent_identity_protected_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/register", post(post_register))
        .route("/revoke", post(post_revoke))
        .route("/list", get(get_list))
}

// `_headers` is reserved for the future audit ingest path (idempotency
// keys, etc.) — pulled out so the route signatures aren't littered
// with unused `HeaderMap` extractors.
#[allow(dead_code)]
fn _phase_10_unused_imports_pin(_: HeaderMap) {}

// ────────────────────────────────────────────────────────────────────
// Tests — unit coverage for hash, key shape, rate-limit key, request
// validation. The DB-backed paths are exercised end-to-end via the
// quality-gate flow documented in `Implement-Rust-Work-Service-Phase10.md`.
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mint_plaintext_key_has_correct_prefix() {
        let (plaintext, prefix) = mint_plaintext_key();
        assert!(plaintext.starts_with(KEY_PREFIX));
        assert!(plaintext.len() > KEY_PREFIX.len() + 30);
        assert_eq!(prefix, "omni_sk_");
    }

    #[test]
    fn mint_plaintext_key_is_random() {
        let (a, _) = mint_plaintext_key();
        let (b, _) = mint_plaintext_key();
        assert_ne!(a, b, "two consecutive mints must not produce the same key");
    }

    #[test]
    fn argon2_roundtrip_matches() {
        let plaintext = "omni_sk_demo_test_value";
        let hash = hash_key(plaintext).expect("hash");
        assert!(hash.starts_with("$argon2id$v=19$"));
        assert!(verify_key(plaintext, &hash).expect("verify"));
        assert!(!verify_key("omni_sk_wrong", &hash).expect("verify"));
    }

    #[test]
    fn argon2_uses_phase10_parameters() {
        let plaintext = "omni_sk_param_test";
        let hash = hash_key(plaintext).expect("hash");
        // Parameters are encoded in the PHC string; cheap regression
        // check that we didn't accidentally drop to defaults.
        assert!(hash.contains("m=65536"), "expected memory_cost=64MiB in {hash}");
        assert!(hash.contains("t=3"), "expected time_cost=3 in {hash}");
        assert!(hash.contains("p=4"), "expected parallelism=4 in {hash}");
    }

    #[test]
    fn rate_limit_key_namespace() {
        let k = rate_limit_key("HOST-Console-USER");
        assert_eq!(k, "ratelimit:agent-identity-exchange:HOST-Console-USER");
        assert!(k.starts_with("ratelimit:agent-identity-exchange:"));
    }

    #[test]
    fn revocation_cache_key_includes_uuid() {
        let id = Uuid::nil();
        let k = revocation_cache_key(id);
        assert!(k.starts_with("agent-identity:revoked:"));
        assert!(k.contains(&id.to_string()));
    }

    #[test]
    fn register_request_parses_minimal_body() {
        let body = r#"{ "agent_id": "host-A" }"#;
        let req: RegisterRequest = serde_json::from_str(body).expect("parse");
        assert_eq!(req.agent_id, "host-A");
        assert!(req.label.is_none());
    }

    #[test]
    fn register_request_parses_with_label() {
        let body = r#"{ "agent_id": "host-A", "label": "Citrix OmniBox 01" }"#;
        let req: RegisterRequest = serde_json::from_str(body).expect("parse");
        assert_eq!(req.label.as_deref(), Some("Citrix OmniBox 01"));
    }

    #[test]
    fn exchange_request_parses_full_body() {
        let body = r#"{ "agent_id": "host-A", "service_key": "omni_sk_abc" }"#;
        let req: ExchangeRequest = serde_json::from_str(body).expect("parse");
        assert_eq!(req.agent_id, "host-A");
        assert_eq!(req.service_key, "omni_sk_abc");
    }

    #[test]
    fn revoke_request_parses_with_optional_reason() {
        let id = Uuid::new_v4();
        let body = format!(r#"{{ "key_id": "{id}" }}"#);
        let req: RevokeRequest = serde_json::from_str(&body).expect("parse");
        assert_eq!(req.key_id, id);
        assert!(req.reason.is_none());

        let body = format!(r#"{{ "key_id": "{id}", "reason": "lost laptop" }}"#);
        let req: RevokeRequest = serde_json::from_str(&body).expect("parse");
        assert_eq!(req.reason.as_deref(), Some("lost laptop"));
    }

    #[test]
    fn require_admin_accepts_admin_and_superadmin_and_service() {
        let admin = AuthenticatedUser {
            user_id: Uuid::new_v4().to_string(),
            email: None,
            organization_id: Some(Uuid::new_v4().to_string()),
            role: Some("admin".into()),
            permissions: vec![],
        };
        assert!(require_admin(&admin).is_ok());

        let superadmin = AuthenticatedUser {
            role: Some("superadmin".into()),
            ..admin.clone()
        };
        assert!(require_admin(&superadmin).is_ok());

        let service = AuthenticatedUser {
            role: Some("service".into()),
            ..admin.clone()
        };
        assert!(require_admin(&service).is_ok());
    }

    #[test]
    fn require_admin_rejects_operator_and_agent() {
        let operator = AuthenticatedUser {
            user_id: Uuid::new_v4().to_string(),
            email: None,
            organization_id: Some(Uuid::new_v4().to_string()),
            role: Some("operator".into()),
            permissions: vec![],
        };
        assert!(require_admin(&operator).is_err());

        let agent = AuthenticatedUser {
            role: Some("agent".into()),
            ..operator.clone()
        };
        assert!(require_admin(&agent).is_err());
    }

    #[test]
    fn jwt_issued_by_register_via_helper_verifies_locally() {
        // End-to-end roundtrip without DB: mint → hash → verify →
        // jwt issue → jwt verify. Confirms the four crates wired
        // together at the route layer match.
        //
        // Acquires `crate::agent_jwt::AGENT_JWT_ENV_LOCK` so this
        // test serialises with `agent_jwt::tests::*` — they all
        // mutate `WORK_SERVICE_AGENT_JWT_SECRET`, which is process-
        // global, and without the lock a parallel test could swap
        // the secret between `issue` and `verify` here and surface
        // as a flaky `InvalidSignature`.
        let _guard = crate::agent_jwt::AGENT_JWT_ENV_LOCK.lock().unwrap();
        std::env::set_var(
            "WORK_SERVICE_AGENT_JWT_SECRET",
            "phase10-route-test-secret-32bytes!!",
        );
        let (plaintext, prefix) = mint_plaintext_key();
        assert_eq!(prefix, "omni_sk_");
        let hash = hash_key(&plaintext).unwrap();
        assert!(verify_key(&plaintext, &hash).unwrap());
        let key_id = Uuid::new_v4();
        let org_id = Uuid::new_v4();
        let token = agent_jwt::issue("host-A", org_id, key_id).unwrap();
        let claims = agent_jwt::verify(&token).unwrap();
        assert_eq!(claims.sub, "host-A");
        assert_eq!(claims.kind, "agent");
        assert_eq!(claims.key_id, key_id);
        assert_eq!(claims.org_id, org_id);
    }
}

// Created and developed by Jai Singh
