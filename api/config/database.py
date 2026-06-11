# Created and developed by Jai Singh
"""
Supabase database configuration and connection management.
Maintains compatibility with existing database schema and RLS policies.

Updated: February 1, 2026
- Fixed ClientOptions compatibility for supabase-py 2.x
- Uses simple client creation without deprecated options
"""

import logging
from typing import Optional
from supabase import create_client, Client
from .settings import settings

logger = logging.getLogger(__name__)


class SupabaseConnection:
    """
    Manages Supabase client connections for the FastAPI application.
    
    Note: For high-performance operations, consider using ConnectionPoolManager
    directly with asyncpg for better connection pooling.
    """
    
    def __init__(self):
        self._client: Optional[Client] = None
        self._read_client: Optional[Client] = None
        self._admin_client: Optional[Client] = None
    
    @property
    def client(self) -> Client:
        """Get the standard Supabase client (uses anon key with RLS)."""
        if self._client is None:
            logger.info("Creating standard Supabase client...")
            self._client = create_client(
                supabase_url=settings.supabase_url,
                supabase_key=settings.supabase_anon_key
            )
            logger.info("✅ Standard Supabase client created")
        return self._client

    @property
    def read_client(self) -> Client:
        """Get the read-replica Supabase client.

        Points at ``settings.supabase_read_url`` which is the Supabase
        load-balanced endpoint (e.g. ``https://<ref>-all.supabase.co``).
        PostgREST behind that URL sends writes to primary and reads to
        replicas, so you can use this client for any read-only query.

        When no read replica is configured (``API_SUPABASE_READ_URL`` unset),
        ``settings.supabase_read_url`` falls back to ``settings.supabase_url``
        and this method returns the same singleton as :attr:`client`. That
        means call sites can always use ``db.read_client`` for SELECTs without
        a feature-flag check.

        Do NOT use for: mutations, RPCs with side effects, or read-after-write
        flows that require strict consistency.
        """
        # Fall back to the primary singleton when no replica is configured.
        if settings.supabase_read_url == settings.supabase_url:
            return self.client

        if self._read_client is None:
            logger.info(
                "Creating Supabase READ client → %s",
                settings.supabase_read_url,
            )
            self._read_client = create_client(
                supabase_url=settings.supabase_read_url,
                supabase_key=settings.supabase_anon_key,
            )
            logger.info("✅ Supabase READ client created")
        return self._read_client

    @property
    def admin_client(self) -> Optional[Client]:
        """Get the admin Supabase client (bypasses RLS for admin operations)."""
        if settings.supabase_service_role_key and self._admin_client is None:
            logger.info("Creating admin Supabase client...")
            self._admin_client = create_client(
                supabase_url=settings.supabase_url,
                supabase_key=settings.supabase_service_role_key
            )
            logger.info("✅ Admin Supabase client created")
        return self._admin_client
    
    def with_auth(self, token: str) -> Client:
        """Get a client with user authentication token for RLS context."""
        # Create a simple client - the token will be used in requests
        client = create_client(
            supabase_url=settings.supabase_url,
            supabase_key=settings.supabase_anon_key
        )
        
        # Set the auth context for auth.uid() in RLS
        try:
            client.auth.set_session(
                access_token=token,
                refresh_token=""
            )
        except Exception as e:
            logger.warning(f"Could not set auth session: {e}")
            # The anon key client should still work for most operations
            pass
            
        return client

# Global database connection instance
db = SupabaseConnection()


async def get_supabase_client():
    """Dependency to get Supabase client for FastAPI endpoints."""
    return db.client


async def get_supabase_read_client():
    """Dependency to get the read-replica Supabase client.

    Returns the load-balanced endpoint when ``API_SUPABASE_READ_URL`` is
    configured; otherwise transparently returns the primary client.
    Use this for heavy SELECTs / reports / dashboards.
    """
    return db.read_client


async def get_authenticated_client(token: str):
    """Get authenticated Supabase client for user-specific operations."""
    return db.with_auth(token)


async def test_connection():
    """Test the database connection."""
    try:
        # Test with a simple query that should work with RLS
        result = db.client.table("organizations").select("id").limit(1).execute()
        return {"status": "connected", "data": result.data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# Created and developed by Jai Singh
