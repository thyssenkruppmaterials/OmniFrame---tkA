//! Query result caching

use super::redis_pool::CacheService;
use serde::{de::DeserializeOwned, Serialize};
use std::time::Duration;
use tracing::instrument;

/// Query cache service for caching database query results
pub struct QueryCache {
    cache: CacheService,
    default_ttl: Duration,
}

impl QueryCache {
    /// Create a new query cache
    pub fn new(cache: CacheService) -> Self {
        Self {
            cache,
            default_ttl: Duration::from_secs(60), // 1 minute default for queries
        }
    }

    /// Create with custom default TTL
    pub fn with_ttl(cache: CacheService, ttl: Duration) -> Self {
        Self {
            cache,
            default_ttl: ttl,
        }
    }

    /// Generate cache key for a query
    fn query_key(query_name: &str, params: &str) -> String {
        format!("query:{}:{}", query_name, params)
    }

    /// Get or execute a query
    ///
    /// If the result is cached, returns it immediately.
    /// Otherwise, executes the query function and caches the result.
    #[instrument(skip(self, query_fn))]
    pub async fn get_or_query<T, F, Fut>(
        &self,
        query_name: &str,
        params: &str,
        ttl: Option<Duration>,
        query_fn: F,
    ) -> Result<T, anyhow::Error>
    where
        T: Serialize + DeserializeOwned,
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T, anyhow::Error>>,
    {
        let key = Self::query_key(query_name, params);

        // Try cache first
        if let Some(cached) = self.cache.get::<T>(&key).await? {
            tracing::debug!(query = %query_name, "Query cache hit");
            return Ok(cached);
        }

        // Execute query
        tracing::debug!(query = %query_name, "Query cache miss, executing");
        let result = query_fn().await?;

        // Cache result
        let cache_ttl = ttl.unwrap_or(self.default_ttl);
        self.cache.set(&key, &result, Some(cache_ttl)).await?;

        Ok(result)
    }

    /// Invalidate a specific query cache
    #[instrument(skip(self))]
    pub async fn invalidate(&self, query_name: &str, params: &str) -> Result<bool, anyhow::Error> {
        let key = Self::query_key(query_name, params);
        self.cache.delete(&key).await
    }

    /// Invalidate all caches for a query name
    #[instrument(skip(self))]
    pub async fn invalidate_query(&self, query_name: &str) -> Result<u64, anyhow::Error> {
        self.cache.delete_pattern(&format!("query:{}:*", query_name)).await
    }

    /// Invalidate all query caches
    #[instrument(skip(self))]
    pub async fn invalidate_all(&self) -> Result<u64, anyhow::Error> {
        self.cache.delete_pattern("query:*").await
    }

    /// Pre-warm cache with a result
    #[instrument(skip(self, result))]
    pub async fn warm<T: Serialize>(
        &self,
        query_name: &str,
        params: &str,
        result: &T,
        ttl: Option<Duration>,
    ) -> Result<(), anyhow::Error> {
        let key = Self::query_key(query_name, params);
        self.cache.set(&key, result, ttl.or(Some(self.default_ttl))).await
    }
}

impl Clone for QueryCache {
    fn clone(&self) -> Self {
        Self {
            cache: self.cache.clone(),
            default_ttl: self.default_ttl,
        }
    }
}
