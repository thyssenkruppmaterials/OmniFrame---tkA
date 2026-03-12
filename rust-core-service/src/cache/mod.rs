//! Caching module with Redis connection pooling
//!
//! Provides high-performance caching with:
//! - Connection pooling with bb8
//! - Redis pipelining for batch operations
//! - Session caching for authenticated users
//! - Query result caching

pub mod redis_pool;
pub mod session;
pub mod query_cache;

pub use redis_pool::{create_redis_pool, CacheService, RedisConfig, RedisPool};
pub use session::SessionService;
