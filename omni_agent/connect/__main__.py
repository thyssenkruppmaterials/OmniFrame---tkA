# Created and developed by Jai Singh
"""PyInstaller entry: ``python -m omni_agent.connect`` -> ``connect_gui.main()``."""

from __future__ import annotations

import os
import sys


def _ensure_std_streams() -> None:
    """Guard against PyInstaller ``--windowed`` ``sys.stdout/stderr is None``."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    try:
        null = open(os.devnull, "w", encoding="utf-8", errors="replace")
    except OSError:
        return
    if sys.stdout is None:
        sys.stdout = null
    if sys.stderr is None:
        sys.stderr = null


_ensure_std_streams()


def main() -> None:
    from omni_agent.connect.cli import handle_cli_before_gui

    if handle_cli_before_gui():
        raise SystemExit(0)
    from omni_agent.connect.connect_gui import main as gui_main

    gui_main()


if __name__ == "__main__":
    main()

# Created and developed by Jai Singh
