# Created and developed by Jai Singh
"""
Rust Core Service Integration

High-performance Rust bindings for:
- JWT validation (cryptographic verification)
- Redis caching (with connection pooling)
- Database queries (compiled prepared statements)

This module provides a Python client that communicates with the Rust core
service via HTTP. When PyO3 bindings are available, it will use direct
Rust calls for maximum performance.
"""

import os
import httpx
import asyncio
from typing import Optional, Dict, Any, List
from functools import lru_cache
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)

# Try to import Rust bindings (future PyO3 implementation)
try:
    from rust_core_bindings import PyJwtValidator, PyCacheService, PyQueryExecutor
    RUST_BINDINGS_AVAILABLE = True
except ImportError:
    RUST_BINDINGS_AVAILABLE = False
    logger.info("Rust core bindings not available, using HTTP client")


@dataclass
class ValidationResult:
    """JWT validation result (basic)"""
    valid: bool
    user_id: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    permissions: Optional[List[str]] = None
    error: Optional[str] = None
    expires_at: Optional[int] = None


@dataclass
class AuthenticatedUserResult:
    """
    Complete authenticated user with profile data.
    
    This is the primary result type for the validate_token_with_profile method.
    Contains everything needed for authentication without additional database queries.
    """
    valid: bool
    cached: bool = False
    
    # User identity
    user_id: Optional[str] = None
    email: Optional[str] = None
    
    # Authorization
    role: Optional[str] = None
    permissions: Optional[List[str]] = None
    
    # Profile data
    organization_id: Optional[str] = None
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    department: Optional[str] = None
    job_title: Optional[str] = None
    status: Optional[str] = None
    
    # Token metadata
    expires_at: Optional[int] = None
    
    # Error handling
    error: Optional[str] = None


@dataclass
class WarehouseStats:
    """Warehouse statistics"""
    inbound_today: Optional[int] = None
    pending_tos: Optional[int] = None
    completed_today: Optional[int] = None
    pending_scans: Optional[int] = None
    pending_counts: Optional[int] = None


class RustCoreError(Exception):
    """Base exception for Rust Core client errors"""
    pass


class RustCoreConnectionError(RustCoreError):
    """Raised when unable to connect to Rust core service"""
    pass


class RustCoreValidationError(RustCoreError):
    """Raised when token validation fails"""
    pass


class RustCoreClient:
    """Unified client for Rust core services"""

    def __init__(
        self,
        base_url: Optional[str] = None,
        timeout: float = 5.0,
        retry_attempts: int = 2,
        retry_delay: float = 0.5,
    ):
        # Resolution order for the upstream URL:
        #   1. Explicit base_url passed by the caller (lifespan uses this)
        #   2. RUST_CORE_PRIVATE_URL (Railway internal DNS — preferred when set)
        #   3. RUST_CORE_URL (public Railway URL — default)
        self.base_url = (
            base_url
            or os.getenv("RUST_CORE_PRIVATE_URL")
            or os.getenv("RUST_CORE_URL", "https://rust-core-service-production.up.railway.app")
        )
        self.timeout = float(os.getenv("RUST_CORE_TIMEOUT", str(timeout)))
        self.retry_attempts = int(os.getenv("RUST_CORE_RETRY_ATTEMPTS", str(retry_attempts)))
        self.retry_delay = retry_delay
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client lazily"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
                headers={"Content-Type": "application/json"},
            )
        return self._client

    async def close(self):
        """Close the HTTP client"""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()

    def _set_auth(self, token: str):
        """Set authorization token for requests"""
        if self._client:
            self._client.headers["Authorization"] = f"Bearer {token}"

    async def _request_with_retry(
        self,
        method: str,
        path: str,
        **kwargs
    ) -> httpx.Response:
        """Execute HTTP request with retry logic"""
        client = await self._get_client()
        last_error = None
        
        for attempt in range(self.retry_attempts + 1):
            try:
                if method == "GET":
                    response = await client.get(path, **kwargs)
                elif method == "POST":
                    response = await client.post(path, **kwargs)
                elif method == "PUT":
                    response = await client.put(path, **kwargs)
                elif method == "DELETE":
                    response = await client.delete(path, **kwargs)
                else:
                    raise ValueError(f"Unsupported HTTP method: {method}")
                
                response.raise_for_status()
                return response
                
            except httpx.ConnectError as e:
                last_error = RustCoreConnectionError(
                    f"Cannot connect to Rust core service at {self.base_url}: {e}"
                )
                logger.warning(f"Rust core connection failed (attempt {attempt + 1}): {e}")
            except httpx.TimeoutException as e:
                last_error = RustCoreConnectionError(
                    f"Timeout connecting to Rust core service: {e}"
                )
                logger.warning(f"Rust core timeout (attempt {attempt + 1}): {e}")
            except httpx.HTTPStatusError as e:
                # Don't retry client errors (4xx), only server errors (5xx)
                if e.response.status_code < 500:
                    raise
                last_error = RustCoreError(f"Rust core service error: {e}")
                logger.warning(f"Rust core server error (attempt {attempt + 1}): {e}")
            
            if attempt < self.retry_attempts:
                await asyncio.sleep(self.retry_delay * (attempt + 1))
        
        raise last_error or RustCoreError("Unknown error")

    # Health
    async def health_check(self) -> Dict[str, Any]:
        """Check service health"""
        try:
            response = await self._request_with_retry("GET", "/api/v1/health")
            return response.json()
        except RustCoreError:
            return {"status": "unhealthy", "error": "Cannot connect to service"}

    async def detailed_health(self) -> Dict[str, Any]:
        """Get detailed health with component status"""
        response = await self._request_with_retry("GET", "/api/v1/health/detailed")
        return response.json()

    # Authentication
    async def validate_token(self, token: str) -> ValidationResult:
        """
        Validate JWT token using Rust (with signature verification)
        
        This provides cryptographic verification unlike the previous
        Python implementation that skipped signature verification.
        
        Raises:
            RustCoreConnectionError: If unable to connect to Rust service
                (httpx.ConnectError, httpx.TimeoutException, or other transport-level
                failures). The caller in supabase_auth.py turns these into a 503
                "Authentication service temporarily unavailable" response. If they
                are NOT wrapped here, the raw httpx exception escapes to the
                generic `except Exception` handler and surfaces as a misleading
                401 "Authentication failed" instead — see
                Debug/Fix-Rust-Core-Private-URL-IPv6-401-2026-05-22.md.
            RustCoreValidationError: If token validation fails
        """
        try:
            # Use a dedicated one-off client for auth calls to avoid mutating
            # the shared singleton client's headers (which caused 405 errors).
            async with httpx.AsyncClient(timeout=self.timeout) as auth_client:
                response = await auth_client.post(
                    f"{self.base_url}/api/v1/auth/validate",
                    json={"token": token},
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {token}",
                    },
                )
                response.raise_for_status()
            
            data = response.json()
            
            result = ValidationResult(
                valid=data.get("valid", False),
                user_id=data.get("user_id"),
                email=data.get("email"),
                role=data.get("role"),
                permissions=data.get("permissions"),
                error=data.get("error"),
                expires_at=data.get("expires_at"),
            )
            
            if not result.valid:
                logger.warning(f"Token validation failed: {result.error}")
            
            return result
            
        except httpx.HTTPStatusError as e:
            # Handle 401/403 from the Rust service
            if e.response.status_code in (401, 403):
                try:
                    error_data = e.response.json()
                    return ValidationResult(
                        valid=False,
                        error=error_data.get("error", "Token validation failed")
                    )
                except Exception:
                    return ValidationResult(
                        valid=False,
                        error=f"Token validation failed with status {e.response.status_code}"
                    )
            raise RustCoreValidationError(f"Validation request failed: {e}")
        except httpx.ConnectError as e:
            raise RustCoreConnectionError(
                f"Cannot connect to Rust core service at {self.base_url}: {e}"
            ) from e
        except httpx.TimeoutException as e:
            raise RustCoreConnectionError(
                f"Timeout connecting to Rust core service at {self.base_url}: {e}"
            ) from e
        except httpx.TransportError as e:
            # Catch-all for other transport-level failures (DNS, network, etc.)
            raise RustCoreConnectionError(
                f"Transport error to Rust core service at {self.base_url}: {e}"
            ) from e

    async def validate_token_with_profile(self, token: str) -> AuthenticatedUserResult:
        """
        Validate JWT token and return complete user profile with caching.
        
        This is the PRIMARY authentication method. It:
        1. Checks session cache first (fast path)
        2. On cache miss: validates JWT, fetches profile from DB, fetches permissions
        3. Caches the complete session for 15 minutes
        4. Returns everything needed without additional database queries
        
        This eliminates the need for Python to make separate Supabase calls.
        
        IMPORTANT: The user's JWT is forwarded in the Authorization header so the
        Rust service's require_auth middleware permits the request. The token is
        also sent in the JSON body for the validate_with_profile handler to process.
        
        Raises:
            RustCoreConnectionError: If unable to connect to Rust service
                (httpx.ConnectError, httpx.TimeoutException, or other transport-level
                failures). The caller in supabase_auth.py turns these into a 503
                "Authentication service temporarily unavailable" response. If they
                are NOT wrapped here, the raw httpx exception escapes to the
                generic `except Exception` handler and surfaces as a misleading
                401 "Authentication failed" instead — see
                Debug/Fix-Rust-Core-Private-URL-IPv6-401-2026-05-22.md.
        """
        try:
            # Use a dedicated one-off client for auth calls to avoid mutating
            # the shared singleton client's headers (which caused 405 errors).
            async with httpx.AsyncClient(timeout=self.timeout) as auth_client:
                response = await auth_client.post(
                    f"{self.base_url}/api/v1/auth/validate-with-profile",
                    json={"token": token},
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {token}",
                    },
                )
                response.raise_for_status()
            
            data = response.json()
            
            result = AuthenticatedUserResult(
                valid=data.get("valid", False),
                cached=data.get("cached", False),
                user_id=data.get("user_id"),
                email=data.get("email"),
                role=data.get("role"),
                permissions=data.get("permissions"),
                organization_id=data.get("organization_id"),
                full_name=data.get("full_name"),
                avatar_url=data.get("avatar_url"),
                department=data.get("department"),
                job_title=data.get("job_title"),
                status=data.get("status"),
                expires_at=data.get("expires_at"),
                error=data.get("error"),
            )
            
            if result.valid:
                cache_status = "cache hit" if result.cached else "cache miss"
                logger.debug(f"Token validated ({cache_status}) for user: {result.user_id}")
            else:
                logger.warning(f"Token validation failed: {result.error}")
            
            return result
            
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (401, 403):
                try:
                    error_data = e.response.json()
                    return AuthenticatedUserResult(
                        valid=False,
                        error=error_data.get("error", "Token validation failed")
                    )
                except Exception:
                    return AuthenticatedUserResult(
                        valid=False,
                        error=f"Token validation failed with status {e.response.status_code}"
                    )
            raise RustCoreValidationError(f"Validation request failed: {e}")
        except httpx.ConnectError as e:
            raise RustCoreConnectionError(
                f"Cannot connect to Rust core service at {self.base_url}: {e}"
            ) from e
        except httpx.TimeoutException as e:
            raise RustCoreConnectionError(
                f"Timeout connecting to Rust core service at {self.base_url}: {e}"
            ) from e
        except httpx.TransportError as e:
            # Catch-all for other transport-level failures (DNS, network, etc.)
            raise RustCoreConnectionError(
                f"Transport error to Rust core service at {self.base_url}: {e}"
            ) from e

    async def get_permissions(self, user_id: str) -> Dict[str, Any]:
        """Get user permissions"""
        response = await self._request_with_retry(
            "GET",
            f"/api/v1/auth/permissions/{user_id}"
        )
        return response.json()

    async def invalidate_session(
        self,
        user_id: Optional[str] = None,
        token_hash: Optional[str] = None,
        invalidate_all: bool = False
    ) -> Dict[str, Any]:
        """Invalidate user session(s)"""
        response = await self._request_with_retry(
            "POST",
            "/api/v1/auth/invalidate",
            json={
                "user_id": user_id,
                "token_hash": token_hash,
                "invalidate_all": invalidate_all,
            }
        )
        return response.json()

    # Cache
    async def cache_get(self, key: str) -> Optional[str]:
        """Get value from Redis cache"""
        response = await self._request_with_retry("GET", f"/api/v1/cache/{key}")
        data = response.json()
        return data.get("value") if data.get("found") else None

    async def cache_set(
        self,
        key: str,
        value: str,
        ttl_seconds: Optional[int] = None
    ) -> bool:
        """Set value in Redis cache"""
        response = await self._request_with_retry(
            "PUT",
            f"/api/v1/cache/{key}",
            json={"value": value, "ttl_seconds": ttl_seconds}
        )
        return response.json().get("success", False)

    async def cache_delete(self, key: str) -> bool:
        """Delete key from Redis cache"""
        response = await self._request_with_retry("DELETE", f"/api/v1/cache/{key}")
        return response.json().get("deleted", False)

    # Warehouse queries
    async def get_warehouse_stats(self) -> WarehouseStats:
        """Get warehouse statistics"""
        response = await self._request_with_retry("GET", "/api/v1/warehouse/stats")
        data = response.json()
        return WarehouseStats(**data)

    async def get_inbound_scans(
        self,
        limit: int = 100,
        offset: int = 0,
        user_id: Optional[str] = None,
        material_number: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get inbound scans with pagination"""
        params = {"limit": limit, "offset": offset}
        if user_id:
            params["user_id"] = user_id
        if material_number:
            params["material_number"] = material_number
        
        response = await self._request_with_retry(
            "GET",
            "/api/v1/warehouse/inbound-scans",
            params=params
        )
        return response.json()

    async def search_materials(
        self,
        query: str,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Search materials by number or description"""
        response = await self._request_with_retry(
            "GET",
            "/api/v1/warehouse/materials/search",
            params={"q": query, "limit": limit}
        )
        return response.json()

    # Generic query execution
    async def execute_query(
        self,
        query_name: str,
        parameters: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Execute a named query"""
        response = await self._request_with_retry(
            "POST",
            "/api/v1/query",
            json={
                "query_name": query_name,
                "parameters": parameters or {}
            }
        )
        return response.json()


# Singleton client instance
_client_instance: Optional[RustCoreClient] = None


def get_rust_client() -> RustCoreClient:
    """Get singleton Rust core client (sync access)"""
    global _client_instance
    if _client_instance is None:
        _client_instance = RustCoreClient()
    return _client_instance


async def get_rust_client_async() -> RustCoreClient:
    """Get singleton Rust core client (async access)"""
    global _client_instance
    if _client_instance is None:
        _client_instance = RustCoreClient()
    return _client_instance


async def init_rust_client(base_url: Optional[str] = None) -> RustCoreClient:
    """Initialize and return the Rust core client"""
    global _client_instance
    if _client_instance:
        await _client_instance.close()
    _client_instance = RustCoreClient(base_url=base_url)
    return _client_instance


async def close_rust_client():
    """Close the singleton Rust core client"""
    global _client_instance
    if _client_instance:
        await _client_instance.close()
        _client_instance = None


# Configuration helpers
def is_rust_core_enabled() -> bool:
    """Check if Rust core service is enabled for JWT validation"""
    return os.getenv("RUST_CORE_ENABLED", "true").lower() == "true"


def get_rust_core_url() -> str:
    """Get the Rust core service URL.

    Prefers RUST_CORE_PRIVATE_URL (Railway internal DNS) over RUST_CORE_URL
    (public) when set. See `RustCoreClient.__init__` for the rationale.
    """
    return (
        os.getenv("RUST_CORE_PRIVATE_URL")
        or os.getenv("RUST_CORE_URL", "https://rust-core-service-production.up.railway.app")
    )


# Graceful fallback wrapper
async def validate_token_with_fallback(
    token: str,
    fallback_fn=None
) -> ValidationResult:
    """
    Validate token using Rust service with fallback to Python.
    
    This allows gradual migration from Python to Rust validation.
    When RUST_CORE_ENABLED=true (default), uses Rust service.
    Falls back to provided function if Rust fails.
    """
    if is_rust_core_enabled():
        try:
            client = get_rust_client()
            return await client.validate_token(token)
        except RustCoreConnectionError as e:
            logger.error(f"Rust core service unavailable: {e}")
            if fallback_fn:
                logger.warning("Falling back to Python validation (INSECURE)")
        except Exception as e:
            logger.error(f"Rust validation error: {e}")
            if fallback_fn:
                logger.warning("Falling back to Python validation (INSECURE)")
    
    if fallback_fn:
        return await fallback_fn(token)
    
    # No fallback - fail securely
    raise RustCoreError(
        "Rust core service unavailable and no fallback configured. "
        "Set RUST_CORE_ENABLED=false to disable secure validation (not recommended)."
    )


# Export all public classes and functions
__all__ = [
    "RustCoreClient",
    "ValidationResult",
    "AuthenticatedUserResult",
    "WarehouseStats",
    "RustCoreError",
    "RustCoreConnectionError",
    "RustCoreValidationError",
    "get_rust_client",
    "get_rust_client_async",
    "init_rust_client",
    "close_rust_client",
    "is_rust_core_enabled",
    "get_rust_core_url",
    "validate_token_with_fallback",
]

# Created and developed by Jai Singh
