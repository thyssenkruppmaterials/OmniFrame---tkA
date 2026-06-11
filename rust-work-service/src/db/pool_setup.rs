// Created and developed by Jai Singh
//! Postgres pool setup hooks (Item 17 from the cutover-invariants plan).
//!
//! Exposes a `build_pool_with_flag_overrides` helper that mirrors the
//! existing `PgPoolOptions::connect()` call site in `main.rs` but ALSO
//! registers an `after_connect` hook that writes the
//! `WORK_ENGINE_FLAG_OVERRIDES` env JSON into a per-connection
//! `work_engine.flag_overrides` GUC.
//!
//! This wires up the Rust half of migration 262: the SQL helper
//! `public.work_engine_feature_flag(p_org, p_key)` reads
//! `current_setting('work_engine.flag_overrides', true)` as the
//! highest-precedence override layer. Without this hook, the GUC is
//! always empty and Layer 1 silently falls through to per-org / default.
//!
//! The env var is parsed once at startup. Bad JSON downgrades to an
//! empty-overrides connection and emits a single WARN — never panics,
//! since a typo in operator config must never wedge the service.

use serde_json::Value as Json;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;
use std::time::Duration;
use tracing::{info, warn};

/// Env var name documented in `docs/work-engine/phase-11-rollout.md` §11.4a
/// and migration 262's header comment.
pub const ENV_VAR: &str = "WORK_ENGINE_FLAG_OVERRIDES";

/// Parse + sanity-check the env var. Returns the JSON object as a STRING (the
/// payload that gets fed to `set_config`) or `None` if the env var is unset
/// / empty / malformed. Logs at WARN on malformed input — never panics so a
/// typo can't wedge the service.
pub fn flag_overrides_payload_from_env() -> Option<String> {
    flag_overrides_payload_from_str(std::env::var(ENV_VAR).ok().as_deref())
}

/// Variant that takes the raw string for testing.
pub fn flag_overrides_payload_from_str(raw: Option<&str>) -> Option<String> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }
    match serde_json::from_str::<Json>(raw) {
        Ok(Json::Object(map)) => {
            let mut filtered = serde_json::Map::with_capacity(map.len());
            for (k, v) in map {
                if v.is_boolean() || v.is_null() {
                    filtered.insert(k, v);
                } else {
                    warn!(
                        env = ENV_VAR,
                        key = %k,
                        value = %v,
                        "ignored non-boolean/null entry in WORK_ENGINE_FLAG_OVERRIDES"
                    );
                }
            }
            Some(Json::Object(filtered).to_string())
        }
        Ok(other) => {
            warn!(
                env = ENV_VAR,
                got = %other,
                "WORK_ENGINE_FLAG_OVERRIDES must be a JSON object; ignoring"
            );
            None
        }
        Err(e) => {
            warn!(
                env = ENV_VAR,
                error = %e,
                "WORK_ENGINE_FLAG_OVERRIDES is not valid JSON; ignoring"
            );
            None
        }
    }
}

/// Build a Postgres pool whose connections always carry the
/// `work_engine.flag_overrides` GUC, populated from the
/// `WORK_ENGINE_FLAG_OVERRIDES` env var.
///
/// Mirrors the existing `PgPoolOptions::new()` defaults from `main.rs` so
/// behaviour is unchanged when the env var is unset.
///
/// Backwards-compatible thin wrapper around
/// [`build_pool_with_flag_overrides_named`] that omits the
/// `application_name` knob (no `application_name` is set on the
/// connection string). Preserved as a public API for the `lib.rs`
/// crate surface; the in-tree binary now uses the `_named` variant
/// exclusively (Items 4 + 5 post-audit) so this entry point is
/// `#[allow(dead_code)]` from main's perspective.
#[allow(dead_code)]
pub async fn build_pool_with_flag_overrides(
    database_url: &str,
    max_connections: u32,
    acquire_timeout: Duration,
) -> Result<PgPool, sqlx::Error> {
    // Backwards-compatible eager init — pre-existing callers expect the pool
    // to be live by the time the future resolves. See `_named_with_lazy`
    // for the boot-resilient variant.
    build_pool_with_flag_overrides_named(database_url, max_connections, acquire_timeout, None).await
}

/// Build a Postgres pool with the same `flag_overrides` hook as
/// [`build_pool_with_flag_overrides`], plus an optional
/// `application_name` that is set on every connection's
/// `PgConnectOptions`.
///
/// `application_name` is the canonical knob for tagging backends in
/// `pg_stat_activity`; setting it lets operators audit which connections
/// belong to rust-work-service (and which sub-pool — general vs
/// listener) WITHOUT IP-address detective work.
///
/// Item 5 (post-audit, 2026-05-07) — wires up the pool labels for
/// the `pg_stat_activity` audit. After this lands, every backend
/// owned by this service shows up as either:
///
///   - `application_name = rust-work-service`
///   - `application_name = rust-work-service-listener`
///
/// EAGER variant — opens at least one connection to validate connectivity
/// before returning. Use for pools that MUST be live at boot (e.g. the
/// listener pool, which spawns `PgListener` tasks immediately on startup).
/// For pools that can tolerate a deferred first-connection cost (e.g. the
/// general/HTTP pool, which has the new container blocked by Supavisor's
/// session-mode `pool_size` while the OLD container still holds it during
/// a zero-downtime rolling deploy), prefer
/// [`build_pool_with_flag_overrides_named_lazy`].
pub async fn build_pool_with_flag_overrides_named(
    database_url: &str,
    max_connections: u32,
    acquire_timeout: Duration,
    application_name: Option<&str>,
) -> Result<PgPool, sqlx::Error> {
    let (opts, payload) = prepare_pool_options(database_url, application_name)?;
    pool_options_with_hooks(max_connections, acquire_timeout, payload)
        .connect_with(opts)
        .await
}

/// Lazy variant of [`build_pool_with_flag_overrides_named`].
///
/// Returns synchronously without opening any connection to Postgres. The
/// first request that calls `pool.acquire().await` pays the connection
/// cost. Mirrors the bb8 `build_unchecked` pattern already used for the
/// Redis pool in `main.rs` (2026-05-11 — see the long-form comment block
/// there for the Redis-side rationale).
///
/// Why we need this for the general pool (2026-05-14 follow-up):
///
/// Supavisor's pooler endpoint (`*.pooler.supabase.com:5432`) runs in
/// **session mode** with a hard `pool_size` ceiling (16 today). During a
/// `railway up` rolling deploy the OLD container still holds its
/// 20-connection share through Supavisor, so the NEW container's eager
/// `connect_with` panics with `(EMAXCONNSESSION) max clients reached in
/// session mode - max clients are limited to pool_size: 16` and Railway
/// flips the deployment to FAILED after `restartPolicyMaxRetries`. The
/// old container keeps serving traffic with stale code — exactly what
/// happened to the 2026-05-14 morning Phase 0 fix attempt (deployment
/// `8850b07d-…` panic-looped on EMAXCONNSESSION between 12:55:21Z and
/// 12:55:39Z; the `c06f8ff3-…` 2026-05-12 image continued to serve).
///
/// With this lazy variant the NEW container boots cleanly (the basic
/// `/health` endpoint never touches the pool), Railway's healthcheck
/// passes, Railway drains the OLD container, the Supavisor slots free,
/// and the first HTTP request on the NEW container then successfully
/// acquires its first connection. The `after_connect` hook and
/// `application_name` tagging both work identically — they fire on the
/// deferred first connect, not at pool construction.
///
/// See [[Debug/Fix-RF-Cycle-Count-Stuck-Waiting.md]] (James Dearman PM
/// deep-dive, 2026-05-14) for the failure timeline.
pub fn build_pool_with_flag_overrides_named_lazy(
    database_url: &str,
    max_connections: u32,
    acquire_timeout: Duration,
    application_name: Option<&str>,
) -> Result<PgPool, sqlx::Error> {
    let (opts, payload) = prepare_pool_options(database_url, application_name)?;
    Ok(pool_options_with_hooks(max_connections, acquire_timeout, payload)
        .connect_lazy_with(opts))
}

/// Listener-pool variant of [`build_pool_with_flag_overrides_named_lazy`]
/// that additionally pins `min_connections`. Used by the listener
/// pool whose steady-state shape is N dedicated `PgListener` sockets
/// + a small constant of keepalive-send slots — `min_connections`
/// matched to the listener-task count keeps the pool from churning
/// open/close on every quiescent keepalive tick.
///
/// Introduced 2026-05-20 alongside the multi-channel listener
/// consolidation. See
/// [[Implementations/Compress-Rust-Work-Listener-Pool-2026-05-20]].
pub fn build_listener_pool_lazy(
    database_url: &str,
    max_connections: u32,
    min_connections: u32,
    acquire_timeout: Duration,
    application_name: Option<&str>,
) -> Result<PgPool, sqlx::Error> {
    let (opts, payload) = prepare_pool_options(database_url, application_name)?;
    let builder = pool_options_with_hooks(max_connections, acquire_timeout, payload)
        .min_connections(min_connections);
    Ok(builder.connect_lazy_with(opts))
}

fn prepare_pool_options(
    database_url: &str,
    application_name: Option<&str>,
) -> Result<(PgConnectOptions, Option<String>), sqlx::Error> {
    let payload = flag_overrides_payload_from_env();
    if let Some(p) = payload.as_deref() {
        info!(
            env = ENV_VAR,
            payload_len = p.len(),
            "WORK_ENGINE_FLAG_OVERRIDES will be applied per-connection via set_config"
        );
    } else {
        info!(
            env = ENV_VAR,
            "WORK_ENGINE_FLAG_OVERRIDES unset/empty; per-org settings + defaults rule"
        );
    }

    let mut opts: PgConnectOptions = database_url.parse()?;
    if let Some(name) = application_name {
        opts = opts.application_name(name);
        info!(application_name = name, "pool will tag pg_stat_activity backends");
    }
    Ok((opts, payload))
}

fn pool_options_with_hooks(
    max_connections: u32,
    acquire_timeout: Duration,
    payload: Option<String>,
) -> PgPoolOptions {
    PgPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(acquire_timeout)
        .after_connect(move |conn, _meta| {
            let payload = payload.clone();
            Box::pin(async move {
                if let Some(payload) = payload {
                    sqlx::query("SELECT set_config('work_engine.flag_overrides', $1, false)")
                        .bind(payload)
                        .execute(&mut *conn)
                        .await?;
                }
                Ok(())
            })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_object_keeps_booleans() {
        let raw = r#"{"work_engine_enabled": true, "work_tasks_shadow_write": false}"#;
        let payload = flag_overrides_payload_from_str(Some(raw)).expect("payload");
        let v: Json = serde_json::from_str(&payload).unwrap();
        let obj = v.as_object().unwrap();
        assert_eq!(obj["work_engine_enabled"], Json::Bool(true));
        assert_eq!(obj["work_tasks_shadow_write"], Json::Bool(false));
    }

    #[test]
    fn parses_object_keeps_nulls() {
        let raw = r#"{"work_engine_enabled": null}"#;
        let payload = flag_overrides_payload_from_str(Some(raw)).expect("payload");
        let v: Json = serde_json::from_str(&payload).unwrap();
        assert!(v.as_object().unwrap()["work_engine_enabled"].is_null());
    }

    #[test]
    fn parses_object_drops_non_booleans() {
        let raw = r#"{"work_engine_enabled": "yes", "good": true}"#;
        let payload = flag_overrides_payload_from_str(Some(raw)).expect("payload");
        let v: Json = serde_json::from_str(&payload).unwrap();
        let obj = v.as_object().unwrap();
        assert!(!obj.contains_key("work_engine_enabled"));
        assert_eq!(obj["good"], Json::Bool(true));
    }

    #[test]
    fn returns_none_for_missing() {
        assert!(flag_overrides_payload_from_str(None).is_none());
        assert!(flag_overrides_payload_from_str(Some("")).is_none());
        assert!(flag_overrides_payload_from_str(Some("   ")).is_none());
    }

    #[test]
    fn returns_none_for_malformed_json() {
        assert!(flag_overrides_payload_from_str(Some("not json")).is_none());
        assert!(flag_overrides_payload_from_str(Some("[]")).is_none());
        assert!(flag_overrides_payload_from_str(Some("123")).is_none());
    }
}

// Created and developed by Jai Singh
