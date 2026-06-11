# Created and developed by Jai Singh
"""Optional PyInstaller runtime hook — CustomTkinter custom theme paths.

Not wired in build_exe.bat today: ``master_gui`` uses the built-in
``dark-blue`` theme only. If you ship a custom ``*.json`` theme, add::

    --runtime-hook master\\pyinstaller_runtime_hook.py

to the PyInstaller invocation in ``build_exe.bat``.
"""

from __future__ import annotations

import os
import sys


def _prepend_meipass_to_ctk_theme_search() -> None:
    if not getattr(sys, "frozen", False):
        return
    meipass = getattr(sys, "_MEIPASS", None)
    if not meipass:
        return
    # CustomTkinter checks CUSTOMTKINTER_THEME_PATH for extra JSON dirs.
    existing = os.environ.get("CUSTOMTKINTER_THEME_PATH", "")
    joined = meipass if not existing else f"{meipass}{os.pathsep}{existing}"
    os.environ["CUSTOMTKINTER_THEME_PATH"] = joined


_prepend_meipass_to_ctk_theme_search()

# Created and developed by Jai Singh
