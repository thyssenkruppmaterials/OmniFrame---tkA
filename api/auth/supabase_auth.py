# Created and developed by Jai Singh
"""
Supabase JWT authentication and authorization middleware for FastAPI.
Integrates with existing OneBox AI Logistics authentication system.

SECURITY: JWT validation is performed by the rust-core-service which implements
proper JWKS-based RS256 signature verification. This replaces the previous
insecure Python implementation that skipped signature verification.
"""

import os
import logging
from typing import Optional, Annotated
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict

logger = logging.getLogger(__name__)

try:
    from ..config.settings import settings
except ImportError:
    from config.settings import settings

try:
    from ..lib.rust_core import (
        get_rust_client,
        ValidationResult,
        AuthenticatedUserResult,
        RustCoreError,
        RustCoreConnectionError,
        is_rust_core_enabled,
    )
except ImportError:
    from lib.rust_core import (
        get_rust_client,
        ValidationResult,
        AuthenticatedUserResult,
        RustCoreError,
        RustCoreConnectionError,
        is_rust_core_enabled,
    )

security = HTTPBearer(auto_error=False)


class UserPayload(BaseModel):
    """User information extracted from Supabase JWT token."""
    sub: str  # User ID
    email: str
    aud: str  # Audience
    role: str  # Supabase role
    exp: int  # Expiration
    iat: int  # Issued at
    iss: str  # Issuer
    
    # Custom claims from user_profiles table (optional)
    organization_id: Optional[str] = None
    user_role: Optional[str] = None
    full_name: Optional[str] = None
    
    # Permissions from RBAC (populated by Rust service)
    permissions: Optional[list[str]] = None


class AuthenticatedUser(BaseModel):
    """Authenticated user with profile information."""
    id: str
    email: str
    organization_id: Optional[str] = None
    role: Optional[str] = None
    full_name: Optional[str] = None
    permissions: Optional[list[str]] = None
    supabase_client: Optional[object] = None
    
    model_config = ConfigDict(arbitrary_types_allowed=True)


async def _fallback_decode_jwt(token: str) -> UserPayload:
    """
    Fallback JWT decoding for development when Rust service is unavailable.
    
    ⚠️ CRITICAL SECURITY WARNING ⚠️
    This decodes the token WITHOUT cryptographic signature verification!
    An attacker can forge tokens if this is enabled in production.
    
    This should ONLY be used for LOCAL DEVELOPMENT when the Rust service
    is not available. NEVER enable in production (RUST_CORE_FALLBACK=false).
    """
    import time
    from jose import jwt, JWTError
    
    logger.warning(
        "SECURITY WARNING: Using insecure JWT fallback - NOT suitable for production. "
        "Tokens are decoded WITHOUT cryptographic signature verification."
    )
    
    try:
        # Decode without verification to get claims
        # We trust tokens from Supabase issuer in development mode
        unverified = jwt.get_unverified_claims(token)
        
        # Verify token is not expired
        exp = unverified.get("exp", 0)
        if exp and exp < time.time():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token expired"
            )
        
        # For development, we trust the token if it's from Supabase
        # In production, always use the Rust service for proper JWKS verification
        iss = unverified.get("iss", "")
        if not iss or "supabase" not in iss:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token issuer"
            )
        
        return UserPayload(
            sub=unverified.get("sub", ""),
            email=unverified.get("email", ""),
            aud=unverified.get("aud", "authenticated"),
            role=unverified.get("role", "authenticated"),
            exp=unverified.get("exp", 0),
            iat=unverified.get("iat", 0),
            iss=iss,
            permissions=unverified.get("permissions"),
        )
    except JWTError as e:
        logger.error(f"Fallback JWT decode failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )


def _is_fallback_enabled() -> bool:
    """
    Check if JWT fallback validation is enabled when Rust service is unavailable.
    
    SECURITY: Defaults to False. Fallback mode skips signature verification,
    allowing forged tokens. Only enable for local development.
    
    ALL of the following must be true for fallback to activate:
    1. Environment is NOT production/prod/staging
    2. ALLOW_INSECURE_JWT_FALLBACK=true
    3. ENVIRONMENT=local (explicit opt-in)
    4. RUST_CORE_FALLBACK=true
    """
    env_name = settings.environment.lower()
    if env_name in ("production", "prod", "staging"):
        return False
    if not settings.allow_insecure_jwt_fallback:
        return False
    if env_name != "local":
        return False
    return settings.rust_core_fallback


if _is_fallback_enabled():
    logger.warning(
        "INSECURE JWT FALLBACK IS ENABLED. Tokens will be decoded WITHOUT "
        "cryptographic signature verification when the Rust service is unavailable. "
        "This must NEVER be used outside local development."
    )


async def decode_jwt_token(token: str) -> UserPayload:
    """
    Validate and decode Supabase JWT token using Rust service.
    
    This provides cryptographic verification via rust-core-service which
    implements proper JWKS-based RS256 signature verification.
    
    The Rust service also caches validated sessions and permissions for
    improved performance.
    
    In development mode, falls back to Python JWT decoding when Rust service
    is unavailable.
    
    Raises:
        HTTPException: If token is invalid, expired, or service unavailable
    """
    try:
        logger.debug(f"Validating JWT token via Rust service (length: {len(token)})")
        
        # Validate token through Rust service
        client = get_rust_client()
        result: ValidationResult = await client.validate_token(token)
        
        if not result.valid:
            logger.warning(f"Token validation failed: {result.error}")
            # If Rust validation fails (e.g., JWT secret mismatch), try fallback
            if _is_fallback_enabled() and result.error and "InvalidSignature" in result.error:
                logger.warning("Using fallback JWT validation (Rust signature mismatch - JWT secret may need sync)")
                return await _fallback_decode_jwt(token)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=result.error or "Token validation failed"
            )
        
        # Build UserPayload from validated result
        user_payload = UserPayload(
            sub=result.user_id or "",
            email=result.email or "",
            aud="authenticated",
            role=result.role or "authenticated",
            exp=result.expires_at or 0,
            iat=0,
            iss="supabase",
            permissions=result.permissions,
        )
        
        logger.info(f"Token validated successfully for user: {user_payload.sub}")
        return user_payload
        
    except RustCoreConnectionError as e:
        # Rust service unavailable - check if we can use fallback
        logger.error(f"Rust core service unavailable: {e}")
        
        if _is_fallback_enabled():
            logger.warning("Using fallback JWT validation (Rust service unavailable)")
            return await _fallback_decode_jwt(token)
        
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable"
        )
    except RustCoreError as e:
        # Rust service returned an error (e.g., InvalidSignature due to JWT secret mismatch)
        logger.error(f"Rust core error: {e}")
        
        if _is_fallback_enabled():
            logger.warning("Using fallback JWT validation (Rust validation error)")
            return await _fallback_decode_jwt(token)
        
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed"
        )
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"Unexpected error validating JWT: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed"
        )


async def get_current_user(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)]
) -> AuthenticatedUser:
    """
    Get the current authenticated user from JWT token.
    
    RUST-CENTRIC AUTHENTICATION:
    This function now uses the Rust service's validate-with-profile endpoint
    which handles JWT validation, profile fetching, and session caching all in one.
    
    Benefits:
    - Single network call instead of JWT validation + profile query
    - Session caching handled by Rust (15-minute TTL)
    - Consistent cache key format across services
    - Fallback to Python-only validation when Rust unavailable
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required"
        )
    
    token = credentials.credentials
    
    # === PRIMARY PATH: Rust-centric authentication ===
    # The Rust service handles:
    # 1. Session cache lookup (fast path)
    # 2. JWT validation with JWKS RS256 verification
    # 3. Profile fetching from database
    # 4. Permission resolution from RBAC
    # 5. Session caching for future requests
    
    try:
        logger.debug(f"Authenticating via Rust service (token length: {len(token)})")
        
        client = get_rust_client()
        result: AuthenticatedUserResult = await client.validate_token_with_profile(token)
        
        if not result.valid:
            logger.warning(f"Token validation failed: {result.error}")
            
            # Check if we should try fallback
            if _is_fallback_enabled() and result.error:
                if "InvalidSignature" in result.error or "Rust" in result.error:
                    logger.warning("Using fallback authentication (Rust validation issue)")
                    return await _fallback_get_current_user(token)
            
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=result.error or "Token validation failed"
            )
        
        # Log cache status for monitoring
        cache_status = "cache hit" if result.cached else "cache miss"
        logger.debug(f"Authentication successful ({cache_status}) for user: {result.user_id}")
        
        org_id = result.organization_id
        
        # Fallback: if organization_id is missing (e.g. stale Redis cache),
        # resolve it directly from user_profiles via Supabase.
        if not org_id and result.user_id:
            try:
                from supabase import create_client
                service_client = create_client(
                    settings.supabase_url,
                    settings.supabase_service_role_key
                )
                profile_result = service_client.table("user_profiles").select(
                    "organization_id"
                ).eq("id", result.user_id).single().execute()
                
                if profile_result.data and profile_result.data.get("organization_id"):
                    org_id = profile_result.data["organization_id"]
                    logger.info(
                        f"Resolved organization_id via direct DB fallback for user {result.user_id}"
                    )
            except Exception as e:
                logger.warning(f"Failed to resolve organization_id fallback: {e}")
        
        return AuthenticatedUser(
            id=result.user_id,
            email=result.email,
            organization_id=org_id,
            role=result.role or "authenticated",
            full_name=result.full_name or result.email,
            permissions=result.permissions or [],
            supabase_client=None
        )
        
    except RustCoreConnectionError as e:
        # Rust service unavailable - try fallback
        logger.error(f"Rust core service unavailable: {e}")
        
        if _is_fallback_enabled():
            logger.warning("Using fallback authentication (Rust service unavailable)")
            return await _fallback_get_current_user(token)
        
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable"
        )
    except RustCoreError as e:
        # Rust service returned an error
        logger.error(f"Rust core error: {e}")
        
        if _is_fallback_enabled():
            logger.warning("Using fallback authentication (Rust error)")
            return await _fallback_get_current_user(token)
        
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in authentication: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed"
        )


async def _fallback_get_current_user(token: str) -> AuthenticatedUser:
    """
    Fallback authentication when Rust service is unavailable.
    
    WARNING: This method does not cache sessions and makes a database query
    on every request. Only use when Rust service is down.
    """
    from supabase import create_client
    
    # Decode JWT (may not have full signature verification)
    user_payload = await _fallback_decode_jwt(token)
    
    try:
        # Fetch profile from Supabase directly
        service_client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key
        )
        
        profile_result = service_client.table("user_profiles").select(
            "organization_id, role, full_name, role_details:roles(name)"
        ).eq("id", user_payload.sub).single().execute()
        
        if profile_result.data:
            profile = profile_result.data
            role_from_roles_table = None
            role_details = profile.get("role_details")
            if isinstance(role_details, dict):
                role_from_roles_table = role_details.get("name")
            effective_role = role_from_roles_table or profile.get("role") or user_payload.role
            return AuthenticatedUser(
                id=user_payload.sub,
                email=user_payload.email,
                organization_id=profile.get("organization_id"),
                role=effective_role,
                full_name=profile.get("full_name", user_payload.email),
                permissions=user_payload.permissions or [],
                supabase_client=None
            )
    except Exception as e:
        logger.error(f"Fallback profile fetch failed: {e}")
    
    # Last resort: basic user info without profile data
    return AuthenticatedUser(
        id=user_payload.sub,
        email=user_payload.email,
        organization_id=None,
        role=user_payload.role,
        full_name=user_payload.email,
        permissions=user_payload.permissions or [],
        supabase_client=None
    )


async def get_optional_current_user(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)]
) -> Optional[AuthenticatedUser]:
    """Get the current user if authenticated, otherwise return None."""
    if not credentials:
        return None
    
    try:
        return await get_current_user(credentials)
    except HTTPException:
        return None


def require_role(required_role: str):
    """Dependency factory for role-based access control."""
    async def role_dependency(current_user: Annotated[AuthenticatedUser, Depends(get_current_user)]):
        if not current_user.role or current_user.role != required_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required role: {required_role}"
            )
        return current_user
    
    return role_dependency


def require_any_role(allowed_roles: list[str]):
    """Dependency factory for multiple role access control."""
    async def role_dependency(current_user: Annotated[AuthenticatedUser, Depends(get_current_user)]):
        if not current_user.role or current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {', '.join(allowed_roles)}"
            )
        return current_user
    
    return role_dependency


def require_permission(required_permission: str):
    """Dependency factory for permission-based access control."""
    async def permission_dependency(current_user: Annotated[AuthenticatedUser, Depends(get_current_user)]):
        user_permissions = current_user.permissions or []
        
        # Check for exact match or wildcard permissions
        has_permission = (
            required_permission in user_permissions or
            "*" in user_permissions or
            "admin:*" in user_permissions
        )
        
        # Check resource wildcards (e.g., "warehouse:*" matches "warehouse:view")
        if not has_permission and ":" in required_permission:
            resource = required_permission.split(":")[0]
            wildcard = f"{resource}:*"
            has_permission = wildcard in user_permissions
        
        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required permission: {required_permission}"
            )
        return current_user
    
    return permission_dependency


def require_any_permission(required_permissions: list[str]):
    """Dependency factory for checking if user has any of the specified permissions."""
    async def permission_dependency(current_user: Annotated[AuthenticatedUser, Depends(get_current_user)]):
        user_permissions = current_user.permissions or []
        
        # Admin/superuser check
        if "*" in user_permissions or "admin:*" in user_permissions:
            return current_user
        
        # Check if user has any of the required permissions
        for perm in required_permissions:
            if perm in user_permissions:
                return current_user
            # Check resource wildcards
            if ":" in perm:
                resource = perm.split(":")[0]
                if f"{resource}:*" in user_permissions:
                    return current_user
        
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied. Required one of: {', '.join(required_permissions)}"
        )
    
    return permission_dependency


# ==============================================================================
# ADMIN ROLE VERIFICATION
# ==============================================================================
# SECURITY FIX (January 27, 2026): Replaced insecure email domain check (@j.ai)
# with proper role-based authorization checking against the roles table.
# ==============================================================================

async def _verify_admin_role(user: AuthenticatedUser) -> bool:
    """
    Verify user has admin or superadmin role by checking role name, permissions,
    and falling back to a database lookup via the roles table.
    
    SECURITY: This replaces the insecure email domain check with proper database verification.
    
    Admin access is granted if ANY of these conditions are met:
    1. User's role name is 'admin' or 'superadmin' (case-insensitive)
    2. User has wildcard permission '*' (superuser)
    3. User has admin wildcard permission 'admin:*'
    4. Database lookup: user_profiles.role_id -> roles.name is admin/superadmin
       (handles stale session cache where role is 'authenticated')
    
    Args:
        user: The authenticated user to verify
        
    Returns:
        True if user has admin access, False otherwise
    """
    if not user:
        return False
    
    admin_roles = {'admin', 'superadmin'}
    
    # Fast path: check role from session/JWT
    if user.role and user.role.lower() in admin_roles:
        logger.debug(f"Admin access granted via role: {user.role}")
        return True
    
    # Check permissions for admin wildcard
    if user.permissions:
        if '*' in user.permissions:
            logger.debug(f"Admin access granted via superuser permission '*'")
            return True
        if 'admin:*' in user.permissions:
            logger.debug(f"Admin access granted via admin:* permission")
            return True
    
    # Database fallback: the session cache or JWT may have a stale/generic role
    # (e.g. "authenticated") while the actual role in the roles table is admin/superadmin.
    # Look up the canonical role via role_id -> roles.name.
    try:
        from supabase import create_client
        service_client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key
        )
        profile_result = service_client.table("user_profiles").select(
            "role_details:roles(name)"
        ).eq("id", user.id).single().execute()
        
        if profile_result.data:
            role_details = profile_result.data.get("role_details")
            if isinstance(role_details, dict):
                db_role = role_details.get("name", "")
                if db_role and db_role.lower() in admin_roles:
                    logger.info(
                        f"Admin access granted via database role lookup: {db_role} "
                        f"(cached role was '{user.role}')"
                    )
                    return True
    except Exception as e:
        logger.warning(f"Database role fallback check failed: {e}")
    
    return False


def require_admin_role():
    """
    Dependency factory for admin role verification.
    
    SECURITY: This replaces the previous email domain check (@j.ai) with
    proper role-based authorization checking the roles table and permissions.
    
    Usage:
        @router.get("/admin-endpoint")
        async def admin_endpoint(current_user: RequireAdmin):
            ...
    
    Or with explicit Depends:
        @router.get("/admin-endpoint")
        async def admin_endpoint(
            current_user: AuthenticatedUser = Depends(require_admin_role())
        ):
            ...
    
    Returns:
        Dependency function that validates admin access
    """
    async def admin_dependency(
        current_user: Annotated[AuthenticatedUser, Depends(get_current_user)]
    ) -> AuthenticatedUser:
        is_admin = await _verify_admin_role(current_user)
        
        if not is_admin:
            logger.warning(
                f"Admin access denied for user {current_user.email} "
                f"(role: {current_user.role}, permissions: {len(current_user.permissions or [])})"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin access required. You must have admin or superadmin role."
            )
        
        logger.info(f"Admin access granted for user {current_user.email} (role: {current_user.role})")
        return current_user
    
    return admin_dependency


# Type alias for cleaner endpoint signatures
# Usage: async def endpoint(current_user: RequireAdmin): ...
RequireAdmin = Annotated[AuthenticatedUser, Depends(require_admin_role())]

# Created and developed by Jai Singh
