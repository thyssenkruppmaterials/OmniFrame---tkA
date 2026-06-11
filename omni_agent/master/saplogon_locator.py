# Created and developed by Jai Singh
"""Autodetect ``saplogon.exe`` install path (Phase E step 5)."""

from __future__ import annotations

import os
from pathlib import Path

_DEFAULT_PATHS: tuple[str, ...] = (
    r"C:\Program Files (x86)\SAP\FrontEnd\SapGui\saplogon.exe",
    r"C:\Program Files\SAP\FrontEnd\SapGui\saplogon.exe",
)


def _localappdata_path() -> Path | None:
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        return None
    return Path(local) / "Programs" / "SAP" / "FrontEnd" / "SapGui" / "saplogon.exe"


def known_saplogon_paths() -> list[Path]:
    """All candidate paths in search order."""
    paths = [Path(p) for p in _DEFAULT_PATHS]
    lap = _localappdata_path()
    if lap is not None:
        paths.append(lap)
    return paths


def locate_saplogon(*, extra_paths: list[Path | str] | None = None) -> Path | None:
    """Return the first existing ``saplogon.exe``, or ``None``."""
    candidates: list[Path] = []
    if extra_paths:
        candidates.extend(Path(p) for p in extra_paths)
    candidates.extend(known_saplogon_paths())
    seen: set[str] = set()
    for path in candidates:
        key = str(path.resolve()) if path.exists() else str(path)
        if key in seen:
            continue
        seen.add(key)
        if path.is_file():
            return path
    return None

# Created and developed by Jai Singh
