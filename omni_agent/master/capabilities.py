# Created and developed by Jai Singh
"""Master EXE capability manifest (Phase G ``--version`` / smoke-check)."""

from __future__ import annotations

AGENT_VERSION = "2.1.0"

# Eight Phase A worker capability ids the master supervisor expects (Plan §10 Phase A).
MASTER_WORKER_CAPABILITIES: tuple[str, ...] = (
    "master-controller-supported",
    "admin-ws-reconnect",
    "admin-job-abort",
    "admin-sap-reattach",
    "health-extended-fields",
    "agent-port-override",
    "agent-self-id-override",
    "agent-sap-pin-env-override",
)


def format_version_stdout() -> str:
    """Machine-readable lines for ``--version`` and Windows smoke-check."""
    lines = [f"AGENT_VERSION={AGENT_VERSION}"]
    for cap in MASTER_WORKER_CAPABILITIES:
        lines.append(f"capability={cap}")
    return "\n".join(lines) + "\n"

# Created and developed by Jai Singh
