// Created and developed by Jai Singh
//! Redis caching module
//!
//! Provides session caching and camera metadata caching with Redis.

use bb8::Pool;
use bb8_redis::RedisConnectionManager;
use bb8_redis::redis::{self, AsyncCommands};
use serde::{de::DeserializeOwned, Serialize};
use std::time::Duration;
use tracing::{debug, info, instrument};

/// Redis connection pool type
pub type RedisPool = Pool<RedisConnectionManager>;

/// Create a Redis connection pool
#[instrument(skip_all)]
pub async fn create_redis_pool(url: &str) -> anyhow::Result<RedisPool> {
    info!("Creating Redis connection pool");

    let manager = RedisConnectionManager::new(url)?;

    let pool = Pool::builder()
        .max_size(20)
        .min_idle(Some(2))
        .connection_timeout(Duration::from_secs(10))
        .build(manager)
        .await?;

    // Test connection
    {
        let mut conn = pool.get().await?;
        let _: String = redis::cmd("PING").query_async(&mut *conn).await?;
    }

    info!("Redis pool created and verified");
    Ok(pool)
}

/// Cache service for session and metadata caching
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
            key_prefix: "streaming:".to_string(),
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
    ) -> anyhow::Result<()> {
        let mut conn = self.pool.get().await?;
        let prefixed = self.prefixed_key(key);
        let serialized = serde_json::to_string(value)?;
        let ttl_secs = ttl.unwrap_or(self.default_ttl).as_secs();

        conn.set_ex::<_, _, ()>(&prefixed, serialized, ttl_secs).await?;

        debug!(key = %key, ttl_secs, "Cache set");
        Ok(())
    }

    /// Get a value
    #[instrument(skip(self))]
    pub async fn get<T: DeserializeOwned>(
        &self,
        key: &str,
    ) -> anyhow::Result<Option<T>> {
        let mut conn = self.pool.get().await?;
        let prefixed = self.prefixed_key(key);

        let result: Option<String> = conn.get(&prefixed).await?;

        match result {
            Some(data) => {
                debug!(key = %key, "Cache hit");
                Ok(Some(serde_json::from_str(&data)?))
            }
            None => {
                debug!(key = %key, "Cache miss");
                Ok(None)
            }
        }
    }

    /// Delete a key
    #[instrument(skip(self))]
    pub async fn delete(&self, key: &str) -> anyhow::Result<bool> {
        let mut conn = self.pool.get().await?;
        let prefixed = self.prefixed_key(key);
        let deleted: i32 = conn.del(&prefixed).await?;

        debug!(key = %key, deleted = deleted > 0, "Cache delete");
        Ok(deleted > 0)
    }

    /// Set a raw string value with TTL in seconds
    #[instrument(skip(self))]
    pub async fn set_with_ttl(
        &self,
        key: &str,
        value: &str,
        ttl_seconds: u64,
    ) -> anyhow::Result<()> {
        let mut conn = self.pool.get().await?;
        let prefixed = self.prefixed_key(key);

        conn.set_ex::<_, _, ()>(&prefixed, value, ttl_seconds).await?;

        debug!(key = %key, ttl_seconds, "Cache set with TTL");
        Ok(())
    }

    /// Get a raw string value
    #[instrument(skip(self))]
    pub async fn get_raw(&self, key: &str) -> anyhow::Result<Option<String>> {
        let mut conn = self.pool.get().await?;
        let prefixed = self.prefixed_key(key);

        let result: Option<String> = conn.get(&prefixed).await?;

        if result.is_some() {
            debug!(key = %key, "Cache hit (raw)");
        } else {
            debug!(key = %key, "Cache miss (raw)");
        }

        Ok(result)
    }

    /// Check if a key exists
    #[instrument(skip(self))]
    pub async fn exists(&self, key: &str) -> anyhow::Result<bool> {
        let mut conn = self.pool.get().await?;
        let prefixed = self.prefixed_key(key);
        let exists: bool = conn.exists(&prefixed).await?;
        Ok(exists)
    }

    /// Get TTL for a key
    #[instrument(skip(self))]
    pub async fn ttl(&self, key: &str) -> anyhow::Result<Option<i64>> {
        let mut conn = self.pool.get().await?;
        let prefixed = self.prefixed_key(key);
        let ttl: i64 = conn.ttl(&prefixed).await?;

        if ttl < 0 {
            Ok(None)
        } else {
            Ok(Some(ttl))
        }
    }

    /// Delete keys matching a pattern
    #[instrument(skip(self))]
    pub async fn delete_pattern(&self, pattern: &str) -> anyhow::Result<u64> {
        let mut conn = self.pool.get().await?;
        let prefixed_pattern = self.prefixed_key(pattern);

        let keys: Vec<String> = redis::cmd("KEYS")
            .arg(&prefixed_pattern)
            .query_async(&mut *conn)
            .await?;

        if keys.is_empty() {
            return Ok(0);
        }

        let deleted: u64 = conn.del(&keys).await?;

        debug!(pattern = %pattern, deleted, "Pattern delete");
        Ok(deleted)
    }

    /// Health check
    pub async fn health_check(&self) -> anyhow::Result<CacheHealth> {
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

// Created and developed by Jai Singh
