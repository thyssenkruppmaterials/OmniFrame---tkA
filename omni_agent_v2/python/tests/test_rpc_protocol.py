# Created and developed by Jai Singh
"""
Unit tests for rpc_protocol.py — JSON-RPC framing + error codes.
Runs anywhere (no Windows / COM dependency).
"""
from __future__ import annotations

import json

import pytest

from rpc_protocol import (
    INTERNAL_ERROR,
    INVALID_PARAMS,
    INVALID_REQUEST,
    METHOD_NOT_FOUND,
    PARSE_ERROR,
    RpcError,
    RpcRequest,
    decode_frame,
    encode_frame,
    make_notification,
    make_response,
)


# ---------------------------------------------------------------------------
#  RpcRequest.from_obj
# ---------------------------------------------------------------------------
class TestRpcRequest:
    def test_valid_request_parses(self):
        req = RpcRequest.from_obj({
            "jsonrpc": "2.0",
            "id": 42,
            "method": "sap.confirmTo",
            "params": {"to_number": "12345", "warehouse": "WH5"},
        })
        assert req.method == "sap.confirmTo"
        assert req.params == {"to_number": "12345", "warehouse": "WH5"}
        assert req.id == 42
        assert not req.is_notification

    def test_string_id_is_accepted(self):
        req = RpcRequest.from_obj({"jsonrpc": "2.0", "id": "abc",
                                    "method": "x"})
        assert req.id == "abc"

    def test_notification_has_no_id(self):
        req = RpcRequest.from_obj({"jsonrpc": "2.0", "method": "log",
                                    "params": {}})
        assert req.is_notification
        assert req.id is None

    def test_missing_method_rejected(self):
        with pytest.raises(RpcError) as exc:
            RpcRequest.from_obj({"jsonrpc": "2.0", "id": 1})
        assert exc.value.code == INVALID_REQUEST

    def test_wrong_jsonrpc_version_rejected(self):
        with pytest.raises(RpcError) as exc:
            RpcRequest.from_obj({"jsonrpc": "1.0", "id": 1, "method": "x"})
        assert exc.value.code == INVALID_REQUEST

    def test_non_object_payload_rejected(self):
        with pytest.raises(RpcError) as exc:
            RpcRequest.from_obj([1, 2, 3])
        assert exc.value.code == INVALID_REQUEST

    def test_list_params_rejected(self):
        # We require named params (object), not positional (list).
        with pytest.raises(RpcError) as exc:
            RpcRequest.from_obj({"jsonrpc": "2.0", "id": 1,
                                  "method": "x", "params": [1, 2]})
        assert exc.value.code == INVALID_PARAMS

    def test_missing_params_defaults_to_empty(self):
        req = RpcRequest.from_obj({"jsonrpc": "2.0", "id": 1, "method": "x"})
        assert req.params == {}

    def test_null_params_treated_as_empty(self):
        req = RpcRequest.from_obj({"jsonrpc": "2.0", "id": 1, "method": "x",
                                    "params": None})
        assert req.params == {}

    def test_float_id_rejected(self):
        with pytest.raises(RpcError) as exc:
            RpcRequest.from_obj({"jsonrpc": "2.0", "id": 1.5, "method": "x"})
        assert exc.value.code == INVALID_REQUEST


# ---------------------------------------------------------------------------
#  RpcError factories
# ---------------------------------------------------------------------------
class TestRpcError:
    def test_invalid_params_factory(self):
        e = RpcError.invalid_params("missing field x", field="x")
        assert e.code == INVALID_PARAMS
        assert "missing field x" in e.message
        assert e.data["field"] == "x"

    def test_method_not_found_factory(self):
        e = RpcError.method_not_found("sap.unknown")
        assert e.code == METHOD_NOT_FOUND
        assert e.data["method"] == "sap.unknown"

    def test_to_dict_omits_empty_data(self):
        e = RpcError(INTERNAL_ERROR, "boom")
        d = e.to_dict()
        assert d == {"code": INTERNAL_ERROR, "message": "boom"}

    def test_to_dict_includes_data(self):
        e = RpcError(INTERNAL_ERROR, "boom", {"foo": 1})
        assert e.to_dict()["data"] == {"foo": 1}

    def test_from_exception_captures_trace(self):
        try:
            raise ValueError("nope")
        except ValueError as exc:
            err = RpcError.from_exception(exc)
        assert err.code == INTERNAL_ERROR
        assert "nope" in err.message
        assert "trace" in err.data


# ---------------------------------------------------------------------------
#  make_response / make_notification
# ---------------------------------------------------------------------------
class TestResponseFraming:
    def test_make_response_success(self):
        r = make_response(42, result={"foo": 1})
        assert r == {"jsonrpc": "2.0", "id": 42, "result": {"foo": 1}}

    def test_make_response_error(self):
        r = make_response(42, error={"code": -32600, "message": "bad"})
        assert r["error"]["code"] == -32600
        assert "result" not in r

    def test_make_response_requires_exactly_one(self):
        with pytest.raises(ValueError):
            make_response(1, result={"a": 1}, error={"code": -1, "message": "x"})
        with pytest.raises(ValueError):
            make_response(1)

    def test_make_response_with_null_id(self):
        # Even when the request had no parseable id, JSON-RPC 2.0
        # requires `id: null` on the response.
        r = make_response(None, error={"code": -32700, "message": "parse"})
        assert r["id"] is None

    def test_make_notification(self):
        n = make_notification("log", {"level": "info", "message": "hi"})
        assert n == {"jsonrpc": "2.0", "method": "log",
                     "params": {"level": "info", "message": "hi"}}

    def test_make_notification_no_params(self):
        n = make_notification("ping")
        assert n == {"jsonrpc": "2.0", "method": "ping"}


# ---------------------------------------------------------------------------
#  encode_frame / decode_frame
# ---------------------------------------------------------------------------
class TestFraming:
    def test_encode_terminates_with_newline(self):
        data = encode_frame({"jsonrpc": "2.0", "method": "x"})
        assert data.endswith(b"\n")
        assert json.loads(data.decode("utf-8")) == {"jsonrpc": "2.0",
                                                     "method": "x"}

    def test_encode_no_internal_newlines(self):
        data = encode_frame({"jsonrpc": "2.0", "id": 1, "result": "hello"})
        # Exactly one newline at the end (compact JSON).
        assert data.count(b"\n") == 1

    def test_decode_valid_line(self):
        line = b'{"jsonrpc":"2.0","id":1,"method":"x"}\n'
        obj = decode_frame(line)
        assert obj["method"] == "x"

    def test_decode_invalid_json_raises_parse_error(self):
        with pytest.raises(RpcError) as exc:
            decode_frame(b"{not json")
        assert exc.value.code == PARSE_ERROR

    def test_decode_empty_line_raises_parse_error(self):
        with pytest.raises(RpcError) as exc:
            decode_frame(b"   \n")
        assert exc.value.code == PARSE_ERROR

    def test_round_trip(self):
        original = {"jsonrpc": "2.0", "id": "abc", "method": "ping",
                    "params": {"x": 1}}
        encoded = encode_frame(original)
        decoded = decode_frame(encoded)
        assert decoded == original

    def test_decode_unicode(self):
        line = '{"jsonrpc":"2.0","id":1,"method":"x","params":{"name":"Müller"}}\n'
        obj = decode_frame(line)
        assert obj["params"]["name"] == "Müller"

# Created and developed by Jai Singh
