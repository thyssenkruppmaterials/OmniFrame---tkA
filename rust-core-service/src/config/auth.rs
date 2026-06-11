// Created and developed by Jai Singh
//! Authentication configuration

use serde::Deserialize;
use std::time::Duration;

/// Authentication configuration
#[derive(Debug, Clone, Deserialize)]
pub struct AuthConfig {
    /// Supabase project URL
    pub supabase_url: String,
    /// JWT secret for HS256 tokens (service role)
    pub jwt_secret: Option<String>,
    /// JWKS refresh interval in seconds
    #[serde(default = "default_jwks_refresh")]
    pub jwks_refresh_secs: u64,
    /// Permission cache TTL in seconds
    #[serde(default = "default_permission_cache_ttl")]
    pub permission_cache_ttl_secs: u64,
    /// Session cache TTL in seconds
    #[serde(default = "default_session_cache_ttl")]
    pub session_cache_ttl_secs: u64,
}

fn default_jwks_refresh() -> u64 {
    3600 // 1 hour
}

fn default_permission_cache_ttl() -> u64 {
    300 // 5 minutes
}

fn default_session_cache_ttl() -> u64 {
    900 // 15 minutes
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            supabase_url: std::env::var("SUPABASE_URL")
                .expect("SUPABASE_URL must be set"),
            jwt_secret: std::env::var("SUPABASE_JWT_SECRET").ok(),
            jwks_refresh_secs: default_jwks_refresh(),
            permission_cache_ttl_secs: default_permission_cache_ttl(),
            session_cache_ttl_secs: default_session_cache_ttl(),
        }
    }
}

impl AuthConfig {
    /// Load configuration from environment variables
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            supabase_url: std::env::var("SUPABASE_URL")?,
            jwt_secret: std::env::var("SUPABASE_JWT_SECRET").ok(),
            jwks_refresh_secs: std::env::var("JWKS_REFRESH_INTERVAL")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(default_jwks_refresh),
            permission_cache_ttl_secs: std::env::var("PERMISSION_CACHE_TTL")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(default_permission_cache_ttl),
            session_cache_ttl_secs: std::env::var("SESSION_CACHE_TTL")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(default_session_cache_ttl),
        })
    }

    /// Get JWKS refresh interval as Duration
    pub fn jwks_refresh_interval(&self) -> Duration {
        Duration::from_secs(self.jwks_refresh_secs)
    }

    /// Get permission cache TTL as Duration
    pub fn permission_cache_ttl(&self) -> Duration {
        Duration::from_secs(self.permission_cache_ttl_secs)
    }

    /// Get session cache TTL as Duration
    pub fn session_cache_ttl(&self) -> Duration {
        Duration::from_secs(self.session_cache_ttl_secs)
    }
}

// Created and developed by Jai Singh
