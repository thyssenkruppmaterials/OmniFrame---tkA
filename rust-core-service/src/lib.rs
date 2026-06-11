// Created and developed by Jai Singh
//! OneBox AI Rust Core Service Library
//!
//! This crate provides high-performance database queries, JWT validation,
//! and Redis caching for the OneBox AI warehouse management platform.
//!
//! ## Features
//!
//! - **Database Connection Pooling**: sqlx-based PostgreSQL connections with
//!   automatic health checks and prepared statement caching
//! - **JWT Validation**: Cryptographic JWKS-based validation with RS256 support
//! - **Redis Caching**: Connection pooling with pipelining for batch operations
//! - **RBAC**: Role-based access control with permission caching
//!
//! ## Architecture
//!
//! ```text
//! +-------------------+     +-------------------+
//! |   REST :8010      |     |   gRPC :8011      |
//! +-------------------+     +-------------------+
//!          |                         |
//!          v                         v
//! +----------------------------------------+
//! |           Middleware Stack             |
//! |  JWT Auth | Rate Limit | Tracing       |
//! +----------------------------------------+
//! |           Core Services                |
//! |  Query Engine | Cache Mgr | Sessions   |
//! +----------------------------------------+
//! |            Data Layer                  |
//! |  sqlx Pool | Redis Pool | JWKS Cache   |
//! +----------------------------------------+
//! ```

pub mod config;
pub mod db;
pub mod cache;
pub mod auth;
pub mod api;
pub mod grpc;
pub mod metrics;

use std::sync::Arc;

/// Application state shared across all handlers
#[derive(Clone)]
pub struct AppState {
    /// Primary PostgreSQL connection pool (writes + read-after-write paths)
    pub db_pool: sqlx::PgPool,
    /// Read-only pool. Points at the Supabase read replica when
    /// `DATABASE_READ_POOLER_URL` is configured; otherwise a clone of
    /// `db_pool`. Use for: RBAC permission lookups, user-profile fetches,
    /// any pure SELECT. Tolerates ~50-100 ms replication lag.
    pub read_pool: sqlx::PgPool,
    /// Redis connection pool (optional)
    pub redis_pool: Option<cache::redis_pool::RedisPool>,
    /// JWT validator with JWKS cache
    pub jwt_validator: Arc<auth::jwt::JwtValidator>,
    /// API key validator for service-to-service authentication
    pub api_key_validator: Arc<auth::api_keys::ApiKeyValidator>,
    /// RBAC service for permission checking
    pub rbac_service: Arc<auth::rbac::RbacService>,
    /// Session caching service (optional)
    pub session_service: Option<Arc<cache::session::SessionService>>,
    /// Cache service for general caching (optional)
    pub cache_service: Option<Arc<cache::redis_pool::CacheService>>,
    /// Supabase configuration
    pub supabase_url: String,
    /// Monotonic instant captured at startup for uptime calculation
    pub startup_time: std::time::Instant,
}

impl AppState {
    /// Create a new AppState with all dependencies initialized.
    ///
    /// `read_pool` is a separate pool routed at the Supabase read replica
    /// when configured; pass a clone of `db_pool` when no replica is
    /// available so call sites stay uniform.
    pub async fn new(
        db_pool: sqlx::PgPool,
        read_pool: sqlx::PgPool,
        redis_pool: Option<cache::redis_pool::RedisPool>,
        supabase_url: String,
        jwt_secret: Option<String>,
    ) -> anyhow::Result<Self> {
        // Initialize JWT validator
        let jwt_validator = Arc::new(auth::jwt::JwtValidator::new(
            &supabase_url,
            jwt_secret,
        ));
        jwt_validator.initialize().await?;

        // API key validator queries `service_api_keys` table (writes the
        // hit on successful validation in some configurations) — keep on
        // primary for now.
        let api_key_validator = Arc::new(auth::api_keys::ApiKeyValidator::new(db_pool.clone()));

        // RBAC service is 100% read-only (get_user_permissions /
        // get_user_roles). Route through the replica.
        let rbac_service = Arc::new(auth::rbac::RbacService::new(read_pool.clone()));

        // Initialize cache and session services only if Redis is available
        let (cache_service, session_service) = if let Some(ref pool) = redis_pool {
            let cache = Arc::new(cache::redis_pool::CacheService::new(
                pool.clone(),
                std::time::Duration::from_secs(300),
            ));
            let session = Arc::new(cache::session::SessionService::new(
                cache.as_ref().clone(),
            ));
            (Some(cache), Some(session))
        } else {
            (None, None)
        };

        Ok(Self {
            db_pool,
            read_pool,
            redis_pool,
            jwt_validator,
            api_key_validator,
            rbac_service,
            session_service,
            cache_service,
            supabase_url,
            startup_time: std::time::Instant::now(),
        })
    }
}

/// Version information
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const NAME: &str = env!("CARGO_PKG_NAME");

// Created and developed by Jai Singh
