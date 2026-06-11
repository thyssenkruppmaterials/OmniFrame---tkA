# Created and developed by Jai Singh
"""Non-GUI CLI flags for OmniFrame Agent Master (Phase G PyInstaller smoke)."""

from __future__ import annotations

import argparse
import json
import sys


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="OmniFrame_AgentMaster",
        description="OmniFrame Multi-Session Agent Master",
    )
    parser.add_argument(
        "--version",
        action="store_true",
        help="Print AGENT_VERSION and master worker capability manifest, then exit.",
    )
    parser.add_argument(
        "--probe-only",
        action="store_true",
        help="Enumerate SAP GUI sessions (JSON on stdout) without starting the GUI.",
    )
    return parser


def handle_cli_before_gui(argv: list[str] | None = None) -> bool:
    """Handle non-GUI flags. Return True when the process should exit 0."""
    args = build_arg_parser().parse_args(argv)
    if args.version:
        from omni_agent.master.capabilities import format_version_stdout

        sys.stdout.write(format_version_stdout())
        return True
    if args.probe_only:
        from omni_agent.master.sap_probe import probe_sap_sessions

        sys.stdout.write(json.dumps(probe_sap_sessions(), indent=2))
        sys.stdout.write("\n")
        return True
    return False

# Created and developed by Jai Singh
