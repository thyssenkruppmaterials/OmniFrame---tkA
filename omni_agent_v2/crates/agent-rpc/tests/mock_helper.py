# Created and developed by Jai Singh
"""Deterministic mock helper for `agent-rpc` integration tests.

Reads line-delimited JSON-RPC requests from stdin and echoes:

  * `sap.connect`   → {"ok": true, "slot_id": <from params>}
  * `sap.confirmTo` → {"ok": true, "to_number": <from params>}
  * `sap.crash`     → exits with code 2 (used to test the supervisor's
                      crash + restart behaviour)
  * `sap.notify`    → emits a one-way notification then a normal
                      response. Lets tests verify the broadcast channel.
  * anything else   → {"error": {"code": -32601, "message": "method not found"}}

Stderr is used for the supervisor's WARN-level relay so tests can
exercise the "stderr line shows up in tracing" path.

This script is INTENTIONALLY tiny + dep-free so the integration test
can spawn it directly via `python3 mock_helper.py` without any
PyPI install step.
"""

from __future__ import annotations

import json
import sys
import time


def respond(id_, result=None, error=None):
    body = {"jsonrpc": "2.0", "id": id_}
    if error is not None:
        body["error"] = error
    else:
        body["result"] = result
    sys.stdout.write(json.dumps(body) + "\n")
    sys.stdout.flush()


def notify(method, params):
    body = {"jsonrpc": "2.0", "method": method, "params": params}
    sys.stdout.write(json.dumps(body) + "\n")
    sys.stdout.flush()


def handle(req):
    method = req.get("method", "")
    id_ = req.get("id")
    params = req.get("params") or {}

    if method == "sap.connect":
        respond(id_, {"ok": True, "slot_id": params.get("slot_id", 0)})
    elif method == "sap.confirmTo":
        respond(id_, {"ok": True, "to_number": params.get("to_number", "")})
    elif method == "sap.crash":
        sys.stderr.write("mock_helper: simulating crash on demand\n")
        sys.stderr.flush()
        sys.exit(2)
    elif method == "sap.notify":
        notify("log.line", {"line": "hello from helper", "level": "info"})
        respond(id_, {"ok": True})
    elif method == "sap.sleep":
        ms = int(params.get("ms", 100))
        time.sleep(ms / 1000.0)
        respond(id_, {"ok": True, "slept_ms": ms})
    else:
        respond(id_, error={"code": -32601, "message": f"method not found: {method}"})


def main():
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
        except Exception as e:
            sys.stderr.write(f"mock_helper: bad JSON: {e}\n")
            continue
        handle(req)


if __name__ == "__main__":
    main()

# Created and developed by Jai Singh
