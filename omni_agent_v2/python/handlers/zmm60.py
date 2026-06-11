# Created and developed by Jai Singh
"""
ZMM60 — Unit-price lookup (Inventory Adjustment workflow).

JSON-RPC method: `sap.zmm60Lookup`.

Near-verbatim port of `omni_agent/zmm60_lookup.py:zmm60_lookup`. Reads
the ALV grid at `wnd[0]/usr/shell` directly via COM (NOT through the
%pc bulk-export path; see Debug/Fix-ZMM60-Export-Dialog-Mismatch.md).

Request shape (matches Worker A's Zmm60LookupParams):
  {
    "slot_id":  <int>,
    "material": <str>,        # required
    "plant":    <str|null>    # optional but strongly recommended
  }

Response (success):
  {
    "ok": true,
    "material": "<echo>",
    "plant":    "<echo or null>",
    "unit_value": <number>,
    "currency":   "<USD|EUR|...|null>",
    "price_unit": <number|null>,
    "raw":        { "<column title>": "<cell>", ... },
    "warning":    "<optional>"
  }

NOTE: in v2 the actual ALV grid extraction (`_extract_alv_grid`) lives
in `handlers.query`, which is currently a stub. So the COM path here
returns an "ok: false, step: extract" error in mock mode and a
NotImplemented message in production until the query module is
fully ported. The selection-screen navigation (Steps 1–3) IS fully
ported and exercised by tests.
"""

from __future__ import annotations

from typing import Any, Optional

from session_manager import SessionManager

from ._common import (
    classify_sbar,
    emit_audit_log,
    opt_int,
    opt_str,
    require_str,
    wait_for_session,
    with_retries,
)


# ---------------------------------------------------------------------------
#  Helpers (verbatim port from zmm60_lookup.py)
# ---------------------------------------------------------------------------
def _exit_to_main(sess: Any) -> None:
    try:
        sess.findById("wnd[0]/tbar[0]/okcd").text = "/n"
        sess.findById("wnd[0]").sendVKey(0)
        wait_for_session(sess, 5)
    except Exception:
        pass


def _try_set(sess: Any, ids: list[str], value: str) -> bool:
    for fid in ids:
        try:
            sess.findById(fid).text = value
            return True
        except Exception:
            continue
    return False


def _safe_float(text: str) -> Optional[float]:
    """Locale-tolerant float parser. Handles 287.63 (US), 287,63 (DE),
    1,234.56 (US grouped), trailing-minus convention 23-."""
    if text is None:
        return None
    s = str(text).strip()
    if not s:
        return None
    neg = s.endswith("-")
    if neg:
        s = s[:-1].strip()
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        v = float(s)
        return -v if neg else v
    except ValueError:
        return None


def _find_col_id(columns: list[dict], wanted_title: str) -> Optional[str]:
    target = wanted_title.strip().lower()
    for col in columns:
        title = str(col.get("title", "")).strip().lower()
        if title == target:
            return str(col.get("id", "")) or None
    return None


# ---------------------------------------------------------------------------
#  Main handler
# ---------------------------------------------------------------------------
async def handle_zmm60_lookup(pool: SessionManager, params: dict, notify) -> dict:
    material = require_str(params, "material")
    plant = opt_str(params, "plant")
    slot_id = opt_int(params, "slot_id", default=None)

    async with pool.acquire_slot_for_op(slot_id=slot_id,
                                        op_name="sap.zmm60Lookup") as slot:

        def _navigate_and_execute(sess: Any) -> dict:
            def _open() -> None:
                sess.findById("wnd[0]/tbar[0]/okcd").text = "/nZMM60"
                sess.findById("wnd[0]").sendVKey(0)
                wait_for_session(sess, 15)
            try:
                with_retries(_open, label="ZMM60 open")
            except Exception as e:
                _exit_to_main(sess)
                return {"ok": False, "error": f"Could not open ZMM60: {e}",
                        "step": "navigate"}

            if not _try_set(sess, [
                "wnd[0]/usr/ctxtMS_MATNR-LOW",
                "wnd[0]/usr/ctxtS_MATNR-LOW",
            ], material):
                _exit_to_main(sess)
                return {
                    "ok": False,
                    "error": ("Could not set material field on ZMM60 selection screen — "
                              "SAP variant may differ"),
                    "step": "navigate",
                }
            if plant:
                _try_set(sess, [
                    "wnd[0]/usr/ctxtMS_WERKS-LOW",
                    "wnd[0]/usr/ctxtS_WERKS-LOW",
                ], plant)

            try:
                sess.findById("wnd[0]/tbar[1]/btn[8]").press()
            except Exception:
                try:
                    sess.findById("wnd[0]").sendVKey(8)
                except Exception as e:
                    _exit_to_main(sess)
                    return {"ok": False, "error": f"Could not execute ZMM60: {e}",
                            "step": "execute"}
            wait_for_session(sess, 30)

            try:
                sbar, msg_type = classify_sbar(sess)
                sbar_lower = sbar.lower()
                if msg_type in ("E", "A") or any(
                    k in sbar_lower
                    for k in ("no data", "no records", "no objects",
                              "no materials", "not exist", "not found")
                ):
                    _exit_to_main(sess)
                    return {
                        "ok": False,
                        "error": (sbar or "No ZMM60 data for this material — "
                                  "verify material exists and is valuated for "
                                  "the requested plant in MM03 (Costing/Accounting view)"),
                        "step": "execute",
                    }
            except Exception:
                pass

            # ALV grid extraction is delegated to the query module's
            # _extract_alv_grid. Until that's ported, surface an extract
            # placeholder. The grid candidate ids are passed through so a
            # later port can hook in cleanly.
            try:
                from . import query as query_handlers  # local import
                extract = query_handlers.extract_alv_grid(sess, candidate_ids=[
                    "wnd[0]/usr/shell",
                    "wnd[0]/usr/cntlGRID1/shellcont/shell",
                    "wnd[0]/usr/cntlCONTAINER1_CONT/shellcont/shell",
                    "wnd[0]/usr/shellcont/shell",
                ])
            except (ImportError, AttributeError):
                _exit_to_main(sess)
                return {
                    "ok": False,
                    "error": ("ALV grid extraction not yet ported. "
                              "Run sap_helper with full handler set."),
                    "step": "extract",
                }
            except Exception as e:
                _exit_to_main(sess)
                return {
                    "ok": False,
                    "error": f"Could not read ZMM60 ALV grid: {e}",
                    "step": "extract",
                }

            _exit_to_main(sess)
            return {"ok": True, "extract": extract}

        try:
            res = await slot.run_on_com(_navigate_and_execute)
        except Exception as e:
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="ZMM60",
                                 action="zmm60_lookup", status="error",
                                 message=f"unhandled | {e}",
                                 delivery_id=material)
            return {"ok": False, "material": material,
                    "error": str(e), "step": "unhandled"}

        if not res.get("ok"):
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="ZMM60",
                                 action="zmm60_lookup",
                                 status="warning" if res.get("step") == "execute" else "error",
                                 message=f"{res.get('step')} | {res.get('error')}",
                                 delivery_id=material)
            return {
                "ok": False, "material": material,
                "error": res.get("error"), "step": res.get("step"),
            }

        # Parse the ALV extract.
        extract = res["extract"]
        columns = list(extract.get("columns", []) or [])
        rows = list(extract.get("rows", []) or [])

        if not columns or not rows:
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="ZMM60",
                                 action="zmm60_lookup", status="warning",
                                 message="empty_extract",
                                 delivery_id=material)
            return {
                "ok": False, "material": material,
                "error": ("ZMM60 returned an empty list — "
                          "material may not be valuated for the requested plant"),
                "step": "extract",
            }

        price_col_id: Optional[str] = None
        price_alias_used: Optional[str] = None
        for alias in (
            "Price", "Std Price", "Standard Price",
            "Moving Avg", "Moving Average",
        ):
            cid = _find_col_id(columns, alias)
            if cid:
                price_col_id = cid
                price_alias_used = alias
                break
        if price_col_id is None:
            available = ", ".join(str(c.get("title", "")) for c in columns[:30])
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="ZMM60",
                                 action="zmm60_lookup", status="error",
                                 message=f"no_price_col | {available}",
                                 delivery_id=material)
            return {
                "ok": False, "material": material,
                "error": f"ZMM60 grid had no Price column. Headers seen: {available}",
                "step": "parse",
            }

        currency_col_id = _find_col_id(columns, "Currency")
        price_unit_col_id = _find_col_id(columns, "Price Unit")
        material_col_id = _find_col_id(columns, "Material")
        plant_col_id = _find_col_id(columns, "Plant")

        chosen: Optional[dict] = None
        if material_col_id:
            for row in rows:
                m_cell = str(row.get(material_col_id, "") or "").strip()
                if m_cell != material:
                    continue
                if plant and plant_col_id:
                    p_cell = str(row.get(plant_col_id, "") or "").strip()
                    if p_cell != plant:
                        continue
                chosen = row
                break
        if chosen is None and plant and plant_col_id:
            for row in rows:
                p_cell = str(row.get(plant_col_id, "") or "").strip()
                if p_cell == plant:
                    chosen = row
                    break
        if chosen is None:
            chosen = rows[0]

        unit_value = _safe_float(str(chosen.get(price_col_id, "") or ""))
        if unit_value is None:
            await emit_audit_log(notify, slot_id=slot.slot_id,
                                 transaction_code="ZMM60",
                                 action="zmm60_lookup", status="error",
                                 message=f"price_parse_failed | raw={chosen.get(price_col_id, '')!r}",
                                 delivery_id=material)
            return {
                "ok": False, "material": material,
                "error": (f"Could not parse ZMM60 {price_alias_used} field "
                          f"(raw value: {chosen.get(price_col_id, '')!r})"),
                "step": "parse",
            }

        currency: Optional[str] = None
        if currency_col_id:
            cell = str(chosen.get(currency_col_id, "") or "").strip()
            currency = cell or None

        price_unit: Optional[float] = None
        if price_unit_col_id:
            price_unit = _safe_float(str(chosen.get(price_unit_col_id, "") or ""))

        raw: dict[str, str] = {}
        for col in columns:
            cid = str(col.get("id", ""))
            title = str(col.get("title", ""))
            if not title:
                continue
            cell = str(chosen.get(cid, "") or "").strip()
            if cell:
                raw[title] = cell

        warning: Optional[str] = None
        if unit_value == 0:
            warning = (
                f"ZMM60 returned price=0; verify in MM03 Costing/Accounting "
                f"view that material {material} has a Standard or Moving Avg "
                f"price configured for plant {plant or '*'}."
            )

        await emit_audit_log(
            notify, slot_id=slot.slot_id,
            transaction_code="ZMM60", action="zmm60_lookup", status="success",
            message=(f"plant:{plant or '-'} price:{unit_value} "
                     f"currency:{currency or '-'} alias:{price_alias_used}"
                     f"{' WARN:price=0' if unit_value == 0 else ''}"),
            delivery_id=material,
        )
        result: dict = {
            "ok": True,
            "material": material,
            "plant": plant or None,
            "unit_value": unit_value,
            "currency": currency,
            "price_unit": price_unit,
            "raw": raw,
        }
        if warning:
            result["warning"] = warning
        return result


def register(dispatcher) -> None:
    dispatcher.register("sap.zmm60Lookup", handle_zmm60_lookup)

# Created and developed by Jai Singh
