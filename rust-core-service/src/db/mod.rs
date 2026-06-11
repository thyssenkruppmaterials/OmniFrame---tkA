// Created and developed by Jai Singh
//! Database module for high-performance PostgreSQL operations
//!
//! Provides connection pooling, prepared statement caching, and health monitoring.

pub mod pool;
pub mod health;
pub mod queries;
pub mod models;

pub use pool::{create_pool, DatabaseConfig};
pub use health::{health_check, PoolMetrics};

// Created and developed by Jai Singh
