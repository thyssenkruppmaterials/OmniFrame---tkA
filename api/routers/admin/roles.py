"""Role management, tab permissions, and navigation permissions endpoints."""

import logging
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, UUID4

from ._helpers import (
    RequireAdmin,
    get_supabase_admin,
    log_admin_action,
    sanitized_error,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


# ---- Pydantic models --------------------------------------------------------

class TabPermissionRequest(BaseModel):
    """Request model for tab permission assignment"""
    role_id: UUID4
    tab_definition_ids: List[UUID4]


class TabPermissionResponse(BaseModel):
    """Response model for tab permission operations"""
    success: bool
    message: str
    affected_rows: Optional[int] = None


class NavigationPermissionRequest(BaseModel):
    """Request model for navigation permission assignment"""
    navigation_item_ids: List[str]


class NavigationPermissionResponse(BaseModel):
    """Response model for navigation permission operations"""
    success: bool
    message: str
    affected_rows: Optional[int] = None
    errors: Optional[List[str]] = None


# ---- Tab permission endpoints ------------------------------------------------

@router.post("/roles/{role_id}/tab-permissions", response_model=TabPermissionResponse)
async def assign_tab_permissions(
    role_id: str,
    request: TabPermissionRequest,
    current_user: RequireAdmin,
):
    """Assign tab permissions to a role.

    This endpoint replaces the frontend's direct database manipulation with a
    secure backend API.
    """
    try:
        supabase_admin = get_supabase_admin()

        delete_result = supabase_admin.table("role_tab_permissions") \
            .delete() \
            .eq("role_id", role_id) \
            .execute()

        if request.tab_definition_ids:
            new_permissions = [
                {
                    "role_id": role_id,
                    "tab_definition_id": str(tab_id),
                    "granted": True
                }
                for tab_id in request.tab_definition_ids
            ]

            insert_result = supabase_admin.table("role_tab_permissions") \
                .insert(new_permissions) \
                .execute()

            affected_rows = len(insert_result.data) if insert_result.data else 0
        else:
            affected_rows = len(delete_result.data) if delete_result.data else 0

        logger.info(f"Tab permissions updated for role {role_id} by user {current_user.email}")

        await log_admin_action(
            action="assign_tab_permissions",
            user=current_user,
            target_resource=role_id,
            details={
                "tab_count": len(request.tab_definition_ids),
                "tab_definition_ids": [str(tid) for tid in request.tab_definition_ids],
                "affected_rows": affected_rows,
            }
        )

        return TabPermissionResponse(
            success=True,
            message="Tab permissions updated successfully",
            affected_rows=affected_rows
        )

    except Exception as e:
        logger.error(f"Failed to assign tab permissions: {str(e)}")
        raise sanitized_error(500, public_message="Failed to update tab permissions.", exc=e, context="assign_tab_permissions")


@router.get("/roles/{role_id}/tab-permissions", response_model=Dict[str, Any])
async def get_role_tab_permissions(
    role_id: str,
    current_user: RequireAdmin,
):
    """Get tab permissions for a specific role."""
    try:
        supabase_admin = get_supabase_admin()

        result = supabase_admin.table("role_tab_permissions") \
            .select("*, tab_definitions(*)") \
            .eq("role_id", role_id) \
            .execute()

        return {
            "role_id": role_id,
            "permissions": result.data if result.data else [],
            "count": len(result.data) if result.data else 0
        }

    except Exception as e:
        logger.error(f"Failed to fetch tab permissions: {str(e)}")
        raise sanitized_error(500, public_message="Failed to fetch tab permissions.", exc=e, context="get_role_tab_permissions")


@router.delete("/roles/{role_id}/tab-permissions")
async def clear_tab_permissions(
    role_id: str,
    current_user: RequireAdmin,
):
    """Clear all tab permissions for a role."""
    try:
        supabase_admin = get_supabase_admin()

        result = supabase_admin.table("role_tab_permissions") \
            .delete() \
            .eq("role_id", role_id) \
            .execute()

        logger.info(f"Tab permissions cleared for role {role_id} by user {current_user.email}")

        await log_admin_action(
            action="clear_tab_permissions",
            user=current_user,
            target_resource=role_id,
            details={"affected_rows": len(result.data) if result.data else 0}
        )

        return TabPermissionResponse(
            success=True,
            message="Tab permissions cleared successfully",
            affected_rows=len(result.data) if result.data else 0
        )

    except Exception as e:
        logger.error(f"Failed to clear tab permissions: {str(e)}")
        raise sanitized_error(500, public_message="Failed to clear tab permissions.", exc=e, context="clear_tab_permissions")


# ---- Navigation permission endpoints ----------------------------------------

@router.post("/roles/{role_id}/navigation-permissions", response_model=NavigationPermissionResponse)
async def assign_navigation_permissions(
    role_id: str,
    request: NavigationPermissionRequest,
    current_user: RequireAdmin,
):
    """Assign navigation permissions to a role.

    Uses the service role key to bypass RLS policies.
    """
    errors: List[str] = []

    try:
        logger.info(f"Assigning {len(request.navigation_item_ids)} navigation permissions to role {role_id}")

        supabase_admin = get_supabase_admin()

        delete_result = supabase_admin.table("role_navigation_permissions") \
            .delete() \
            .eq("role_id", role_id) \
            .execute()

        deleted_count = len(delete_result.data) if delete_result.data else 0
        logger.info(f"Deleted {deleted_count} existing navigation permissions for role {role_id}")

        if request.navigation_item_ids:
            role_result = supabase_admin.table("roles") \
                .select("name") \
                .eq("id", role_id) \
                .single() \
                .execute()

            role_name = role_result.data.get("name", "viewer") if role_result.data else "viewer"

            valid_role_enums = ["superadmin", "admin", "manager", "supervisor", "viewer", "operator"]
            role_enum_value = role_name.lower() if role_name.lower() in valid_role_enums else "viewer"

            nav_validation = supabase_admin.table("navigation_items") \
                .select("id") \
                .in_("id", request.navigation_item_ids) \
                .execute()

            valid_nav_ids = [n["id"] for n in nav_validation.data] if nav_validation.data else []
            invalid_nav_ids = [nid for nid in request.navigation_item_ids if nid not in valid_nav_ids]

            if invalid_nav_ids:
                warning = f"Skipped {len(invalid_nav_ids)} invalid navigation item IDs"
                logger.warning(f"{warning}: {invalid_nav_ids}")
                errors.append(warning)

            if valid_nav_ids:
                new_permissions = [
                    {
                        "role_id": role_id,
                        "navigation_item_id": nav_id,
                        "visible": True,
                        "role": role_enum_value,
                    }
                    for nav_id in valid_nav_ids
                ]

                insert_result = supabase_admin.table("role_navigation_permissions") \
                    .insert(new_permissions) \
                    .execute()

                affected_rows = len(insert_result.data) if insert_result.data else 0
                logger.info(f"Inserted {affected_rows} navigation permissions for role {role_id}")
            else:
                affected_rows = 0
                if not invalid_nav_ids:
                    logger.info(f"No valid navigation items to assign for role {role_id}")
        else:
            affected_rows = deleted_count
            logger.info(f"No navigation items to assign, cleared {deleted_count} existing permissions")

        logger.info(f"Navigation permissions updated for role {role_id} by user {current_user.email}")

        await log_admin_action(
            action="assign_navigation_permissions",
            user=current_user,
            target_resource=role_id,
            details={
                "navigation_count": len(request.navigation_item_ids),
                "valid_count": len(valid_nav_ids) if request.navigation_item_ids else 0,
                "affected_rows": affected_rows,
                "errors": errors,
            }
        )

        return NavigationPermissionResponse(
            success=len(errors) == 0,
            message="Navigation permissions updated successfully" if not errors else "Navigation permissions updated with warnings",
            affected_rows=affected_rows,
            errors=errors if errors else None
        )

    except Exception as e:
        logger.error(f"Failed to assign navigation permissions: {str(e)}")
        raise sanitized_error(500, public_message="Failed to update navigation permissions.", exc=e, context="assign_navigation_permissions")


@router.get("/roles/{role_id}/navigation-permissions", response_model=Dict[str, Any])
async def get_role_navigation_permissions(
    role_id: str,
    current_user: RequireAdmin,
):
    """Get navigation permissions for a specific role."""
    try:
        supabase_admin = get_supabase_admin()

        result = supabase_admin.table("role_navigation_permissions") \
            .select("*, navigation_items(*)") \
            .eq("role_id", role_id) \
            .eq("visible", True) \
            .execute()

        return {
            "role_id": role_id,
            "permissions": result.data if result.data else [],
            "count": len(result.data) if result.data else 0
        }

    except Exception as e:
        logger.error(f"Failed to fetch navigation permissions: {str(e)}")
        raise sanitized_error(500, public_message="Failed to fetch navigation permissions.", exc=e, context="get_role_navigation_permissions")


@router.delete("/roles/{role_id}/navigation-permissions")
async def clear_navigation_permissions(
    role_id: str,
    current_user: RequireAdmin,
):
    """Clear all navigation permissions for a role."""
    try:
        supabase_admin = get_supabase_admin()

        result = supabase_admin.table("role_navigation_permissions") \
            .delete() \
            .eq("role_id", role_id) \
            .execute()

        logger.info(f"Navigation permissions cleared for role {role_id} by user {current_user.email}")

        await log_admin_action(
            action="clear_navigation_permissions",
            user=current_user,
            target_resource=role_id,
            details={"affected_rows": len(result.data) if result.data else 0}
        )

        return NavigationPermissionResponse(
            success=True,
            message="Navigation permissions cleared successfully",
            affected_rows=len(result.data) if result.data else 0
        )

    except Exception as e:
        logger.error(f"Failed to clear navigation permissions: {str(e)}")
        raise sanitized_error(500, public_message="Failed to clear navigation permissions.", exc=e, context="clear_navigation_permissions")

# Developer and Creator: Jai Singh
