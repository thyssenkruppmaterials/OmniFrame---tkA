"""
Cache services for OmniFrame API

NOTE: Authentication caching (sessions, tokens, permissions) is now handled
by the Rust Core Service for better performance. This module provides:
- Rate limiting via Redis
- General-purpose caching for non-auth use cases

For session caching architecture, see:
- rust-core-service/src/cache/session.rs
- rust-core-service/src/api/routes/auth.rs (validate-with-profile endpoint)
"""

from .redis_service import RedisService, get_redis_service, close_redis

__all__ = [
    "RedisService",
    "get_redis_service", 
    "close_redis",
]