# Created and developed by Jai Singh
"""
FastAPI application settings and configuration.
Integrates with existing Supabase infrastructure.
"""

import os
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


def _get_supabase_url() -> str:
    """Get Supabase URL from various environment variable formats."""
    return (
        os.environ.get("API_SUPABASE_URL") or 
        os.environ.get("SUPABASE_URL") or 
        os.environ.get("VITE_SUPABASE_URL") or 
        ""
    )


def _get_supabase_read_url() -> str:
    """Get optional Supabase read-replica URL (load-balanced endpoint).
    Falls back to the primary URL when no read replica is configured so that
    `db.read_client` always returns a working client. The load-balanced URL
    (e.g. ``https://<ref>-all.supabase.co``) routes writes to primary and
    reads to replicas transparently."""
    return (
        os.environ.get("API_SUPABASE_READ_URL")
        or os.environ.get("SUPABASE_READ_URL")
        or os.environ.get("VITE_SUPABASE_READ_URL")
        or _get_supabase_url()
    )


def _get_supabase_anon_key() -> str:
    """Get Supabase anon key from various environment variable formats."""
    return (
        os.environ.get("API_SUPABASE_ANON_KEY") or 
        os.environ.get("SUPABASE_ANON_KEY") or 
        os.environ.get("VITE_SUPABASE_ANON_KEY") or 
        ""
    )


def _get_supabase_service_role_key() -> Optional[str]:
    """Get Supabase service role key from various environment variable formats."""
    return (
        os.environ.get("API_SUPABASE_SERVICE_ROLE_KEY") or 
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    )


def _resolve_env_file() -> str:
    """Pick the env file: prefer .env.test when running under pytest."""
    import pathlib

    if os.environ.get("TESTING") or os.environ.get("PYTEST_CURRENT_TEST"):
        candidates = [".env.test", "../.env.test"]
        for c in candidates:
            if pathlib.Path(c).is_file():
                return c
    return ".env"


class Settings(BaseSettings):
    """Application settings with environment variable support."""
    
    # Use Pydantic v2 settings config
    model_config = SettingsConfigDict(
        env_file=_resolve_env_file(),
        env_file_encoding="utf-8",
        env_prefix="API_",
        case_sensitive=False,
        extra="ignore",  # Ignore extra environment variables
    )
    
    # Application
    app_name: str = "OneBox AI Logistics API"
    app_version: str = "1.0.0"
    debug: bool = False
    
    # Environment identification
    # Supports API_ENVIRONMENT or ENVIRONMENT env var; defaults to "development"
    environment: str = os.environ.get("API_ENVIRONMENT") or os.environ.get("ENVIRONMENT") or "development"
    
    # Server
    host: str = "0.0.0.0"
    port: int = int(os.environ.get("PORT", "8000"))
    reload: bool = False
    
    # Supabase Configuration (matches existing frontend)
    # Supports API_SUPABASE_URL, SUPABASE_URL, or VITE_SUPABASE_URL
    supabase_url: str = _get_supabase_url()
    # Optional read-replica routing URL (load-balanced endpoint). Falls back to
    # supabase_url when not configured. See `api/config/database.py::SupabaseConnection.read_client`.
    supabase_read_url: str = _get_supabase_read_url()
    supabase_anon_key: str = _get_supabase_anon_key()
    supabase_service_role_key: Optional[str] = _get_supabase_service_role_key()
    
    # Database
    database_url: Optional[str] = None  # Optional direct PostgreSQL connection
    
    # Frontend URL (used for Supabase auth email redirect links)
    frontend_url: str = os.environ.get("FRONTEND_URL") or os.environ.get("VITE_APP_URL") or "http://localhost:5173"

    # Authentication
    # NOTE: JWT validation and session caching are handled by Rust Core Service
    # These settings are kept for fallback mode only
    jwt_secret_key: str = os.environ.get("JWT_SECRET_KEY", "")  # Only used in Python fallback mode
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    
    # External Integrations
    fedex_api_key: Optional[str] = None
    ups_api_key: Optional[str] = None
    
    # Smartsheet Configuration
    smartsheet_access_token: str = os.environ.get("SMARTSHEET_ACCESS_TOKEN", "")
    smartsheet_max_retry_time: int = 60
    smartsheet_max_connections: int = 10
    smartsheet_cache_ttl: int = 300
    smartsheet_default_page_size: int = 100
    smartsheet_rate_limit_per_second: int = 10
    
    # Nefab PFC Trace API Configuration
    nefab_api_url: str = "https://my.nefab.com/pfctrace/api/v5.0"
    nefab_api_key: str = os.environ.get("NEFAB_API_KEY", "")
    nefab_cache_ttl: int = 60  # 60 seconds cache for real-time updates
    nefab_max_connections: int = 5
    
    # Redis for rate limiting (session caching is handled by Rust Core Service)
    redis_url: str = os.environ.get("REDIS_URL", "redis://localhost:6379")
    redis_max_connections: int = 50
    redis_socket_keepalive: bool = True
    redis_socket_connect_timeout: int = 5
    redis_retry_on_timeout: bool = True
    
    # Rust Core Service Configuration
    # The Rust service provides secure JWT validation with JWKS-based RS256 verification
    # Default to Railway production service URL for development convenience
    rust_core_url: str = os.getenv("RUST_CORE_URL", "https://rust-core-service-production.up.railway.app")
    # OPTIONAL — Railway internal hostname (e.g.
    # `http://rust-core-service.railway.internal:8010`). When set, this is
    # preferred over `rust_core_url` to avoid the public edge proxy + TLS
    # handshake hop on every call. See api/main.py lifespan for the boot
    # rationale (3/4 uvicorn workers were timing out their cold-start
    # health probe against the public URL in parallel).
    rust_core_private_url: str = os.getenv("RUST_CORE_PRIVATE_URL", "")
    rust_core_timeout: float = float(os.getenv("RUST_CORE_TIMEOUT", "10.0"))  # Increased for network latency
    rust_core_enabled: bool = os.getenv("RUST_CORE_ENABLED", "true").lower() == "true"
    rust_core_retry_attempts: int = int(os.getenv("RUST_CORE_RETRY_ATTEMPTS", "3"))
    # SECURITY: Fallback is DISABLED by default. When enabled, JWT tokens are decoded
    # WITHOUT cryptographic signature verification - tokens can be forged!
    # Only enable for local development with: RUST_CORE_FALLBACK=true
    rust_core_fallback: bool = os.getenv("RUST_CORE_FALLBACK", "false").lower() == "true"
    # SECURITY: Second gate for insecure JWT fallback. Both this AND rust_core_fallback
    # must be true, AND environment must be "local", for fallback to activate.
    allow_insecure_jwt_fallback: bool = os.getenv("ALLOW_INSECURE_JWT_FALLBACK", "false").lower() == "true"
    
    # Session
    session_secret_key: str = os.getenv("SESSION_SECRET_KEY", "")
    
    # Logging
    log_level: str = "INFO"

    # Railway Monitoring (server-only -- token never exposed to the frontend)
    railway_api_token: str = os.getenv("RAILWAY_API_TOKEN", "")
    railway_project_id: str = os.getenv("RAILWAY_PROJECT_ID", "fac8472c-199b-41ec-8806-a869ee96e783")
    railway_environment_name: str = os.getenv("RAILWAY_ENVIRONMENT_NAME", "production")
    railway_api_url: str = "https://backboard.railway.com/graphql/v2"

    def validate_required_settings(self) -> list[str]:
        """Validate that required settings are configured. Returns list of missing settings."""
        missing = []
        if not self.supabase_url:
            missing.append("SUPABASE_URL (or API_SUPABASE_URL or VITE_SUPABASE_URL)")
        if not self.supabase_anon_key:
            missing.append("SUPABASE_ANON_KEY (or API_SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY)")
        return missing

    @property
    def is_configured(self) -> bool:
        """Check if minimum required settings are configured."""
        return bool(self.supabase_url and self.supabase_anon_key)

    @property
    def cors_origins(self) -> list[str]:
        """CORS origins for frontend integration."""
        if self.debug:
            return [
                "http://localhost:5173",
                "http://localhost:3000",
                "http://127.0.0.1:5173",
                "http://127.0.0.1:3000",
            ]
        origins = [
            "https://onebox-ai-logistics-production.up.railway.app",
        ]
        extra = os.environ.get("CORS_EXTRA_ORIGINS", "")
        if extra:
            origins.extend(o.strip() for o in extra.split(",") if o.strip())
        return origins

# Global settings instance
settings = Settings()

# Created and developed by Jai Singh
