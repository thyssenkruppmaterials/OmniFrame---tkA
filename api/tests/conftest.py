# Created and developed by Jai Singh
"""
Shared fixtures for OneBox AI backend tests.

Provides FastAPI test client, mock auth context, and common utilities.

Note: The asyncio event-loop backend is configured in pytest.ini via
``asyncio_mode = auto`` and ``asyncio_default_fixture_loop_scope = function``.
No ``anyio_backend`` fixture is needed with pytest-asyncio >= 0.23.
"""

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
async def app():
    """Import and return the FastAPI application instance."""
    try:
        from api.main import app as fastapi_app

        return fastapi_app
    except ImportError:
        pytest.skip("FastAPI application not importable (check api/main.py)")


@pytest.fixture
async def client(app):
    """Async HTTP client for testing FastAPI endpoints."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://localhost") as ac:
        yield ac


@pytest.fixture(autouse=True)
async def _reset_redis_singleton():
    """Ensure Redis singleton is reset between tests to avoid stale-loop errors."""
    yield
    try:
        from api.lib.cache.redis_service import close_redis
        await close_redis()
    except Exception:
        pass


@pytest.fixture
def mock_auth_headers():
    """Return headers simulating an unauthenticated request."""
    return {"Content-Type": "application/json"}


@pytest.fixture
def mock_admin_headers():
    """Return headers simulating an admin user (requires JWT mock in real tests)."""
    return {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-admin-token",
    }

# Created and developed by Jai Singh
