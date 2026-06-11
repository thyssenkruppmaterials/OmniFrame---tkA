// Created and developed by Jai Singh
//! Configuration module for the Rust Core Service
//!
//! Provides configuration structures and helpers for database, Redis, and authentication.

pub mod database;
pub mod redis;
pub mod auth;

use serde::Deserialize;

/// Main application configuration
#[derive(Debug, Clone, Deserialize)]
pub struct AppConfig {
    /// Database configuration
    pub database: database::DatabaseConfig,
    /// Redis configuration
    pub redis: redis::RedisConfig,
    /// Authentication configuration
    pub auth: auth::AuthConfig,
    /// HTTP server port
    #[serde(default = "default_http_port")]
    pub http_port: u16,
    /// gRPC server port
    #[serde(default = "default_grpc_port")]
    pub grpc_port: u16,
}

fn default_http_port() -> u16 {
    8010
}

fn default_grpc_port() -> u16 {
    8011
}

impl AppConfig {
    /// Load configuration from environment variables
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            database: database::DatabaseConfig::from_env()?,
            redis: redis::RedisConfig::from_env()?,
            auth: auth::AuthConfig::from_env()?,
            http_port: std::env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or_else(default_http_port),
            grpc_port: std::env::var("GRPC_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or_else(default_grpc_port),
        })
    }
}

// Created and developed by Jai Singh
