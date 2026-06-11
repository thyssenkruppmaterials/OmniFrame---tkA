# Created and developed by Jai Singh
"""
JSON-RPC 2.0 framing + error codes for the OmniAgent v2 helper.

Wire format (one JSON object per line on stdin/stdout):

  Request    : {"jsonrpc":"2.0","id":<int|str>,"method":"<dotted>","params":{...}}
  Response OK: {"jsonrpc":"2.0","id":<int|str>,"result":{...}}
  Response E : {"jsonrpc":"2.0","id":<int|str>,"error":{"code":-32602,"message":"...","data":{...}}}
  Notification (server → client, no id):
               {"jsonrpc":"2.0","method":"log","params":{...}}

Error codes follow the JSON-RPC 2.0 spec where applicable (-32700, -32600,
-32601, -32602, -32603) and add an OmniAgent-specific range (-32000 … -32099)
for transport-agnostic agent errors. Worker A's `agent-rpc` Rust crate
mirrors these codes 1:1.
"""

from __future__ import annotations

import json
import traceback
from dataclasses import dataclass, field
from typing import Any, Optional, Union


# ---------------------------------------------------------------------------
#  Error codes
# ---------------------------------------------------------------------------
# JSON-RPC 2.0 reserved range (-32768 … -32000)
PARSE_ERROR = -32700           # Invalid JSON received
INVALID_REQUEST = -32600       # Not a valid Request object
METHOD_NOT_FOUND = -32601      # Method does not exist
INVALID_PARAMS = -32602        # Invalid params (missing field, wrong type, ...)
INTERNAL_ERROR = -32603        # Server hit an unexpected exception

# OmniAgent-specific application errors (-32000 … -32099)
SAP_NOT_CONNECTED = -32001
SLOT_BUSY = -32002
SLOT_NOT_FOUND = -32003
SAP_HARD_ERROR = -32004        # SAP returned an E/A status-bar message
COM_INIT_FAILED = -32005
HANDLER_TIMEOUT = -32006
HELPER_SHUTTING_DOWN = -32007


# ---------------------------------------------------------------------------
#  RpcError — what handlers raise to map cleanly to JSON-RPC error frames
# ---------------------------------------------------------------------------
class RpcError(Exception):
    """Raised by handlers / dispatcher to produce a structured JSON-RPC
    error response. Ordinary Python exceptions are caught at the top of
    `handle_request` and converted into `INTERNAL_ERROR` automatically."""

    def __init__(self, code: int, message: str, data: Optional[dict] = None) -> None:
        super().__init__(message)
        self.code = int(code)
        self.message = str(message)
        self.data = data or {}

    def to_dict(self) -> dict:
        out: dict = {"code": self.code, "message": self.message}
        if self.data:
            out["data"] = self.data
        return out

    @classmethod
    def invalid_params(cls, message: str, **data: Any) -> "RpcError":
        return cls(INVALID_PARAMS, f"Invalid params: {message}", data or None)

    @classmethod
    def method_not_found(cls, method: str) -> "RpcError":
        return cls(METHOD_NOT_FOUND, f"Method not found: {method}",
                   {"method": method})

    @classmethod
    def slot_busy(cls, slot_id: int, last_op: str = "") -> "RpcError":
        return cls(SLOT_BUSY, f"Slot {slot_id} is busy",
                   {"slot_id": slot_id, "last_op": last_op})

    @classmethod
    def slot_not_found(cls, slot_id: int) -> "RpcError":
        return cls(SLOT_NOT_FOUND, f"No such slot: {slot_id}",
                   {"slot_id": slot_id})

    @classmethod
    def sap_not_connected(cls, slot_id: Optional[int] = None) -> "RpcError":
        data: dict = {}
        if slot_id is not None:
            data["slot_id"] = slot_id
        return cls(SAP_NOT_CONNECTED, "SAP not connected", data or None)

    @classmethod
    def from_exception(cls, exc: BaseException, *, include_trace: bool = True) -> "RpcError":
        data: dict = {"exception": type(exc).__name__}
        if include_trace:
            data["trace"] = "".join(
                traceback.format_exception(type(exc), exc, exc.__traceback__)
            )[-4000:]
        return cls(INTERNAL_ERROR, str(exc) or type(exc).__name__, data)


# ---------------------------------------------------------------------------
#  Request / Response models
# ---------------------------------------------------------------------------
@dataclass
class RpcRequest:
    """Parsed JSON-RPC request frame."""

    method: str
    params: dict = field(default_factory=dict)
    id: Optional[Union[int, str]] = None  # None == notification
    jsonrpc: str = "2.0"

    @classmethod
    def from_obj(cls, obj: Any) -> "RpcRequest":
        """Validate a parsed JSON object as a JSON-RPC 2.0 Request.

        Raises RpcError on shape violations so the dispatcher can emit
        the right INVALID_REQUEST / PARSE_ERROR frame back.
        """
        if not isinstance(obj, dict):
            raise RpcError(INVALID_REQUEST, "Request must be a JSON object",
                           {"received_type": type(obj).__name__})

        version = obj.get("jsonrpc")
        if version != "2.0":
            raise RpcError(INVALID_REQUEST,
                           "Only jsonrpc='2.0' is supported",
                           {"jsonrpc": version})

        method = obj.get("method")
        if not isinstance(method, str) or not method:
            raise RpcError(INVALID_REQUEST,
                           "Request missing string `method`",
                           {"method": method})

        # Notifications omit `id`; requests carry int or str.
        rid = obj.get("id", None)
        if rid is not None and not isinstance(rid, (int, str)):
            raise RpcError(INVALID_REQUEST,
                           "`id` must be int, string, or absent",
                           {"id_type": type(rid).__name__})

        params = obj.get("params", {})
        if params is None:
            params = {}
        if not isinstance(params, dict):
            # We don't accept positional params (list); the contract is
            # named-only because every Worker A agent-types method emits
            # an object.
            raise RpcError(INVALID_PARAMS,
                           "`params` must be a JSON object",
                           {"params_type": type(params).__name__})

        return cls(method=method, params=params, id=rid, jsonrpc=version)

    @property
    def is_notification(self) -> bool:
        return self.id is None


def make_response(req_id: Union[int, str, None],
                  *,
                  result: Any = None,
                  error: Optional[dict] = None) -> dict:
    """Build a JSON-RPC 2.0 response frame.

    Exactly one of `result` / `error` must be set. `req_id` may be None,
    int, or string; if None we still emit `id: null` (the JSON-RPC spec
    requires the `id` member to be present on every response, even when
    the matching request was malformed).
    """
    if (result is None) == (error is None):
        raise ValueError(
            "make_response: exactly one of `result` or `error` must be set"
        )
    out: dict = {"jsonrpc": "2.0", "id": req_id}
    if error is not None:
        out["error"] = error
    else:
        out["result"] = result
    return out


def make_notification(method: str, params: Optional[dict] = None) -> dict:
    """Build a JSON-RPC 2.0 notification frame (no id, server → client)."""
    out: dict = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        out["params"] = params
    return out


# ---------------------------------------------------------------------------
#  Line-delimited JSON I/O helpers
# ---------------------------------------------------------------------------
def encode_frame(obj: dict) -> bytes:
    """Encode a JSON-RPC frame as a single UTF-8 line ending in '\n'."""
    return (json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
            + "\n").encode("utf-8")


def decode_frame(line: Union[str, bytes]) -> dict:
    """Decode a single line of UTF-8 JSON. Raises RpcError(PARSE_ERROR)
    on invalid JSON so the caller can emit the right frame."""
    if isinstance(line, bytes):
        line = line.decode("utf-8", errors="replace")
    line = line.strip()
    if not line:
        raise RpcError(PARSE_ERROR, "Empty line")
    try:
        return json.loads(line)
    except json.JSONDecodeError as e:
        raise RpcError(PARSE_ERROR, f"Invalid JSON: {e.msg}",
                       {"line": line[:200], "pos": e.pos}) from e


__all__ = [
    "PARSE_ERROR", "INVALID_REQUEST", "METHOD_NOT_FOUND",
    "INVALID_PARAMS", "INTERNAL_ERROR",
    "SAP_NOT_CONNECTED", "SLOT_BUSY", "SLOT_NOT_FOUND",
    "SAP_HARD_ERROR", "COM_INIT_FAILED", "HANDLER_TIMEOUT",
    "HELPER_SHUTTING_DOWN",
    "RpcError", "RpcRequest",
    "make_response", "make_notification",
    "encode_frame", "decode_frame",
]

# Created and developed by Jai Singh
