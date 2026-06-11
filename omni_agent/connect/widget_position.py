# Created and developed by Jai Singh
"""Persisted widget position + monitor-aware off-screen guard (pure helpers)."""

from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import NamedTuple, Optional

LOG = logging.getLogger("omniframe.connect.widget_position")

Rect = tuple[int, int, int, int]  # x, y, width, height


class Position(NamedTuple):
    x: int
    y: int
    monitor_geometry: tuple[int, int, int, int]


POSITION_FILENAME = "connect_widget_pos.json"
MARGIN_PX = 12


def omniframe_home() -> Path:
    profile = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    return Path(profile) / ".omniframe"


def position_path() -> Path:
    return omniframe_home() / POSITION_FILENAME


def read_position(path: Path) -> Optional[Position]:
    """Return persisted position or None if missing / corrupt."""
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        x = int(raw["x"])
        y = int(raw["y"])
        mg = raw.get("monitor_geometry")
        if not isinstance(mg, (list, tuple)) or len(mg) != 4:
            raise ValueError("invalid monitor_geometry")
        monitor_geometry = tuple(int(v) for v in mg)
        return Position(x=x, y=y, monitor_geometry=monitor_geometry)
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        LOG.warning("[ERR] corrupt widget position file -> %s", exc)
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        return None


def write_position(path: Path, pos: Position) -> None:
    """Atomic write via temp file + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "x": pos.x,
        "y": pos.y,
        "monitor_geometry": list(pos.monitor_geometry),
    }
    fd, tmp_name = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=".connect_widget_pos.",
        suffix=".tmp",
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
    except OSError:
        tmp_path.unlink(missing_ok=True)
        raise


def _rect_contains(rect: Rect, x: int, y: int, w: int, h: int) -> bool:
    rx, ry, rw, rh = rect
    return x >= rx and y >= ry and (x + w) <= (rx + rw) and (y + h) <= (ry + rh)


def _rect_distance_sq(rect: Rect, x: int, y: int) -> int:
    """Squared distance from point to nearest edge/corner of rect."""
    rx, ry, rw, rh = rect
    cx = min(max(x, rx), rx + rw)
    cy = min(max(y, ry), ry + rh)
    return (x - cx) ** 2 + (y - cy) ** 2


def clamp_to_visible_monitor(
    pos: Position,
    monitors: list[Rect],
    *,
    widget_width: int,
    widget_height: int,
) -> Position:
    """Snap off-screen positions to nearest monitor bottom-right with margin."""
    if not monitors:
        return pos
    for rect in monitors:
        if _rect_contains(rect, pos.x, pos.y, widget_width, widget_height):
            return pos
    nearest = min(monitors, key=lambda r: _rect_distance_sq(r, pos.x, pos.y))
    rx, ry, rw, rh = nearest
    snap_x = max(rx + MARGIN_PX, rx + rw - widget_width - MARGIN_PX)
    snap_y = max(ry + MARGIN_PX, ry + rh - widget_height - MARGIN_PX)
    return Position(x=snap_x, y=snap_y, monitor_geometry=nearest)


def list_monitors_fallback(screen_width: int, screen_height: int) -> list[Rect]:
    """Primary monitor only when ``screeninfo`` is unavailable."""
    return [(0, 0, screen_width, screen_height)]


def try_list_monitors() -> list[Rect]:
    """Best-effort monitor enumeration; falls back to primary-only."""
    try:
        from screeninfo import get_monitors  # type: ignore[import-untyped]

        monitors = get_monitors()
        if monitors:
            return [(m.x, m.y, m.width, m.height) for m in monitors]
    except Exception:
        pass
    return []

# Created and developed by Jai Singh
