# Created and developed by Jai Singh
"""Phase D #15 — Reversal / Rollback Engine helper.

This module is intentionally tiny:

  - Pure-python `compute_inverse(action, payload, prev_state)` that
    derives the payload required to undo each supported SAP mutation.
  - One FastAPI endpoint, `POST /sap/reversal/compute-inverse`, that
    surfaces it to the OmniFrame web app so the inverse preview can
    render before the user enqueues the reversal batch.

Reversal jobs themselves run through the **existing** mutation
endpoints (`/sap/material-master-bin`, `/sap/transfer-inventory`,
`/sap/bin-blocks`, `/sap/material-master-storage-types`) — see
`sap_agent_jobs` and the queue worker in `agent.py`. We deliberately
do NOT reimplement the SAP-side workflow here; the inverse payload is
just a transformed dict that gets fed back into the same handlers.

Inverse semantics by action
---------------------------

  * material_master_bin
        Forward:  set storage_bin = NEW
        prev_state: {"storage_bin": OLD}
        Inverse:  set storage_bin = OLD  (i.e. the original value)

  * material_master_storage_types
        Forward:  set removal_storage_type = A, placement_storage_type = B
        prev_state: {"removal_storage_type": prevA, "placement_storage_type": prevB}
        Inverse:  removal_storage_type = prevA, placement_storage_type = prevB

  * transfer_inventory  (LT01 — bin-to-bin TO creation)
        Forward:  source = (T_a, B_a) → dest = (T_b, B_b)
        Inverse:  source = (T_b, B_b) → dest = (T_a, B_a)
                  (no prev_state needed; the inverse is a swap)

  * set_bin_blocks
        Forward:  putaway_block = X, stock_removal_block = Y
        prev_state: {"putaway_block": prevX, "stock_removal_block": prevY}
        Inverse:  flip back to prevX / prevY

  * confirm_transfer_order  (LT12)
        IRREVERSIBLE.  SAP confirms are atomic — the engine returns
        None and the UI flags the row as 'cannot reverse'.

Anything else also returns None (treated as cannot-reverse).
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Pure function
# ---------------------------------------------------------------------------
def compute_inverse(
    action: str,
    payload: dict,
    prev_state: Optional[dict],
) -> Optional[dict]:
    """Return the payload that reverses `action`, or None if irreversible.

    The returned dict is shaped to match the *same* mutation endpoint as
    the original. Callers should enqueue it via `sap_agent_jobs` against
    the same endpoint they would have hit for the forward call.
    """
    if not action:
        return None

    # ── material_master_bin (MM02 storage bin) ──
    if action == "material_master_bin":
        if not prev_state or "storage_bin" not in prev_state:
            return None
        # The agent endpoint accepts an empty string to *clear* the bin,
        # which is a perfectly valid prev_state — preserve it as-is.
        return {**payload, "storage_bin": prev_state.get("storage_bin", "")}

    # ── material_master_storage_types (MM02 LTKZA / LTKZE) ──
    if action == "material_master_storage_types":
        if not prev_state:
            return None
        return {
            **payload,
            "removal_storage_type": prev_state.get("removal_storage_type", ""),
            "placement_storage_type": prev_state.get(
                "placement_storage_type", ""
            ),
        }

    # ── transfer_inventory (LT01 bin-to-bin) ──
    # Inverse is a pure swap of source/dest — no prev_state needed.
    if action == "transfer_inventory":
        return {
            **payload,
            "source_storage_type": payload.get("dest_storage_type", ""),
            "source_storage_bin": payload.get("dest_storage_bin", ""),
            "dest_storage_type": payload.get("source_storage_type", ""),
            "dest_storage_bin": payload.get("source_storage_bin", ""),
        }

    # ── set_bin_blocks (LS02N putaway / removal flags) ──
    if action == "set_bin_blocks":
        if not prev_state:
            return None
        return {
            **payload,
            "putaway_block": bool(prev_state.get("putaway_block", False)),
            "stock_removal_block": bool(
                prev_state.get("stock_removal_block", False)
            ),
        }

    # ── confirm_transfer_order (LT12) — IRREVERSIBLE ──
    if action == "confirm_transfer_order":
        return None

    # Anything else (create_storage_bin, process_shipment, query, …) is
    # treated as not yet supported by the reversal engine.
    return None


def is_action_reversible_in_principle(action: str) -> bool:
    """True if the engine knows how to invert this action *given* a
    prev_state. confirm_transfer_order is the only flat-out 'no'."""
    return action in {
        "material_master_bin",
        "material_master_storage_types",
        "transfer_inventory",
        "set_bin_blocks",
    }


# ---------------------------------------------------------------------------
# FastAPI surface — wired into agent.py at the end via include_router.
# ---------------------------------------------------------------------------
router = APIRouter()


class InverseRequest(BaseModel):
    action: str
    payload: dict[str, Any] = {}
    prev_state: dict[str, Any] = {}


@router.post("/sap/reversal/compute-inverse")
def compute_inverse_endpoint(req: InverseRequest) -> dict:
    """Return either the inverse payload or a structured 'cannot reverse'
    result. Called from the Reversal panel preview pane in the web app
    before the user enqueues the batch."""
    prev = req.prev_state if req.prev_state else None
    inverse = compute_inverse(req.action, req.payload or {}, prev)
    if inverse is None:
        if req.action == "confirm_transfer_order":
            return {
                "ok": False,
                "reversible": False,
                "reason": "irreversible_action",
                "message": (
                    "LT12 confirmations are atomic in SAP and cannot be "
                    "auto-reversed. Open a manual cancellation TO."
                ),
            }
        if not is_action_reversible_in_principle(req.action):
            return {
                "ok": False,
                "reversible": False,
                "reason": "unsupported_action",
                "message": (
                    f"The reversal engine does not yet know how to invert "
                    f"action '{req.action}'."
                ),
            }
        return {
            "ok": False,
            "reversible": False,
            "reason": "missing_prev_state",
            "message": (
                "No pre-mutation snapshot was captured for this row. "
                "Run the original mutation through the dry-run preview "
                "first so prev_state is populated."
            ),
        }
    # We also surface which mutation endpoint the reversal job should
    # target so the frontend doesn't have to re-derive it.
    endpoint_for_action = {
        "material_master_bin": "/sap/material-master-bin",
        "material_master_storage_types": "/sap/material-master-storage-types",
        "transfer_inventory": "/sap/transfer-inventory",
        "set_bin_blocks": "/sap/bin-blocks",
    }
    return {
        "ok": True,
        "reversible": True,
        "inverse_payload": inverse,
        "endpoint": endpoint_for_action.get(req.action),
    }

# Created and developed by Jai Singh
