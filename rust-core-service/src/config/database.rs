//! Database configuration

use serde::Deserialize;
use std::time::Duration;

/// Database connection configuration
#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    /// PostgreSQL connection URL
    pub url: String,
    /// Maximum number of connections in the pool
    #[serde(default = "default_max_connections")]
    pub max_connections: u32,
    /// Minimum number of connections to keep open
    #[serde(default = "default_min_connections")]
    pub min_connections: u32,
    /// Connection acquire timeout in seconds
    #[serde(default = "default_acquire_timeout")]
    pub acquire_timeout_secs: u64,
    /// Idle connection timeout in seconds
    #[serde(default = "default_idle_timeout")]
    pub idle_timeout_secs: u64,
    /// Maximum connection lifetime in seconds
    #[serde(default = "default_max_lifetime")]
    pub max_lifetime_secs: u64,
}

fn default_max_connections() -> u32 {
    100
}

fn default_min_connections() -> u32 {
    10
}

fn default_acquire_timeout() -> u64 {
    3
}

fn default_idle_timeout() -> u64 {
    600
}

fn default_max_lifetime() -> u64 {
    1800
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            url: std::env::var("DATABASE_URL")
                .expect("DATABASE_URL must be set"),
            max_connections: default_max_connections(),
            min_connections: default_min_connections(),
            acquire_timeout_secs: default_acquire_timeout(),
            idle_timeout_secs: default_idle_timeout(),
            max_lifetime_secs: default_max_lifetime(),
        }
    }
}

impl DatabaseConfig {
    /// Load configuration from environment variables
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            url: std::env::var("DATABASE_URL")?,
            max_connections: std::env::var("DB_MAX_CONNECTIONS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(default_max_connections),
            min_connections: std::env::var("DB_MIN_CONNECTIONS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(default_min_connections),
            acquire_timeout_secs: std::env::var("DB_ACQUIRE_TIMEOUT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(default_acquire_timeout),
            idle_timeout_secs: std::env::var("DB_IDLE_TIMEOUT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(default_idle_timeout),
            max_lifetime_secs: std::env::var("DB_MAX_LIFETIME")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(default_max_lifetime),
        })
    }

    /// Get acquire timeout as Duration
    pub fn acquire_timeout(&self) -> Duration {
        Duration::from_secs(self.acquire_timeout_secs)
    }

    /// Get idle timeout as Duration
    pub fn idle_timeout(&self) -> Duration {
        Duration::from_secs(self.idle_timeout_secs)
    }

    /// Get max lifetime as Duration
    pub fn max_lifetime(&self) -> Duration {
        Duration::from_secs(self.max_lifetime_secs)
    }
}
