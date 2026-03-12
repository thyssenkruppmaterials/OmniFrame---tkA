//! Database health monitoring and metrics

use sqlx::PgPool;
use std::time::Instant;
use serde::Serialize;
use tracing::instrument;

/// Pool metrics snapshot
#[derive(Debug, Clone, Serialize)]
pub struct PoolMetrics {
    /// Total connections in the pool
    pub total_connections: u32,
    /// Currently idle connections
    pub idle_connections: u32,
    /// Active connections (total - idle)
    pub active_connections: u32,
    /// Health check latency in milliseconds
    pub health_check_latency_ms: u64,
    /// Last health check timestamp (Unix epoch seconds)
    pub last_health_check: i64,
    /// Pool is healthy
    pub healthy: bool,
}

impl PoolMetrics {
    /// Create metrics from a pool snapshot
    pub async fn from_pool(pool: &PgPool, latency_ms: u64) -> Self {
        let size = pool.size();
        let idle = pool.num_idle() as u32;

        Self {
            total_connections: size,
            idle_connections: idle,
            active_connections: size.saturating_sub(idle),
            health_check_latency_ms: latency_ms,
            last_health_check: chrono::Utc::now().timestamp(),
            healthy: true,
        }
    }

    /// Create unhealthy metrics
    pub fn unhealthy(latency_ms: u64, _error: &str) -> Self {
        Self {
            total_connections: 0,
            idle_connections: 0,
            active_connections: 0,
            health_check_latency_ms: latency_ms,
            last_health_check: chrono::Utc::now().timestamp(),
            healthy: false,
        }
    }
}

/// Perform a health check on the database pool
#[instrument(skip(pool))]
pub async fn health_check(pool: &PgPool) -> Result<PoolMetrics, sqlx::Error> {
    let start = Instant::now();
    
    // Execute lightweight health query
    sqlx::query("SELECT 1 as health_check")
        .fetch_one(pool)
        .await?;

    let latency = start.elapsed().as_millis() as u64;
    
    // Record metrics
    metrics::histogram!("db.health_check.latency_ms").record(latency as f64);

    Ok(PoolMetrics::from_pool(pool, latency).await)
}

/// Detailed health check with more database info
#[instrument(skip(pool))]
pub async fn detailed_health_check(pool: &PgPool) -> Result<DetailedHealth, sqlx::Error> {
    let start = Instant::now();

    // Check connectivity
    let connectivity_result = sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(pool)
        .await;

    let connectivity_ok = connectivity_result.is_ok();
    let connectivity_latency = start.elapsed().as_millis() as u64;

    // Get database stats
    let stats = if connectivity_ok {
        sqlx::query_as::<_, DatabaseStats>(
            r#"
            SELECT 
                (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) as active_connections,
                pg_database_size(current_database()) as database_size_bytes,
                current_timestamp as server_time
            "#
        )
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
    } else {
        None
    };

    let latency = start.elapsed().as_millis() as u64;

    Ok(DetailedHealth {
        pool_metrics: PoolMetrics::from_pool(pool, latency).await,
        connectivity_ok,
        connectivity_latency_ms: connectivity_latency,
        database_stats: stats,
    })
}

/// Detailed health information
#[derive(Debug, Clone, Serialize)]
pub struct DetailedHealth {
    /// Basic pool metrics
    pub pool_metrics: PoolMetrics,
    /// Connectivity check passed
    pub connectivity_ok: bool,
    /// Connectivity check latency
    pub connectivity_latency_ms: u64,
    /// Database statistics (if available)
    pub database_stats: Option<DatabaseStats>,
}

/// Database statistics
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct DatabaseStats {
    /// Number of active connections to the database
    pub active_connections: Option<i64>,
    /// Size of the database in bytes
    pub database_size_bytes: Option<i64>,
    /// Current server time
    pub server_time: Option<chrono::DateTime<chrono::Utc>>,
}

/// Health check result
#[derive(Debug, Clone, Serialize)]
pub struct HealthCheckResult {
    /// Service status
    pub status: String,
    /// Database health
    pub database: Option<PoolMetrics>,
    /// Redis health
    pub redis: Option<RedisHealth>,
    /// Service version
    pub version: String,
    /// Uptime in seconds
    pub uptime_seconds: u64,
}

/// Redis health metrics
#[derive(Debug, Clone, Serialize)]
pub struct RedisHealth {
    pub connected: bool,
    pub latency_ms: u64,
}
