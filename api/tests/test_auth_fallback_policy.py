# Created and developed by Jai Singh
"""
Auth fallback policy tests for OneBox AI backend.

Validates that the insecure JWT fallback is NEVER enabled in
production or without explicit opt-in configuration.
"""

import os
import importlib

import pytest


class TestFallbackDisabledInProduction:
    """Ensure fallback is disabled in production-like environments."""

    def test_fallback_disabled_in_production(self, monkeypatch):
        """_is_fallback_enabled() must return False when environment is production."""
        monkeypatch.setenv("API_ENVIRONMENT", "production")
        monkeypatch.setenv("ALLOW_INSECURE_JWT_FALLBACK", "true")
        monkeypatch.setenv("RUST_CORE_FALLBACK", "true")

        # Force re-import so settings pick up the new env
        import api.config.settings as settings_mod
        importlib.reload(settings_mod)

        import api.auth.supabase_auth as auth_mod
        importlib.reload(auth_mod)

        assert auth_mod._is_fallback_enabled() is False

    def test_fallback_disabled_in_staging(self, monkeypatch):
        """_is_fallback_enabled() must return False when environment is staging."""
        monkeypatch.setenv("API_ENVIRONMENT", "staging")
        monkeypatch.setenv("ALLOW_INSECURE_JWT_FALLBACK", "true")
        monkeypatch.setenv("RUST_CORE_FALLBACK", "true")

        import api.config.settings as settings_mod
        importlib.reload(settings_mod)

        import api.auth.supabase_auth as auth_mod
        importlib.reload(auth_mod)

        assert auth_mod._is_fallback_enabled() is False

    def test_fallback_disabled_in_prod_short(self, monkeypatch):
        """_is_fallback_enabled() must return False for 'prod' alias."""
        monkeypatch.setenv("API_ENVIRONMENT", "prod")
        monkeypatch.setenv("ALLOW_INSECURE_JWT_FALLBACK", "true")
        monkeypatch.setenv("RUST_CORE_FALLBACK", "true")

        import api.config.settings as settings_mod
        importlib.reload(settings_mod)

        import api.auth.supabase_auth as auth_mod
        importlib.reload(auth_mod)

        assert auth_mod._is_fallback_enabled() is False


class TestFallbackRequiresExplicitOptIn:
    """Ensure fallback requires all three opt-in conditions."""

    def test_fallback_disabled_without_allow_flag(self, monkeypatch):
        """Without ALLOW_INSECURE_JWT_FALLBACK, fallback should be disabled."""
        monkeypatch.setenv("API_ENVIRONMENT", "local")
        monkeypatch.delenv("ALLOW_INSECURE_JWT_FALLBACK", raising=False)
        monkeypatch.setenv("RUST_CORE_FALLBACK", "true")

        import api.config.settings as settings_mod
        importlib.reload(settings_mod)

        import api.auth.supabase_auth as auth_mod
        importlib.reload(auth_mod)

        assert auth_mod._is_fallback_enabled() is False

    def test_fallback_disabled_without_rust_core_fallback(self, monkeypatch):
        """Without RUST_CORE_FALLBACK=true, fallback should be disabled."""
        monkeypatch.setenv("API_ENVIRONMENT", "local")
        monkeypatch.setenv("ALLOW_INSECURE_JWT_FALLBACK", "true")
        monkeypatch.setenv("RUST_CORE_FALLBACK", "false")

        import api.config.settings as settings_mod
        importlib.reload(settings_mod)

        import api.auth.supabase_auth as auth_mod
        importlib.reload(auth_mod)

        assert auth_mod._is_fallback_enabled() is False

    def test_fallback_disabled_in_development_env(self, monkeypatch):
        """'development' is not 'local' — fallback should be disabled."""
        monkeypatch.setenv("API_ENVIRONMENT", "development")
        monkeypatch.setenv("ALLOW_INSECURE_JWT_FALLBACK", "true")
        monkeypatch.setenv("RUST_CORE_FALLBACK", "true")

        import api.config.settings as settings_mod
        importlib.reload(settings_mod)

        import api.auth.supabase_auth as auth_mod
        importlib.reload(auth_mod)

        assert auth_mod._is_fallback_enabled() is False

# Created and developed by Jai Singh
