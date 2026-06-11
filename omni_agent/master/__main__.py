# Created and developed by Jai Singh
"""PyInstaller entry: ``python -m omni_agent.master`` → ``master_gui.main()``.

Module-level stream patching MUST run before any sub-imports — see
``_ensure_std_streams`` below.
"""

from __future__ import annotations

import os
import sys


def _ensure_std_streams() -> None:
    """Guard against PyInstaller ``--windowed`` ``sys.stdout/stderr is None``.

    When the master EXE is built with ``--windowed`` (no console) and a user
    double-clicks it from Explorer/Citrix, both ``sys.stdout`` and
    ``sys.stderr`` are ``None``. Libraries that write to stdout at *import
    time* — e.g. CustomTkinter ``font/__init__.py`` line 21 — then crash
    with ``AttributeError: 'NoneType' object has no attribute 'write'``
    before the GUI ever opens.

    Patching to ``os.devnull`` only when the streams are ``None`` keeps:

    - CLI smoke checks intact: ``OmniFrame_AgentMaster.exe --version`` run
      via ``prlctl exec`` / a cmd prompt has real stdout, so the patch is a
      no-op and ``cli.py``'s prints go to the calling process.
    - Production launches safe: double-click from Citrix → ``stdout is
      None`` → patched to devnull → CustomTkinter font init succeeds → GUI
      opens. Important errors land in ``master.log`` via
      ``logging_setup.configure_master_logging``, not stdout.

    This must run **before** any third-party imports — keep it at the top
    of this module, ahead of ``master_gui`` / ``cli`` / ``customtkinter``.
    """
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
    from omni_agent.master.master_gui import main as gui_main

    gui_main()


if __name__ == "__main__":
    main()

# Created and developed by Jai Singh
