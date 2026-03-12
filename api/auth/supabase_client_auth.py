"""
Proper Supabase client authentication using JWT tokens.
This handles the specific way Supabase clients need to be configured for RLS.
"""

import logging
from typing import Optional
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions

try:
    from ..config.settings import settings
except ImportError:
    from config.settings import settings

logger = logging.getLogger(__name__)


def create_authenticated_supabase_client(jwt_token: str) -> Client:
    """
    Create a Supabase client properly authenticated with JWT token for RLS.
    
    This ensures auth.uid() works correctly in RLS policies.
    """
    try:
        # Create Supabase client with JWT token for authentication
        client = create_client(
            supabase_url=settings.supabase_url,
            supabase_key=settings.supabase_anon_key,
            options=ClientOptions(
                headers={
                    "Authorization": f"Bearer {jwt_token}",
                    "apikey": settings.supabase_anon_key
                },
                postgrest_client_timeout=10,
                storage_client_timeout=10,
                schema="public"
            )
        )
        
        # Set the session manually to establish auth.uid() context
        # This is critical for RLS policies to work
        try:
            # Extract token parts for session setup
            session_data = {
                "access_token": jwt_token,
                "refresh_token": "",  # Not needed for API access
                "token_type": "bearer",
                "user": None  # Will be populated by Supabase
            }
            
            # Set the session in the auth client
            client.auth._session = session_data
            
            # Also set in postgrest client for RLS
            client.postgrest.auth(jwt_token)
            
            logger.info(f"✅ Created authenticated Supabase client with JWT token")
            return client
            
        except Exception as session_error:
            logger.warning(f"Session setup had issues but client created: {session_error}")
            # Even if session setup fails partially, the Authorization header should work
            return client
            
    except Exception as e:
        logger.error(f"Failed to create authenticated Supabase client: {e}")
        # Fallback to basic client
        return create_client(settings.supabase_url, settings.supabase_anon_key)


def test_authenticated_client(client: Client, user_id: str) -> dict:
    """Test that the authenticated client works with RLS."""
    try:
        # Test basic query that should work with auth context
        result = client.table("user_profiles").select("id, organization_id, role").eq("id", user_id).single().execute()
        
        if result.data:
            logger.info(f"✅ Authenticated client test successful for user: {user_id}")
            return {"status": "success", "data": result.data}
        else:
            logger.warning(f"⚠️ No profile data found for user: {user_id}")
            return {"status": "no_data", "message": "Profile not found"}
            
    except Exception as e:
        logger.error(f"❌ Authenticated client test failed: {str(e)}")
        return {"status": "error", "message": str(e)}
