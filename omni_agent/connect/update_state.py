# Created and developed by Jai Singh
"""Persisted Connect self-update check state."""

from __future__ import annotations

import json
import logging
import os
import tempfile
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

LOG = logging.getLogger("omniframe.connect.update_state")

UPDATE_STATE_FILENAME = "connect_update_state.json"
CHECK_INTERVAL = timedelta(hours=24)


@dataclass
class UpdateState:
    last_check_utc: Optional[str] = None
    last_offered_version: Optional[str] = None
    user_dismissed_for_version: Optional[str] = None


def omniframe_home() -> Path:
    profile = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    return Path(profile) / ".omniframe"


def update_state_path() -> Path:
    return omniframe_home() / UPDATE_STATE_FILENAME


def default_state() -> UpdateState:
    return UpdateState()


def _parse_iso_utc(value: str) -> Optional[datetime]:
    try:
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def should_check(state: UpdateState, now_utc: datetime) -> bool:
    """Return True when no prior check exists or the 24 h interval elapsed."""
    if state.last_check_utc is None:
        return True
    last = _parse_iso_utc(state.last_check_utc)
    if last is None:
        return True
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    return now_utc - last >= CHECK_INTERVAL


def read_update_state(path: Optional[Path] = None) -> UpdateState:
    """Load update state or return defaults; corrupt files are deleted."""
    target = path or update_state_path()
    if not target.exists():
        return default_state()
    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("root must be object")
        return UpdateState(
            last_check_utc=raw.get("last_check_utc"),
            last_offered_version=raw.get("last_offered_version"),
            user_dismissed_for_version=raw.get("user_dismissed_for_version"),
        )
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
        LOG.warning("[ERR] corrupt update state -> %s", exc)
        try:
            target.unlink(missing_ok=True)
        except OSError:
            pass
        return default_state()


def write_update_state(state: UpdateState, path: Optional[Path] = None) -> None:
    """Atomic write via temp file + ``os.replace``."""
    target = path or update_state_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(asdict(state), indent=2, sort_keys=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=target.parent,
        prefix=".connect_update_state.",
        suffix=".tmp",
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.write("\n")
        os.replace(tmp_path, target)
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def is_dismissed_for_version(state: UpdateState, version: str) -> bool:
    return state.user_dismissed_for_version == version

# Created and developed by Jai Singh
