# Created and developed by Jai Singh
"""
Handler modules for the OmniAgent v2 SAP helper.

Each module exports a `register(dispatcher)` function that registers its
JSON-RPC method handlers. The dispatcher is built once at helper start
in `sap_helper.build_dispatcher`.

Handler signature is

    async def handle_X(session_pool, params, notify) -> result_dict

The handler MUST:

  - Acquire a slot via `session_pool.acquire_slot_for_op(...)` (which
    transitions slot state idle → busy → idle around the operation).
  - Run COM-touching work via `slot.run_on_com(fn, ...)` so it executes
    on the slot's STA thread.
  - Return a JSON-serialisable dict shaped per Worker A's agent-types.
  - Raise `RpcError` for structured errors (param validation, slot
    busy, SAP-not-connected). Unstructured exceptions are caught at the
    dispatcher and converted to JSON-RPC INTERNAL_ERROR.

Shared helpers used across handler modules live in `handlers._common`.
"""

# Created and developed by Jai Singh
