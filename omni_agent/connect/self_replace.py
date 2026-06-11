# Created and developed by Jai Singh
"""Tiny replace helper invoked via ``--replace-helper`` on the Connect EXE."""

from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

LOG = logging.getLogger("omniframe.connect.self_replace")

HELPER_WAIT_S = 5.0


def build_replace_argv(
    helper_exe: Path,
    *,
    target: Path,
    source: Path,
    restart: bool = True,
) -> list[str]:
    """Build argv for spawning the replace helper from the Connect EXE."""
    argv = [
        str(helper_exe),
        "--replace-helper",
        "--target",
        str(target),
        "--source",
        str(source),
    ]
    if restart:
        argv.append("--restart")
    return argv


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--replace-helper", action="store_true")
    parser.add_argument("--target", type=str)
    parser.add_argument("--source", type=str)
    parser.add_argument("--restart", action="store_true")
    return parser


def run(target: Path, source: Path, *, restart: bool = True) -> int:
    """Wait briefly, atomically replace ``target`` with ``source``, optionally relaunch."""
    deadline = time.monotonic() + HELPER_WAIT_S
    while time.monotonic() < deadline:
        time.sleep(0.25)
    if not source.is_file():
        LOG.error("[ERR] replace source missing -> %s", source)
        return 1
    try:
        os.replace(source, target)
        LOG.info("[OK] replaced exe -> %s", target)
    except OSError as exc:
        LOG.error("[ERR] os.replace failed -> %s", exc)
        return 1
    if restart:
        try:
            subprocess.Popen([str(target)], close_fds=True)
            LOG.info("[OK] relaunched connect -> %s", target)
        except OSError as exc:
            LOG.error("[ERR] relaunch failed -> %s", exc)
            return 1
    return 0


def handle_replace_helper_argv(argv: list[str]) -> bool:
    """Return True when argv handled the helper branch (caller should exit)."""
    parser = build_arg_parser()
    args, _unknown = parser.parse_known_args(argv)
    if not args.replace_helper:
        return False
    if not args.target or not args.source:
        sys.stderr.write("[ERR] --replace-helper requires --target and --source\n")
        raise SystemExit(2)
    code = run(Path(args.target), Path(args.source), restart=bool(args.restart))
    raise SystemExit(code)

# Created and developed by Jai Singh
