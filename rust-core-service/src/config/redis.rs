//! Redis configuration

use serde::Deserialize;
use std::time::Duration;

/// Redis connection configuration
#[derive(Debug, Clone, Deserialize)]
pub struct RedisConfig {
    /// Redis connection URL
    pub url: String,
    /// Maximum number of connections in the pool
    #[serde(default = "default_max_connections")]
    pub max_connections: u32,
    /// Minimum idle connections to keep
    #[serde(default = "default_min_idle")]
    pub min_idle: u32,
    /// Connection timeout in seconds
    #[serde(default = "default_connection_timeout")]
    pub connection_timeout_secs: u64,
    /// Default TTL for cached items in seconds
    #[serde(default = "default_ttl")]
    pub default_ttl_secs: u64,
}

fn default_max_connections() -> u32 {
    50
}

fn default_min_idle() -> u32 {
    5
}

fn default_connection_timeout() -> u64 {
    5
}

fn default_ttl() -> u64 {
    300
}

impl Default for RedisConfig {
    fn default() -> Self {
        Self {
            url: std::env::var("REDIS_URL")
                .expect("REDIS_URL must be set"),
            max_connections: default_max_connections(),
            min_idle: default_min_idle(),
            connection_timeout_secs: default_connection_timeout(),
            default_ttl_secs: default_ttl(),
        }
    }
}

impl RedisConfig {
    /// Load configuration from environment variables
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            url: std::env::var("REDIS_URL")?,
            max_connections: std::env::var("REDIS_MAX_CONNECTIONS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(default_max_connections),
            min_idle: std::env::var("REDIS_MIN_IDLE")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(default_min_idle),
            connection_timeout_secs: std::env::var("REDIS_CONNECTION_TIMEOUT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(default_connection_timeout),
            default_ttl_secs: std::env::var("REDIS_DEFAULT_TTL")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(default_ttl),
        })
    }

    /// Get connection timeout as Duration
    pub fn connection_timeout(&self) -> Duration {
        Duration::from_secs(self.connection_timeout_secs)
    }

    /// Get default TTL as Duration
    pub fn default_ttl(&self) -> Duration {
        Duration::from_secs(self.default_ttl_secs)
    }
}
