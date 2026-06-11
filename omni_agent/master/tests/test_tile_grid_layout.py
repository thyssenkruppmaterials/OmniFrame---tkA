# Created and developed by Jai Singh
"""Tile grid row/col placement for 1, 6, and 12 workers."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master.layout import compute_tile_grid  # noqa: E402
from omni_agent.master import theme  # noqa: E402


def test_grid_1_worker():
    assert compute_tile_grid(1) == [(0, 0)]


def test_grid_6_workers_3x2():
    positions = compute_tile_grid(6)
    assert positions == [
        (0, 0),
        (0, 1),
        (0, 2),
        (1, 0),
        (1, 1),
        (1, 2),
    ]


def test_grid_12_workers_3x4():
    positions = compute_tile_grid(12)
    assert len(positions) == 12
    assert positions[0] == (0, 0)
    assert positions[11] == (3, 2)
    rows = {r for r, _ in positions}
    assert max(rows) == 3
    assert theme.GRID_COLUMNS == 3


def test_tile_min_height_for_button_grid():
    assert theme.TILE_MIN_HEIGHT >= 340

# Created and developed by Jai Singh
