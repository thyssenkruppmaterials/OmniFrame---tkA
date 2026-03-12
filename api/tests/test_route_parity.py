"""
Route parity tests for OmniFrame backend.

Ensures all expected route prefixes are registered in the FastAPI app.
This catches accidental router removal or import failures.
"""

import pytest


EXPECTED_ROUTE_PREFIXES = [
    "/api/test",
    "/api/analytics",
    "/api/reports",
    "/api/admin",
    "/api/shift-productivity",
    "/health",
    "/api/info",
    "/api/drone",
]


class TestRouteParity:
    """Verify that all expected route prefixes are registered."""

    def test_all_expected_routes_are_registered(self):
        """Every prefix in EXPECTED_ROUTE_PREFIXES must have at least one mounted route."""
        from api.main import app

        routes = [
            r.path for r in app.routes if hasattr(r, "path")
        ]

        for prefix in EXPECTED_ROUTE_PREFIXES:
            matching = [r for r in routes if r.startswith(prefix)]
            assert len(matching) > 0, (
                f"No routes found with prefix '{prefix}'. "
                f"Available routes: {sorted(set(routes))}"
            )

    def test_critical_routers_are_included(self):
        """Spot-check that critical sub-routes exist, not just prefixes."""
        from api.main import app

        routes = {r.path for r in app.routes if hasattr(r, "path")}

        assert "/health" in routes, "/health endpoint must be registered"
        assert "/api/info" in routes, "/api/info endpoint must be registered"

    def test_health_endpoints_registered(self):
        from api.main import app

        routes = [r.path for r in app.routes if hasattr(r, "path")]
        health_routes = [r for r in routes if r.startswith("/health")]
        assert len(health_routes) >= 5, (
            f"Expected >= 5 health endpoints, found {len(health_routes)}: {health_routes}"
        )

    def test_no_duplicate_route_paths(self):
        """Warn if the same path is registered multiple times."""
        from api.main import app

        paths = [r.path for r in app.routes if hasattr(r, "path")]
        seen: dict[str, int] = {}
        for p in paths:
            seen[p] = seen.get(p, 0) + 1

        duplicates = {p: count for p, count in seen.items() if count > 1}
        # Duplicates are not necessarily errors (different methods), but flag them
        for path, count in duplicates.items():
            assert count <= 4, (
                f"Route '{path}' registered {count} times — possible misconfiguration"
            )
