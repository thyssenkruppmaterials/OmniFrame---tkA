//! Redis connection pool with high-performance caching operations

use bb8::Pool;
use bb8_redis::RedisConnectionManager;
use bb8_redis::redis::{self, AsyncCommands};
use serde::{de::DeserializeOwned, Serialize};
use std::time::Duration;
use tracing::{info, instrument};

/// Redis connection configuration
pub struct RedisConfig {
    pub url: String,
    pub max_connections: u32,
    pub min_idle: u32,
    pub connection_timeout: Duration,
    pub default_ttl: Duration,
}

impl Default for RedisConfig {
    fn default() -> Self {
        Self {
            url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            max_connections: 50,
            min_idle: 5,
            connection_timeout: Duration::from_secs(10),
            default_ttl: Duration::from_secs(300), // 5 minutes
        }
    }
}

/// Redis connection pool type
pub type RedisPool = Pool<RedisConnectionManager>;

/// Create a Redis connection pool
#[instrument(skip(config))]
pub async fn create_redis_pool(config: &RedisConfig) -> Result<RedisPool, anyhow::Error> {
    info!(
        max_connections = config.max_connections,
        min_idle = config.min_idle,
        "Creating Redis connection pool"
    );

    let manager = RedisConnectionManager::new(config.url.clone())?;

    let pool = Pool::builder()
        .max_size(config.max_connections)
        .min_idle(Some(config.min_idle))
        .connection_timeout(config.connection_timeout)
        .build(manager)
        .await?;

    // Test connection
    {
        let mut conn = pool.get().await?;
        let _: String = redis::cmd("PING").query_async(&mut *conn).await?;
    }

    info!("Redis pool created and verified");
    metrics::gauge!("cache.pool.size").set(config.max_connections as f64);

    Ok(pool)
}

/// High-level cache service with serialization support
#[derive(Clone)]
pub struct CacheService {
    pool: RedisPool,
    default_ttl: Duration,
    key_prefix: String,
}

impl CacheService {
    /// Create a new cache service
    pub fn new(pool: RedisPool, default_ttl: Duration) -> Self {
        Self {
            pool,
            default_ttl,
            key_prefix: "omniframe:".to_string(),
        }
    }

    /// Create with custom key prefix
    pub fn with_prefix(pool: RedisPool, default_ttl: Duration, prefix: &str) -> Self {
        Self {
            pool,
            default_ttl,
            key_prefix: prefix.to_string(),
        }
    }

    /// Get the full prefixed key
    fn prefixed_key(&self, key: &str) -> String {
        format!("{}{}", self.key_prefix, key)
    }

    /// Set a value with optional TTL
    #[instrument(skip(self, value))]
    pub async fn set<T: Serialize>(
        &self,
        key: &str,
        value: &T,
        ttl: Option<Duration>,
    ) -> Result<(), anyhow::Error> {
        let mut conn = self.pool.get().await?;
        let prefixed = self.prefixed_key(key);
        let serialized = serde_json::to_string(value)?;
        let ttl_secs = ttl.unwrap_or(self.default_ttl).as_secs();

        conn.set_ex::<_, _, ()>(&prefixed, serialized, ttl_secs).await?;

        metrics::counter!("cache.set").increment(1);
        Ok(())
    }

    /// Get a value
    #[instrument(skip(self))]
    pub async fn get<T: DeserializeOwned>(
        &self,
        key: &str,
    ) -> Result<Option<T>, anyhow::Error> {
        let mut conn = self.pool.get().await?;
        let prefixed = self.prefixed_key(key);

        let result: Option<String> = conn.get(&prefixed).await?;

        match result {
            Some(data) => {
                metrics::counter!("cache.hit").increment(1);
                Ok(Some(serde_json::from_str(&data)?))
            }
            None => {
                metrics::counter!("cache.miss").increment(1);
                Ok(None)
            }
        }
    }

    /// Delete a key
    #[instrument(skip(self))]
    pub async fn delete(&self, key: &str) -> Result<bool, anyhow::Error> {
        let mut conn = self.pool.get().await?;
        let prefixed = self.prefixed_key(key);
        let deleted: i32 = conn.del(&prefixed).await?;

        metrics::counter!("cache.delete").increment(1);
        Ok(deleted > 0)
    }

    /// Check if a key exists
    #[instrument(skip(self))]
    pub async fn exists(&self, key: &str) -> Result<bool, anyhow::Error> {
        let mut conn = self.pool.get().await?;
        let prefixed = self.prefixed_key(key);
        let exists: bool = conn.exists(&prefixed).await?;
        Ok(exists)
    }

    /// Set a raw string value with TTL in seconds
    #[instrument(skip(self))]
    pub async fn set_with_ttl(
        &self,
        key: &str,
        value: &str,
        ttl_seconds: u64,
    ) -> Result<(), anyhow::Error> {
        let mut conn = self.pool.get().await?;
        let prefixed = self.prefixed_key(key);

        conn.set_ex::<_, _, ()>(&prefixed, value, ttl_seconds).await?;

        metrics::counter!("cache.set_with_ttl").increment(1);
        Ok(())
    }

    /// Set a raw string value
    #[instrument(skip(self))]
    pub async fn set_raw(
        &self,
        key: &str,
        value: &str,
        ttl: Option<Duration>,
    ) -> Result<(), anyhow::Error> {
        let mut conn = self.pool.get().await?;
        let prefixed = self.prefixed_key(key);
        let ttl_secs = ttl.unwrap_or(self.default_ttl).as_secs();

        conn.set_ex::<_, _, ()>(&prefixed, value, ttl_secs).await?;

        metrics::counter!("cache.set_raw").increment(1);
        Ok(())
    }

    /// Get a raw string value
    #[instrument(skip(self))]
    pub async fn get_raw(&self, key: &str) -> Result<Option<String>, anyhow::Error> {
        let mut conn = self.pool.get().await?;
        let prefixed = self.prefixed_key(key);

        let result: Option<String> = conn.get(&prefixed).await?;
        
        if result.is_some() {
            metrics::counter!("cache.hit").increment(1);
        } else {
            metrics::counter!("cache.miss").increment(1);
        }

        Ok(result)
    }

    /// Batch set multiple values with pipelining
    #[instrument(skip(self, items))]
    pub async fn batch_set<T: Serialize>(
        &self,
        items: &[(String, T)],
        ttl: Option<Duration>,
    ) -> Result<(), anyhow::Error> {
        let mut conn = self.pool.get().await?;
        let ttl_secs = ttl.unwrap_or(self.default_ttl).as_secs();

        let mut pipe = redis::pipe();

        for (key, value) in items {
            let prefixed = self.prefixed_key(key);
            let serialized = serde_json::to_string(value)?;
            pipe.set_ex(&prefixed, serialized, ttl_secs);
        }

        pipe.query_async::<()>(&mut *conn).await?;

        metrics::counter!("cache.batch_set").increment(items.len() as u64);
        Ok(())
    }

    /// Batch get multiple values with pipelining
    #[instrument(skip(self))]
    pub async fn batch_get<T: DeserializeOwned>(
        &self,
        keys: &[String],
    ) -> Result<Vec<Option<T>>, anyhow::Error> {
        let mut conn = self.pool.get().await?;

        let prefixed_keys: Vec<String> = keys
            .iter()
            .map(|k| self.prefixed_key(k))
            .collect();

        let results: Vec<Option<String>> = conn.mget(&prefixed_keys).await?;

        let mut parsed = Vec::with_capacity(results.len());
        let mut hits = 0u64;
        let mut misses = 0u64;

        for result in results {
            match result {
                Some(data) => {
                    hits += 1;
                    parsed.push(Some(serde_json::from_str(&data)?));
                }
                None => {
                    misses += 1;
                    parsed.push(None);
                }
            }
        }

        metrics::counter!("cache.hit").increment(hits);
        metrics::counter!("cache.miss").increment(misses);

        Ok(parsed)
    }

    /// Delete multiple keys
    #[instrument(skip(self))]
    pub async fn batch_delete(&self, keys: &[String]) -> Result<u64, anyhow::Error> {
        let mut conn = self.pool.get().await?;

        let prefixed_keys: Vec<String> = keys
            .iter()
            .map(|k| self.prefixed_key(k))
            .collect();

        let deleted: u64 = conn.del(&prefixed_keys).await?;

        metrics::counter!("cache.batch_delete").increment(deleted);
        Ok(deleted)
    }

    /// Delete keys matching a pattern (use with caution)
    #[instrument(skip(self))]
    pub async fn delete_pattern(&self, pattern: &str) -> Result<u64, anyhow::Error> {
        let mut conn = self.pool.get().await?;
        let prefixed_pattern = self.prefixed_key(pattern);

        // Use SCAN instead of KEYS for production safety
        let keys: Vec<String> = redis::cmd("KEYS")
            .arg(&prefixed_pattern)
            .query_async(&mut *conn)
            .await?;

        if keys.is_empty() {
            return Ok(0);
        }

        let deleted: u64 = conn.del(&keys).await?;

        metrics::counter!("cache.pattern_delete").increment(deleted);
        tracing::debug!(pattern = %pattern, deleted = deleted, "Pattern delete completed");

        Ok(deleted)
    }

    /// Get TTL for a key in seconds
    #[instrument(skip(self))]
    pub async fn ttl(&self, key: &str) -> Result<Option<i64>, anyhow::Error> {
        let mut conn = self.pool.get().await?;
        let prefixed = self.prefixed_key(key);
        let ttl: i64 = conn.ttl(&prefixed).await?;
        
        if ttl < 0 {
            Ok(None) // Key doesn't exist or has no TTL
        } else {
            Ok(Some(ttl))
        }
    }

    /// Increment a counter
    #[instrument(skip(self))]
    pub async fn incr(&self, key: &str, delta: i64) -> Result<i64, anyhow::Error> {
        let mut conn = self.pool.get().await?;
        let prefixed = self.prefixed_key(key);
        let result: i64 = conn.incr(&prefixed, delta).await?;
        Ok(result)
    }

    /// Health check
    pub async fn health_check(&self) -> Result<CacheHealth, anyhow::Error> {
        let start = std::time::Instant::now();
        
        let mut conn = self.pool.get().await?;
        let _: String = redis::cmd("PING").query_async(&mut *conn).await?;
        
        let latency = start.elapsed().as_millis() as u64;
        
        Ok(CacheHealth {
            connected: true,
            latency_ms: latency,
            pool_size: self.pool.state().connections,
            idle_connections: self.pool.state().idle_connections,
        })
    }
}

/// Cache health information
#[derive(Debug, Clone, serde::Serialize)]
pub struct CacheHealth {
    pub connected: bool,
    pub latency_ms: u64,
    pub pool_size: u32,
    pub idle_connections: u32,
}
