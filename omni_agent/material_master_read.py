# Created and developed by Jai Singh
"""
Phase D #11 — Material Master dry-run / preview helpers (Worker B).

Read-only MM03 navigators that surface the *current* warehouse-level
fields a forthcoming MM02 mutation would overwrite. Frontend uses these
to render a diff modal so users can confirm before committing a 500+ row
batch.

Design notes:
    - Mirrors the navigation in `agent.handler_material_master_bin` and
      `agent.handler_material_master_storage_types` but uses `/nMM03`
      (display mode) and never presses Save (`btn[11]`). Backs out cleanly
      with `/n` so the next call starts from a known state.
    - Imports the agent's shared SAP helpers (`_get_sap_session`,
      `_wait_for_session`, `_classify_sbar`, `_walk_gui_tree`, `_safe_get`,
      `state`, `_with_retries`, `_log_sap_txn`, `_track_metric`) instead
      of duplicating them. The agent loads this module via
      `app.include_router(...)` at boot so the imports resolve from the
      already-loaded `agent` package.
    - Wrapped in `_with_retries` for navigation-only steps (open tx,
      org-levels press, tab select). Reads themselves are not retried;
      a missing field returns `current_*=None` so the UI can display
      "—" rather than failing the whole row.
    - Capabilities: `mm03-read-bin`, `mm03-read-storage-types` — declared
      via `# WORKER-B-CAPABILITIES` comment in agent.py for foreground
      merge into `AGENT_CAPABILITIES`.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

# v1.6.4 — Lazy bridge into the parent `agent` module.
#
# Previously this module did `from agent import (_classify_sbar, ...)` at
# module load time. That worked when run from source but emitted
# `[boot] WARN material_master_read import failed: cannot import name
# 'router' from partially initialized module 'material_master_read'
# (most likely due to a circular import)` under PyInstaller's --onefile
# bootloader, which preloads bundled modules before agent.py finishes
# its top-level execution. The retry inside agent.py's
# `try: from material_master_read import router` swallowed the failure
# (the second attempt succeeds because agent.py is fully loaded by then),
# but the WARN was cosmetic noise on every boot.
#
# Fix: defer the agent-symbol resolution until a handler actually runs.
# By that time agent.py is guaranteed loaded — both the `__main__`
# entrypoint AND the `app.include_router(...)` call at the bottom of
# agent.py have completed. The `_track_metric` decorator below is the
# only thing that needs the bridge at module-load time, so it gets a
# thin lazy-resolving wrapper.

def _agent():
    """Return the `agent` module. Cached in sys.modules after the first
    real import, so this is essentially free on every call."""
    import agent  # type: ignore[import-not-found]
    return agent


def _track_metric(action: str):  # noqa: N802 — mirrors agent.py's name
    """Lazy proxy for `agent._track_metric`. Resolves the real decorator
    on first invocation and caches the wrapped function so subsequent
    calls have zero overhead. Lets us write `@_track_metric('foo')` at
    module scope without forcing an `import agent` during the partial-
    init window the PyInstaller bootloader exposes."""
    def decorator(fn):
        cache: list = []

        from functools import wraps

        @wraps(fn)
        def wrapped(*args, **kwargs):
            if not cache:
                cache.append(_agent()._track_metric(action)(fn))
            return cache[0](*args, **kwargs)

        return wrapped

    return decorator


_AGENT_GLOBALS_RESOLVED = False


def _resolve_agent_globals() -> None:
    """Bind the agent helper symbols into THIS module's globals so the
    handlers below can call them as bare names (`_classify_sbar(sess)`,
    `state.sap_connected`, etc.). Idempotent. Called from each handler
    entry point so the resolution happens at FIRST request — by which
    time agent.py is fully loaded and uvicorn is serving traffic, so the
    PyInstaller circular-import warning that v1.6.3 emitted at boot
    can't recur."""
    global _AGENT_GLOBALS_RESOLVED
    if _AGENT_GLOBALS_RESOLVED:
        return
    a = _agent()
    g = globals()
    for name in (
        "_classify_sbar",
        "_get_sap_session",
        "_log_sap_txn",
        "_walk_gui_tree",
        "_wait_for_session",
        "_with_retries",
        "state",
    ):
        g[name] = getattr(a, name)
    _AGENT_GLOBALS_RESOLVED = True


router = APIRouter()


# ---------------------------------------------------------------------------
#  Request / Response Models
# ---------------------------------------------------------------------------
class ReadBinRequest(BaseModel):
    """Inputs mirror `MaterialMasterBinRequest` so the frontend can re-use
    the same CSV row payload it would send to the MM02 mutation."""

    material: str
    plant: str
    warehouse: str
    storage_type: str


class ReadBinResponse(BaseModel):
    ok: bool
    material: str
    current_bin: Optional[str] = None
    error: Optional[str] = None
    step: Optional[str] = None


class ReadStorageTypesRequest(BaseModel):
    """Inputs mirror `MaterialMasterStorageTypesRequest` (sans the
    proposed values) so the frontend can re-use the CSV row payload."""

    material: str
    plant: str
    warehouse: str
    org_storage_type: str


class ReadStorageTypesResponse(BaseModel):
    ok: bool
    material: str
    current_removal: Optional[str] = None
    current_placement: Optional[str] = None
    error: Optional[str] = None
    step: Optional[str] = None


# ---------------------------------------------------------------------------
#  Helpers
# ---------------------------------------------------------------------------
def _exit_to_main(sess) -> None:
    """Send `/n` to leave whatever screen we're on so the next call
    starts at the SAP Easy Access menu. Idempotent and forgiving — any
    failure is swallowed because the next `/nMM03` will reset us anyway."""
    try:
        sess.findById("wnd[0]/tbar[0]/okcd").text = "/n"
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 5)
    except Exception:
        pass


def _find_field_text(sess, primary_id: str, suffix: str) -> Optional[str]:
    """Resolve a field by its long ID first; fall back to a tree walk
    matching the trailing path segment. Returns the field's text or
    None if the control isn't present. Empty string is preserved (i.e.
    a present-but-blank field returns "" not None — the caller can
    distinguish "no current value" from "no field at all")."""
    try:
        node = sess.findById(primary_id)
        return str(node.text or "")
    except Exception:
        pass
    nodes: list = []
    try:
        _walk_gui_tree(sess.findById("wnd[0]/usr"), nodes)
    except Exception:
        return None
    for nid, ntype, node in nodes:
        if ntype in ("GuiCTextField", "GuiTextField") and nid.endswith(suffix):
            try:
                return str(node.text or "")
            except Exception:
                return None
    return None


def _open_mm03_for_material(sess, material: str) -> tuple[bool, Optional[str], Optional[str]]:
    """Step 1 + 2 — open MM03 and type the material. Returns
    `(ok, error, step)` so callers can surface SAP's status-bar message
    consistently with the MM02 mutation handlers."""

    def _open():
        sess.findById("wnd[0]/tbar[0]/okcd").text = "/nMM03"
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 15)

    try:
        _with_retries(_open, label="MM03 open")
    except Exception as e:
        return False, f"Could not open MM03: {e}", "open_mm03"

    try:
        sess.findById("wnd[0]/usr/ctxtRMMG1-MATNR").text = material
    except Exception as e:
        return False, f"Could not set material RMMG1-MATNR: {e}", "initial_screen"
    return True, None, None


def _press_org_levels(sess, material: str) -> tuple[bool, Optional[str], Optional[str]]:
    """Step 3 — open the Organizational Levels popup, surfacing
    "material not found" / "no authorization" hard-errors as ok=False."""

    def _press():
        try:
            sess.findById("wnd[0]/tbar[1]/btn[6]").press()
        except Exception:
            sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 15)

    try:
        _with_retries(_press, label="MM03 org-levels press")
    except Exception as e:
        return False, f"Could not open Org Levels popup: {e}", "org_levels_popup"

    sbar, msg_type = _classify_sbar(sess)
    sbar_lower = sbar.lower()
    if msg_type in ("E", "A"):
        return False, sbar or "Material initial screen rejected", "initial_screen"
    for err in ("does not exist", "not found", "no authorization", "is locked"):
        if err in sbar_lower:
            return False, sbar, "initial_screen"
    return True, None, None


def _confirm_org_levels(
    sess,
    *,
    plant: str,
    warehouse: str,
    storage_type: str,
) -> tuple[bool, Optional[str], Optional[str]]:
    """Step 4 — fill the popup and Enter to load the WM views. Same
    failure semantics as the MM02 handlers (so the frontend can render
    a consistent "would-fail" badge)."""
    try:
        sess.findById("wnd[1]/usr/ctxtRMMG1-WERKS").text = plant
        sess.findById("wnd[1]/usr/ctxtRMMG1-LGNUM").text = warehouse
        sess.findById("wnd[1]/usr/ctxtRMMG1-LGTYP").text = storage_type
    except Exception as e:
        return False, f"Could not fill org-levels popup: {e}", "org_levels_popup"
    try:
        sess.findById("wnd[1]/usr/chkUSRM1-ASCHL").setFocus()
    except Exception:
        pass
    try:
        sess.findById("wnd[1]").sendVKey(0)
        _wait_for_session(sess, 20)
    except Exception as e:
        return False, f"Could not confirm Org Levels popup: {e}", "org_levels_popup"

    sbar, msg_type = _classify_sbar(sess)
    if msg_type in ("E", "A"):
        return False, sbar or "Org Levels rejected", "org_levels_popup"
    return True, None, None


# ---------------------------------------------------------------------------
#  /sap/material-master-read-bin
# ---------------------------------------------------------------------------
@router.post("/sap/material-master-read-bin")
@_track_metric("material_master_read_bin")
def read_bin(req: ReadBinRequest) -> dict:
    """Open MM03 (display mode), navigate to Warehouse Mgmt 2, read
    `MLGT-LGPLA`, then back out without saving.

    Mirrors `handler_material_master_bin`'s navigation 1:1 except:
      - Uses `/nMM03` instead of `/nMM02` (display, not change).
      - No write to the bin field.
      - No `btn[11]` Save press.
      - Always sends `/n` at the end to leave the next call starting
        from the SAP Easy Access menu.
    """
    _resolve_agent_globals()
    if not state.sap_connected:
        return {"ok": False, "material": req.material, "error": "SAP not connected"}

    missing = [
        f for f, v in [
            ("material",     req.material),
            ("plant",        req.plant),
            ("warehouse",    req.warehouse),
            ("storage_type", req.storage_type),
        ] if not v
    ]
    if missing:
        return {
            "ok": False,
            "material": req.material,
            "error": f"Missing required fields: {', '.join(missing)}",
        }

    try:
        sess, _ = _get_sap_session()

        ok, err, step = _open_mm03_for_material(sess, req.material)
        if not ok:
            _log_sap_txn(req.material, "MM03", "material_master_read_bin",
                         "error", f"WH:{req.warehouse} | {step} | {err}")
            return {"ok": False, "material": req.material, "error": err, "step": step}

        ok, err, step = _press_org_levels(sess, req.material)
        if not ok:
            _exit_to_main(sess)
            _log_sap_txn(req.material, "MM03", "material_master_read_bin",
                         "error", f"WH:{req.warehouse} | {step} | {err}")
            return {"ok": False, "material": req.material, "error": err, "step": step}

        ok, err, step = _confirm_org_levels(
            sess,
            plant=req.plant,
            warehouse=req.warehouse,
            storage_type=req.storage_type,
        )
        if not ok:
            _exit_to_main(sess)
            _log_sap_txn(req.material, "MM03", "material_master_read_bin",
                         "error", f"WH:{req.warehouse} | {step} | {err}")
            return {"ok": False, "material": req.material, "error": err, "step": step}

        # WM2 tab is the same long path as the MM02 handler; auto-selected
        # after Org Levels confirms. Walker fallback handles SAP variants.
        bin_id = (
            "wnd[0]/usr/tabsTABSPR1/tabpSP22/ssubTABFRA1:SAPLMGMM:2000/"
            "subSUB3:SAPLMGD1:2734/ctxtMLGT-LGPLA"
        )
        # Some SAP variants land on a different default tab in MM03; click
        # WM2 explicitly first so the bin field is materialised.
        try:
            sess.findById("wnd[0]/usr/tabsTABSPR1/tabpSP22").select()
            _wait_for_session(sess, 10)
        except Exception:
            pass

        current_bin = _find_field_text(sess, bin_id, "/ctxtMLGT-LGPLA")
        _exit_to_main(sess)

        if current_bin is None:
            # Field genuinely not present — material may not have WM2 view
            # extended for this plant/wh/storage-type combo. Surface as
            # ok=True so the diff dialog can render "—" instead of an
            # error badge — the user still sees the proposed value.
            _log_sap_txn(req.material, "MM03", "material_master_read_bin",
                         "warning",
                         f"WH:{req.warehouse} | WM2 view missing — bin field absent")
            return {
                "ok": True,
                "material": req.material,
                "current_bin": None,
                "warning": "WM2 view not extended for this plant/warehouse/storage-type",
            }

        _log_sap_txn(req.material, "MM03", "material_master_read_bin",
                     "success",
                     f"WH:{req.warehouse} Plant:{req.plant} STyp:{req.storage_type} "
                     f"Bin:{current_bin or '(empty)'}")
        return {
            "ok": True,
            "material": req.material,
            "current_bin": current_bin,
        }

    except Exception as e:
        try:
            sess, _ = _get_sap_session()
            _exit_to_main(sess)
        except Exception:
            pass
        _log_sap_txn(req.material, "MM03", "material_master_read_bin",
                     "error", f"WH:{req.warehouse} | {e}")
        return {"ok": False, "material": req.material, "error": str(e)}


# ---------------------------------------------------------------------------
#  /sap/material-master-read-storage-types
# ---------------------------------------------------------------------------
@router.post("/sap/material-master-read-storage-types")
@_track_metric("material_master_read_storage_types")
def read_storage_types(req: ReadStorageTypesRequest) -> dict:
    """Open MM03, navigate to Warehouse Mgmt 1, read `MLGN-LTKZA` and
    `MLGN-LTKZE`, back out without saving.

    Mirrors `handler_material_master_storage_types`'s navigation but
    in display mode and read-only — same exit semantics as `read_bin`.
    """
    _resolve_agent_globals()
    if not state.sap_connected:
        return {"ok": False, "material": req.material, "error": "SAP not connected"}

    missing = [
        f for f, v in [
            ("material",         req.material),
            ("plant",            req.plant),
            ("warehouse",        req.warehouse),
            ("org_storage_type", req.org_storage_type),
        ] if not v
    ]
    if missing:
        return {
            "ok": False,
            "material": req.material,
            "error": f"Missing required fields: {', '.join(missing)}",
        }

    try:
        sess, _ = _get_sap_session()

        ok, err, step = _open_mm03_for_material(sess, req.material)
        if not ok:
            _log_sap_txn(req.material, "MM03",
                         "material_master_read_storage_types",
                         "error", f"WH:{req.warehouse} | {step} | {err}")
            return {"ok": False, "material": req.material, "error": err, "step": step}

        ok, err, step = _press_org_levels(sess, req.material)
        if not ok:
            _exit_to_main(sess)
            _log_sap_txn(req.material, "MM03",
                         "material_master_read_storage_types",
                         "error", f"WH:{req.warehouse} | {step} | {err}")
            return {"ok": False, "material": req.material, "error": err, "step": step}

        ok, err, step = _confirm_org_levels(
            sess,
            plant=req.plant,
            warehouse=req.warehouse,
            storage_type=req.org_storage_type,
        )
        if not ok:
            _exit_to_main(sess)
            _log_sap_txn(req.material, "MM03",
                         "material_master_read_storage_types",
                         "error", f"WH:{req.warehouse} | {step} | {err}")
            return {"ok": False, "material": req.material, "error": err, "step": step}

        # Switch to Warehouse Mgmt 1 tab. Wrap in retry so a one-off
        # COM hiccup doesn't blow up the whole row preview.
        wm1_tab_id = "wnd[0]/usr/tabsTABSPR1/tabpSP21"

        def _select_wm1():
            sess.findById(wm1_tab_id).select()
            _wait_for_session(sess, 10)
        try:
            _with_retries(_select_wm1, label="MM03 WM1 tab select")
        except Exception as e:
            _exit_to_main(sess)
            _log_sap_txn(req.material, "MM03",
                         "material_master_read_storage_types",
                         "warning",
                         f"WH:{req.warehouse} | WM1 tab not selectable | {e}")
            return {
                "ok": True,
                "material": req.material,
                "current_removal": None,
                "current_placement": None,
                "warning": "WM1 view not extended for this plant/warehouse/storage-type",
            }

        ltkza_id = (
            "wnd[0]/usr/tabsTABSPR1/tabpSP21/ssubTABFRA1:SAPLMGMM:2000/"
            "subSUB3:SAPLMGD1:2733/ctxtMLGN-LTKZA"
        )
        ltkze_id = (
            "wnd[0]/usr/tabsTABSPR1/tabpSP21/ssubTABFRA1:SAPLMGMM:2000/"
            "subSUB3:SAPLMGD1:2733/ctxtMLGN-LTKZE"
        )
        current_removal = _find_field_text(sess, ltkza_id, "/ctxtMLGN-LTKZA")
        current_placement = _find_field_text(sess, ltkze_id, "/ctxtMLGN-LTKZE")
        _exit_to_main(sess)

        _log_sap_txn(req.material, "MM03",
                     "material_master_read_storage_types",
                     "success",
                     f"WH:{req.warehouse} Plant:{req.plant} "
                     f"Removal(LTKZA):{current_removal or '(empty)'} "
                     f"Placement(LTKZE):{current_placement or '(empty)'}")
        return {
            "ok": True,
            "material": req.material,
            "current_removal": current_removal,
            "current_placement": current_placement,
        }

    except Exception as e:
        try:
            sess, _ = _get_sap_session()
            _exit_to_main(sess)
        except Exception:
            pass
        _log_sap_txn(req.material, "MM03",
                     "material_master_read_storage_types",
                     "error", f"WH:{req.warehouse} | {e}")
        return {"ok": False, "material": req.material, "error": str(e)}

# Created and developed by Jai Singh
