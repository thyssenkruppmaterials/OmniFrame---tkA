"""
Database Connection Pool Manager
Enterprise-grade PostgreSQL connection pooling using asyncpg

Designed to handle 100+ concurrent connections with:
- Automatic connection recycling
- Health monitoring
- Connection retry with exponential backoff
- Graceful degradation

Author: Jai Singh
Date: October 29, 2025
Version: 1.0.0
"""

import asyncio
import asyncpg
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
import logging
from contextlib import asynccontextmanager

from .settings import settings

logger = logging.getLogger(__name__)


class ConnectionPoolConfig:
    """Configuration for database connection pool"""
    
    # Pool sizing
    MIN_CONNECTIONS = 10
    MAX_CONNECTIONS = 100
    
    # Connection lifecycle
    MAX_QUERIES = 50000  # Max queries per connection before recycling
    MAX_INACTIVE_CONNECTION_LIFETIME = 300  # 5 minutes in seconds
    COMMAND_TIMEOUT = 60  # 60 seconds per command
    
    # Connection establishment
    CONNECTION_TIMEOUT = 10  # 10 seconds to establish connection
    
    # Health checks
    HEALTH_CHECK_INTERVAL = 30  # 30 seconds
    
    # Retry configuration
    MAX_RETRY_ATTEMPTS = 3
    INITIAL_RETRY_DELAY = 1  # 1 second
    MAX_RETRY_DELAY = 30  # 30 seconds
    RETRY_BACKOFF_FACTOR = 2  # Exponential backoff


class ConnectionPoolManager:
    """
    Singleton connection pool manager for PostgreSQL using asyncpg
    
    Features:
    - Connection pooling with automatic recycling
    - Health monitoring and auto-recovery
    - Connection retry with exponential backoff
    - Metrics collection for monitoring
    - Graceful shutdown
    """
    
    _instance: Optional['ConnectionPoolManager'] = None
    _lock = asyncio.Lock()
    
    def __init__(self):
        self.pool: Optional[asyncpg.Pool] = None
        self.is_initialized = False
        self.health_check_task: Optional[asyncio.Task] = None
        
        # Metrics
        self.metrics = {
            'total_connections_created': 0,
            'total_queries_executed': 0,
            'total_errors': 0,
            'pool_size': 0,
            'active_connections': 0,
            'idle_connections': 0,
            'last_health_check': None,
            'health_check_failures': 0,
            'connection_timeouts': 0,
        }
        
        # Configuration
        self.config = ConnectionPoolConfig()
    
    @classmethod
    async def get_instance(cls) -> 'ConnectionPoolManager':
        """Get or create singleton instance (thread-safe)"""
        if cls._instance is None:
            async with cls._lock:
                if cls._instance is None:
                    cls._instance = ConnectionPoolManager()
                    await cls._instance.initialize()
        return cls._instance
    
    async def initialize(self) -> None:
        """Initialize connection pool"""
        if self.is_initialized:
            logger.warning("Connection pool already initialized")
            return
        
        try:
            logger.info("🚀 Initializing PostgreSQL connection pool...")
            
            # Parse database URL from Supabase URL
            # Supabase URL format: https://xxx.supabase.co
            # We need postgres://postgres:[password]@db.xxx.supabase.co:5432/postgres
            
            # For now, use direct connection string if available
            if settings.database_url:
                dsn = settings.database_url
            else:
                # Construct from Supabase settings
                # This would need the actual database password
                # For production, use environment variable: DATABASE_URL
                raise ValueError(
                    "DATABASE_URL not configured. Please set DATABASE_URL environment variable "
                    "with format: postgresql://user:password@host:port/database"
                )
            
            # Create connection pool
            self.pool = await asyncpg.create_pool(
                dsn=dsn,
                min_size=self.config.MIN_CONNECTIONS,
                max_size=self.config.MAX_CONNECTIONS,
                max_queries=self.config.MAX_QUERIES,
                max_inactive_connection_lifetime=self.config.MAX_INACTIVE_CONNECTION_LIFETIME,
                command_timeout=self.config.COMMAND_TIMEOUT,
                timeout=self.config.CONNECTION_TIMEOUT,
                # Connection initialization callback
                init=self._init_connection,
            )
            
            # Test pool
            await self._test_pool()
            
            # Start health monitoring
            self.health_check_task = asyncio.create_task(self._health_check_loop())
            
            self.is_initialized = True
            self.metrics['total_connections_created'] = self.config.MIN_CONNECTIONS
            
            logger.info(
                f"✅ Connection pool initialized successfully "
                f"(min={self.config.MIN_CONNECTIONS}, max={self.config.MAX_CONNECTIONS})"
            )
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize connection pool: {e}")
            raise
    
    async def _init_connection(self, conn: asyncpg.Connection) -> None:
        """Initialize each new connection"""
        # Set application name for tracking
        await conn.execute(
            "SET application_name = 'omniframe-api-pool'"
        )
        
        # Set reasonable statement timeout
        await conn.execute(
            f"SET statement_timeout = '{self.config.COMMAND_TIMEOUT * 1000}'"  # milliseconds
        )
    
    async def _test_pool(self) -> None:
        """Test pool connectivity"""
        async with self.pool.acquire() as conn:
            result = await conn.fetchval('SELECT 1')
            if result != 1:
                raise Exception("Pool connectivity test failed")
        logger.info("✅ Connection pool test passed")
    
    @asynccontextmanager
    async def acquire(self):
        """
        Acquire connection from pool with automatic release
        
        Usage:
            async with pool_manager.acquire() as conn:
                result = await conn.fetch("SELECT * FROM table")
        """
        if not self.is_initialized or self.pool is None:
            raise RuntimeError("Connection pool not initialized")
        
        retry_count = 0
        retry_delay = self.config.INITIAL_RETRY_DELAY
        
        while retry_count < self.config.MAX_RETRY_ATTEMPTS:
            try:
                async with self.pool.acquire() as conn:
                    self.metrics['active_connections'] += 1
                    try:
                        yield conn
                        self.metrics['total_queries_executed'] += 1
                    finally:
                        self.metrics['active_connections'] -= 1
                return  # Success, exit retry loop
                
            except asyncpg.TooManyConnectionsError:
                self.metrics['connection_timeouts'] += 1
                logger.warning(
                    f"Connection pool exhausted (attempt {retry_count + 1}/"
                    f"{self.config.MAX_RETRY_ATTEMPTS})"
                )
                
            except asyncpg.PostgresError as e:
                self.metrics['total_errors'] += 1
                logger.error(f"Database error: {e}")
                raise
                
            except Exception as e:
                self.metrics['total_errors'] += 1
                logger.error(f"Unexpected error acquiring connection: {e}")
                raise
            
            # Exponential backoff
            retry_count += 1
            if retry_count < self.config.MAX_RETRY_ATTEMPTS:
                await asyncio.sleep(retry_delay)
                retry_delay = min(
                    retry_delay * self.config.RETRY_BACKOFF_FACTOR,
                    self.config.MAX_RETRY_DELAY
                )
        
        # All retries exhausted
        raise RuntimeError(
            f"Failed to acquire connection after {self.config.MAX_RETRY_ATTEMPTS} attempts"
        )
    
    async def execute(
        self, 
        query: str, 
        *args,
        timeout: Optional[float] = None
    ) -> str:
        """
        Execute a query and return status
        
        Args:
            query: SQL query string
            *args: Query parameters
            timeout: Optional query timeout override
        
        Returns:
            Query execution status
        """
        async with self.acquire() as conn:
            return await conn.execute(query, *args, timeout=timeout)
    
    async def fetch(
        self, 
        query: str, 
        *args,
        timeout: Optional[float] = None
    ) -> List[asyncpg.Record]:
        """
        Fetch multiple rows
        
        Args:
            query: SQL query string
            *args: Query parameters
            timeout: Optional query timeout override
        
        Returns:
            List of records
        """
        async with self.acquire() as conn:
            return await conn.fetch(query, *args, timeout=timeout)
    
    async def fetchrow(
        self, 
        query: str, 
        *args,
        timeout: Optional[float] = None
    ) -> Optional[asyncpg.Record]:
        """
        Fetch single row
        
        Args:
            query: SQL query string
            *args: Query parameters
            timeout: Optional query timeout override
        
        Returns:
            Single record or None
        """
        async with self.acquire() as conn:
            return await conn.fetchrow(query, *args, timeout=timeout)
    
    async def fetchval(
        self, 
        query: str, 
        *args,
        timeout: Optional[float] = None
    ) -> Any:
        """
        Fetch single value
        
        Args:
            query: SQL query string
            *args: Query parameters
            timeout: Optional query timeout override
        
        Returns:
            Single value
        """
        async with self.acquire() as conn:
            return await conn.fetchval(query, *args, timeout=timeout)
    
    async def execute_many(
        self, 
        query: str, 
        args_list: List[tuple],
        timeout: Optional[float] = None
    ) -> None:
        """
        Execute query multiple times with different parameters (batch operation)
        
        Args:
            query: SQL query string
            args_list: List of parameter tuples
            timeout: Optional query timeout override
        """
        async with self.acquire() as conn:
            await conn.executemany(query, args_list, timeout=timeout)
    
    async def get_pool_stats(self) -> Dict[str, Any]:
        """Get current pool statistics"""
        if not self.pool:
            return {'status': 'not_initialized'}
        
        pool_size = self.pool.get_size()
        idle_size = self.pool.get_idle_size()
        
        self.metrics['pool_size'] = pool_size
        self.metrics['idle_connections'] = idle_size
        
        return {
            'status': 'healthy' if self.is_initialized else 'not_initialized',
            'pool_size': pool_size,
            'min_size': self.config.MIN_CONNECTIONS,
            'max_size': self.config.MAX_CONNECTIONS,
            'active_connections': pool_size - idle_size,
            'idle_connections': idle_size,
            'total_queries': self.metrics['total_queries_executed'],
            'total_errors': self.metrics['total_errors'],
            'connection_timeouts': self.metrics['connection_timeouts'],
            'last_health_check': self.metrics['last_health_check'],
            'health_check_failures': self.metrics['health_check_failures'],
        }
    
    async def _health_check_loop(self) -> None:
        """Background task for periodic health checks"""
        while self.is_initialized:
            try:
                await asyncio.sleep(self.config.HEALTH_CHECK_INTERVAL)
                await self._perform_health_check()
            except asyncio.CancelledError:
                logger.info("Health check loop cancelled")
                break
            except Exception as e:
                logger.error(f"Health check error: {e}")
                self.metrics['health_check_failures'] += 1
    
    async def _perform_health_check(self) -> None:
        """Perform health check on pool"""
        try:
            async with self.acquire() as conn:
                result = await conn.fetchval('SELECT 1')
                if result == 1:
                    self.metrics['last_health_check'] = datetime.now().isoformat()
                    
                    # Log pool stats periodically
                    stats = await self.get_pool_stats()
                    logger.debug(
                        f"Pool health check passed - "
                        f"Active: {stats['active_connections']}, "
                        f"Idle: {stats['idle_connections']}, "
                        f"Total queries: {stats['total_queries']}"
                    )
                else:
                    raise Exception("Health check query returned unexpected result")
                    
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            self.metrics['health_check_failures'] += 1
            raise
    
    async def close(self) -> None:
        """Gracefully close connection pool"""
        if not self.is_initialized:
            return
        
        logger.info("🔄 Closing connection pool...")
        
        # Cancel health check task
        if self.health_check_task:
            self.health_check_task.cancel()
            try:
                await self.health_check_task
            except asyncio.CancelledError:
                pass
        
        # Close pool
        if self.pool:
            await self.pool.close()
        
        self.is_initialized = False
        logger.info("✅ Connection pool closed gracefully")
    
    async def __aenter__(self):
        """Context manager entry"""
        if not self.is_initialized:
            await self.initialize()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit"""
        await self.close()


# Global instance accessor
_pool_manager: Optional[ConnectionPoolManager] = None


async def get_pool_manager() -> ConnectionPoolManager:
    """
    Get global connection pool manager instance
    
    Usage in FastAPI:
        from api.config.connection_pool import get_pool_manager
        
        @app.get("/data")
        async def get_data():
            pool = await get_pool_manager()
            async with pool.acquire() as conn:
                result = await conn.fetch("SELECT * FROM table")
            return result
    """
    global _pool_manager
    if _pool_manager is None:
        _pool_manager = await ConnectionPoolManager.get_instance()
    return _pool_manager


async def close_pool():
    """Close global connection pool (for application shutdown)"""
    global _pool_manager
    if _pool_manager:
        await _pool_manager.close()
        _pool_manager = None

