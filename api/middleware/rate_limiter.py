"""
Rate Limiting Middleware
Protects API endpoints from abuse using Redis

Author: Jai Singh
Date: October 29, 2025
Version: 1.0.0
"""

from fastapi import Request, HTTPException, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from typing import Callable
import logging

from ..lib.cache.redis_service import get_redis_service

logger = logging.getLogger(__name__)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Rate limiting middleware using Redis
    
    Limits:
    - General endpoints: 100 requests per minute per IP
    - Auth endpoints: 10 requests per minute per IP
    - Failed auth: 5 attempts per 10 minutes per IP
    """
    
    def __init__(self, app):
        super().__init__(app)
        self.redis_service = None
        
        # Rate limit configurations
        self.limits = {
            'default': {'requests': 100, 'window': 60},        # 100 req/min
            'auth': {'requests': 10, 'window': 60},             # 10 req/min for auth
            'auth_fail': {'requests': 5, 'window': 600},        # 5 failed attempts/10min
            'public_ticket': {'requests': 12, 'window': 60},    # 12 req/min for public ticket endpoints
        }
    
    # Paths exempt from fail-closed behavior (health checks must work even when Redis is down)
    EXEMPT_PATHS = ('/health', '/health/')
    
    def _is_exempt_path(self, path: str) -> bool:
        """Check if the request path is exempt from fail-closed rate limiting."""
        return path == '/health' or path.startswith('/health/')
    
    async def dispatch(self, request: Request, call_next: Callable):
        """Process request with rate limiting"""
        
        endpoint_path = request.url.path
        
        # Initialize Redis service if needed
        if self.redis_service is None:
            try:
                self.redis_service = await get_redis_service()
            except Exception as e:
                logger.error(f"Redis unavailable for rate limiting: {e}")
                # Allow health checks through even when Redis is down
                if self._is_exempt_path(endpoint_path):
                    return await call_next(request)
                # Fail-closed: return 503 when rate limiting backend is unavailable
                return JSONResponse(
                    status_code=503,
                    content={"detail": "Service temporarily unavailable - rate limiting backend error"},
                    headers={"Retry-After": "30"},
                )
        
        # Get client identifier (IP address)
        client_ip = self._get_client_ip(request)
        
        # Determine rate limit based on endpoint
        limit_config = self._get_limit_config(endpoint_path)
        
        # Check rate limit
        identifier = f"{client_ip}:{endpoint_path}"
        
        try:
            is_allowed = await self.redis_service.check_rate_limit(
                identifier=identifier,
                max_requests=limit_config['requests'],
                window_seconds=limit_config['window']
            )
            
            if not is_allowed:
                logger.warning(
                    f"Rate limit exceeded for {client_ip} on {endpoint_path}"
                )
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "error": "Rate limit exceeded",
                        "message": f"Too many requests. Please try again later.",
                        "retry_after": limit_config['window']
                    }
                )
            
            # Process request
            response = await call_next(request)
            
            # Track failed auth attempts
            if endpoint_path.startswith('/auth/') and response.status_code == 401:
                await self._track_failed_auth(client_ip)
            
            return response
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Rate limiter error: {e}")
            # Allow health checks through even on rate limiter errors
            if self._is_exempt_path(endpoint_path):
                return await call_next(request)
            # Fail-closed: return 503 when rate limiting backend errors
            return JSONResponse(
                status_code=503,
                content={"detail": "Service temporarily unavailable - rate limiting backend error"},
                headers={"Retry-After": "30"},
            )
    
    def _get_client_ip(self, request: Request) -> str:
        """Extract client IP address from request"""
        # Check for forwarded IP (behind proxy/load balancer)
        forwarded = request.headers.get('X-Forwarded-For')
        if forwarded:
            return forwarded.split(',')[0].strip()
        
        real_ip = request.headers.get('X-Real-IP')
        if real_ip:
            return real_ip
        
        # Fallback to direct connection IP
        if request.client:
            return request.client.host
        
        return 'unknown'
    
    def _get_limit_config(self, endpoint_path: str) -> dict:
        """Get rate limit configuration for endpoint"""
        # Auth endpoints
        if any(endpoint_path.startswith(path) for path in [
            '/auth/',
            '/api/auth/',
            '/login',
            '/signup'
        ]):
            return self.limits['auth']
        
        # Public-facing ticket endpoints: tighter limits to prevent abuse
        if any(endpoint_path.startswith(path) for path in [
            '/api/customer-tickets/updates',
            '/customer-tickets/updates',
        ]):
            return self.limits['public_ticket']
        
        # Default for all other endpoints
        return self.limits['default']
    
    async def _track_failed_auth(self, client_ip: str) -> None:
        """Track failed authentication attempts"""
        try:
            identifier = f"auth_fail:{client_ip}"
            
            # Check if too many failures
            is_allowed = await self.redis_service.check_rate_limit(
                identifier=identifier,
                max_requests=self.limits['auth_fail']['requests'],
                window_seconds=self.limits['auth_fail']['window']
            )
            
            if not is_allowed:
                logger.warning(
                    f"Too many failed auth attempts from {client_ip} - "
                    f"consider temporary IP ban"
                )
                
        except Exception as e:
            logger.error(f"Failed auth tracking error: {e}")


# FastAPI dependency for route-specific rate limiting
async def check_rate_limit_dependency(
    request: Request,
    max_requests: int = 100,
    window_seconds: int = 60
):
    """
    Dependency for applying rate limits to specific routes
    
    Usage:
        @router.post("/expensive-operation")
        async def expensive_op(
            _: None = Depends(
                lambda req: check_rate_limit_dependency(req, max_requests=10, window_seconds=60)
            )
        ):
            # This endpoint limited to 10 requests per minute
            return {"status": "ok"}
    """
    try:
        redis_service = await get_redis_service()
        client_ip = request.client.host if request.client else 'unknown'
        
        identifier = f"{client_ip}:{request.url.path}"
        
        is_allowed = await redis_service.check_rate_limit(
            identifier=identifier,
            max_requests=max_requests,
            window_seconds=window_seconds
        )
        
        if not is_allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Rate limit check error: {e}")
        # Fail-closed: block request when rate limiting backend is unavailable
        raise HTTPException(
            status_code=503,
            detail="Service temporarily unavailable",
        )

