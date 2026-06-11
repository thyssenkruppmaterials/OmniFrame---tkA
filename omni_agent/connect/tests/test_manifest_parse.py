# Created and developed by Jai Singh
"""Manifest fetch/parse and version comparison tests."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

import httpx
import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.manifest import (  # noqa: E402
    ManifestErrorKind,
    fetch_manifest,
    is_update_available,
    parse_manifest,
)

VALID_MANIFEST = """
{
  "schema_version": 1,
  "current_version": "0.2.0",
  "minimum_required_version": "0.1.0",
  "released_at": "2026-05-21T22:00:00Z",
  "channels": {
    "stable": {
      "version": "0.2.0",
      "exe_url": "https://example.com/OmniFrame_Connect_0.2.0.exe",
      "exe_sha256": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      "exe_size_bytes": 14500000,
      "release_notes_md": "Bug fixes."
    }
  }
}
"""


def test_parse_valid_manifest():
    result = parse_manifest(VALID_MANIFEST)
    assert result.ok is True
    assert result.manifest is not None
    assert result.manifest.stable.version == "0.2.0"
    assert result.manifest.stable.exe_sha256.startswith("abcdef")


def test_parse_malformed_json():
    result = parse_manifest("{not json")
    assert result.ok is False
    assert result.error_kind == ManifestErrorKind.MALFORMED_JSON


def test_parse_missing_stable_channel():
    result = parse_manifest('{"schema_version": 1, "channels": {}}')
    assert result.ok is False
    assert result.error_kind == ManifestErrorKind.MISSING_FIELD


def test_parse_schema_version_mismatch():
    payload = VALID_MANIFEST.replace('"schema_version": 1', '"schema_version": 99')
    result = parse_manifest(payload)
    assert result.ok is False
    assert result.error_kind == ManifestErrorKind.SCHEMA_MISMATCH


def test_fetch_manifest_non_2xx():
    response = httpx.Response(404, text="missing")
    with mock.patch("omni_agent.connect.manifest.httpx.get", return_value=response):
        result = fetch_manifest("https://example.com/manifest.json")
    assert result.ok is False
    assert result.error_kind == ManifestErrorKind.HTTP_ERROR


def test_fetch_manifest_network_error():
    with mock.patch(
        "omni_agent.connect.manifest.httpx.get",
        side_effect=httpx.ConnectError("offline"),
    ):
        result = fetch_manifest("https://example.com/manifest.json")
    assert result.ok is False
    assert result.error_kind == ManifestErrorKind.NETWORK_ERROR


@pytest.mark.parametrize(
    ("installed", "available", "expected"),
    [
        ("0.1.0", "0.1.0", False),
        ("0.1.0", "0.2.0", True),
        ("0.1.0", "0.1.1", True),
        ("0.2.0", "0.1.9", False),
        ("1.0.0", "0.9.9", False),
    ],
)
def test_is_update_available(installed, available, expected):
    assert is_update_available(installed, available) is expected

# Created and developed by Jai Singh
