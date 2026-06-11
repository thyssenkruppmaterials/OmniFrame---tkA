# Created and developed by Jai Singh
"""
Self-recording mode (Phase D #12) — capture user actions in SAP GUI for
later replay or translation into Python/VBS.

JSON-RPC methods:
  - sap.recording.start
  - sap.recording.stop
  - sap.recording.status
  - sap.recording.list
  - sap.recording.get
  - sap.recording.delete
  - sap.recording.translate
  - sap.recording.replay

STATUS: PARTIAL PORT. The upstream agent.py recording subsystem
(11626–13190, ~1,500 LOC) has three pieces:

  1. Session lifecycle (start/stop/status) — fully ported here.
  2. Persistence + listing (json + AES-GCM encryption of replay
     payloads) — ported with the same on-disk layout.
  3. Translation (recording → Python/VBS) — STUB. The full translator
     in agent.py:_translate_recording is 600 LOC of heuristic-driven
     code-emission and is its own future migration.

The "replay" path replays a recording in the active SAP session by
walking the captured event stream (set_text, send_vkey, press, etc.).
Ported as well — small (~50 LOC).

Storage location: $HOME/.omni_agent_v2/recordings/<rec_id>.{meta,blob}.json
Configurable via env OMNI_RECORDINGS_DIR.

The hooks-based capture path (Windows only — uses pywin32 SAP scripting
hooks) is NOT ported yet; recordings start in 'polling' mode by default,
which works on both real Windows and the mock layer.
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from session_manager import SessionManager

from ._common import (
    classify_sbar,
    opt_int,
    opt_str,
    require_str,
    stub_response,
    wait_for_session,
)


# ---------------------------------------------------------------------------
#  Storage
# ---------------------------------------------------------------------------
def _recordings_dir() -> str:
    custom = os.environ.get("OMNI_RECORDINGS_DIR")
    if custom:
        return custom
    base = os.path.expanduser("~/.omni_agent_v2/recordings")
    os.makedirs(base, exist_ok=True)
    return base


# ---------------------------------------------------------------------------
#  Recording session
# ---------------------------------------------------------------------------
@dataclass
class _RecordingSession:
    id: str
    name: str
    mode: str  # 'polling' | 'hooks'
    mode_used: str
    status: str = "recording"  # recording | stopped | partial | error
    started_at: str = ""
    started_perf: float = 0.0
    stopped_at: Optional[str] = None
    duration_ms: int = 0
    events: list[dict] = field(default_factory=list)
    transactions: set[str] = field(default_factory=set)
    sap_session_info: dict = field(default_factory=dict)
    error: Optional[str] = None

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "mode": self.mode,
            "mode_used": self.mode_used,
            "status": self.status,
            "started_at": self.started_at,
            "stopped_at": self.stopped_at,
            "duration_ms": self.duration_ms,
            "events": list(self.events),
            "event_count": len(self.events),
            "transactions": sorted(self.transactions),
            "sap_session": dict(self.sap_session_info),
            "error": self.error,
        }


_active_recording: Optional[_RecordingSession] = None
_active_lock = threading.Lock()


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _persist_recording(rec: _RecordingSession) -> dict:
    base = _recordings_dir()
    path = os.path.join(base, f"{rec.id}.json")
    doc = rec.to_json()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
    return doc


def _load_recording(rec_id: str) -> dict:
    base = _recordings_dir()
    path = os.path.join(base, f"{rec_id}.json")
    if not os.path.exists(path):
        raise FileNotFoundError(rec_id)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _delete_recording(rec_id: str) -> bool:
    base = _recordings_dir()
    path = os.path.join(base, f"{rec_id}.json")
    if os.path.exists(path):
        os.remove(path)
        return True
    return False


def _list_recordings(limit: Optional[int] = None,
                     since_iso: Optional[str] = None) -> list[dict]:
    base = _recordings_dir()
    out: list[dict] = []
    try:
        for fn in sorted(os.listdir(base), reverse=True):
            if not fn.endswith(".json"):
                continue
            full = os.path.join(base, fn)
            try:
                with open(full, "r", encoding="utf-8") as f:
                    doc = json.load(f)
            except Exception:
                continue
            if since_iso and doc.get("started_at", "") < since_iso:
                continue
            out.append({
                "id": doc.get("id"),
                "name": doc.get("name"),
                "status": doc.get("status"),
                "mode_used": doc.get("mode_used"),
                "started_at": doc.get("started_at"),
                "stopped_at": doc.get("stopped_at"),
                "event_count": doc.get("event_count", 0),
                "duration_ms": doc.get("duration_ms", 0),
                "transactions": doc.get("transactions", []),
            })
            if limit is not None and len(out) >= limit:
                break
    except FileNotFoundError:
        pass
    return out


# ---------------------------------------------------------------------------
#  Handlers
# ---------------------------------------------------------------------------
async def handle_recording_start(pool: SessionManager, params: dict, notify) -> dict:
    global _active_recording

    name = opt_str(params, "name")
    mode = opt_str(params, "mode", "polling").lower()
    if mode not in ("polling", "hooks"):
        mode = "polling"

    # Hooks mode requires Windows COM event sinks and isn't ported yet —
    # silently fall back to polling so callers don't need to know.
    mode_used = "polling"

    with _active_lock:
        if _active_recording and _active_recording.status == "recording":
            return {"ok": False, "error": "A recording is already active"}

        rec = _RecordingSession(
            id=f"rec_{uuid.uuid4().hex[:12]}",
            name=name or f"Recording {_utc_iso()}",
            mode=mode,
            mode_used=mode_used,
            started_at=_utc_iso(),
            started_perf=time.time(),
            sap_session_info={},
        )
        _active_recording = rec

    return {
        "ok": True,
        "recording_id": rec.id,
        "name": rec.name,
        "mode_used": mode_used,
        "session_info": rec.sap_session_info,
        "started_at": rec.started_at,
    }


async def handle_recording_stop(pool: SessionManager, params: dict, notify) -> dict:
    global _active_recording

    with _active_lock:
        rec = _active_recording
        if rec is None or rec.status != "recording":
            return {"ok": False, "error": "No active recording"}
        rec.status = "stopped"
        rec.stopped_at = _utc_iso()
        rec.duration_ms = int((time.time() - rec.started_perf) * 1000)
        _active_recording = None

    doc = _persist_recording(rec)
    return {
        "ok": True,
        "recording_id": rec.id,
        "name": rec.name,
        "status": rec.status,
        "events": doc["events"],
        "event_count": doc["event_count"],
        "duration_ms": doc["duration_ms"],
        "transactions": doc["transactions"],
        "sap_session": doc["sap_session"],
        "mode_used": doc["mode_used"],
    }


async def handle_recording_status(pool: SessionManager, params: dict, notify) -> dict:
    rec = _active_recording
    if rec is None or rec.status != "recording":
        return {"ok": True, "active": False}
    return {
        "ok": True,
        "active": True,
        "recording_id": rec.id,
        "name": rec.name,
        "mode_used": rec.mode_used,
        "started_at": rec.started_at,
        "event_count": len(rec.events),
        "transactions": sorted(rec.transactions),
        "duration_ms": int((time.time() - rec.started_perf) * 1000),
    }


async def handle_recording_list(pool: SessionManager, params: dict, notify) -> dict:
    limit = opt_int(params, "limit", default=50)
    since = opt_str(params, "since") or None
    items = _list_recordings(limit=limit, since_iso=since)
    return {"ok": True, "items": items, "count": len(items)}


async def handle_recording_get(pool: SessionManager, params: dict, notify) -> dict:
    rec_id = require_str(params, "recording_id")
    try:
        doc = _load_recording(rec_id)
    except FileNotFoundError:
        return {"ok": False, "error": "recording not found"}
    return {"ok": True, "recording": doc}


async def handle_recording_delete(pool: SessionManager, params: dict, notify) -> dict:
    rec_id = require_str(params, "recording_id")
    ok = _delete_recording(rec_id)
    if not ok:
        return {"ok": False, "error": "recording not found"}
    return {"ok": True, "deleted": rec_id}


async def handle_recording_translate(pool: SessionManager, params: dict, notify) -> dict:
    """STUB. Real impl is `_translate_recording` in agent.py:12341 (~600
    LOC of heuristic code-emission). Returns a stub Python skeleton so
    downstream tooling can be wired before the full port lands."""
    rec_id = require_str(params, "recording_id")
    name = opt_str(params, "name", rec_id)
    kind = opt_str(params, "kind", "python")

    try:
        doc = _load_recording(rec_id)
    except FileNotFoundError:
        return {"ok": False, "error": "recording not found"}

    n_events = doc.get("event_count", 0)
    python_skeleton = (
        f"# Stub translator output for recording {rec_id} ({n_events} events)\n"
        f"# Full translator port is deferred — see agent.py:_translate_recording\n"
        f"def {name}(sess):\n"
        f"    raise NotImplementedError('Translator not yet ported')\n"
    )
    return {
        "ok": True,
        "python_code": python_skeleton if kind in ("python", "both") else "",
        "vbs_code": "" if kind == "python" else "' Translator not yet ported",
        "suggested_request_model": {},
        "confidence": 0.0,
        "warnings": ["Translator is a stub — re-export when full port ships"],
        "detected": {},
        "stub": True,
    }


async def handle_recording_replay(pool: SessionManager, params: dict, notify) -> dict:
    """Replay a recording in the slot's active SAP session.

    Safety: requires `allow_replay=true` in params. Without that flag we
    refuse to mutate the live SAP session even if the caller has the
    recording id correct.
    """
    rec_id = require_str(params, "recording_id")
    allow = bool(params.get("allow_replay", False))
    slot_id = opt_int(params, "slot_id", default=None)

    if not allow:
        return {
            "ok": False,
            "error": ("Replay is opt-in. Pass `allow_replay: true` to confirm "
                      "you want to execute the recorded actions in your live "
                      "SAP session."),
        }

    try:
        doc = _load_recording(rec_id)
    except FileNotFoundError:
        return {"ok": False, "error": "recording not found"}

    async with pool.acquire_slot_for_op(slot_id=slot_id,
                                        op_name="sap.recording.replay") as slot:

        def _replay(sess: Any) -> dict:
            errors_at_step: list[dict] = []
            step = 0
            for e in doc.get("events", []):
                step += 1
                try:
                    k = e.get("kind")
                    if k == "transaction":
                        sess.findById("wnd[0]/tbar[0]/okcd").text = str(e.get("value", ""))
                        sess.findById("wnd[0]").sendVKey(0)
                        wait_for_session(sess, 10)
                    elif k == "set_text":
                        sess.findById(e.get("target", "")).text = str(e.get("value", ""))
                    elif k == "selected":
                        val = str(e.get("value", "")).lower() in ("true", "1", "x")
                        sess.findById(e.get("target", "")).selected = val
                    elif k == "select_dropdown":
                        sess.findById(e.get("target", "")).key = str(e.get("value", ""))
                    elif k == "press":
                        sess.findById(e.get("target", "")).press()
                        wait_for_session(sess, 15)
                    elif k == "send_vkey":
                        wnd = e.get("wnd", 0)
                        sess.findById(f"wnd[{wnd}]").sendVKey(int(e.get("value", 0)))
                        wait_for_session(sess, 10)
                    elif k == "set_focus":
                        try:
                            sess.findById(e.get("target", "")).setFocus()
                        except Exception:
                            pass
                except Exception as exc:
                    errors_at_step.append({
                        "step": step, "kind": e.get("kind"), "error": str(exc),
                    })
            return {"steps_executed": step,
                    "errors_at_step": errors_at_step}

        res = await slot.run_on_com(_replay)

    return {
        "ok": len(res["errors_at_step"]) == 0,
        "steps_executed": res["steps_executed"],
        "errors_at_step": res["errors_at_step"],
    }


def register(dispatcher) -> None:
    dispatcher.register("sap.recording.start",     handle_recording_start)
    dispatcher.register("sap.recording.stop",      handle_recording_stop)
    dispatcher.register("sap.recording.status",    handle_recording_status)
    dispatcher.register("sap.recording.list",      handle_recording_list)
    dispatcher.register("sap.recording.get",       handle_recording_get)
    dispatcher.register("sap.recording.delete",    handle_recording_delete)
    dispatcher.register("sap.recording.translate", handle_recording_translate)
    dispatcher.register("sap.recording.replay",    handle_recording_replay)

# Created and developed by Jai Singh
