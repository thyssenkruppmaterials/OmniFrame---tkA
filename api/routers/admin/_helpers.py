# Created and developed by Jai Singh
"""Shared helpers for the admin sub-package."""

import logging
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, status
from supabase import create_client, Client

try:
    from ...auth.supabase_auth import (
        get_current_user,
        AuthenticatedUser,
        require_admin_role,
        RequireAdmin,
    )
    from ...config.settings import settings
    from ...utils.error_responses import sanitized_error
except ImportError:
    try:
        from auth.supabase_auth import (
            get_current_user,
            AuthenticatedUser,
            require_admin_role,
            RequireAdmin,
        )
        from config.settings import settings
        from utils.error_responses import sanitized_error
    except ImportError:
        from api.auth.supabase_auth import (
            get_current_user,
            AuthenticatedUser,
            require_admin_role,
            RequireAdmin,
        )
        from api.config.settings import settings
        from api.utils.error_responses import sanitized_error

logger = logging.getLogger(__name__)


def get_supabase_admin() -> Client:
    """Get Supabase admin client with proper validation and error handling."""
    if not settings.supabase_url:
        logger.error("SUPABASE_URL not configured")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase URL not configured"
        )

    if not settings.supabase_service_role_key:
        logger.error("SUPABASE_SERVICE_ROLE_KEY not configured")
        logger.error(f"Available settings: supabase_url={bool(settings.supabase_url)}, "
                    f"supabase_anon_key={bool(settings.supabase_anon_key)}, "
                    f"service_role_key={bool(settings.supabase_service_role_key)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase service role key not configured"
        )

    try:
        logger.info(f"Creating Supabase admin client (URL configured: {bool(settings.supabase_url)}, service key configured: {bool(settings.supabase_service_role_key)})")

        client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key
        )
        return client
    except Exception as e:
        logger.error(f"Failed to create Supabase admin client: {str(e)}")
        raise sanitized_error(500, public_message="Failed to initialize admin client.", exc=e, context="get_supabase_admin")


async def log_admin_action(
    action: str,
    user: AuthenticatedUser,
    target_resource: str,
    details: dict = None
) -> None:
    """Log admin actions for audit trail.

    This function logs administrative actions to the audit_logs table for
    security compliance and accountability tracking.
    """
    try:
        supabase_admin = get_supabase_admin()
        await_result = supabase_admin.table("audit_logs").insert({
            "user_id": user.id,
            "action": action,
            "resource_type": "admin",
            "resource_id": target_resource,
            "metadata": details or {},
            "ip_address": None,
            "created_at": datetime.utcnow().isoformat(),
        }).execute()
        logger.debug(f"Admin action logged: {action} on {target_resource} by {user.email}")
    except Exception as e:
        logger.warning(f"Failed to log admin action: {e}")

# Created and developed by Jai Singh
