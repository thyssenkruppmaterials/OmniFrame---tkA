// Created and developed by Jai Singh
//! Rate limiting middleware

use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use governor::{
    clock::DefaultClock,
    state::{InMemoryState, NotKeyed},
    Quota, RateLimiter,
};
use std::num::NonZeroU32;
use std::sync::Arc;
use tracing::warn;
use bb8_redis::redis::AsyncCommands;

/// Global rate limiter type
pub type GlobalRateLimiter = RateLimiter<NotKeyed, InMemoryState, DefaultClock>;

/// Create a new global rate limiter
pub fn create_rate_limiter(requests_per_second: u32) -> Arc<GlobalRateLimiter> {
    Arc::new(RateLimiter::direct(Quota::per_second(
        NonZeroU32::new(requests_per_second).unwrap()
    )))
}

/// Rate limiting middleware
pub async fn rate_limit_middleware(
    limiter: Arc<GlobalRateLimiter>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    match limiter.check() {
        Ok(_) => Ok(next.run(request).await),
        Err(_) => {
            warn!("Rate limit exceeded");
            metrics::counter!("api.rate_limit.exceeded").increment(1);
            Err(StatusCode::TOO_MANY_REQUESTS)
        }
    }
}

/// Per-user rate limiting using Redis
use crate::cache::redis_pool::RedisPool;

/// Check and update rate limit for a user
pub async fn user_rate_limit(
    redis_pool: &RedisPool,
    user_id: &str,
    limit: u32,
    window_seconds: u64,
) -> Result<RateLimitResult, anyhow::Error> {
    let mut conn = redis_pool.get().await?;
    let window = chrono::Utc::now().timestamp() / window_seconds as i64;
    let key = format!("ratelimit:{}:{}", user_id, window);

    let count: i64 = conn.incr(&key, 1).await?;

    if count == 1 {
        conn.expire::<_, ()>(&key, window_seconds as i64).await?;
    }

    let remaining = (limit as i64 - count).max(0) as u32;
    let allowed = count <= limit as i64;

    if !allowed {
        metrics::counter!(
            "api.rate_limit.user_exceeded",
            "user_id" => user_id.to_string()
        ).increment(1);
    }

    Ok(RateLimitResult {
        allowed,
        limit,
        remaining,
        reset_after_seconds: window_seconds,
    })
}

/// Rate limit check result
#[derive(Debug, Clone)]
pub struct RateLimitResult {
    pub allowed: bool,
    pub limit: u32,
    pub remaining: u32,
    pub reset_after_seconds: u64,
}

/// Tiered rate limiting configuration
pub struct TieredRateLimits {
    pub anonymous: RateLimitConfig,
    pub authenticated: RateLimitConfig,
    pub premium: RateLimitConfig,
}

/// Rate limit configuration for a tier
pub struct RateLimitConfig {
    pub requests_per_second: u32,
    pub requests_per_minute: u32,
    pub requests_per_hour: u32,
}

impl Default for TieredRateLimits {
    fn default() -> Self {
        Self {
            anonymous: RateLimitConfig {
                requests_per_second: 10,
                requests_per_minute: 100,
                requests_per_hour: 1000,
            },
            authenticated: RateLimitConfig {
                requests_per_second: 50,
                requests_per_minute: 500,
                requests_per_hour: 5000,
            },
            premium: RateLimitConfig {
                requests_per_second: 200,
                requests_per_minute: 2000,
                requests_per_hour: 20000,
            },
        }
    }
}

// Created and developed by Jai Singh
