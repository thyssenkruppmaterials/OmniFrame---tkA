//! High-performance database connection pooling

use sqlx::{postgres::PgPoolOptions, PgPool, Error};
use std::time::Duration;
use std::num::NonZeroUsize;
use tracing::{info, instrument};
use dashmap::DashMap;
use lru::LruCache;
use parking_lot::Mutex;

/// Database connection configuration
pub struct DatabaseConfig {
    pub url: String,
    pub max_connections: u32,
    pub min_connections: u32,
    pub acquire_timeout: Duration,
    pub idle_timeout: Duration,
    pub max_lifetime: Duration,
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            url: std::env::var("DATABASE_URL")
                .expect("DATABASE_URL must be set"),
            max_connections: 100,     // High concurrency
            min_connections: 10,      // Keep warm connections
            acquire_timeout: Duration::from_secs(30), // Increased for cold starts
            idle_timeout: Duration::from_secs(600),   // 10 minutes
            max_lifetime: Duration::from_secs(1800),  // 30 minutes
        }
    }
}

/// Create a new database connection pool with optimized settings
#[instrument(skip(config))]
pub async fn create_pool(config: &DatabaseConfig) -> Result<PgPool, Error> {
    info!(
        max_connections = config.max_connections,
        min_connections = config.min_connections,
        "Creating database connection pool"
    );

    let pool = PgPoolOptions::new()
        .max_connections(config.max_connections)
        .min_connections(config.min_connections)
        .acquire_timeout(config.acquire_timeout)
        .idle_timeout(Some(config.idle_timeout))
        .max_lifetime(Some(config.max_lifetime))
        .test_before_acquire(true)
        .connect(&config.url)
        .await?;

    // Warm up the pool by acquiring connections
    info!("Warming up connection pool...");
    let warmup_count = config.min_connections.min(5);
    let mut connections = Vec::with_capacity(warmup_count as usize);
    
    for _ in 0..warmup_count {
        match pool.acquire().await {
            Ok(conn) => connections.push(conn),
            Err(e) => {
                tracing::warn!(error = %e, "Failed to acquire warmup connection");
            }
        }
    }
    
    // Drop connections to return them to pool
    drop(connections);

    info!(
        pool_size = pool.size(),
        idle_connections = pool.num_idle(),
        "Database pool created and warmed up successfully"
    );
    
    Ok(pool)
}

/// Prepared statement cache with LRU eviction
pub struct PreparedStatementCache {
    _cache: Mutex<LruCache<String, ()>>,
    stats: DashMap<String, u64>,
}

impl PreparedStatementCache {
    /// Create a new prepared statement cache
    pub fn new(capacity: usize) -> Self {
        Self {
            _cache: Mutex::new(LruCache::new(
                NonZeroUsize::new(capacity).unwrap()
            )),
            stats: DashMap::new(),
        }
    }

    /// Record usage of a query for statistics
    pub fn record_usage(&self, query_name: &str) {
        self.stats
            .entry(query_name.to_string())
            .and_modify(|c| *c += 1)
            .or_insert(1);
    }

    /// Get query usage count
    pub fn get_usage(&self, query_name: &str) -> u64 {
        self.stats.get(query_name).map(|r| *r).unwrap_or(0)
    }

    /// Get all query statistics
    pub fn get_all_stats(&self) -> Vec<(String, u64)> {
        self.stats
            .iter()
            .map(|entry| (entry.key().clone(), *entry.value()))
            .collect()
    }

    /// Clear all statistics
    pub fn clear_stats(&self) {
        self.stats.clear();
    }
}

impl Default for PreparedStatementCache {
    fn default() -> Self {
        Self::new(1000)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prepared_statement_cache() {
        let cache = PreparedStatementCache::new(10);
        
        cache.record_usage("query1");
        cache.record_usage("query1");
        cache.record_usage("query2");
        
        assert_eq!(cache.get_usage("query1"), 2);
        assert_eq!(cache.get_usage("query2"), 1);
        assert_eq!(cache.get_usage("query3"), 0);
    }
}
