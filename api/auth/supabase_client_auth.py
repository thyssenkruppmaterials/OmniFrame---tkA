# Created and developed by Jai Singh
"""
Proper Supabase client authentication using JWT tokens.
This handles the specific way Supabase clients need to be configured for RLS.

History:
- 2026-05-24: Stopped passing ``ClientOptions(headers=...)`` to
  ``create_client``. In supabase-py 2.x the SDK initialiser reads
  ``options.storage`` during construction, but our ``ClientOptions``
  kwargs (``headers``, ``postgrest_client_timeout``, ...) don't populate
  that attribute, so ``create_client`` raised ``AttributeError:
  'ClientOptions' object has no attribute 'storage'``. The old code
  swallowed that error and returned an unauthenticated anon client,
  causing the OmniBelt kill-switch RLS 42501. We now set the JWT on the
  PostgREST sub-client after creating the bare client — that's the
  documented, supported way to attach a user JWT in v2.x.
"""

import logging
from supabase import create_client, Client

try:
    from ..config.settings import settings
except ImportError:
    from config.settings import settings

logger = logging.getLogger(__name__)


def create_authenticated_supabase_client(jwt_token: str) -> Client:
    """Create a Supabase client whose PostgREST requests carry the
    caller's JWT, so RLS policies see the real ``auth.uid()``.

    Implementation notes:
    - We deliberately do NOT pass ``ClientOptions(...)`` here. supabase-py
      2.x reads attributes on ``options`` that aren't populated when you
      only set ``headers``/timeouts, which makes ``create_client`` throw.
      Calling ``client.postgrest.auth(jwt_token)`` after construction is
      the supported way to attach a user JWT for RLS in v2.x.
    - We also call ``client.auth.set_session(...)`` defensively so the
      ``auth`` sub-client has the same session context if any code path
      reads it (we don't strictly need it for PostgREST writes).
    """
    client: Client = create_client(
        supabase_url=settings.supabase_url,
        supabase_key=settings.supabase_anon_key,
    )

    # Attach JWT to PostgREST requests — this is what makes RLS resolve
    # ``auth.uid()`` to the calling user instead of NULL.
    try:
        client.postgrest.auth(jwt_token)
    except Exception as e:
        # If this fails the client is effectively anon — better to raise
        # than to silently downgrade and re-hit the original 42501.
        logger.error("Failed to attach JWT to PostgREST client: %s", e)
        raise

    # Best-effort auth-side session bind for any code that introspects
    # ``client.auth`` (e.g. ``client.auth.get_user()``). Not required for
    # the RLS write path.
    try:
        client.auth.set_session(access_token=jwt_token, refresh_token="")
    except Exception as session_error:
        logger.debug(
            "Auth session bind skipped (non-fatal for RLS writes): %s",
            session_error,
        )

    return client


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

# Created and developed by Jai Singh
