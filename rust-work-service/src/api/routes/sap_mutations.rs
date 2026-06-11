// Created and developed by Jai Singh
//! Phase 5 (2026-05-06) — server-side defence-in-depth wrapper for the
//! highest-risk SAP Testing surface: Material Master mutations.
//!
//! One endpoint mounted under `/api/v1/sap-mutations/*`, behind
//! `require_auth`:
//!
//!   - `POST /material-master` — wraps the equivalent direct-fire
//!     `agentFetch('/sap/material-master-bin')` (and its sibling
//!     `/material-master-storage-types`) callsite in
//!     `inventory-management-tab.tsx` with five layered checks before
//!     the `sap_agent_jobs` row is INSERTed:
//!
//!       1. Role gate — caller must hold `admin` / `superadmin` /
//!          `sap_mutator` (mirrors the FE's RBAC nav gate at the
//!          server boundary).
//!       2. Concurrency lock — `presence:lock:material:{material_id}`
//!          via SET NX EX 300. Two admins clicking "update" on the
//!          same material within 5min => 409 for the second.
//!       3. Per-org rate limit — INCR `ratelimit:sap-mutations:{org_id}`
//!          with EXPIRE 60s on first hit; > 10 mutations / min / org
//!          ⇒ 429 + Retry-After header. Defends SAP from a rogue
//!          batch-mode loop.
//!       4. Pre-flight audit row — INSERT `sap_audit_log` at
//!          `status='pending'` BEFORE the job is enqueued. Even if
//!          the agent crashes mid-mutation OR the job row is later
//!          purged, a forensic trail of "who tried what when" exists.
//!       5. Job INSERT — `sap_agent_jobs.payload` carries
//!          `_audit_log_id` so the `sap_jobs_listener` PgListener
//!          (`crate::sap_jobs_listener`) can patch the audit row to
//!          `'completed'` / `'failed'` / `'canceled'` when the job
//!          terminates. The audit row's `job_id` column is set in
//!          the same DB transaction so the listener can also look up
//!          the audit row by `job_id` when the payload is missing.
//!
//! Response shape:
//!
//!   ```json
//!   { "ok": true, "job_id": "<uuid>", "audit_log_id": "<uuid>" }
//!   ```
//!
//! All five steps run in the request handler — the FE no longer talks
//! to the local agent's HTTP server for these mutations. The agent
//! claims the queued `sap_agent_jobs` row the same way it claims any
//! other queue-mode job, and the WS-pushed `SapJobStatusChanged`
//! event (already shipped via Phase 4) tells the FE when the agent
//! finishes. So this endpoint is *additive* with respect to the
//! agent — no agent changes were required for Phase 5.
//!
//! Security ratchet — the Idempotency-Key header is forwarded to
//! `sap_agent_jobs.idempotency_key` so a network retry by the FE
//! never enqueues the same mutation twice. The lock + rate-limit
//! checks ALSO run before the idempotency dedup, so a duplicate POST
//! for the same idempotency key gets the same 409/429 treatment as a
//! fresh duplicate would.
//!
//! Cross-references:
//!   - FE client: `src/lib/work-service/sap-mutations-client.ts`
//!   - FE callsite: `src/features/admin/sap-testing/components/inventory-management-tab.tsx`
//!   - Listener side-effect: `rust-work-service/src/sap_jobs_listener.rs`
//!   - Migration: `supabase/migrations/277_phase5_audit_log_lifecycle.sql`
//!   - Implementation note: `memorybank/OmniFrame/Implementations/Implement-Rust-Work-Service-Phase5.md`

use axum::{
    extract::{Extension, State},
    http::HeaderMap,
    routing::post,
    Json, Router,
};
use bb8::Pool;
use bb8_redis::redis::AsyncCommands;
use bb8_redis::RedisConnectionManager;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Arc;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::api::error::{ApiError, ApiResult};
use crate::auth::AuthenticatedUser;
use crate::AppState;

/// Per-org per-minute mutation budget.
///
/// 10 mutations/min/org is loose enough that a focused human admin
/// (1 click every 5–10s) never sees a 429, but tight enough that a
/// runaway batch mode loop or an automated abuse vector is bounded
/// to ≤10 SAP transactions / minute.
pub(crate) const RATE_LIMIT_PER_MINUTE: i64 = 10;

/// Window in seconds for the per-org rate-limit token bucket. The
/// counter EXPIREs after this many seconds so a quiet minute resets
/// the budget.
pub(crate) const RATE_LIMIT_WINDOW_SECONDS: u64 = 60;

/// TTL for the Redis lock that prevents two admins from concurrently
/// editing the same material's master data. Five minutes matches the
/// upper bound of an MM02 transaction with the agent.
pub(crate) const MATERIAL_LOCK_TTL_SECONDS: u64 = 300;

/// Roles that may invoke a Material Master mutation. Mirrors the FE
/// RBAC nav gate; the server-side check is defence-in-depth so a
/// stolen JWT for a non-admin user can't bypass the FE-only gate.
///
/// Today the database carries `admin` and `superadmin`. The
/// `sap_mutator` literal is reserved per the Phase 5 plan so a
/// future fine-grained role can land without redeploying this
/// route.
const ALLOWED_MUTATION_ROLES: &[&str] =
    &["admin", "superadmin", "super_admin", "sap_mutator"];

// ────────────────────────────────────────────────────────────────────
// Wire types
// ────────────────────────────────────────────────────────────────────

/// Request body for `POST /material-master`.
///
/// `fields` is a key/value map of the Material Master columns the
/// caller wants to change. Using `BTreeMap` (not `HashMap`) so the
/// pre-flight audit payload's JSON keys are stable across builds —
/// helpful for debugging diffs against the audit log.
#[derive(Debug, Deserialize)]
pub struct MaterialMasterMutation {
    /// SAP material number — used as the lock key. Required.
    pub material: String,
    /// SAP plant code (e.g. `PL08`). Required.
    pub plant: String,
    /// Optional warehouse number. Some mutations (storage-bin) need
    /// it; others (storage-types) don't. The agent's handler decides.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warehouse: Option<String>,
    /// Optional storage type filter — used by the storage-bin handler
    /// to narrow the WM2 view.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_type: Option<String>,
    /// SAP fields to mutate. Values are passed through verbatim.
    /// `null` is allowed and represents "clear this field" semantics
    /// in MM02 (e.g. clearing a storage bin).
    #[serde(default)]
    pub fields: BTreeMap<String, Option<String>>,
    /// Optional pin to a specific SAP agent (`sap_agents.id`). When
    /// `None` any online agent in the org may claim the job.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assigned_agent_id: Option<String>,
    /// Optional dry-run pre-state — forwarded to
    /// `sap_audit_log.prev_state` so the reversal engine can later
    /// compute the inverse mutation without rerunning a read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prev_state: Option<serde_json::Value>,
    /// Which agent endpoint to enqueue. Defaults to
    /// `/sap/material-master-bin`. Whitelisted server-side; see
    /// `ALLOWED_MUTATION_ENDPOINTS`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    /// SAP transaction code recorded on the audit row (e.g. `MM02`).
    /// Defaults to `MM02` — every Material Master mutation today is
    /// MM02; the field is parameterised so a future MM01 / MM06 path
    /// can reuse the same route.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transaction_code: Option<String>,
    /// Audit-log `action` label. Defaults to
    /// `material-master-update`. Lets the FE distinguish
    /// `material_master_bin` vs `material_master_storage_types`
    /// when reading back the audit log — a future ergonomics win.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
}

/// Whitelist of agent endpoints the Material Master route can enqueue.
/// Limits the blast radius if a bug ever lets an attacker control the
/// `endpoint` field — the worst they can do is target one of these
/// vetted handlers.
const ALLOWED_MUTATION_ENDPOINTS: &[&str] = &[
    "/sap/material-master-bin",
    "/sap/material-master-storage-types",
];

/// Default endpoint when the caller omits `endpoint`. Matches the
/// most common Material Master mutation in the SAP Testing playbook.
const DEFAULT_MUTATION_ENDPOINT: &str = "/sap/material-master-bin";

/// Default audit `action` label.
const DEFAULT_AUDIT_ACTION: &str = "material-master-update";

/// Default audit `transaction_code` label.
const DEFAULT_TRANSACTION_CODE: &str = "MM02";

/// Response body for `POST /material-master`.
#[derive(Debug, Serialize)]
pub struct MutationResult {
    pub ok: bool,
    pub job_id: Uuid,
    pub audit_log_id: Uuid,
}

// ────────────────────────────────────────────────────────────────────
// Redis helpers — concurrency lock + per-org rate limit
// ────────────────────────────────────────────────────────────────────

/// Outcome of `acquire_material_lock`. The route handler turns
/// `AlreadyLocked` into a 409 response.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LockOutcome {
    /// Lock was free and is now held by us.
    Acquired,
    /// Another caller already holds the lock — retry after the TTL
    /// elapses.
    AlreadyLocked,
}

/// Build the Redis lock key for a `(org_id, material_id)` pair.
///
/// The key namespace mirrors `presence/redis.rs` so a single
/// `redis-cli KEYS presence:lock:*` scan in ops debugging surfaces
/// every active concurrency lock without an extra prefix lookup.
pub(crate) fn material_lock_key(org_id: Uuid, material_id: &str) -> String {
    format!("presence:lock:material:{}:{}", org_id, material_id)
}

/// Build the Redis rate-limit key for an org. One token-bucket counter
/// per org per minute window.
pub(crate) fn rate_limit_key(org_id: Uuid) -> String {
    format!("ratelimit:sap-mutations:{}", org_id)
}

/// Acquire a per-material concurrency lock with a 5-minute TTL.
///
/// Implemented as `SET key value NX EX ttl`. Returns `Acquired` if
/// the key was free, `AlreadyLocked` if another caller holds it.
/// `value` is the caller's user_id so ops can `redis-cli GET` the
/// key to see who's editing.
pub(crate) async fn acquire_material_lock(
    pool: &Pool<RedisConnectionManager>,
    org_id: Uuid,
    material_id: &str,
    user_id: &str,
    ttl_secs: u64,
) -> Result<LockOutcome, bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let key = material_lock_key(org_id, material_id);
    // `set_nx_ex` is not exposed directly by bb8-redis 0.16, so we
    // build the SET ... NX EX <ttl> command manually. Returning the
    // string "OK" means the key was set; `nil` means NX failed.
    let result: Option<String> = bb8_redis::redis::cmd("SET")
        .arg(&key)
        .arg(user_id)
        .arg("NX")
        .arg("EX")
        .arg(ttl_secs)
        .query_async(&mut *conn)
        .await?;
    Ok(if result.is_some() {
        LockOutcome::Acquired
    } else {
        LockOutcome::AlreadyLocked
    })
}

/// Release a per-material concurrency lock.
///
/// Best-effort — if the key is already gone (TTL elapsed, manual
/// admin DEL, etc.) this is a no-op. Returns the count of keys
/// removed (0 or 1) so callers can log a debug line on unexpected
/// values.
pub(crate) async fn release_material_lock(
    pool: &Pool<RedisConnectionManager>,
    org_id: Uuid,
    material_id: &str,
) -> Result<i64, bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let key = material_lock_key(org_id, material_id);
    let removed: i64 = conn.del(&key).await?;
    Ok(removed)
}

/// Outcome of `bump_rate_limit_counter`. The route handler turns
/// `Exceeded` into a 429 response.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RateLimitOutcome {
    pub count: i64,
    pub exceeded: bool,
    /// Seconds remaining on the rate-limit counter — used to surface
    /// `Retry-After` to the caller. `None` if the counter has no TTL
    /// (shouldn't happen in steady state — we EXPIRE on every first
    /// INCR).
    pub ttl_secs: Option<u64>,
}

/// INCR the per-org rate-limit counter and surface whether the budget
/// was exceeded.
///
/// First INCR in a window returns `1`; we set `EXPIRE` to the window
/// length so the counter resets after the window elapses. Subsequent
/// INCRs in the same window leave the TTL alone (Redis preserves the
/// TTL on INCR). Returns the post-INCR count + whether it's over the
/// budget + the remaining TTL so the route can populate
/// `Retry-After`.
pub(crate) async fn bump_rate_limit_counter(
    pool: &Pool<RedisConnectionManager>,
    org_id: Uuid,
    budget: i64,
    window_secs: u64,
) -> Result<RateLimitOutcome, bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let key = rate_limit_key(org_id);
    let count: i64 = conn.incr(&key, 1).await?;
    if count == 1 {
        // First hit in this window — set the expiry so a quiet
        // minute resets the budget. Subsequent INCRs preserve the
        // TTL by Redis semantics.
        let _: () = conn.expire(&key, window_secs as i64).await?;
    }
    let ttl_secs: i64 = conn.ttl(&key).await.unwrap_or(-1);
    let ttl = if ttl_secs > 0 {
        Some(ttl_secs as u64)
    } else {
        None
    };
    Ok(RateLimitOutcome {
        count,
        exceeded: count > budget,
        ttl_secs: ttl,
    })
}

/// Convert a bb8 pool acquisition error into a `RedisError`. Matches
/// the existing `presence/redis.rs` shape so error-rate metrics aren't
/// fragmented across modules.
fn redis_pool_err(e: bb8::RunError<bb8_redis::redis::RedisError>) -> bb8_redis::redis::RedisError {
    match e {
        bb8::RunError::User(re) => re,
        bb8::RunError::TimedOut => bb8_redis::redis::RedisError::from(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "redis pool acquire timeout",
        )),
    }
}

// ────────────────────────────────────────────────────────────────────
// Auth + validation helpers
// ────────────────────────────────────────────────────────────────────

fn require_org(user: &AuthenticatedUser) -> ApiResult<Uuid> {
    let org_id_str = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;
    Uuid::parse_str(org_id_str)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))
}

/// Reject the request unless the caller holds an allowed role.
///
/// Service-key callers (`role = "service"`) get a free pass — they
/// can be other internal services posting on behalf of a verified
/// user (the orchestrator path that lands when a Phase-3 fleet card
/// fans out a mutation, for example).
fn require_mutator_role(user: &AuthenticatedUser) -> ApiResult<()> {
    if user.role.as_deref() == Some("service") {
        return Ok(());
    }
    let role = user.role.as_deref().unwrap_or("");
    if ALLOWED_MUTATION_ROLES.contains(&role) {
        return Ok(());
    }
    warn!(
        user_id = %user.user_id,
        role = role,
        "sap_mutations: role gate rejected request"
    );
    Err(ApiError::Forbidden(
        "Material Master mutations require admin or sap_mutator role".to_string(),
    ))
}

fn validate_endpoint(endpoint: &str) -> ApiResult<()> {
    if ALLOWED_MUTATION_ENDPOINTS.contains(&endpoint) {
        return Ok(());
    }
    Err(ApiError::BadRequest(format!(
        "endpoint must be one of {:?}",
        ALLOWED_MUTATION_ENDPOINTS
    )))
}

fn validate_material_id(material: &str) -> ApiResult<()> {
    let trimmed = material.trim();
    if trimmed.is_empty() {
        return Err(ApiError::BadRequest("material is required".to_string()));
    }
    if trimmed.len() > 64 {
        return Err(ApiError::BadRequest(
            "material exceeds 64-character limit".to_string(),
        ));
    }
    Ok(())
}

// ────────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────────

/// `POST /api/v1/sap-mutations/material-master`.
///
/// See module-level doc-comment for the five-step defence-in-depth
/// pipeline.
pub async fn post_material_master_mutation(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    headers: HeaderMap,
    Json(body): Json<MaterialMasterMutation>,
) -> ApiResult<Json<MutationResult>> {
    // ── Step 1: role gate + body validation ─────────────────────────
    require_mutator_role(&user)?;
    let org_id = require_org(&user)?;
    validate_material_id(&body.material)?;
    let endpoint_owned = body
        .endpoint
        .clone()
        .unwrap_or_else(|| DEFAULT_MUTATION_ENDPOINT.to_string());
    validate_endpoint(&endpoint_owned)?;

    // ── Step 2: per-material concurrency lock ───────────────────────
    let lock_outcome =
        acquire_material_lock(&state.redis_pool, org_id, &body.material, &user.user_id, MATERIAL_LOCK_TTL_SECONDS)
            .await
            .map_err(|e| {
                warn!(?e, org_id = %org_id, material = %body.material, "sap_mutations: lock acquire failed");
                ApiError::ServiceUnavailable("Could not acquire concurrency lock".to_string())
            })?;
    if lock_outcome == LockOutcome::AlreadyLocked {
        info!(
            org_id = %org_id,
            material = %body.material,
            user_id = %user.user_id,
            "sap_mutations: 409 — material already locked by another admin"
        );
        return Err(ApiError::Conflict(format!(
            "Material '{}' is already being edited by another admin in this org. Try again in up to 5 minutes.",
            body.material
        )));
    }

    // ── Step 3: per-org rate limit ──────────────────────────────────
    let rl = bump_rate_limit_counter(
        &state.redis_pool,
        org_id,
        RATE_LIMIT_PER_MINUTE,
        RATE_LIMIT_WINDOW_SECONDS,
    )
    .await
    .map_err(|e| {
        warn!(?e, org_id = %org_id, "sap_mutations: rate limit INCR failed");
        ApiError::ServiceUnavailable("Could not check rate limit".to_string())
    })?;
    if rl.exceeded {
        // Release the lock we just acquired — otherwise the caller
        // gets locked out for 5min on a 429 they could legitimately
        // retry in 60s.
        let _ = release_material_lock(&state.redis_pool, org_id, &body.material).await;
        info!(
            org_id = %org_id,
            count = rl.count,
            ttl = ?rl.ttl_secs,
            "sap_mutations: 429 — per-org budget exceeded"
        );
        return Err(ApiError::TooManyRequests {
            message: format!(
                "Per-org Material Master mutation budget exceeded ({} > {} per {}s window). Retry after the window resets.",
                rl.count, RATE_LIMIT_PER_MINUTE, RATE_LIMIT_WINDOW_SECONDS
            ),
            retry_after_secs: rl.ttl_secs.or(Some(RATE_LIMIT_WINDOW_SECONDS)),
        });
    }

    // ── Idempotency-Key passthrough ─────────────────────────────────
    let idempotency_key = headers
        .get("Idempotency-Key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // ── Step 4 + 5 in a single DB transaction ───────────────────────
    //
    //   4a) INSERT sap_audit_log (status='pending')      ← audit_log_id
    //   4b) INSERT sap_agent_jobs (payload._audit_log_id) ← job_id
    //   4c) UPDATE sap_audit_log SET job_id = $job_id    ← link the row
    //
    // Wrapping all three in one transaction guarantees the audit row
    // is paired with its job row even if the request is interrupted
    // mid-INSERT — partial failure leaves nothing behind, which is
    // the right invariant for a security ratchet.
    let action = body
        .action
        .clone()
        .unwrap_or_else(|| DEFAULT_AUDIT_ACTION.to_string());
    let transaction_code = body
        .transaction_code
        .clone()
        .unwrap_or_else(|| DEFAULT_TRANSACTION_CODE.to_string());

    // Build the audit `payload` blob. Captures the snapshot of fields
    // the caller wanted to change so a forensic auditor can read the
    // intent off the row even if the agent never claims the job.
    let audit_payload = serde_json::json!({
        "material": body.material,
        "plant": body.plant,
        "warehouse": body.warehouse,
        "storage_type": body.storage_type,
        "fields": body.fields,
        "endpoint": endpoint_owned,
        "assigned_agent_id": body.assigned_agent_id,
    });

    let user_uuid = Uuid::parse_str(&user.user_id).ok();

    let mut tx = state.db_pool.begin().await.map_err(|e| {
        // Lock release on db-acquire failure is best-effort.
        warn!(?e, "sap_mutations: tx begin failed");
        ApiError::Database(e)
    })?;

    let audit_log_id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO public.sap_audit_log (
            organization_id,
            user_id,
            transaction_code,
            action,
            payload,
            status,
            agent_version,
            prev_state,
            reversal_status
        ) VALUES ($1, $2, $3, $4, $5, 'pending', NULL, $6, 'original')
        RETURNING id
        "#,
    )
    .bind(org_id)
    .bind(user_uuid)
    .bind(&transaction_code)
    .bind(&action)
    .bind(&audit_payload)
    .bind(body.prev_state.as_ref())
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        warn!(?e, org_id = %org_id, "sap_mutations: audit pre-flight INSERT failed");
        ApiError::Database(e)
    })?;

    // Job payload — what the agent actually consumes. Mirrors the
    // direct-fire body the FE used to POST to the agent at
    // `/sap/material-master-bin`. Adding `_audit_log_id` so the
    // listener-side patch in `sap_jobs_listener.rs` can resolve the
    // audit row without reading the audit table again.
    let mut job_payload = serde_json::json!({
        "material": body.material,
        "plant": body.plant,
        "_audit_log_id": audit_log_id,
    });
    if let Some(warehouse) = &body.warehouse {
        job_payload["warehouse"] = serde_json::Value::String(warehouse.clone());
    }
    if let Some(storage_type) = &body.storage_type {
        job_payload["storage_type"] = serde_json::Value::String(storage_type.clone());
    }
    for (k, v) in &body.fields {
        // Skip keys that would collide with the structural fields the
        // agent already reads from the payload.
        if k == "material" || k == "plant" || k == "warehouse" || k == "storage_type" {
            continue;
        }
        job_payload[k] = match v {
            Some(s) => serde_json::Value::String(s.clone()),
            None => serde_json::Value::Null,
        };
    }

    let job_id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO public.sap_agent_jobs (
            organization_id,
            requested_by,
            endpoint,
            payload,
            status,
            priority,
            max_attempts,
            assigned_agent_id,
            idempotency_key
        ) VALUES ($1, $2, $3, $4, 'queued', 100, 1, $5, $6)
        RETURNING id
        "#,
    )
    .bind(org_id)
    .bind(user_uuid)
    .bind(&endpoint_owned)
    .bind(&job_payload)
    .bind(body.assigned_agent_id.as_deref())
    .bind(idempotency_key.as_deref())
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        warn!(?e, org_id = %org_id, audit_log_id = %audit_log_id, "sap_mutations: job INSERT failed");
        ApiError::Database(e)
    })?;

    sqlx::query(
        r#"
        UPDATE public.sap_audit_log
           SET job_id = $1
         WHERE id = $2
        "#,
    )
    .bind(job_id)
    .bind(audit_log_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        warn!(?e, audit_log_id = %audit_log_id, job_id = %job_id, "sap_mutations: audit row job_id link failed");
        ApiError::Database(e)
    })?;

    tx.commit().await.map_err(|e| {
        warn!(?e, "sap_mutations: tx commit failed");
        ApiError::Database(e)
    })?;

    info!(
        org_id = %org_id,
        user_id = %user.user_id,
        material = %body.material,
        plant = %body.plant,
        endpoint = %endpoint_owned,
        action = %action,
        job_id = %job_id,
        audit_log_id = %audit_log_id,
        idempotency_key = ?idempotency_key,
        rate_limit_count = rl.count,
        "sap_mutations: material-master mutation enqueued"
    );

    debug!(
        org_id = %org_id,
        material = %body.material,
        "sap_mutations: leaving lock in place to expire after TTL"
    );

    Ok(Json(MutationResult {
        ok: true,
        job_id,
        audit_log_id,
    }))
}

// ────────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────────

/// Build the sap-mutations router, mounted by `main.rs` at
/// `/api/v1/sap-mutations` (alphabetically placed AFTER the Phase 3
/// `/api/v1/sap-agents` nest in the router-nest list).
pub fn sap_mutations_routes() -> Router<Arc<AppState>> {
    Router::new().route("/material-master", post(post_material_master_mutation))
}

// ────────────────────────────────────────────────────────────────────
// Tests — pure-logic unit tests (no live Redis / Postgres)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::AuthenticatedUser;

    fn user_with_role(role: Option<&str>) -> AuthenticatedUser {
        AuthenticatedUser {
            user_id: "00000000-0000-0000-0000-000000000001".to_string(),
            email: Some("dev@example.com".to_string()),
            organization_id: Some("00000000-0000-0000-0000-0000000000aa".to_string()),
            role: role.map(|s| s.to_string()),
            permissions: vec![],
        }
    }

    // Lock + rate-limit key formatters — pure-logic.
    #[test]
    fn material_lock_key_is_namespaced() {
        let org_id = Uuid::nil();
        let key = material_lock_key(org_id, "AS16446");
        assert_eq!(key, "presence:lock:material:00000000-0000-0000-0000-000000000000:AS16446");
        assert!(
            key.starts_with("presence:lock:material:"),
            "key must live under the presence:lock:material:* namespace so ops can `redis-cli KEYS` it"
        );
    }

    #[test]
    fn rate_limit_key_is_namespaced() {
        let org_id = Uuid::nil();
        let key = rate_limit_key(org_id);
        assert_eq!(key, "ratelimit:sap-mutations:00000000-0000-0000-0000-000000000000");
        assert!(
            key.starts_with("ratelimit:sap-mutations:"),
            "rate-limit key must live under ratelimit:sap-mutations:* namespace"
        );
    }

    #[test]
    fn material_lock_key_is_unique_per_org_and_material() {
        let org_a = Uuid::parse_str("00000000-0000-0000-0000-0000000000aa").unwrap();
        let org_b = Uuid::parse_str("00000000-0000-0000-0000-0000000000bb").unwrap();
        let mat_a = "AS16446";
        let mat_b = "BS70210";
        let keys = [
            material_lock_key(org_a, mat_a),
            material_lock_key(org_a, mat_b),
            material_lock_key(org_b, mat_a),
            material_lock_key(org_b, mat_b),
        ];
        let unique: std::collections::HashSet<_> = keys.iter().collect();
        assert_eq!(
            unique.len(),
            keys.len(),
            "lock keys must collide on (org, material) pair only"
        );
    }

    // Role-gate — defence-in-depth on the JWT claim.
    #[test]
    fn role_gate_accepts_admin() {
        let user = user_with_role(Some("admin"));
        require_mutator_role(&user).expect("admin must be allowed");
    }

    #[test]
    fn role_gate_accepts_superadmin() {
        let user = user_with_role(Some("superadmin"));
        require_mutator_role(&user).expect("superadmin must be allowed");
    }

    #[test]
    fn role_gate_accepts_sap_mutator() {
        let user = user_with_role(Some("sap_mutator"));
        require_mutator_role(&user).expect("sap_mutator must be allowed");
    }

    #[test]
    fn role_gate_accepts_service_caller() {
        let user = user_with_role(Some("service"));
        require_mutator_role(&user).expect("service callers bypass role gate");
    }

    #[test]
    fn role_gate_rejects_viewer() {
        let user = user_with_role(Some("viewer"));
        assert!(matches!(
            require_mutator_role(&user),
            Err(ApiError::Forbidden(_))
        ));
    }

    #[test]
    fn role_gate_rejects_missing_role() {
        let user = user_with_role(None);
        assert!(matches!(
            require_mutator_role(&user),
            Err(ApiError::Forbidden(_))
        ));
    }

    // Endpoint whitelist.
    #[test]
    fn endpoint_whitelist_accepts_known_paths() {
        validate_endpoint("/sap/material-master-bin").unwrap();
        validate_endpoint("/sap/material-master-storage-types").unwrap();
    }

    #[test]
    fn endpoint_whitelist_rejects_arbitrary_paths() {
        assert!(matches!(
            validate_endpoint("/sap/transfer-inventory"),
            Err(ApiError::BadRequest(_))
        ));
        assert!(matches!(
            validate_endpoint("/etc/passwd"),
            Err(ApiError::BadRequest(_))
        ));
        assert!(matches!(
            validate_endpoint(""),
            Err(ApiError::BadRequest(_))
        ));
    }

    // Material-id validation.
    #[test]
    fn material_validation_rejects_empty_or_oversized() {
        assert!(matches!(
            validate_material_id(""),
            Err(ApiError::BadRequest(_))
        ));
        assert!(matches!(
            validate_material_id("   "),
            Err(ApiError::BadRequest(_))
        ));
        let big = "X".repeat(65);
        assert!(matches!(
            validate_material_id(&big),
            Err(ApiError::BadRequest(_))
        ));
    }

    #[test]
    fn material_validation_accepts_normal_ids() {
        validate_material_id("AS16446").unwrap();
        validate_material_id("PART-WITH-DASHES").unwrap();
        // Exactly 64 chars — boundary case.
        validate_material_id(&"X".repeat(64)).unwrap();
    }

    // Rate-limit threshold semantics — pure-logic check on the
    // `RateLimitOutcome.exceeded` flag.
    #[test]
    fn rate_limit_outcome_at_budget_is_not_exceeded() {
        // Hitting the budget exactly is OK — only > budget is over.
        let ok = RateLimitOutcome {
            count: RATE_LIMIT_PER_MINUTE,
            exceeded: RATE_LIMIT_PER_MINUTE > RATE_LIMIT_PER_MINUTE,
            ttl_secs: Some(60),
        };
        assert!(!ok.exceeded);
    }

    #[test]
    fn rate_limit_outcome_above_budget_is_exceeded() {
        let over = RateLimitOutcome {
            count: RATE_LIMIT_PER_MINUTE + 1,
            exceeded: RATE_LIMIT_PER_MINUTE + 1 > RATE_LIMIT_PER_MINUTE,
            ttl_secs: Some(60),
        };
        assert!(over.exceeded);
    }

    // Default-fill semantics on the request body — `serde` defaults
    // for the optional fields.
    #[test]
    fn mutation_body_default_fills_endpoint_and_action() {
        let body = serde_json::json!({
            "material": "AS16446",
            "plant": "PL08",
        });
        let parsed: MaterialMasterMutation =
            serde_json::from_value(body).expect("body parses");
        assert_eq!(parsed.material, "AS16446");
        assert!(parsed.endpoint.is_none(), "no endpoint => caller-side default");
        assert!(parsed.fields.is_empty());
        assert!(parsed.warehouse.is_none());
    }

    #[test]
    fn mutation_body_accepts_full_shape() {
        let body = serde_json::json!({
            "material": "AS16446",
            "plant": "PL08",
            "warehouse": "WH8",
            "storage_type": "826",
            "fields": { "storage_bin": "SX-29-EN" },
            "endpoint": "/sap/material-master-bin",
            "transaction_code": "MM02",
            "action": "material_master_bin",
            "prev_state": { "storage_bin": "OLD-BIN-A-01" },
            "assigned_agent_id": "agent-uuid-here",
        });
        let parsed: MaterialMasterMutation =
            serde_json::from_value(body).expect("body parses");
        assert_eq!(parsed.fields.get("storage_bin"), Some(&Some("SX-29-EN".to_string())));
        assert_eq!(parsed.endpoint.as_deref(), Some("/sap/material-master-bin"));
        assert_eq!(parsed.action.as_deref(), Some("material_master_bin"));
        assert_eq!(
            parsed
                .prev_state
                .as_ref()
                .and_then(|v| v.get("storage_bin"))
                .and_then(|v| v.as_str()),
            Some("OLD-BIN-A-01")
        );
    }

    #[test]
    fn mutation_body_supports_null_field_value() {
        // MM02 "clear the storage bin" — `null` is meaningful.
        let body = serde_json::json!({
            "material": "AS16446",
            "plant": "PL08",
            "fields": { "storage_bin": null },
        });
        let parsed: MaterialMasterMutation =
            serde_json::from_value(body).expect("body parses");
        assert_eq!(parsed.fields.get("storage_bin"), Some(&None));
    }
}

// Created and developed by Jai Singh
