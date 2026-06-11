# Created and developed by Jai Singh
"""Tile grid layout math (no CustomTkinter import)."""

from __future__ import annotations

from omni_agent.master import theme


def compute_tile_grid(
    num_workers: int, columns: int = theme.GRID_COLUMNS
) -> list[tuple[int, int]]:
    """Return ``(row, col)`` for each worker index ``0..num_workers-1``."""
    positions: list[tuple[int, int]] = []
    for i in range(num_workers):
        row = i // columns
        col = i % columns
        positions.append((row, col))
    return positions

# Created and developed by Jai Singh
