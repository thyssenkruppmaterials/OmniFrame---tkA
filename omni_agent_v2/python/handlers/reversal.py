# Created and developed by Jai Singh
"""
Reversal — undo a previously-confirmed transaction.

JSON-RPC method: `sap.reverseTransaction` (placeholder).

STATUS: STUB by design. Per the v2 partition map, reversal is owned by
the Rust services going forward — they have direct DB access to query
the audit log and orchestrate the undo flow more cleanly than driving
SAP GUI in reverse. The Python helper exposes only the placeholder
method so the dispatch surface stays complete.

Worker A's Rust shell may either:
  - Refuse `sap.reverseTransaction` outright at the JSON-RPC layer
    (and not forward it to Python), OR
  - Forward it here so this module can return the "use Rust reversal
    service" pointer.

We choose the latter to keep the interface uniform — the Rust shell
forwards everything it doesn't own and lets Python explain itself.
"""

from __future__ import annotations

from session_manager import SessionManager


async def handle_reverse_transaction(pool: SessionManager, params: dict, notify) -> dict:
    return {
        "ok": False,
        "error": (
            "sap.reverseTransaction is owned by the Rust reversal service in "
            "v2 — call rust-work-service /reversal/* instead. The Python "
            "helper does not implement reversal."
        ),
        "stub": True,
        "method": "sap.reverseTransaction",
        "owner": "rust-reversal-service",
        "params_received": list(params.keys()),
    }


def register(dispatcher) -> None:
    dispatcher.register("sap.reverseTransaction", handle_reverse_transaction)

# Created and developed by Jai Singh
