# Created and developed by Jai Singh
"""Pulse animation step generator tests."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.animation import pulse_color_steps  # noqa: E402


def test_pulse_returns_ten_steps_by_default():
    steps = pulse_color_steps("#000000", "#ffffff")
    assert len(steps) == 10
    assert steps[0] != "#ffffff"
    assert steps[-1] == "#ffffff"


def test_pulse_interpolates_midpoint():
    steps = pulse_color_steps("#000000", "#010101", steps=2)
    assert len(steps) == 2
    assert steps[-1] == "#010101"

# Created and developed by Jai Singh
