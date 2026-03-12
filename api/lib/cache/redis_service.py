"""
Redis Cache Service for FastAPI Backend

Provides rate limiting and general-purpose caching capabilities.

NOTE: Session caching, token validation caching, and permission caching
are now handled by the Rust Core Service (rust-core-service). This Python
Redis service is retained only for:
- Rate limiting
- Application-specific caching (non-auth)
- Health checks

Author: Jai Singh
Date: October 29, 2025
Updated: January 2026 - Removed auth caching (moved to Rust)
Version: 2.0.0
"""

import redis.asyncio as redis
from typing import Optional, Any, Dict
import json
import logging

from ...config.settings import settings

logger = logging.getLogger(__name__)


class RedisService:
    """
    Redis cache service for rate limiting and general caching.
    
    Features:
    - Rate limiting support (IP-based, endpoint-based)
    - General-purpose key-value caching
    - Connection pooling
    - Health monitoring
    
    NOTE: Authentication caching (sessions, tokens, permissions) is now
    handled by the Rust Core Service for better performance. See:
    - rust-core-service/src/cache/session.rs
    - rust-core-service/src/api/routes/auth.rs (validate-with-profile endpoint)
    """
    
    _instance: Optional['RedisService'] = None
    
    def __init__(self):
        self.redis_client: Optional[redis.Redis] = None
        self.is_connected = False
        
        # Metrics
        self.metrics = {
            'rate_limit_checks': 0,
            'rate_limit_exceeded': 0,
            'cache_ops': 0,
            'errors': 0,
        }
    
    @classmethod
    async def get_instance(cls) -> 'RedisService':
        """Get or create singleton instance.

        Detects when the event loop has changed (common in pytest with
        function-scoped loops) and creates a fresh instance rather than
        returning one bound to a closed loop.
        """
        import asyncio

        loop = asyncio.get_running_loop()

        if cls._instance is not None:
            # If the loop changed since last connect, the old client is stale.
            if getattr(cls._instance, '_bound_loop', None) is not loop:
                logger.info("Event loop changed — resetting Redis singleton")
                await cls._safe_disconnect(cls._instance)
                cls._instance = None

        if cls._instance is None:
            cls._instance = RedisService()
            cls._instance._bound_loop = loop
            await cls._instance.connect()
        return cls._instance

    @classmethod
    async def reset(cls) -> None:
        """Explicitly tear down the singleton (for test teardown)."""
        if cls._instance is not None:
            await cls._safe_disconnect(cls._instance)
            cls._instance = None

    @staticmethod
    async def _safe_disconnect(instance: 'RedisService') -> None:
        """Disconnect without raising if the loop is already closed."""
        try:
            await instance.disconnect()
        except Exception:
            instance.is_connected = False
            instance.redis_client = None
    
    async def connect(self) -> None:
        """Establish Redis connection with connection pooling"""
        if self.is_connected:
            logger.warning("Redis already connected")
            return
        
        try:
            logger.info("🚀 Connecting to Redis (rate limiting only)...")
            
            # Create connection pool
            self.redis_client = await redis.from_url(
                settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
                max_connections=settings.redis_max_connections,
                socket_keepalive=settings.redis_socket_keepalive,
                socket_connect_timeout=settings.redis_socket_connect_timeout,
                retry_on_timeout=settings.redis_retry_on_timeout,
            )
            
            # Test connection
            await self.redis_client.ping()
            
            self.is_connected = True
            logger.info("✅ Redis connected successfully (rate limiting enabled)")
            
        except Exception as e:
            logger.error(f"❌ Redis connection failed: {e}")
            logger.warning("🔄 Running without Redis - rate limiting disabled")
            self.is_connected = False
            # Don't raise - allow graceful degradation
    
    async def disconnect(self) -> None:
        """Close Redis connection"""
        if self.redis_client:
            await self.redis_client.aclose()
            self.is_connected = False
            logger.info("✅ Redis disconnected")
    
    # ==================== RATE LIMITING ====================
    
    async def check_rate_limit(
        self,
        identifier: str,
        max_requests: int,
        window_seconds: int
    ) -> bool:
        """
        Check if identifier is within rate limit using sliding window.
        
        Args:
            identifier: Unique identifier (e.g., "ip:endpoint" format)
            max_requests: Maximum requests allowed in window
            window_seconds: Time window in seconds
        
        Returns:
            True if within limit, False if exceeded
        """
        if not self.is_connected:
            return True  # Allow if Redis unavailable (fail open)
        
        try:
            self.metrics['rate_limit_checks'] += 1
            cache_key = f"ratelimit:{identifier}"
            
            # Get current count
            current = await self.redis_client.get(cache_key)
            
            if current is None:
                # First request in window
                await self.redis_client.setex(cache_key, window_seconds, "1")
                return True
            
            count = int(current)
            
            if count >= max_requests:
                self.metrics['rate_limit_exceeded'] += 1
                return False
            
            # Increment count
            await self.redis_client.incr(cache_key)
            return True
            
        except Exception as e:
            logger.error(f"Rate limit check error: {e}")
            self.metrics['errors'] += 1
            return True  # Allow on error (fail open)
    
    async def get_rate_limit_remaining(
        self,
        identifier: str,
        max_requests: int
    ) -> int:
        """
        Get remaining requests in current window.
        
        Args:
            identifier: Rate limit identifier
            max_requests: Maximum allowed requests
        
        Returns:
            Number of remaining requests (0 if exceeded)
        """
        if not self.is_connected:
            return max_requests
        
        try:
            cache_key = f"ratelimit:{identifier}"
            current = await self.redis_client.get(cache_key)
            
            if current is None:
                return max_requests
            
            return max(0, max_requests - int(current))
            
        except Exception as e:
            logger.error(f"Rate limit remaining check error: {e}")
            return max_requests
    
    # ==================== GENERAL CACHING ====================
    
    async def set(
        self,
        key: str,
        value: Any,
        ttl_seconds: Optional[int] = None
    ) -> bool:
        """
        Set a cached value.
        
        Args:
            key: Cache key
            value: Value to cache (will be JSON serialized)
            ttl_seconds: Time to live in seconds (None = no expiry)
        
        Returns:
            True if cached successfully
        """
        if not self.is_connected:
            return False
        
        try:
            self.metrics['cache_ops'] += 1
            cache_key = f"cache:{key}"
            serialized = json.dumps(value) if not isinstance(value, str) else value
            
            if ttl_seconds:
                await self.redis_client.setex(cache_key, ttl_seconds, serialized)
            else:
                await self.redis_client.set(cache_key, serialized)
            
            return True
            
        except Exception as e:
            logger.error(f"Cache set error: {e}")
            self.metrics['errors'] += 1
            return False
    
    async def get(self, key: str) -> Optional[Any]:
        """
        Get a cached value.
        
        Args:
            key: Cache key
        
        Returns:
            Cached value or None if not found
        """
        if not self.is_connected:
            return None
        
        try:
            self.metrics['cache_ops'] += 1
            cache_key = f"cache:{key}"
            
            value = await self.redis_client.get(cache_key)
            
            if value is None:
                return None
            
            # Try to parse as JSON, return as-is if not JSON
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
                
        except Exception as e:
            logger.error(f"Cache get error: {e}")
            self.metrics['errors'] += 1
            return None
    
    async def delete(self, key: str) -> bool:
        """
        Delete a cached value.
        
        Args:
            key: Cache key
        
        Returns:
            True if deleted successfully
        """
        if not self.is_connected:
            return False
        
        try:
            cache_key = f"cache:{key}"
            await self.redis_client.delete(cache_key)
            return True
            
        except Exception as e:
            logger.error(f"Cache delete error: {e}")
            self.metrics['errors'] += 1
            return False
    
    async def exists(self, key: str) -> bool:
        """
        Check if a key exists in cache.
        
        Args:
            key: Cache key
        
        Returns:
            True if key exists
        """
        if not self.is_connected:
            return False
        
        try:
            cache_key = f"cache:{key}"
            return await self.redis_client.exists(cache_key) > 0
            
        except Exception as e:
            logger.error(f"Cache exists check error: {e}")
            return False
    
    # ==================== METRICS & HEALTH ====================
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get service statistics"""
        return {
            'connected': self.is_connected,
            'rate_limit_checks': self.metrics['rate_limit_checks'],
            'rate_limit_exceeded': self.metrics['rate_limit_exceeded'],
            'cache_operations': self.metrics['cache_ops'],
            'errors': self.metrics['errors'],
            'purpose': 'rate_limiting_and_general_cache',
            'auth_caching': 'handled_by_rust_core_service',
        }
    
    async def health_check(self) -> Dict[str, Any]:
        """Perform health check"""
        if not self.is_connected:
            return {
                'status': 'unhealthy',
                'message': 'Redis not connected',
                'connected': False,
                'purpose': 'rate_limiting',
            }
        
        try:
            await self.redis_client.ping()
            stats = await self.get_stats()
            
            return {
                'status': 'healthy',
                'message': 'Redis operating normally',
                'connected': True,
                **stats
            }
            
        except Exception as e:
            return {
                'status': 'unhealthy',
                'message': f'Redis health check failed: {str(e)}',
                'connected': False
            }


# Global instance accessor
_redis_service: Optional[RedisService] = None


async def get_redis_service() -> RedisService:
    """
    Get global Redis service instance.
    
    NOTE: This service is used for rate limiting only.
    Session caching is handled by the Rust Core Service.
    
    Usage:
        redis_service = await get_redis_service()
        is_allowed = await redis_service.check_rate_limit(identifier, max_requests, window)
    """
    global _redis_service
    if _redis_service is None:
        _redis_service = await RedisService.get_instance()
    return _redis_service


async def close_redis():
    """Close Redis connection (for application shutdown or test teardown)."""
    global _redis_service
    if _redis_service:
        await _redis_service.disconnect()
        _redis_service = None
    await RedisService.reset()
