# Created and developed by Jai Singh
"""OmniFrame Connect capability manifest (Phase H.1 ``--version``)."""

from __future__ import annotations

CONNECT_VERSION = "0.1.0"

CONNECT_CAPABILITIES: tuple[str, ...] = (
    "connect-widget-supervisor",
    "connect-single-worker-watchdog",
    "connect-health-probe-loop",
    "connect-crash-loop-circuit-breaker",
    "connect-clean-shutdown-descendants",
    "connect-open-web-app",
    "connect-pause-resume",
)


def format_version_stdout() -> str:
    """Machine-readable lines for ``--version``."""
    lines = [f"CONNECT_VERSION={CONNECT_VERSION}"]
    for cap in CONNECT_CAPABILITIES:
        lines.append(f"capability={cap}")
    return "\n".join(lines) + "\n"

# Created and developed by Jai Singh
