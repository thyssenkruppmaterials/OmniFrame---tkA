# Created and developed by Jai Singh
"""Widget position persistence + off-screen guard tests."""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.widget_position import (  # noqa: E402
    Position,
    clamp_to_visible_monitor,
    read_position,
    write_position,
)

W = 280
H = 120


def test_write_read_round_trip(tmp_path):
    path = tmp_path / "connect_widget_pos.json"
    pos = Position(x=100, y=200, monitor_geometry=(0, 0, 1920, 1080))
    write_position(path, pos)
    loaded = read_position(path)
    assert loaded == pos


def test_malformed_json_deleted(tmp_path):
    path = tmp_path / "connect_widget_pos.json"
    path.write_text("{not json", encoding="utf-8")
    assert read_position(path) is None
    assert not path.exists()


def test_missing_file_returns_none(tmp_path):
    assert read_position(tmp_path / "missing.json") is None


def test_atomic_write_uses_replace(tmp_path, monkeypatch):
    path = tmp_path / "connect_widget_pos.json"
    calls: list[tuple] = []

    def _track_replace(src, dst):
        calls.append((Path(src), Path(dst)))

    monkeypatch.setattr("omni_agent.connect.widget_position.os.replace", _track_replace)
    write_position(path, Position(1, 2, (0, 0, 800, 600)))
    assert calls
    assert calls[0][1] == path


def test_inside_single_monitor_unchanged():
    monitors = [(0, 0, 1920, 1080)]
    pos = Position(x=100, y=100, monitor_geometry=monitors[0])
    out = clamp_to_visible_monitor(pos, monitors, widget_width=W, widget_height=H)
    assert out == pos


def test_dual_horizontal_off_right_snaps_bottom_right():
    monitors = [(0, 0, 1920, 1080), (1920, 0, 1920, 1080)]
    pos = Position(x=3600, y=100, monitor_geometry=monitors[1])
    out = clamp_to_visible_monitor(pos, monitors, widget_width=W, widget_height=H)
    assert out.x == 1920 + 1920 - W - 12
    assert out.y == 1080 - H - 12


def test_dual_vertical_off_bottom_snaps():
    monitors = [(0, 0, 1920, 1080), (0, 1080, 1920, 1080)]
    pos = Position(x=100, y=2200, monitor_geometry=monitors[1])
    out = clamp_to_visible_monitor(pos, monitors, widget_width=W, widget_height=H)
    assert out.monitor_geometry == monitors[1]
    assert out.y == 1080 + 1080 - H - 12


def test_monitor_disappeared_snaps_to_remaining():
    monitors = [(0, 0, 1920, 1080)]
    pos = Position(x=2500, y=50, monitor_geometry=(1920, 0, 1920, 1080))
    out = clamp_to_visible_monitor(pos, monitors, widget_width=W, widget_height=H)
    assert out.x == 1920 - W - 12
    assert out.y == 1080 - H - 12

# Created and developed by Jai Singh
