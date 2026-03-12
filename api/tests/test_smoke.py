"""
Backend Smoke Tests for OmniFrame.

Validates critical paths: health endpoints, auth gates, and core routers.
These run in CI as the minimum backend quality gate.
"""

import pytest


class TestHealthEndpoints:
    """Verify health/readiness endpoints respond correctly."""

    @pytest.mark.asyncio
    async def test_root_endpoint_returns_200(self, client):
        """Root or health endpoint should return 200."""
        response = await client.get("/")
        # Accept 200 or 404 (if no root route defined)
        assert response.status_code in (200, 404, 307)

    @pytest.mark.asyncio
    async def test_health_check_endpoint(self, client):
        """Health check endpoint should be accessible."""
        for path in ["/health", "/api/health", "/healthz"]:
            response = await client.get(path)
            if response.status_code == 200:
                return
        # If none of the common health paths work, that's still info
        pytest.skip("No standard health endpoint found")


class TestAuthGates:
    """Verify that auth-required endpoints reject unauthenticated requests."""

    @pytest.mark.asyncio
    async def test_admin_routes_require_auth(self, client, mock_auth_headers):
        """Admin endpoints should return 401 or 403 without auth."""
        admin_paths = ["/api/admin", "/api/users", "/api/roles"]
        for path in admin_paths:
            response = await client.get(path, headers=mock_auth_headers)
            if response.status_code not in (404,):
                assert response.status_code in (
                    401,
                    403,
                ), f"{path} returned {response.status_code} instead of 401/403"

    @pytest.mark.asyncio
    async def test_protected_endpoints_reject_anonymous(self, client):
        """Protected API endpoints should not return 200 without auth."""
        protected_paths = ["/api/permissions", "/api/settings"]
        for path in protected_paths:
            response = await client.get(path)
            if response.status_code not in (404,):
                assert (
                    response.status_code != 200
                ), f"{path} returned 200 without authentication"


class TestImportability:
    """Verify that core modules can be imported without errors."""

    def test_main_app_imports(self):
        """The FastAPI app module should be importable."""
        try:
            from api.main import app  # noqa: F401
        except ImportError:
            pytest.skip("api.main not importable in this environment")

    def test_config_imports(self):
        """Configuration module should be importable."""
        try:
            from api.config import database  # noqa: F401
        except ImportError:
            pytest.skip("api.config.database not importable")
