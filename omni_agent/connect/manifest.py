# Created and developed by Jai Singh
"""Fetch and parse OmniFrame Connect update manifest (SHA-256 trust model v0.1.0)."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional

import httpx

from omni_agent.connect.capabilities import CONNECT_VERSION

MANIFEST_URL = (
    "https://wncpqxwmbxjgxvrpcake.supabase.co/storage/v1/object/public/"
    "downloads/connect_manifest.json"
)
EXPECTED_SCHEMA_VERSION = 1
STABLE_CHANNEL = "stable"


class ManifestErrorKind(str, Enum):
    MALFORMED_JSON = "malformed_json"
    MISSING_FIELD = "missing_field"
    SCHEMA_MISMATCH = "schema_mismatch"
    HTTP_ERROR = "http_error"
    NETWORK_ERROR = "network_error"


@dataclass(frozen=True)
class ChannelEntry:
    version: str
    exe_url: str
    exe_sha256: str
    exe_size_bytes: int
    release_notes_md: str = ""


@dataclass(frozen=True)
class Manifest:
    schema_version: int
    current_version: str
    minimum_required_version: str
    released_at: str
    stable: ChannelEntry


@dataclass(frozen=True)
class ManifestResult:
    ok: bool
    manifest: Optional[Manifest] = None
    error_kind: Optional[ManifestErrorKind] = None
    error_detail: str = ""
    raw_text: str = ""


def _parse_version(version: str) -> tuple[int, ...]:
    """Parse semver-like strings into comparable integer tuples."""
    try:
        from packaging.version import Version  # type: ignore[import-untyped]

        parsed = Version(version)
        return parsed.release
    except Exception:
        parts = re.split(r"[.\-+]", version.strip())
        out: list[int] = []
        for part in parts:
            if not part:
                continue
            digits = re.match(r"^(\d+)", part)
            if digits:
                out.append(int(digits.group(1)))
            else:
                break
        return tuple(out) if out else (0,)


def is_update_available(installed: str, available: str) -> bool:
    """Return True when ``available`` is strictly greater than ``installed``."""
    return _parse_version(available) > _parse_version(installed)


def _require_str(data: dict[str, Any], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"missing or invalid {key}")
    return value.strip()


def _require_int(data: dict[str, Any], key: str) -> int:
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"missing or invalid {key}")
    return value


def parse_manifest(text: str) -> ManifestResult:
    """Parse manifest JSON text into a typed ``ManifestResult``."""
    try:
        root = json.loads(text)
    except json.JSONDecodeError as exc:
        return ManifestResult(
            ok=False,
            error_kind=ManifestErrorKind.MALFORMED_JSON,
            error_detail=str(exc),
            raw_text=text,
        )
    if not isinstance(root, dict):
        return ManifestResult(
            ok=False,
            error_kind=ManifestErrorKind.MALFORMED_JSON,
            error_detail="root must be object",
            raw_text=text,
        )
    try:
        schema_version = root.get("schema_version")
        if schema_version != EXPECTED_SCHEMA_VERSION:
            return ManifestResult(
                ok=False,
                error_kind=ManifestErrorKind.SCHEMA_MISMATCH,
                error_detail=f"expected schema_version {EXPECTED_SCHEMA_VERSION}, got {schema_version!r}",
                raw_text=text,
            )
        channels = root.get("channels")
        if not isinstance(channels, dict):
            raise ValueError("missing channels")
        stable_raw = channels.get(STABLE_CHANNEL)
        if not isinstance(stable_raw, dict):
            raise ValueError("missing channels.stable")
        stable = ChannelEntry(
            version=_require_str(stable_raw, "version"),
            exe_url=_require_str(stable_raw, "exe_url"),
            exe_sha256=_require_str(stable_raw, "exe_sha256").lower(),
            exe_size_bytes=_require_int(stable_raw, "exe_size_bytes"),
            release_notes_md=str(stable_raw.get("release_notes_md") or ""),
        )
        manifest = Manifest(
            schema_version=int(schema_version),
            current_version=_require_str(root, "current_version"),
            minimum_required_version=_require_str(root, "minimum_required_version"),
            released_at=_require_str(root, "released_at"),
            stable=stable,
        )
        return ManifestResult(ok=True, manifest=manifest, raw_text=text)
    except ValueError as exc:
        return ManifestResult(
            ok=False,
            error_kind=ManifestErrorKind.MISSING_FIELD,
            error_detail=str(exc),
            raw_text=text,
        )


def fetch_manifest(url: str = MANIFEST_URL, timeout: float = 5.0) -> ManifestResult:
    """Fetch manifest JSON over HTTP and parse it."""
    try:
        response = httpx.get(url, timeout=timeout, follow_redirects=True)
    except httpx.HTTPError as exc:
        return ManifestResult(
            ok=False,
            error_kind=ManifestErrorKind.NETWORK_ERROR,
            error_detail=str(exc),
        )
    if response.status_code < 200 or response.status_code >= 300:
        return ManifestResult(
            ok=False,
            error_kind=ManifestErrorKind.HTTP_ERROR,
            error_detail=f"HTTP {response.status_code}",
            raw_text=response.text,
        )
    return parse_manifest(response.text)


def installed_version() -> str:
    """Return the bundled Connect version."""
    return CONNECT_VERSION

# Created and developed by Jai Singh
