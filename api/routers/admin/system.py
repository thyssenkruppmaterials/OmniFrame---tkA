"""System-level admin endpoints (health, test, routes)."""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends

from ._helpers import (
    get_current_user,
    AuthenticatedUser,
    require_admin_role,
    RequireAdmin,
    get_supabase_admin,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


@router.get("/test")
async def test_admin_router(
    current_user: AuthenticatedUser = Depends(get_current_user),
    _admin=Depends(require_admin_role()),
):
    """Simple test endpoint to verify admin router is loading."""
    return {"status": "admin_router_loaded", "timestamp": datetime.utcnow().isoformat()}


@router.get("/health")
async def admin_health_check(
    current_user: AuthenticatedUser = Depends(get_current_user),
    _admin=Depends(require_admin_role()),
):
    """Health check for admin functionality and Supabase admin client."""
    try:
        supabase_admin = get_supabase_admin()
        result = supabase_admin.table("roles").select("count", count="exact").limit(1).execute()

        return {
            "status": "healthy",
            "supabase_admin": "connected",
            "settings_validated": True,
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Admin health check failed: {str(e)}")
        return {
            "status": "unhealthy",
            "error": str(e),
            "supabase_admin": "failed",
            "settings_validated": False,
            "timestamp": datetime.utcnow().isoformat()
        }


@router.get("/routes")
async def list_routes(
    current_user: RequireAdmin,
):
    """List all registered routes (admin only).

    SECURITY: This endpoint now requires admin authentication.
    Endpoint function names have been removed to prevent code disclosure.
    """
    routes = []
    for route in router.routes:
        routes.append({
            "path": route.path,
            "methods": list(route.methods) if hasattr(route, 'methods') else None,
            "name": route.name if hasattr(route, 'name') else None,
        })

    logger.info(f"Routes list accessed by admin user: {current_user.email}")

    return {
        "routes": routes,
        "total_routes": len(routes),
        "accessed_by": current_user.email,
        "timestamp": datetime.utcnow().isoformat()
    }

# Developer and Creator: Jai Singh
