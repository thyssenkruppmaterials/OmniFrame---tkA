# Created and developed by Jai Singh
"""Stdlib logging to ``%USERPROFILE%\\.omniframe\\logs\\master.log``."""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

from omni_agent.master.config import MasterConfig, omniframe_home


def configure_master_logging(cfg: MasterConfig) -> Path:
    log_dir = cfg.master.resolved_log_dir()
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "master.log"

    root = logging.getLogger("omniframe.master")
    root.setLevel(logging.INFO)
    if not root.handlers:
        fmt = logging.Formatter(
            "%(asctime)s %(levelname)s [%(name)s] %(message)s"
        )
        fh = RotatingFileHandler(
            log_path,
            maxBytes=5_000_000,
            backupCount=5,
            encoding="utf-8",
        )
        fh.setFormatter(fmt)
        root.addHandler(fh)
        sh = logging.StreamHandler()
        sh.setFormatter(fmt)
        root.addHandler(sh)

    root.info("Master logging initialized at %s", log_path)
    return log_path

# Created and developed by Jai Singh
