# Created and developed by Jai Singh
"""Non-GUI CLI flags for OmniFrame Connect (before Tk init)."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="OmniFrame_Connect",
        description="OmniFrame Connect — end-user agent supervisor widget",
    )
    parser.add_argument(
        "--version",
        action="store_true",
        help="Print CONNECT_VERSION and capability manifest, then exit.",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete Connect widget position + worker config (recovery).",
    )
    parser.add_argument(
        "--check-update",
        action="store_true",
        help="Fetch update manifest and print availability, then exit.",
    )
    parser.add_argument(
        "--apply-update",
        action="store_true",
        help="Download and apply the latest stable update synchronously.",
    )
    parser.add_argument(
        "--replace-helper",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    parser.add_argument("--target", type=str, help=argparse.SUPPRESS)
    parser.add_argument("--source", type=str, help=argparse.SUPPRESS)
    parser.add_argument("--restart", action="store_true", help=argparse.SUPPRESS)
    return parser


def _omniframe_home() -> Path:
    profile = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    return Path(profile) / ".omniframe"


def _worker_config_path() -> Path:
    appdata = os.environ.get("APPDATA") or os.path.expanduser("~")
    return Path(appdata) / "OmniFrameAgent" / "config.json"


def run_reset() -> dict[str, object]:
    """Nuclear recovery: widget position + worker config.

    Deletes ``connect_widget_pos.json`` (H.3 drag-position persist) and the
    worker ``config.json``. No tooltip cache file is used in H.3.
    """
    targets = [
        _omniframe_home() / "connect_widget_pos.json",
        _worker_config_path(),
    ]
    deleted: list[str] = []
    skipped: list[str] = []
    for path in targets:
        try:
            if path.exists():
                path.unlink()
                deleted.append(str(path))
                sys.stdout.write(f"[OK] deleted {path}\n")
            else:
                skipped.append(str(path))
                sys.stdout.write(f"[OK] skip missing {path}\n")
        except OSError as exc:
            sys.stderr.write(f"[ERR] delete failed {path}: {exc}\n")
            raise SystemExit(1) from exc
    return {"deleted": deleted, "skipped": skipped, "ok": True}


def run_check_update() -> None:
    from omni_agent.connect.manifest import installed_version
    from omni_agent.connect.self_update import check_for_update

    installed = installed_version()
    available, manifest, entry, result = check_for_update(installed=installed)
    if not result.ok:
        sys.stderr.write(f"[ERR] manifest fetch failed: {result.error_detail}\n")
        raise SystemExit(1)
    assert manifest is not None and entry is not None
    sys.stdout.write(f"CONNECT_VERSION={installed}\n")
    sys.stdout.write(f"MANIFEST_VERSION={entry.version}\n")
    sys.stdout.write(f"UPDATE_AVAILABLE={'yes' if available else 'no'}\n")
    if entry.release_notes_md:
        sys.stdout.write(f"RELEASE_NOTES={entry.release_notes_md}\n")


def run_apply_update() -> None:
    from omni_agent.connect.self_update import (
        SelfUpdateController,
        check_for_update,
        configure_controller,
        current_exe_path,
    )

    available, _manifest, entry, result = check_for_update()
    if not result.ok or entry is None:
        sys.stderr.write(f"[ERR] manifest fetch failed: {result.error_detail}\n")
        raise SystemExit(1)
    if not available:
        sys.stdout.write("[OK] already up to date\n")
        return
    configure_controller(
        SelfUpdateController(on_exit_for_replace=lambda: sys.exit(0))
    )
    from omni_agent.connect.self_update import start_install

    start_install(entry, current_exe_path(), synchronous=True)


def handle_cli_before_gui(argv: list[str] | None = None) -> bool:
    """Handle non-GUI flags. Return True when the process should exit 0."""
    from omni_agent.connect.self_replace import handle_replace_helper_argv

    raw_argv = list(argv if argv is not None else sys.argv[1:])
    if any(token == "--replace-helper" for token in raw_argv):
        handle_replace_helper_argv(raw_argv)
    args = build_arg_parser().parse_args(raw_argv)
    if args.version:
        from omni_agent.connect.capabilities import format_version_stdout

        sys.stdout.write(format_version_stdout())
        return True
    if args.reset:
        run_reset()
        return True
    if args.check_update:
        run_check_update()
        return True
    if args.apply_update:
        run_apply_update()
        return True
    return False

# Created and developed by Jai Singh
