// Created and developed by Jai Singh
//! OmniBelt bootstrap endpoint (`GET /omnibelt/bootstrap`).
//!
//! Returns the per-user OmniBelt configuration payload required to mount
//! the floating launcher: kill-switch evaluation, role-default belt,
//! per-user prefs, org-wide allow-list, tool registry version stub, and
//! a placeholder for active jobs (filled by `workServiceWs` push in P5,
//! never via this endpoint).
//!
//! ## Read paths
//!
//! ALL reads route through `state.read_pool` per spec §16
//! (read-replica routing). Writes are not allowed on this endpoint —
//! mutations go through the FastAPI proxy → primary pool.
//!
//! ## Caching
//!
//! Layer 2 of the three-layer cache (browser → Redis → replica). When
//! `state.redis_pool` is `Some`, results are cached at
//! `omnibelt:bootstrap:{org_id}:{user_id}` with a 30-second TTL.
//! On cache miss we hit the replica and write-through. Redis failures
//! are logged at `warn` and treated as cache miss — the endpoint
//! degrades to "always replica" but never fails.
//!
//! Invalidation is hot-reloaded via `rust-work-service`'s PgListener on
//! the `omnibelt_config_changed` channel: when the trigger fires for an
//! org, that listener DELs `omnibelt:bootstrap:{org_id}:*` so the next
//! bootstrap fetch by any user in that org sees fresh data.

use std::sync::Arc;

use axum::{extract::State, http::StatusCode, Extension, Json};
use bb8::Pool;
use bb8_redis::{redis::AsyncCommands, RedisConnectionManager};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::AppState;

/// 30-second TTL on the per-(org,user) bootstrap cache. Matches spec
/// §15.2 — short enough that admin config changes feel near-real-time
/// without the WS invalidation, long enough to absorb the 2k-user
/// mount-storm on deploy/login spikes.
const CACHE_TTL_SECONDS: u64 = 30;

#[derive(Debug, Serialize, Deserialize)]
pub struct KillSwitch {
    pub enabled: bool,
    /// `"env"` (build-time disabled — not actually emitted by the Rust
    /// path; reserved for symmetry with the FE evaluator),
    /// `"org"` when the `settings.system.omnibelt.enabled` row exists,
    /// `"none"` when no row exists (default-enabled).
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OmnibeltRoleConfig {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub role_id: Uuid,
    pub default_tool_ids: Vec<String>,
    pub default_pinned_ids: Vec<String>,
    pub default_position: Value,
    pub default_skin: String,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub updated_by: Option<Uuid>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OmnibeltUserPrefs {
    pub user_id: Uuid,
    pub organization_id: Uuid,
    pub pinned_tool_ids: Vec<String>,
    pub hidden_tool_ids: Vec<String>,
    pub tool_order: Vec<String>,
    pub position_by_route: Value,
    pub skin: Option<String>,
    pub mach3_behavior: String,
    pub auto_hide_after_seconds: i32,
    pub user_hidden: bool,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// Active job payload — placeholder for P5. Always empty today; the
/// real population path is `workServiceWs` push events filtered by
/// the FE, never this bootstrap endpoint. Defined here so the wire
/// shape is forward-compatible.
#[derive(Debug, Serialize, Deserialize)]
pub struct ActiveJob {
    pub id: String,
    pub job_type: String,
    pub label: String,
    pub progress: f64,
    pub started_at: i64,
    pub started_by_current_user: bool,
    pub cancelable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancel_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OmnibeltBootstrap {
    pub kill_switch: KillSwitch,
    pub role_config: Option<OmnibeltRoleConfig>,
    pub user_prefs: Option<OmnibeltUserPrefs>,
    pub allow_list: Vec<String>,
    pub tool_registry_version: u32,
    pub initial_active_jobs: Vec<ActiveJob>,
}

/// Build the per-(org,user) Redis key used by both this endpoint and
/// the matching DEL pattern in `rust-work-service`'s PgListener.
fn cache_key(org_id: &Uuid, user_id: &Uuid) -> String {
    format!("omnibelt:bootstrap:{}:{}", org_id, user_id)
}

/// Try to read a JSON-serialised bootstrap payload from Redis.
/// Returns `None` on miss, on any Redis error, or when caching is
/// disabled — call sites treat all three identically.
async fn cache_get(
    pool: &Pool<RedisConnectionManager>,
    key: &str,
) -> Option<OmnibeltBootstrap> {
    let mut conn = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            warn!(error = %e, "omnibelt cache: redis pool acquire failed");
            return None;
        }
    };
    let raw: Option<String> = match conn.get(key).await {
        Ok(v) => v,
        Err(e) => {
            warn!(error = %e, key = %key, "omnibelt cache: GET failed");
            return None;
        }
    };
    let body = raw?;
    match serde_json::from_str::<OmnibeltBootstrap>(&body) {
        Ok(v) => Some(v),
        Err(e) => {
            warn!(error = %e, key = %key, "omnibelt cache: deserialize failed");
            None
        }
    }
}

/// Write-through with `EX = 30`. Errors are logged but never bubble.
async fn cache_set(
    pool: &Pool<RedisConnectionManager>,
    key: &str,
    value: &OmnibeltBootstrap,
) {
    let body = match serde_json::to_string(value) {
        Ok(b) => b,
        Err(e) => {
            warn!(error = %e, "omnibelt cache: serialize failed");
            return;
        }
    };
    let mut conn = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            warn!(error = %e, "omnibelt cache: redis pool acquire failed (set)");
            return;
        }
    };
    let result: Result<(), _> = conn.set_ex(key, body, CACHE_TTL_SECONDS).await;
    if let Err(e) = result {
        warn!(error = %e, key = %key, "omnibelt cache: SETEX failed");
    }
}

/// `GET /omnibelt/bootstrap`
///
/// Authenticated by the existing `require_auth` middleware (mirrors
/// `/stats`). The middleware injects `AuthenticatedUser` into request
/// extensions; we extract it here via `axum::Extension`.
pub async fn get_bootstrap(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<OmnibeltBootstrap>, (StatusCode, String)> {
    let user_id_str = user.user_id.clone();
    let org_id_str = match user.organization_id.clone() {
        Some(s) => s,
        None => {
            return Err((
                StatusCode::FORBIDDEN,
                "Organization context required".to_string(),
            ));
        }
    };

    let user_id = Uuid::parse_str(&user_id_str)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid user_id: {e}")))?;
    let org_id = Uuid::parse_str(&org_id_str)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid organization_id: {e}")))?;

    let key = cache_key(&org_id, &user_id);

    if let Some(redis_pool) = state.redis_pool.as_ref() {
        if let Some(hit) = cache_get(redis_pool, &key).await {
            debug!(key = %key, "omnibelt bootstrap: cache hit");
            return Ok(Json(hit));
        }
    }

    debug!(key = %key, "omnibelt bootstrap: cache miss; reading replica");

    let bootstrap = build_bootstrap(&state, &org_id, &user_id, user.role.as_deref())
        .await
        .map_err(|e| {
            warn!(error = %e, "omnibelt bootstrap: read-pool failure");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("bootstrap read failed: {e}"),
            )
        })?;

    if let Some(redis_pool) = state.redis_pool.as_ref() {
        cache_set(redis_pool, &key, &bootstrap).await;
    }

    Ok(Json(bootstrap))
}

/// Pure read path — runs every SELECT against `state.read_pool`.
async fn build_bootstrap(
    state: &AppState,
    org_id: &Uuid,
    user_id: &Uuid,
    role_name: Option<&str>,
) -> Result<OmnibeltBootstrap, sqlx::Error> {
    let kill_switch = read_kill_switch(state).await?;
    let allow_list = read_allow_list(state).await?;
    let role_config = read_role_config(state, org_id, role_name).await?;
    let user_prefs = read_user_prefs(state, user_id).await?;

    Ok(OmnibeltBootstrap {
        kill_switch,
        role_config,
        user_prefs,
        allow_list,
        // P2 stub — the FE will check this to invalidate its registry
        // cache when the registry ships in P3+. Bumped by hand on
        // breaking shape changes.
        tool_registry_version: 1,
        // Placeholder per spec §10.4 — populated by `workServiceWs`
        // push in P5, NOT by this bootstrap endpoint.
        initial_active_jobs: Vec::new(),
    })
}

/// Read `settings` row keyed by `system.omnibelt.enabled`. Default-true
/// when absent (matches the FE `OmnibeltSettingsService.getEnabled`
/// fail-open posture).
async fn read_kill_switch(state: &AppState) -> Result<KillSwitch, sqlx::Error> {
    let row: Option<(Value,)> = sqlx::query_as(
        r#"
        SELECT value
          FROM settings
         WHERE key = 'system.omnibelt.enabled'
           AND user_id IS NULL
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 1
        "#,
    )
    .fetch_optional(&state.read_pool)
    .await?;

    Ok(match row {
        None => KillSwitch {
            enabled: true,
            source: "none".to_string(),
        },
        Some((value,)) => {
            let enabled = value
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            KillSwitch {
                enabled,
                source: "org".to_string(),
            }
        }
    })
}

/// Read `settings` row keyed by `system.omnibelt.allow_list`.
/// Default empty when absent — FE treats `[]` as "no restriction".
async fn read_allow_list(state: &AppState) -> Result<Vec<String>, sqlx::Error> {
    let row: Option<(Value,)> = sqlx::query_as(
        r#"
        SELECT value
          FROM settings
         WHERE key = 'system.omnibelt.allow_list'
           AND user_id IS NULL
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 1
        "#,
    )
    .fetch_optional(&state.read_pool)
    .await?;

    Ok(match row {
        None => Vec::new(),
        Some((value,)) => value
            .get("tool_ids")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default(),
    })
}

/// Resolve the user's role row, then look up the matching
/// `omnibelt_role_config` row. Returns `None` when the role isn't set
/// on the JWT, when the role isn't in the `roles` table for this org,
/// or when no per-role config has been authored yet.
///
/// `roles.name` is the canonical key used by the JWT validation chain
/// (the rust-core-service exposes `role` as the role name string).
async fn read_role_config(
    state: &AppState,
    org_id: &Uuid,
    role_name: Option<&str>,
) -> Result<Option<OmnibeltRoleConfig>, sqlx::Error> {
    let Some(role_name) = role_name else {
        return Ok(None);
    };
    if role_name.is_empty() {
        return Ok(None);
    }

    let row: Option<OmnibeltRoleConfig> = sqlx::query_as::<_, (Uuid, Uuid, Uuid, Vec<String>, Vec<String>, Value, String, chrono::DateTime<chrono::Utc>, Option<Uuid>)>(
        r#"
        SELECT
            orc.id,
            orc.organization_id,
            orc.role_id,
            orc.default_tool_ids,
            orc.default_pinned_ids,
            orc.default_position,
            orc.default_skin,
            orc.updated_at,
            orc.updated_by
          FROM omnibelt_role_config orc
          JOIN roles r ON r.id = orc.role_id
         WHERE orc.organization_id = $1
           AND r.name = $2
         LIMIT 1
        "#,
    )
    .bind(org_id)
    .bind(role_name)
    .fetch_optional(&state.read_pool)
    .await?
    .map(|t| OmnibeltRoleConfig {
        id: t.0,
        organization_id: t.1,
        role_id: t.2,
        default_tool_ids: t.3,
        default_pinned_ids: t.4,
        default_position: t.5,
        default_skin: t.6,
        updated_at: t.7,
        updated_by: t.8,
    });

    Ok(row)
}

/// Read this user's omnibelt prefs row (RLS-equivalent — query is
/// keyed on the JWT-asserted `user_id`, the read pool runs with the
/// service role).
async fn read_user_prefs(
    state: &AppState,
    user_id: &Uuid,
) -> Result<Option<OmnibeltUserPrefs>, sqlx::Error> {
    let row: Option<OmnibeltUserPrefs> = sqlx::query_as::<_, (
        Uuid,
        Uuid,
        Vec<String>,
        Vec<String>,
        Vec<String>,
        Value,
        Option<String>,
        String,
        i32,
        bool,
        chrono::DateTime<chrono::Utc>,
    )>(
        r#"
        SELECT
            user_id,
            organization_id,
            pinned_tool_ids,
            hidden_tool_ids,
            tool_order,
            position_by_route,
            skin,
            mach3_behavior,
            auto_hide_after_seconds,
            user_hidden,
            updated_at
          FROM omnibelt_user_prefs
         WHERE user_id = $1
         LIMIT 1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.read_pool)
    .await?
    .map(|t| OmnibeltUserPrefs {
        user_id: t.0,
        organization_id: t.1,
        pinned_tool_ids: t.2,
        hidden_tool_ids: t.3,
        tool_order: t.4,
        position_by_route: t.5,
        skin: t.6,
        mach3_behavior: t.7,
        auto_hide_after_seconds: t.8,
        user_hidden: t.9,
        updated_at: t.10,
    });

    Ok(row)
}

// Created and developed by Jai Singh
