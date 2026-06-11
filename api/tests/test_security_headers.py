# Created and developed by Jai Singh
"""
Security header tests for OneBox AI backend.

Validates that the security middleware injects expected headers into responses.
"""

import pytest


class TestSecurityHeaders:
    """Verify security headers are present on API responses."""

    @pytest.mark.asyncio
    async def test_security_headers_present(self, client):
        """Health endpoint response should include core security headers."""
        response = await client.get("/health")
        assert response.status_code == 200

        assert response.headers.get("x-content-type-options") == "nosniff"
        assert response.headers.get("x-frame-options") == "DENY"
        assert response.headers.get("x-xss-protection") == "1; mode=block"

    @pytest.mark.asyncio
    async def test_referrer_policy_header(self, client):
        """Referrer-Policy header should be strict."""
        response = await client.get("/health")
        referrer = response.headers.get("referrer-policy", "")
        assert "strict-origin" in referrer

    @pytest.mark.asyncio
    async def test_permissions_policy_header(self, client):
        """Permissions-Policy header should restrict sensitive APIs."""
        response = await client.get("/health")
        permissions = response.headers.get("permissions-policy", "")
        assert "geolocation=()" in permissions

    @pytest.mark.asyncio
    async def test_csp_header_present(self, client):
        """Content-Security-Policy header should be set."""
        response = await client.get("/health")
        csp = response.headers.get("content-security-policy", "")
        assert "default-src" in csp

    @pytest.mark.asyncio
    async def test_request_id_header(self, client):
        """X-Request-ID header should be set for tracing."""
        response = await client.get("/health")
        request_id = response.headers.get("x-request-id")
        assert request_id is not None
        assert len(request_id) > 0

    @pytest.mark.asyncio
    async def test_process_time_header(self, client):
        """X-Process-Time header should be set."""
        response = await client.get("/health")
        process_time = response.headers.get("x-process-time")
        assert process_time is not None
        assert float(process_time) >= 0

    @pytest.mark.asyncio
    async def test_api_cache_control_headers(self, client):
        """API endpoints should have no-cache directives."""
        response = await client.get("/api/info")
        cache_control = response.headers.get("cache-control", "")
        assert "no-cache" in cache_control or "no-store" in cache_control

    @pytest.mark.asyncio
    async def test_security_health_audit_status(self, client):
        """Security health should report audit_service as configured, not healthy."""
        response = await client.get("/health/security")
        if response.status_code == 200:
            data = response.json()
            security = data.get("security_systems", {})
            assert security.get("audit_service") == "configured"

# Created and developed by Jai Singh
