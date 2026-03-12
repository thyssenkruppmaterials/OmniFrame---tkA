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

