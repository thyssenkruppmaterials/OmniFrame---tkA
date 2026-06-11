// Created and developed by Jai Singh
//! Configuration module for rust-work-service
//!
//! Loads all configuration from environment variables.

use std::env;

/// Application configuration loaded from environment variables
#[derive(Debug, Clone)]
pub struct AppConfig {
    /// PostgreSQL connection URL — DIRECT connection (port 5432).
    ///
    /// This URL MUST point at the database's direct port, NOT a
    /// transaction-mode pooler. The listener pool (`pglistener.rs` +
    /// every `*_listener.rs` consumer + `triggers/loader.rs` +
    /// `triggers/evaluator.rs`) is built from this URL because
    /// `LISTEN/NOTIFY` requires a long-lived dedicated TCP that
    /// transaction-mode pgbouncer / Supavisor multiplexes to death.
    pub database_url: String,
    /// Optional PgBouncer / Supavisor transaction-mode pooler URL
    /// (port 6543). When set, the general-purpose `db_pool` (HTTP
    /// routes, scheduler, WS handler) routes through it instead of
    /// the direct `database_url`. Listener pools still use the
    /// direct URL (LISTEN/NOTIFY is incompatible with transaction
    /// pooling).
    ///
    /// Reads `WORK_SERVICE_DATABASE_POOLER_URL` first, then falls
    /// back to `DATABASE_POOLER_URL`. Unset = backwards-compatible
    /// behaviour (everything goes through the direct URL).
    ///
    /// Supavisor URL pattern (transaction mode):
    /// ```text
    /// postgresql://postgres.{project_ref}:{password}@aws-0-{region}.pooler.supabase.com:6543/postgres?pgbouncer=true
    /// ```
    pub database_pooler_url: Option<String>,
    /// Optional Supabase read-replica pooler URL (Supavisor).
    /// When set, the `read_pool` routes pure-read queries (queue
    /// stats broadcasts, pending-cycle-count fetches) at the replica
    /// instead of the primary. When unset, `read_pool` falls back to
    /// `db_pool` so behaviour stays unchanged.
    ///
    /// Reads `WORK_SERVICE_DATABASE_READ_POOLER_URL` first, then
    /// falls back to `DATABASE_READ_POOLER_URL`.
    ///
    /// DO NOT POINT THIS AT THE PRIMARY POOLER \u2014 it bypasses the
    /// safety property we get from a dedicated read endpoint
    /// (mutations issued through this pool would silently succeed
    /// against the primary instead of failing fast).
    pub database_read_pooler_url: Option<String>,
    /// Redis connection URL
    pub redis_url: String,
    /// HTTP server port
    pub server_port: u16,
    /// rust-core-service URL for auth validation
    pub rust_core_url: String,
    /// Service API key for rust-core-service
    pub rust_core_api_key: String,
    /// Auth validation timeout in seconds (default 15)
    pub auth_timeout_secs: u64,
    /// Supabase URL (optional, for storage — will be used when Supabase integration is wired up)
    #[allow(dead_code)]
    pub supabase_url: Option<String>,
    /// Supabase service role key (optional — will be used when Supabase integration is wired up)
    #[allow(dead_code)]
    pub supabase_service_role_key: Option<String>,
}

impl AppConfig {
    /// Load configuration from environment variables
    ///
    /// # Panics
    /// Panics if required environment variables are not set:
    /// - DATABASE_URL
    /// - REDIS_URL
    /// - RUST_CORE_API_KEY
    pub fn from_env() -> Self {
        Self {
            database_url: env::var("DATABASE_URL")
                .expect("DATABASE_URL must be set"),
            // Item 4 (post-audit, 2026-05-07) — optional pooler URL.
            // First-class name is `WORK_SERVICE_DATABASE_POOLER_URL`;
            // shorter `DATABASE_POOLER_URL` is accepted for parity
            // with the existing unprefixed `DATABASE_URL`.
            database_pooler_url: env::var("WORK_SERVICE_DATABASE_POOLER_URL")
                .ok()
                .or_else(|| env::var("DATABASE_POOLER_URL").ok())
                .filter(|s| !s.trim().is_empty()),
            database_read_pooler_url: env::var("WORK_SERVICE_DATABASE_READ_POOLER_URL")
                .ok()
                .or_else(|| env::var("DATABASE_READ_POOLER_URL").ok())
                .filter(|s| !s.trim().is_empty()),
            redis_url: env::var("REDIS_URL")
                .expect("REDIS_URL must be set"),
            server_port: env::var("PORT")
                .unwrap_or_else(|_| "8030".to_string())
                .parse()
                .expect("PORT must be a valid u16"),
            rust_core_url: env::var("RUST_CORE_URL")
                .unwrap_or_else(|_| "http://localhost:8010".to_string()),
            rust_core_api_key: env::var("RUST_CORE_API_KEY")
                .expect("RUST_CORE_API_KEY must be set"),
            auth_timeout_secs: env::var("AUTH_TIMEOUT_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(15),
            supabase_url: env::var("SUPABASE_URL").ok(),
            supabase_service_role_key: env::var("SUPABASE_SERVICE_ROLE_KEY").ok(),
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_default_port_value() {
        // PORT env not set should default to 8030
        std::env::remove_var("PORT");
        let port: u16 = std::env::var("PORT")
            .unwrap_or_else(|_| "8030".to_string())
            .parse()
            .unwrap();
        assert_eq!(port, 8030);
    }

    #[test]
    fn test_rust_core_url_default() {
        std::env::remove_var("RUST_CORE_URL");
        let url = std::env::var("RUST_CORE_URL")
            .unwrap_or_else(|_| "http://localhost:8010".to_string());
        assert_eq!(url, "http://localhost:8010");
    }
}

// Created and developed by Jai Singh
