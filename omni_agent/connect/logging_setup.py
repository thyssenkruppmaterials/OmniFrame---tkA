# Created and developed by Jai Singh
"""Rotating file log at ``%USERPROFILE%\\.omniframe\\connect.log``."""

from __future__ import annotations

import logging
import os
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path


def omniframe_home() -> Path:
    profile = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    return Path(profile) / ".omniframe"


def configure_connect_logging() -> Path:
    """Configure ASCII-safe rotating daily log for Connect."""
    log_dir = omniframe_home()
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "connect.log"

    root = logging.getLogger("omniframe.connect")
    root.setLevel(logging.DEBUG)
    if not root.handlers:
        fmt = logging.Formatter(
            "%(asctime)s %(levelname)s [%(name)s] %(message)s"
        )
        fh = TimedRotatingFileHandler(
            log_path,
            when="midnight",
            interval=1,
            backupCount=7,
            encoding="utf-8",
        )
        fh.setFormatter(fmt)
        root.addHandler(fh)

    root.info("[OK] Connect logging initialized -> %s", log_path)
    return log_path

# Created and developed by Jai Singh
