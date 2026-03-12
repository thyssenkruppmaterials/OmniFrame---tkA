//! Configuration module for the Rust Streaming Service
//!
//! Provides configuration for ExacqVision integration, Redis, and server settings.

use serde::Deserialize;

/// ExacqVision configuration
#[derive(Debug, Clone, Deserialize)]
pub struct ExacqConfig {
    /// Base URL for ExacqVision API — set via EXACQ_URL env var
    pub base_url: String,
    /// Username for authentication
    pub username: String,
    /// Password for authentication
    pub password: String,
}

impl ExacqConfig {
    /// Load ExacqVision configuration from environment variables
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            base_url: std::env::var("EXACQ_URL")
                .map_err(|_| anyhow::anyhow!("EXACQ_URL environment variable must be set"))?,
            username: std::env::var("EXACQ_USER")
                .map_err(|_| anyhow::anyhow!("EXACQ_USER environment variable must be set"))?,
            password: std::env::var("EXACQ_PASSWORD")
                .map_err(|_| anyhow::anyhow!("EXACQ_PASSWORD environment variable must be set"))?,
        })
    }
}

/// Main application configuration
#[derive(Debug, Clone, Deserialize)]
pub struct AppConfig {
    /// ExacqVision configuration
    pub exacq: ExacqConfig,
    /// Redis URL (optional)
    pub redis_url: Option<String>,
    /// HTTP server port
    pub http_port: u16,
    /// Session TTL in seconds (default: 3600 = 1 hour)
    pub session_ttl_seconds: u64,
    /// Default video width
    pub default_video_width: u32,
    /// Default video height
    pub default_video_height: u32,
    /// Default video quality (1-10, higher is better)
    pub default_video_quality: u8,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            exacq: ExacqConfig {
                base_url: String::new(),
                username: String::new(),
                password: String::new(),
            },
            redis_url: None,
            http_port: 8020,
            session_ttl_seconds: 3600, // 1 hour
            default_video_width: 640,
            default_video_height: 480,
            default_video_quality: 8,
        }
    }
}

impl AppConfig {
    /// Load configuration from environment variables
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            exacq: ExacqConfig::from_env()?,
            redis_url: std::env::var("REDIS_URL").ok(),
            http_port: std::env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(8020),
            session_ttl_seconds: std::env::var("SESSION_TTL_SECONDS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(3600),
            default_video_width: std::env::var("DEFAULT_VIDEO_WIDTH")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(640),
            default_video_height: std::env::var("DEFAULT_VIDEO_HEIGHT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(480),
            default_video_quality: std::env::var("DEFAULT_VIDEO_QUALITY")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(8),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_config_default_has_correct_server_values() {
        let config = AppConfig::default();

        assert_eq!(config.http_port, 8020);
        assert_eq!(config.session_ttl_seconds, 3600);
        assert!(config.redis_url.is_none());
    }

    #[test]
    fn app_config_default_has_correct_video_values() {
        let config = AppConfig::default();

        assert_eq!(config.default_video_width, 640);
        assert_eq!(config.default_video_height, 480);
        assert_eq!(config.default_video_quality, 8);
    }

    #[test]
    fn app_config_default_has_correct_exacq_defaults() {
        let config = AppConfig::default();

        assert!(config.exacq.base_url.is_empty());
        assert!(config.exacq.username.is_empty());
        assert!(config.exacq.password.is_empty());
    }
}
