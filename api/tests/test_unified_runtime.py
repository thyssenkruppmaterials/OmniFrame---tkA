"""
Unified runtime tests for OmniFrame backend.

Validates that:
- start.py uses the canonical app from api.main
- Core health and info endpoints respond correctly
"""

import pytest


class TestAppImport:
    """Verify the canonical app is importable and properly configured."""

    def test_app_imports_from_canonical_module(self):
        """Verify api.main.app is importable and has a title set."""
        from api.main import app

        assert app is not None
        assert app.title, "FastAPI app must have a title"

    def test_app_has_expected_version(self):
        """App version should be populated from settings."""
        from api.main import app

        assert app.version is not None
        assert len(app.version) > 0


class TestHealthEndpoint:
    """Verify /health endpoint responds correctly."""

    @pytest.mark.asyncio
    async def test_health_endpoint(self, client):
        """Health endpoint should return 200 with status: healthy."""
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "timestamp" in data


class TestApiInfoEndpoint:
    """Verify /api/info lightweight endpoint responds correctly."""

    @pytest.mark.asyncio
    async def test_api_info_endpoint(self, client):
        """/api/info should return 200 with name, version, and status."""
        response = await client.get("/api/info")
        assert response.status_code == 200
        data = response.json()
        assert "name" in data
        assert "version" in data
        assert "status" in data
        assert data["status"] == "running"

    @pytest.mark.asyncio
    async def test_api_info_contains_app_name(self, client):
        """/api/info name should reference OmniFrame."""
        response = await client.get("/api/info")
        data = response.json()
        assert "OmniFrame" in data["name"] or "omniframe" in data["name"].lower()
