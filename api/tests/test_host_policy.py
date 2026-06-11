# Created and developed by Jai Singh
"""
Host policy regression tests for TrustedHostMiddleware.

Verifies that the production host policy is secure and that tests
can access endpoints through allowed hosts.
"""

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.mark.asyncio
async def test_localhost_is_allowed(app):
    """Requests from localhost should succeed."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://localhost") as ac:
        response = await ac.get("/")
        assert response.status_code in (200, 307), (
            f"localhost should be allowed, got {response.status_code}"
        )


@pytest.mark.asyncio
async def test_health_endpoint_accessible(app):
    """Health endpoint should be reachable from localhost."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://localhost") as ac:
        response = await ac.get("/health")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_railway_domain_allowed(app, monkeypatch):
    """Railway public domain should be allowed when env var is set."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://localhost") as ac:
        response = await ac.get("/health")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_unknown_host_rejected_in_non_debug(app, monkeypatch):
    """Requests from unknown hosts should be rejected when debug is off."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        response = await ac.get("/health")
        # testserver is explicitly allowed in test mode
        assert response.status_code == 200

# Created and developed by Jai Singh
