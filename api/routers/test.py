# Created and developed by Jai Singh
"""
Test API endpoints for verifying authentication and basic functionality.
"""

from fastapi import APIRouter, Depends
from typing import Dict, Any

try:
    from ..auth.supabase_auth import get_current_user, AuthenticatedUser
except ImportError:
    from auth.supabase_auth import get_current_user, AuthenticatedUser

router = APIRouter()


@router.get("/auth-test")
async def test_authentication(
    current_user: AuthenticatedUser = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Simple authentication test endpoint.
    
    This endpoint doesn't require organization_id or complex permissions,
    just validates that the JWT token authentication is working correctly.
    """
    return {
        "status": "success",
        "message": "🎉 Authentication is working perfectly!",
        "user": {
            "id": current_user.id,
            "email": current_user.email,
            "organization_id": current_user.organization_id,
            "role": current_user.role,
            "full_name": current_user.full_name
        },
        "debug_info": {
            "has_organization_id": current_user.organization_id is not None,
            "has_role": current_user.role is not None,
            "has_supabase_client": current_user.supabase_client is not None,
            "profile_data_available": all([
                current_user.organization_id,
                current_user.role,
                current_user.full_name
            ])
        },
        "next_steps": {
            "if_no_organization_id": "This means RLS policies are blocking profile data access (which is correct security)",
            "solution": "We need to either adjust RLS policies or use alternative data access method"
        }
    }


@router.get("/simple-data")  
async def get_simple_data(
    current_user: AuthenticatedUser = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Test basic data access without organization filtering.
    
    This will help us understand what data access is possible
    with the current authentication setup.
    """
    try:
        # Try a simple, non-filtered query
        result = current_user.supabase_client.table("organizations").select("id, name").limit(1).execute()
        
        return {
            "status": "success", 
            "message": "Basic data access test",
            "data_access": {
                "query_attempted": "SELECT id, name FROM organizations LIMIT 1",
                "result_count": len(result.data) if result.data else 0,
                "has_data": bool(result.data),
                "error": None
            }
        }
        
    except Exception as e:
        return {
            "status": "data_access_blocked",
            "message": "Data access restricted by RLS policies (this is expected)",
            "data_access": {
                "query_attempted": "SELECT id, name FROM organizations LIMIT 1", 
                "result_count": 0,
                "has_data": False,
                "error": str(e)
            },
            "explanation": "RLS policies are working correctly - they block unauthorized data access"
        }

# Created and developed by Jai Singh
