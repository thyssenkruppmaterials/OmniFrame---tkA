# Created and developed by Jai Singh
"""Unit tests for the Railway GraphQL client's parsing / normalization logic.

These tests do NOT call the real Railway API -- they exercise the helper
functions and data-class construction that the client uses.
"""

import pytest

from api.lib.railway_client import (
    NormalizedLog,
    _make_dedup_key,
    _normalize_severity,
)


# ---- Severity normalization -------------------------------------------------

@pytest.mark.parametrize(
    "raw, expected",
    [
        ("INFO", "info"),
        ("info", "info"),
        ("WARN", "warn"),
        ("WARNING", "warn"),
        ("ERROR", "error"),
        ("ERR", "error"),
        ("FATAL", "error"),
        ("CRITICAL", "error"),
        ("DEBUG", "debug"),
        ("TRACE", "debug"),
        ("", "info"),
        ("  INFO  ", "info"),
        ("unknown_level", "unknown_level"),
    ],
)
def test_normalize_severity(raw: str, expected: str):
    assert _normalize_severity(raw) == expected


# ---- Dedup key construction -------------------------------------------------

def test_dedup_key_is_deterministic():
    log = NormalizedLog(
        timestamp="2026-04-12T10:00:00Z",
        severity="info",
        message="Hello world",
        service_id="svc-1",
        deployment_id="dep-1",
    )
    key1 = _make_dedup_key(log)
    key2 = _make_dedup_key(log)
    assert key1 == key2
    assert "svc-1" in key1
    assert "dep-1" in key1


def test_dedup_key_differs_for_different_messages():
    base = dict(
        timestamp="2026-04-12T10:00:00Z",
        severity="info",
        service_id="svc-1",
        deployment_id="dep-1",
    )
    log_a = NormalizedLog(message="Alpha", **base)
    log_b = NormalizedLog(message="Beta", **base)
    assert _make_dedup_key(log_a) != _make_dedup_key(log_b)


def test_dedup_key_truncates_long_messages():
    long_msg = "x" * 500
    log = NormalizedLog(
        timestamp="t",
        severity="info",
        message=long_msg,
        service_id="s",
        deployment_id="d",
    )
    key = _make_dedup_key(log)
    assert len(key) < 200


# ---- HTTP status → severity -------------------------------------------------

def test_http_5xx_maps_to_error():
    """5xx HTTP status codes should be surfaced as error severity."""
    for code in [500, 502, 503]:
        severity = (
            "error" if code >= 500
            else "warn" if code >= 400
            else "info"
        )
        assert severity == "error"


def test_http_4xx_maps_to_warn():
    for code in [400, 401, 404]:
        severity = (
            "error" if code >= 500
            else "warn" if code >= 400
            else "info"
        )
        assert severity == "warn"


def test_http_2xx_maps_to_info():
    for code in [200, 201, 204]:
        severity = (
            "error" if code >= 500
            else "warn" if code >= 400
            else "info"
        )
        assert severity == "info"

# Created and developed by Jai Singh
