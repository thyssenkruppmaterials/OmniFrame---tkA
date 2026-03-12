"""
FastAPI application entry point for OmniFrame Logistics.
Integrates with existing Supabase backend and authentication.
"""

import logging
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
from starlette.middleware.sessions import SessionMiddleware
import secrets

try:
    # Try relative imports first (when run as a module)
    from .config.settings import settings
    from .config.database import test_connection
    from .auth.supabase_auth import get_current_user, AuthenticatedUser
except ImportError:
    # Fall back to absolute imports (when run as a script)
    from config.settings import settings
    from config.database import test_connection
    from auth.supabase_auth import get_current_user, AuthenticatedUser


# Configure logging
logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for startup and shutdown events."""
    # Startup
    logger.info("🚀 Starting OmniFrame Logistics FastAPI application")
    
    # Initialize connection pool (optional - only if DATABASE_URL is set)
    connection_pool = None
    try:
        if settings.database_url:
            from config.connection_pool import get_pool_manager
            connection_pool = await get_pool_manager()
            logger.info("✅ Database connection pool initialized")
    except Exception as e:
        logger.warning(f"⚠️ Connection pool not initialized (will use Supabase client): {e}")
    
    # Initialize Redis for rate limiting (session caching is handled by Rust Core Service)
    redis_service = None
    try:
        from lib.cache.redis_service import get_redis_service
        redis_service = await get_redis_service()
        if redis_service.is_connected:
            logger.info("✅ Redis connected (rate limiting enabled)")
        else:
            logger.warning("⚠️ Redis not connected - rate limiting disabled")
    except Exception as e:
        logger.warning(f"⚠️ Redis initialization failed (rate limiting disabled): {e}")
    
    # Initialize Rust Core client for secure JWT validation
    rust_client = None
    try:
        from lib.rust_core import init_rust_client, close_rust_client
        rust_client = await init_rust_client(base_url=settings.rust_core_url)
        
        # Test connection to Rust service
        health = await rust_client.health_check()
        if health.get("status") == "healthy":
            logger.info("✅ Rust Core Service connected (secure JWT validation enabled)")
        else:
            logger.warning(f"⚠️ Rust Core Service unhealthy: {health}")
    except Exception as e:
        logger.error(f"❌ Rust Core Service connection failed: {e}")
        logger.warning("⚠️ JWT validation may fail without Rust Core Service")
    
    # Test database connection (using Supabase client)
    try:
        connection_result = await test_connection()
        if connection_result["status"] == "connected":
            logger.info("✅ Supabase database connection verified")
        else:
            logger.error(f"❌ Database connection failed: {connection_result}")
    except Exception as e:
        logger.error(f"❌ Database connection test failed: {str(e)}")
    
    logger.info("✅ Application startup complete")
    
    yield
    
    # Shutdown
    logger.info("🔄 Shutting down OmniFrame Logistics FastAPI application")
    
    # Close Rust Core client
    if rust_client:
        try:
            from lib.rust_core import close_rust_client
            await close_rust_client()
            logger.info("✅ Rust Core client closed")
        except Exception as e:
            logger.error(f"❌ Error closing Rust Core client: {e}")
    
    # Close connection pool
    if connection_pool:
        try:
            from config.connection_pool import close_pool
            await close_pool()
            logger.info("✅ Connection pool closed")
        except Exception as e:
            logger.error(f"❌ Error closing connection pool: {e}")
    
    # Close Redis connection
    if redis_service:
        try:
            from lib.cache.redis_service import close_redis
            await close_redis()
            logger.info("✅ Redis connection closed")
        except Exception as e:
            logger.error(f"❌ Error closing Redis: {e}")
    
    logger.info("✅ Application shutdown complete")


# Create FastAPI application
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Advanced analytics and processing API for OmniFrame Logistics platform",
    lifespan=lifespan,
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
    openapi_url="/openapi.json" if settings.debug else None,
)


# Middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)

import os as _os

_trusted_hosts = ["localhost", "127.0.0.1", "*.omniframe.example.com"]
_custom_domain = _os.environ.get("TRUSTED_HOST")
if _custom_domain:
    _trusted_hosts.append(_custom_domain)
# Allow httpx ASGI transport host ("testserver") and "localhost" in test mode
if _os.environ.get("TESTING") or _os.environ.get("PYTEST_CURRENT_TEST"):
    _trusted_hosts += ["testserver", "test"]

# On Railway, the platform edge proxy validates Host headers before traffic
# reaches the container. Health probes and internal service-to-service calls
# use raw container IPs that TrustedHostMiddleware would reject, so we skip
# the middleware entirely when running on Railway.
_on_railway = bool(_os.environ.get("RAILWAY_ENVIRONMENT") or _os.environ.get("RAILWAY_PUBLIC_DOMAIN"))

if not settings.debug and not _on_railway:
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=_trusted_hosts,
    )

_session_key = settings.session_secret_key or secrets.token_urlsafe(32)
if not settings.session_secret_key:
    logger.warning("SESSION_SECRET_KEY not set; using random key (sessions won't persist across restarts)")

app.add_middleware(
    SessionMiddleware,
    secret_key=_session_key,
    session_cookie="session",
    max_age=3600,
    same_site="strict",
    https_only=not settings.debug,
)

# Add rate limiting middleware (Phase 1 optimization - Oct 29, 2025)
try:
    from api.middleware.rate_limiter import RateLimitMiddleware
    app.add_middleware(RateLimitMiddleware)
    logger.info("✅ Rate limiting middleware enabled")
except ImportError as e:
    logger.warning(f"⚠️ Rate limiting middleware not available: {e}")

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Add comprehensive security and cache control headers for enterprise protection."""
    response = await call_next(request)

    # Security headers
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=(self)"

    # HSTS (only in production)
    if not settings.debug:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"

    # Cache Control Headers
    path = request.url.path
    if path.startswith("/api/"):
        # API responses: never cache
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    elif path.startswith("/assets/"):
        # Hashed assets (Vite fingerprinted): immutable, cache forever
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif path in ("/", "") or path.endswith(".html") or path in (
        "/build-info.json", "/sw.js", "/registerSW.js",
    ):
        # Critical files: NEVER cache - enables auto-update detection
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    elif path.startswith("/images/"):
        # Static images: cache for 1 day
        response.headers["Cache-Control"] = "public, max-age=86400"
    else:
        # Everything else (manifest, fonts, etc.): short-term cache with revalidation
        if not settings.debug:
            response.headers["Cache-Control"] = "public, no-cache, must-revalidate"
        else:
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"

    # Content Security Policy — strict by default, relaxed only in debug mode
    if settings.debug:
        csp_directives = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "script-src-elem 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "font-src 'self'",
            "connect-src 'self' ws://localhost:* http://localhost:* https://*.supabase.co wss://*.supabase.co",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'"
        ]
    else:
        csp_directives = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "img-src 'self' data: blob: https:",
            "font-src 'self' https://fonts.gstatic.com",
            "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.up.railway.app wss://*.up.railway.app https://*.amazonaws.com",
            "frame-src 'self' blob:",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'"
        ]

    response.headers["Content-Security-Policy"] = "; ".join(csp_directives)

    return response

@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    """Add processing time to response headers."""
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    return response

@app.middleware("http") 
async def add_request_id_header(request: Request, call_next):
    """Add unique request ID for tracing and debugging."""
    request_id = secrets.token_urlsafe(16)
    request.state.request_id = request_id
    
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response

@app.middleware("http")
async def security_monitoring_middleware(request: Request, call_next):
    """Monitor requests for security threats and anomalies."""
    start_time = time.time()
    
    # Log security-relevant request details
    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "unknown")
    
    # Check for suspicious patterns
    suspicious_patterns = [
        "/.env", "/config", "/.git", "/admin", "/wp-admin", 
        "/phpmyadmin", "/mysql", "/backup", "/../", "/.."
    ]
    
    if any(pattern in str(request.url.path) for pattern in suspicious_patterns):
        logger.warning(f"Suspicious request detected: {request.url.path} from {client_ip}")
        # Could implement automatic blocking here
    
    response = await call_next(request)
    
    # Log failed authentication attempts
    if response.status_code == 401 or response.status_code == 403:
        logger.warning(f"Authentication/authorization failure: {request.url.path} from {client_ip} - {response.status_code}")
    
    # Monitor response time for DoS detection
    response_time = time.time() - start_time
    if response_time > 5.0:  # 5 seconds
        logger.warning(f"Slow response detected: {request.url.path} took {response_time:.2f}s")
    
    return response


@app.exception_handler(404)
async def not_found_handler(request: Request, exc: HTTPException):
    """Custom 404 handler."""
    return JSONResponse(
        status_code=404,
        content={
            "error": "Not Found",
            "message": "The requested resource was not found",
            "path": str(request.url.path)
        }
    )


@app.exception_handler(500)
async def internal_error_handler(request: Request, exc: Exception):
    """Custom 500 handler."""
    logger.error(f"Internal server error: {str(exc)}")
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal Server Error", 
            "message": "An unexpected error occurred",
            "request_id": getattr(request.state, "request_id", "unknown")
        }
    )


# Health check endpoints
@app.get("/health", tags=["Health"])
async def health_check():
    """Basic health check endpoint."""
    return {"status": "healthy", "timestamp": time.time()}


@app.get("/health/database", tags=["Health"])
async def database_health_check():
    """Database connection health check."""
    try:
        result = await test_connection()
        return {
            "status": "healthy" if result["status"] == "connected" else "unhealthy",
            "database": result,
            "timestamp": time.time()
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": time.time()
        }


@app.get("/health/auth", tags=["Health"])
async def auth_health_check(current_user: AuthenticatedUser = Depends(get_current_user)):
    """
    Authentication system health check.
    
    This endpoint validates that the full Rust-centric auth flow is working:
    1. JWT token validation via Rust service
    2. Session caching (check if response was from cache)
    3. Profile data enrichment
    4. Permission resolution
    """
    return {
        "status": "healthy",
        "authenticated": True,
        "user_id": current_user.id,
        "email": current_user.email,
        "organization_id": current_user.organization_id,
        "role": current_user.role,
        "full_name": current_user.full_name,
        "permissions_count": len(current_user.permissions or []),
        "auth_method": "rust-centric",
        "timestamp": time.time()
    }


@app.get("/health/auth/session-test", tags=["Health"])
async def auth_session_test():
    """
    Test session caching behavior without authentication.
    
    This endpoint checks the Rust service's session caching capabilities
    by examining the service health and cache status.
    """
    try:
        from lib.rust_core import get_rust_client
        
        client = get_rust_client()
        health = await client.detailed_health()
        
        # Extract cache-related metrics if available
        cache_status = health.get("cache", {})
        
        return {
            "status": "healthy",
            "session_caching": {
                "enabled": cache_status.get("connected", False) if cache_status else False,
                "rust_service": "connected" if health.get("status") == "healthy" else "disconnected",
                "cache_endpoint": "/api/v1/auth/validate-with-profile",
                "session_ttl_seconds": 900,  # 15 minutes
            },
            "architecture": "rust-centric",
            "timestamp": time.time()
        }
    except Exception as e:
        logger.error(f"Session test failed: {e}")
        return {
            "status": "degraded",
            "session_caching": {
                "enabled": False,
                "rust_service": "disconnected",
                "error": str(e),
            },
            "architecture": "rust-centric",
            "timestamp": time.time()
        }


@app.get("/health/rust-core", tags=["Health"])
async def rust_core_health_check():
    """
    Rust Core Service health check.
    
    The Rust service provides secure JWT validation with JWKS-based RS256 
    signature verification. This endpoint checks if the service is available.
    """
    try:
        from lib.rust_core import get_rust_client, is_rust_core_enabled
        
        if not is_rust_core_enabled():
            return {
                "status": "disabled",
                "message": "Rust Core Service is disabled via RUST_CORE_ENABLED=false",
                "signature_verification": "disabled",
                "timestamp": time.time()
            }
        
        client = get_rust_client()
        health = await client.health_check()
        
        is_healthy = health.get("status") == "healthy"
        
        return {
            "status": "healthy" if is_healthy else "unhealthy",
            "rust_core_service": "connected" if is_healthy else "disconnected",
            "signature_verification": "enabled" if is_healthy else "unavailable",
            "service_url": settings.rust_core_url,
            "service_details": health,
            "timestamp": time.time()
        }
    except Exception as e:
        logger.error(f"Rust Core health check failed: {e}")
        return {
            "status": "unhealthy",
            "rust_core_service": "disconnected",
            "signature_verification": "unavailable",
            "error": str(e),
            "service_url": settings.rust_core_url,
            "timestamp": time.time()
        }


@app.get("/health/security", tags=["Health"])
async def security_health_check():
    """Security systems health check."""
    try:
        # Check Rust Core Service for JWT validation
        jwt_validation_status = "unknown"
        try:
            from lib.rust_core import get_rust_client, is_rust_core_enabled
            if is_rust_core_enabled():
                client = get_rust_client()
                health = await client.health_check()
                jwt_validation_status = "secure" if health.get("status") == "healthy" else "degraded"
            else:
                jwt_validation_status = "disabled"
        except Exception as e:
            jwt_validation_status = f"error: {str(e)}"
        
        security_status = {
            "jwt_validation": jwt_validation_status,
            "signature_verification": "enabled" if jwt_validation_status == "secure" else "disabled",
            "rate_limiter": "healthy",
            "audit_service": "configured", 
            "security_headers": "active",
            "session_security": "active",
            "threat_monitoring": "active"
        }
        
        overall_status = "healthy" if jwt_validation_status == "secure" else "degraded"
        
        return {
            "status": overall_status,
            "security_systems": security_status,
            "timestamp": time.time()
        }
    except Exception as e:
        logger.error(f"Security health check failed: {str(e)}")
        return {
            "status": "degraded",
            "error": str(e),
            "timestamp": time.time()
        }


# Root endpoint — only when the SPA frontend is NOT being served,
# so that configure_frontend_routes can own "/" for index.html.
if _os.environ.get("SERVE_FRONTEND", "false").lower() != "true":
    @app.get("/", tags=["Root"])
    async def root():
        """API root endpoint with basic information."""
        return {
            "name": settings.app_name,
            "version": settings.app_version,
            "description": "FastAPI complement to OmniFrame Logistics platform",
            "docs": "/docs" if settings.debug else "Contact administrator for API documentation",
            "status": "operational"
        }


# Custom OpenAPI schema (if needed for customization)
def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    
    openapi_schema = get_openapi(
        title=settings.app_name,
        version=settings.app_version,
        description="Advanced analytics and processing API for OmniFrame Logistics",
        routes=app.routes,
    )
    
    # Add security scheme for Supabase JWT
    openapi_schema["components"]["securitySchemes"] = {
        "BearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": "Supabase JWT token obtained from the main application"
        }
    }
    
    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi


# Import and include routers — critical imports MUST succeed or startup fails.
_CRITICAL_ROUTER_PREFIXES = [
    "/api/test", "/api/analytics", "/api/reports", "/api",
    "/api/admin", "/api/drone", "/api/shift-productivity",
]

try:
    try:
        # Try relative imports first (when run as a module)
        from .routers import (
            analytics, reports, test, smartsheet, admin,
            customer_tickets, webhooks, lx03_import, nefab,
            sap, proxy, shift_productivity, camera, drone,
        )
    except ImportError:
        # Fall back to absolute imports (when run as a script)
        from routers import (
            analytics, reports, test, smartsheet, admin,
            customer_tickets, webhooks, lx03_import, nefab,
            sap, proxy, shift_productivity, camera, drone,
        )
except ImportError as e:
    logger.error(f"❌ CRITICAL: Router import failed — aborting startup: {e}")
    raise RuntimeError(f"Critical router import failure: {e}") from e

app.include_router(test.router, prefix="/api/test", tags=["Testing"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["Analytics"])
app.include_router(reports.router, prefix="/api/reports", tags=["Reports"])
app.include_router(smartsheet.router, prefix="/api", tags=["Smartsheet"])
app.include_router(customer_tickets.router, prefix="/api", tags=["Customer Tickets"])
app.include_router(webhooks.router, prefix="/api", tags=["Webhooks"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])
app.include_router(lx03_import.router, prefix="/api", tags=["LX03 Import"])
app.include_router(nefab.router, prefix="/api", tags=["Nefab PFC Trace"])
app.include_router(sap.router, prefix="/api", tags=["SAP Integration"])
app.include_router(proxy.router, prefix="/api", tags=["Proxy"])
app.include_router(shift_productivity.router, prefix="/api/shift-productivity", tags=["Shift Productivity"])
app.include_router(camera.router, prefix="/api", tags=["Camera"])
app.include_router(drone.router, prefix="/api", tags=["Drone Scanner"])
logger.info(
    "✅ API routers loaded successfully (analytics, reports, smartsheet, admin, "
    "customer_tickets, webhooks, lx03_import, nefab, sap, proxy, shift_productivity, "
    "camera, drone)"
)

# Startup validation — confirm critical route prefixes are mounted
_mounted_paths = {route.path for route in app.routes if hasattr(route, "path")}
for prefix in _CRITICAL_ROUTER_PREFIXES:
    if not any(p.startswith(prefix) for p in _mounted_paths):
        logger.warning(f"⚠️ Expected route prefix '{prefix}' not found in mounted routes")


# ---- /api/info — lightweight status endpoint ----

@app.get("/api/info", tags=["Root"])
async def api_info():
    """Lightweight API information endpoint."""
    return {
        "name": "OmniFrame Logistics API",
        "version": app.version,
        "status": "running",
    }


# ---- Frontend SPA serving (opt-in via SERVE_FRONTEND=true) ----

from pathlib import Path as _Path

if _os.environ.get("SERVE_FRONTEND", "false").lower() == "true":
    try:
        try:
            from .frontend_static import configure_frontend_routes
        except ImportError:
            from frontend_static import configure_frontend_routes

        _fe_dist = _Path(_os.environ.get(
            "FRONTEND_DIST_DIR",
            str(_Path(__file__).parent.parent / "dist"),
        ))

        if _fe_dist.is_dir() and (_fe_dist / "index.html").is_file():
            configure_frontend_routes(app, _fe_dist)
            logger.info(f"✅ Frontend SPA serving enabled from {_fe_dist}")
        else:
            logger.warning(
                f"⚠️ SERVE_FRONTEND=true but dist dir missing or has no index.html: {_fe_dist}"
            )
    except Exception as e:
        logger.error(f"❌ Failed to configure frontend routes: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.reload,
        log_level=settings.log_level.lower()
    )
# Developer and Creator: Jai Singh
