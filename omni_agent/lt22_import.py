# Created and developed by Jai Singh
"""
Phase D outbound — LT22 Open Transfer-Order import (Worker D).

Pulls every open / waiting transfer order from SAP via LT22 and bulk-INSERTs
the result into `public.sap_outbound_to_imports`. Each run is tracked in
`public.sap_outbound_to_import_runs` (queued → running → completed/failed)
so the frontend ImportLt22Dialog can drive a status pill from Realtime.

The recording the user provided drives the selection screen:
    /nLT22
    chkT3_SEVON.selected = false   ' Show "Verified" rows OFF
    chkT3_SENAC.selected = true    ' Show "Open + waiting" rows ON
    ctxtT3_LGNUM.text    = "PDC"   ' Warehouse
    ctxtT3_LGTYP-LOW.text = "916"  ' Storage type (optional)
    ctxtLISTV.text       = "ONEBOXAPPX"  ' Customer's outbound layout variant
    btn[8].press                    ' F8 execute

Result extraction uses `_extract_via_pc_export()` (Phase B4) as the
**primary path** because LT22 result sets routinely exceed Ctrl+PgDn
pagination's sweet spot — paging through 500+ rows in the visible SAP
GUI hammers the COM bridge and v1.6.2 saw it kill the SAP scripting
engine with `(-2147023174, 'The RPC server is unavailable.', None,
None)` on a 657-row PDC pull. The `%pc → Unconverted → Save list in
file` flow does the entire export server-side in one round-trip.
Falls back to `_extract_sap_list_output()` only if the %pc dialog
can't be driven on the user's SAP variant; the fallback is opt-out via
`use_bulk_export=False` so the foreground can disable it remotely if a
future SAP build breaks the export dialog.

Defensive: if the SAP COM session dies during the run (RPC server
unavailable / E_FAIL / pywintypes.com_error) we mark the agent's
`state.sap_connected = False` so the queue poller stops claiming new
jobs — the user has to restart SAP GUI before the agent can do
anything else. See `Debug/Fix-LT22-SAP-Crash-Pagedown` in the
omniframe vault for the full root cause.

v1.8.2 — three layered defenses on top of the bulk-export +
multi-format parser stack so a single misparsed export can no longer
take down the whole import: (1) `_validate_lt22_parse(...)` runs
BEFORE the bulk INSERT and raises a specific Exception (with a
diagnostic snapshot saved to %TEMP%) when the parser shipped no "TO
Number"-shaped column or every row's TO Number is empty; (2)
`_dedupe_lt22_rows(...)` drops empty-`to_number` rows and
de-duplicates within the batch by `to_number` (split deliveries
legitimately produce duplicate TO numbers in the same export); (3)
the bulk-INSERT POST now uses `Prefer: return=minimal,resolution=
ignore-duplicates` so a partial-success run that re-executes
against rows already inserted no longer 409-aborts on the
`sap_outbound_to_imports_unique_per_batch` unique constraint.

Capability ids (foreground merges into AGENT_CAPABILITIES):
    'import-lt22'        — endpoint exists
    'import-lt22-bulk'   — bulk %pc path is the default (v1.6.3+)
"""

from __future__ import annotations

import json
import os
import tempfile
import time
import uuid as _uuid
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

import requests as _requests
from fastapi import APIRouter
from pydantic import BaseModel


router = APIRouter()

# Mirror of agent.py's `_SSL_VERIFY`. Recomputed locally so this module
# stays usable in isolation (tests, REPL) without dragging in agent.py.
# See agent.py's truststore block + corporate-SSL comment for the full
# story; setting `OMNIFRAME_INSECURE_SSL=1` flips both files at once.
_SSL_VERIFY: bool = os.environ.get("OMNIFRAME_INSECURE_SSL", "") != "1"

# v1.7.2 — local retry helper. Mirrors agent.py's `_supabase_request`
# (30s timeout + single retry on transient Timeout / ConnectionError
# after a 2s sleep) so LT22 imports get the same resilience to
# corporate-proxy + Citrix latency blips that every other Supabase
# write enjoys. We deliberately DON'T import `_supabase_request` from
# `agent` here even though the v1.7.2 sys.modules alias would make it
# safe — keeping `lt22_import.py` self-contained means this module
# stays importable from tests / REPL without dragging in the FastAPI
# app instance + heavyweight COM init in agent.py.
_LT22_HTTP_TIMEOUT_SEC: float = 30.0
_LT22_HTTP_RETRY_SLEEP_SEC: float = 2.0

# Work Engine zoning follow-on — storage types that route LT22 rows into
# the polymorphic `work_tasks` queue as `zone_audit` work. This is
# additive: rows continue to land in `sap_outbound_to_imports` first; the
# zoning dispatch only fires when the org has flipped the
# `work_engine_settings.feature_flags.work_engine_enabled` feature flag
# to true. The default canary value is false everywhere, so this path is
# a guaranteed no-op until an operator turns it on.
ZONING_STORAGE_TYPES: list[str] = ["916"]
ZONING_TASK_TYPE: str = "zone_audit"
ZONING_TASK_SUBTYPE: str = "standard_audit"


def _lt22_request(method: str, url: str, **kwargs):
    """POST/PATCH/GET wrapper with a 30s default timeout and a single
    retry on transient network errors. Used by the LT22 chunk-INSERT
    loop and the run-row PATCH calls so a single corporate-proxy blip
    doesn't fail an otherwise-successful 5000-row import."""
    kwargs.setdefault("timeout", _LT22_HTTP_TIMEOUT_SEC)
    kwargs.setdefault("verify", _SSL_VERIFY)
    fn = getattr(_requests, method.lower())
    try:
        return fn(url, **kwargs)
    except (
        _requests.exceptions.Timeout,
        _requests.exceptions.ConnectionError,
    ) as exc:
        short = url.split("?")[0][:120]
        print(
            f"[lt22]  transient {type(exc).__name__} on {method.upper()} "
            f"{short} — retrying once after {_LT22_HTTP_RETRY_SLEEP_SEC:.0f}s"
        )
        time.sleep(_LT22_HTTP_RETRY_SLEEP_SEC)
        return fn(url, **kwargs)


# ---------------------------------------------------------------------------
#  Request / Response models
# ---------------------------------------------------------------------------
class Lt22ImportRequest(BaseModel):
    """Inputs mirror the LT22 selection-screen fields the user recorded.

    `import_run_id` is generated client-side (the frontend INSERTs the
    run row first, then enqueues the job with that id in the payload) so
    the agent can PATCH the same row without a round-trip to look it up.
    """

    warehouse: str                       # T3_LGNUM
    storage_type: str = ""               # T3_LGTYP-LOW (blank = all types)
    show_verified: bool = False          # T3_SEVON  (recording: OFF)
    show_open_waiting: bool = True       # T3_SENAC (recording: ON)
    layout_variant: str = "ONEBOXAPPX"   # LISTV — user's saved layout
    date_from: Optional[str] = None      # T3_BDATU-LOW (variants only)
    date_to: Optional[str] = None        # T3_BDATU-HIGH
    organization_id: str
    triggered_by: Optional[str] = None
    import_run_id: str
    # v1.6.3 — opt-out for the %pc bulk-export primary path. Defaults to
    # True (bulk-export first, pagination fallback) per the production
    # default. Set to False from the queue payload if a future SAP build
    # breaks the %pc export dialog and we need to force pagination
    # without rebuilding the agent. See module docstring for context.
    use_bulk_export: bool = True


# ---------------------------------------------------------------------------
#  Endpoint
# ---------------------------------------------------------------------------
@router.post("/sap/import-lt22")
def import_lt22(req: Lt22ImportRequest) -> dict:
    """Run LT22 in SAP, parse the result, batch-INSERT into
    `sap_outbound_to_imports`, and PATCH `sap_outbound_to_import_runs`.

    All Supabase calls go through the agent's `state.supabase_token` (the
    user JWT minted on /supabase/login) so the existing org-scoped RLS
    policies are honoured. If the agent has not been logged in, the
    function still runs the SAP side but skips the Supabase persistence
    and returns the parsed rows in the response so the caller can decide
    what to do.
    """
    # Imports come from the parent module — `agent.py` mounts this router
    # at the bottom of its boot sequence, so the symbols below already
    # exist by the time this function is invoked.
    from agent import (  # type: ignore[import-not-found]
        _classify_sbar,
        _extract_sap_list_output,
        _extract_via_pc_export,
        _get_sap_session,
        _log_sap_txn,
        _wait_for_session,
        _agent_self_id,
        _auto_select_valid_session,
        _PcPreCommitError,
        _PcPostCommitError,
        state,
    )

    # pywintypes ships with pywin32; on dev machines / non-Windows it
    # may be absent. Treat its `com_error` as the canonical "SAP COM
    # bridge died" signal so we can flip `state.sap_connected` and
    # stop the queue poller. If pywintypes isn't importable we fall
    # through to the generic Exception path — the only consequence is
    # we don't get the RPC-server-unavailable specific log line.
    try:
        import pywintypes  # type: ignore[import-not-found]
        _COM_ERROR: type = pywintypes.com_error
    except Exception:
        class _COM_ERROR(Exception):  # type: ignore[no-redef]
            """Fallback so `except _COM_ERROR` is always valid."""

    started = time.time()
    agent_id = _agent_self_id()

    # Pre-flight COM session sanity check. If SAP GUI isn't running (or
    # is sitting on the Logon Pad with no sessions) we'd get a generic
    # `_get_sap_session` traceback after marking the run "running" — bail
    # earlier with a friendlier message AND flip `sap_connected` so the
    # poller stops claiming new jobs against a dead bridge.
    pre_ci, _pre_si = _auto_select_valid_session()
    if pre_ci is None:
        try:
            state.sap_connected = False
        except Exception:
            pass
        msg = (
            "SAP COM session not available — please open SAP Logon, sign in, "
            "and re-run the import."
        )
        print(f"[lt22]  pre-flight: {msg}")
        _patch_run(state, req.import_run_id, {
            "status": "failed",
            "agent_id": agent_id,
            "error": msg,
            "completed_at": _utcnow_iso(),
            "duration_ms": int((time.time() - started) * 1000),
        })
        return {"ok": False, "error": msg}

    _patch_run(state, req.import_run_id, {
        "status": "running",
        "agent_id": agent_id,
        "started_at": _utcnow_iso(),
    })

    try:
        sess, _ = _get_sap_session()

        # 1. Open LT22 selection screen.
        sess.findById("wnd[0]/tbar[0]/okcd").text = "/nLT22"
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 15)

        # 2. Fill the four selection fields the recording set.
        try:
            sess.findById("wnd[0]/usr/chkT3_SEVON").selected = bool(req.show_verified)
            sess.findById("wnd[0]/usr/chkT3_SENAC").selected = bool(req.show_open_waiting)
            sess.findById("wnd[0]/usr/ctxtT3_LGNUM").text = req.warehouse
            if req.storage_type:
                sess.findById("wnd[0]/usr/ctxtT3_LGTYP-LOW").text = req.storage_type
            if req.layout_variant:
                sess.findById("wnd[0]/usr/ctxtLISTV").text = req.layout_variant
            # Optional date range — only some variants surface these fields.
            if req.date_from:
                try:
                    sess.findById("wnd[0]/usr/ctxtT3_BDATU-LOW").text = req.date_from
                except Exception:
                    pass
            if req.date_to:
                try:
                    sess.findById("wnd[0]/usr/ctxtT3_BDATU-HIGH").text = req.date_to
                except Exception:
                    pass
        except Exception as exc:
            raise Exception(f"LT22 selection screen field not found: {exc}")

        # 3. Execute (F8). Some SAP skins don't expose btn[8] reliably;
        # sendVKey 8 is the keyboard equivalent.
        try:
            sess.findById("wnd[0]/tbar[1]/btn[8]").press()
        except Exception:
            sess.findById("wnd[0]").sendVKey(8)
        _wait_for_session(sess, 60)

        # 4. Empty-result detection. Don't insert anything when SAP says
        # "No data" / "No transfer orders" — surface that as a successful
        # zero-row run so the UI can toast "Already up to date".
        sbar, _msg_type = _classify_sbar(sess)
        sbar_lower = sbar.lower()
        if any(k in sbar_lower for k in (
            "no data",
            "no transfer orders",
            "no records found",
            "no records selected",
        )):
            _patch_run(state, req.import_run_id, {
                "status": "completed",
                "rows_imported": 0,
                "completed_at": _utcnow_iso(),
                "duration_ms": int((time.time() - started) * 1000),
            })
            _log_sap_txn(req.warehouse, "LT22", "import_lt22", "success",
                         f"WH:{req.warehouse} STyp:{req.storage_type} rows:0 (empty)")
            return {
                "ok": True,
                "rows_imported": 0,
                "batch_id": None,
                "message": sbar or "No transfer orders match the selection.",
            }

        # 5. Bulk-export via %pc (handles 10K+ rows in seconds), with a
        # narrow fallback to the lbl-based extractor. The pagination
        # path was the v1.6.2 default for LT22 and triggered the SAP
        # COM crash on a 657-row pull — bulk export is now primary.
        # COM errors from inside the extractor are re-raised so the
        # outer handler can flip `state.sap_connected` (the SAP GUI is
        # dead — fallback would hit the same brick wall).
        #
        # v1.7.3 — fallback is no longer greedy. We only fall back to
        # `_extract_sap_list_output` when %pc raises
        # `_PcPreCommitError` (the dialog never opened, nothing was
        # saved, GUI is still on the source list screen). On
        # `_PcPostCommitError` we re-raise — the export file was
        # already burned and pagination would re-walk the same data
        # slowly while ALSO hammering the COM bridge that v1.6.3
        # specifically introduced bulk-export to avoid.
        result: dict[str, Any]
        if req.use_bulk_export:
            print("[lt22]  using %pc bulk export")
            try:
                result = _extract_via_pc_export(sess)
            except _COM_ERROR:
                raise  # let the outer handler mark sap_connected=False
            except _PcPreCommitError as pre_err:
                print(
                    f"[lt22]  %pc pre-commit failed, falling back to "
                    f"paginated extract: {pre_err}"
                )
                try:
                    result = _extract_sap_list_output(sess)
                except _COM_ERROR:
                    raise
            except _PcPostCommitError as post_err:
                # File saved (or save attempt completed) but parse / file
                # presence check failed. Pagination would re-walk the
                # same data slowly + risk re-triggering the v1.6.2
                # SAP-COM crash. Surface the error instead.
                print(
                    f"[lt22]  %pc post-commit failed — NOT falling back "
                    f"(file was already saved, pagination would re-burn "
                    f"the COM bridge): {post_err}"
                )
                raise Exception(
                    f"LT22 bulk export saved file but parse failed: "
                    f"{post_err}"
                ) from post_err
        else:
            print("[lt22]  use_bulk_export=False — using paginated extract directly")
            result = _extract_sap_list_output(sess)

        rows = result.get("rows", []) if result else []
        columns = result.get("columns", []) if result else []
        batch_id = str(_uuid.uuid4())

        # v1.8.2 — parser-validation gate. The v1.7.7 smart-header pass
        # is robust on the user's known LT10/LT22 formats but a future
        # SAP variant could ship a banner shape that still tricks the
        # scorer. If we INSERT 561 rows with `to_number=NULL` we'd
        # 409-abort on the first chunk anyway — surface a specific
        # diagnostic BEFORE the round-trip so triagers get a saved
        # snapshot instead of an opaque PostgREST error.
        _validate_lt22_parse(rows, columns, req)

        normalized = [
            normalize_lt22_row(row, columns, req, batch_id)
            for row in rows
        ]
        normalized = [r for r in normalized if r and r.get("to_number")]

        # v1.8.2 — defense-in-depth dedup + empty-TO drop.
        normalized, dedup_dropped, empty_dropped = _dedupe_lt22_rows(normalized)
        if empty_dropped:
            print(
                f"[lt22]  WARN dropped {empty_dropped} row(s) with empty/null "
                f"to_number before insert (parser likely misidentified header — "
                f"check `result.meta.parser_format` in agent log)."
            )
        if dedup_dropped:
            print(
                f"[lt22]  deduplicated {dedup_dropped} row(s) by to_number "
                f"within batch {batch_id} before insert (split deliveries can "
                f"legitimately produce duplicate TO numbers in the SAP export)."
            )

        # 6. Persist to Supabase (chunks of 500 to keep request bodies
        # under PostgREST's payload sweet spot). When the agent is not
        # logged in we skip the insert and surface a warning. v1.8.2 —
        # `resolution=ignore-duplicates` so a partial-success run can
        # re-execute without 409-aborting on rows the previous run
        # already inserted (the unique constraint
        # `sap_outbound_to_imports_unique_per_batch` covers
        # `(organization_id, to_number, import_batch_id)` so
        # within-batch duplicates already get caught DB-side and pure
        # client-side dedup above means we shouldn't ever hit it; the
        # ignore-duplicates Prefer is the seatbelt).
        inserted = 0
        if not state.supabase_token or not state.supabase_url:
            print("[lt22]  WARN no Supabase token — returning parsed rows without persisting.")
        else:
            for chunk in _chunks(normalized, 500):
                resp = _lt22_request(
                    "POST",
                    f"{state.supabase_url}/rest/v1/sap_outbound_to_imports",
                    json=chunk,
                    headers={
                        "apikey": state.supabase_key,
                        "Authorization": f"Bearer {state.supabase_token}",
                        "Content-Type": "application/json",
                        "Prefer": "return=minimal,resolution=ignore-duplicates",
                    },
                )
                if resp.status_code >= 400:
                    raise Exception(
                        f"Supabase insert failed ({resp.status_code}): {resp.text[:300]}"
                    )
                inserted += len(chunk)

        # 6b. Work Engine zoning dispatch (additive). After the legacy
        # `sap_outbound_to_imports` insert succeeds, fan a subset of the
        # same rows out to `work_tasks` so the polymorphic engine can
        # claim them. Gated on the per-org `work_engine_enabled` feature
        # flag — when false (default everywhere) this is a complete
        # no-op, so v1.7.x deployments are unaffected.
        zoning_dispatched = 0
        if state.supabase_token and state.supabase_url and inserted > 0:
            try:
                zoning_dispatched = dispatch_zoning_tasks(state, req, normalized)
            except Exception as zoning_exc:
                # Failures in the additive path must NEVER fail the
                # primary import — the engine is a follow-on.
                print(f"[zoning-dispatch]  WARN dispatch failed: {zoning_exc}")

        _patch_run(state, req.import_run_id, {
            "status": "completed",
            "rows_imported": inserted,
            "completed_at": _utcnow_iso(),
            "duration_ms": int((time.time() - started) * 1000),
        })
        _log_sap_txn(
            req.warehouse, "LT22", "import_lt22", "success",
            f"WH:{req.warehouse} STyp:{req.storage_type} "
            f"rows:{inserted} batch:{batch_id} zoning:{zoning_dispatched}",
        )
        return {
            "ok": True,
            "rows_imported": inserted,
            "batch_id": batch_id,
            "rows_parsed": len(normalized),
            "zoning_dispatched": zoning_dispatched,
        }

    except _COM_ERROR as com_exc:
        # SAP COM bridge died (typically `(-2147023174, 'The RPC server
        # is unavailable.', None, None)` after a long page-down loop).
        # The session is unrecoverable from this process — flip
        # `sap_connected` so the queue poller stops claiming new jobs
        # and the web app's session badge flips to "disconnected". The
        # user has to restart SAP GUI before any further work.
        try:
            state.sap_connected = False
        except Exception:
            pass
        err = (
            f"SAP COM session died ({com_exc}). "
            f"Restart SAP GUI before re-running the import."
        )
        print(f"[lt22]  COM crash — marking sap_connected=False: {err}")
        _patch_run(state, req.import_run_id, {
            "status": "failed",
            "error": err[:500],
            "completed_at": _utcnow_iso(),
            "duration_ms": int((time.time() - started) * 1000),
        })
        _log_sap_txn(
            req.warehouse, "LT22", "import_lt22", "error",
            f"WH:{req.warehouse} | COM crash: {com_exc}",
        )
        return {"ok": False, "error": err, "sap_disconnected": True}
    except Exception as exc:
        err = str(exc)
        _patch_run(state, req.import_run_id, {
            "status": "failed",
            "error": err[:500],
            "completed_at": _utcnow_iso(),
            "duration_ms": int((time.time() - started) * 1000),
        })
        _log_sap_txn(
            req.warehouse, "LT22", "import_lt22", "error",
            f"WH:{req.warehouse} | {err}",
        )
        return {"ok": False, "error": err}


# ---------------------------------------------------------------------------
#  Row normalisation
# ---------------------------------------------------------------------------
def normalize_lt22_row(
    raw_row: dict,
    columns: list,
    req: Lt22ImportRequest,
    batch_id: str,
) -> Optional[dict]:
    """Map LT22 column abbreviations to schema fields.

    The `ONEBOXAPPX` layout variant the user provided may rename / reorder
    columns relative to the SAP defaults, so we match titles fuzzily and
    accept multiple aliases per field. Each `columns` entry is shaped
    `{id, title}`; `raw_row` is `{column_id: cell_value}`.
    """
    title_to_id: dict[str, str] = {}
    for col in columns:
        title = (col.get("title") or "").strip().lower()
        if title and col.get("id"):
            # First non-empty wins to handle SAP's habit of repeating headers
            # (e.g. duplicate "S" columns for status + special stock).
            title_to_id.setdefault(title, col["id"])

    def get(*aliases: str) -> str:
        for alias in aliases:
            cid = title_to_id.get(alias.lower())
            if cid and raw_row.get(cid) not in (None, ""):
                return str(raw_row.get(cid)).strip()
        return ""

    to_number = get("to number", "tanum", "to no.", "transfer order")
    if not to_number:
        return None  # Skip non-data rows (separators / blanks).

    return {
        "organization_id": req.organization_id,
        "to_number": to_number,
        "warehouse": req.warehouse,
        "storage_type": req.storage_type or get("typ", "src styp", "vltyp"),
        "status": get("status", "stat"),
        "status_code": get("s", "st"),
        "movement_type": get("mvt type", "mvt", "bwlvs", "movement type"),
        "source_storage_type": get("src styp", "vltyp", "src typ", "source stor.type"),
        "source_storage_bin": get("src bin", "vlpla", "srcbin", "source bin"),
        "dest_storage_type": get("dst styp", "nltyp", "dst typ", "dest. stor.type"),
        "dest_storage_bin": get("dst bin", "nlpla", "dstbin", "dest. bin"),
        "material": get("material", "matnr"),
        "quantity": _try_float(get("qty", "quantity", "vsolm", "trqty")),
        "unit_of_measure": get("uom", "unit", "meins"),
        "delivery": get("delivery", "vbeln"),
        "reference_doc": get("ref. doc", "reference", "refdoc", "ref"),
        "created_in_sap": _try_iso(get("created on", "cr.date", "crdate", "bdatu")),
        "confirmed_in_sap": _try_iso(get("conf. date", "confirmed on", "confdate", "kqdat")),
        "confirmed_by_sap": get("conf.by", "confirmed by", "bname"),
        "raw_row": raw_row,
        "import_batch_id": batch_id,
        "import_run_id": req.import_run_id,
    }


# ---------------------------------------------------------------------------
#  Supabase helpers
# ---------------------------------------------------------------------------
def _patch_run(state, run_id: str, fields: dict) -> None:
    """Best-effort PATCH of `sap_outbound_to_import_runs.id = run_id`.

    Failures are swallowed so a Supabase blip doesn't abort the SAP
    operation. The frontend's Realtime subscription will still see the
    final terminal state when the next PATCH succeeds.
    """
    if not getattr(state, "supabase_token", "") or not getattr(state, "supabase_url", ""):
        return
    try:
        _lt22_request(
            "PATCH",
            f"{state.supabase_url}/rest/v1/sap_outbound_to_import_runs?id=eq.{run_id}",
            json=fields,
            headers={
                "apikey": state.supabase_key,
                "Authorization": f"Bearer {state.supabase_token}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
#  Defense-in-depth helpers (v1.8.2)
# ---------------------------------------------------------------------------
_TO_NUMBER_HEADER_ALIASES: tuple[str, ...] = (
    "to number",
    "tanum",
    "to no.",
    "to no",
    "transfer order",
)


def _has_to_number_column(columns: list[dict]) -> bool:
    """True if any of the parsed columns looks like a SAP TO Number
    header. Matched fuzzily against the same alias list `normalize_lt22_row`
    uses so the two stay in sync — a parser slip that gives us "to_number"
    or "TO N" wouldn't match here AND wouldn't extract via `get(...)`."""
    for col in columns:
        title = (col.get("title") or "").strip().lower()
        if not title:
            continue
        if title in _TO_NUMBER_HEADER_ALIASES:
            return True
    return False


def _save_lt22_parse_failure_snapshot(
    rows: list[dict],
    columns: list[dict],
    req: "Lt22ImportRequest",
) -> Optional[str]:
    """Best-effort snapshot of the parsed rows + columns to %TEMP% so a
    triager can see exactly what shape the parser returned. Returns the
    saved path on success, None on any failure (we never want this
    helper to mask the original parse-misidentification error).

    Filename pattern matches the v1.7.6 `_save_failed_export_debug_copy`
    in agent.py — `omniframe_lt22_parse_failure_<UTC_ts>.json` — so
    operators have one stable place to look for SAP-export diagnostics.
    """
    try:
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = os.path.join(
            tempfile.gettempdir(),
            f"omniframe_lt22_parse_failure_{ts}.json",
        )
        snapshot = {
            "warehouse": req.warehouse,
            "storage_type": req.storage_type,
            "layout_variant": req.layout_variant,
            "import_run_id": req.import_run_id,
            "row_count": len(rows),
            "column_count": len(columns),
            "columns": columns,
            "first_5_rows": rows[:5],
            "last_5_rows": rows[-5:] if len(rows) > 5 else [],
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, indent=2, default=str)
        return path
    except Exception:
        return None


def _validate_lt22_parse(
    rows: list[dict],
    columns: list[dict],
    req: "Lt22ImportRequest",
) -> None:
    """Raise a specific Exception if the parsed result looks like the
    parser misidentified the header. Two failure modes:

      1. No "TO Number"-shaped column was extracted at all — the parser
         clearly picked a non-header line as the header.
      2. The "TO Number" column exists but EVERY data row is empty in
         that column — the column ordering is off (the header line was
         found but the data rows are misaligned).

    On either failure we save a diagnostic snapshot to %TEMP% and raise
    a specific Exception that mentions the saved path, so triagers can
    grab the file + ship it without hunting for the right SAP export.
    """
    if not rows:
        return  # zero-row results are handled separately upstream.

    if not _has_to_number_column(columns):
        snap = _save_lt22_parse_failure_snapshot(rows, columns, req)
        titles = [(c.get("title") or "") for c in columns][:25]
        suffix = f" Diagnostic file saved to {snap}" if snap else ""
        raise Exception(
            "LT22 parsed but TO Number column not found / values empty — "
            "likely parser misidentified header. "
            f"Got {len(rows)} row(s) × {len(columns)} column(s). "
            f"First column titles: {titles}.{suffix}"
        )

    # Column exists — confirm at least one data row carries a value.
    title_to_id: dict[str, str] = {}
    for col in columns:
        title = (col.get("title") or "").strip().lower()
        if title and col.get("id"):
            title_to_id.setdefault(title, col["id"])
    to_col_id: Optional[str] = None
    for alias in _TO_NUMBER_HEADER_ALIASES:
        cid = title_to_id.get(alias)
        if cid:
            to_col_id = cid
            break
    if to_col_id is None:
        return  # already caught above; defensive fallthrough.

    has_any = any(
        str(r.get(to_col_id, "")).strip() for r in rows
    )
    if not has_any:
        snap = _save_lt22_parse_failure_snapshot(rows, columns, req)
        suffix = f" Diagnostic file saved to {snap}" if snap else ""
        raise Exception(
            "LT22 parsed but TO Number column not found / values empty — "
            "likely parser misidentified header. "
            f"All {len(rows)} row(s) have an empty value in the "
            f"'{to_col_id}' (TO Number) column.{suffix}"
        )


def _dedupe_lt22_rows(normalized: list[dict]) -> tuple[list[dict], int, int]:
    """Drop empty-`to_number` rows and de-duplicate on `to_number`
    within the batch. Returns `(kept, dedup_dropped, empty_dropped)`.

    Why dedup at the agent layer when the DB has a unique constraint:
    the constraint is the safety net but a 409 from a single duplicate
    fails the WHOLE chunk on PostgREST (without the v1.8.2
    `resolution=ignore-duplicates` Prefer). Pre-deduping client-side
    keeps the chunk INSERTs clean AND surfaces an honest count of
    "rows accepted" instead of "rows attempted".

    SAP can legitimately ship duplicate TO numbers in a single LT22
    pull — split deliveries (one TO number, multiple delivery rows)
    are the most common cause. We keep the FIRST occurrence so the
    row order in `sap_outbound_to_imports` matches the SAP export
    order operators see in the GUI.
    """
    kept: list[dict] = []
    seen: set[str] = set()
    empty_dropped = 0
    dedup_dropped = 0
    for row in normalized:
        tn = (row.get("to_number") or "").strip() if row else ""
        if not tn:
            empty_dropped += 1
            continue
        if tn in seen:
            dedup_dropped += 1
            continue
        seen.add(tn)
        kept.append(row)
    return kept, dedup_dropped, empty_dropped


# ---------------------------------------------------------------------------
#  Pure helpers
# ---------------------------------------------------------------------------
def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _try_float(s: str) -> Optional[float]:
    if not s:
        return None
    cleaned = s.replace(",", "").strip()
    # SAP renders negatives with a trailing minus.
    if cleaned.endswith("-"):
        cleaned = "-" + cleaned[:-1].strip()
    try:
        return float(cleaned)
    except ValueError:
        return None


def _try_iso(s: str) -> Optional[str]:
    """Best-effort SAP-date → ISO string. Returns None for unparseable."""
    if not s:
        return None
    from datetime import datetime
    for fmt in ("%m/%d/%Y", "%d.%m.%Y", "%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(s, fmt).isoformat()
        except ValueError:
            continue
    return None


def _chunks(lst: list, n: int) -> Iterable[list]:
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


# ---------------------------------------------------------------------------
#  Work Engine zoning dispatch (Phase F follow-on)
# ---------------------------------------------------------------------------
def is_zoning_eligible(row: dict) -> bool:
    """Predicate: should this normalized LT22 row become a zone_audit task?

    The minimal-risk v1 predicate is "storage type is in the configured
    zoning list". Pulled out so unit tests can drive the boundary
    without faking the whole agent state.
    """
    storage_type = (row.get("storage_type") or "").strip()
    source_storage_type = (row.get("source_storage_type") or "").strip()
    if not storage_type and not source_storage_type:
        return False
    return (
        storage_type in ZONING_STORAGE_TYPES
        or source_storage_type in ZONING_STORAGE_TYPES
    )


def derive_zone_id(row: dict) -> Optional[str]:
    """Pull the zone code from the source bin's location prefix.

    SAP bins look like `916-A1-01` / `916/A1/01` — the first hyphen- or
    slash-separated segment is the zone. Falls back to the storage type
    when no bin is present (the rest of the row is then logically
    grouped under the storage-type bucket).
    """
    bin_field = (row.get("source_storage_bin") or row.get("dest_storage_bin") or "").strip()
    if bin_field:
        for sep in ("-", "/", "."):
            if sep in bin_field:
                return bin_field.split(sep, 1)[0].strip() or None
        return bin_field
    storage_type = (row.get("storage_type") or row.get("source_storage_type") or "").strip()
    return storage_type or None


def _is_work_engine_enabled(state, organization_id: str) -> bool:
    """Read `work_engine_settings.feature_flags.work_engine_enabled`.

    Defensive: missing row / network blip / null flag all resolve to
    `False` so a Supabase outage can never accidentally fan tasks out.
    """
    if not getattr(state, "supabase_token", "") or not getattr(state, "supabase_url", ""):
        return False
    try:
        resp = _lt22_request(
            "GET",
            f"{state.supabase_url}/rest/v1/work_engine_settings"
            f"?organization_id=eq.{organization_id}&select=feature_flags",
            headers={
                "apikey": state.supabase_key,
                "Authorization": f"Bearer {state.supabase_token}",
                "Accept": "application/json",
            },
        )
        if resp.status_code >= 400:
            print(f"[zoning-dispatch]  feature-flag fetch HTTP {resp.status_code}")
            return False
        body = resp.json() if resp.content else []
        if not body:
            return False
        flags = body[0].get("feature_flags") or {}
        return bool(flags.get("work_engine_enabled", False))
    except Exception as exc:
        print(f"[zoning-dispatch]  feature-flag fetch failed: {exc}")
        return False


def build_zoning_task(row: dict, req: Lt22ImportRequest) -> Optional[dict]:
    """Construct a single `work_tasks` insert payload from a normalized row.

    Returns None when the row is missing the data required to make a
    zone_audit task meaningful (no zone, no source bin, no quantity).
    """
    zone_id = derive_zone_id(row)
    if not zone_id:
        return None
    primary_location = (row.get("source_storage_bin") or row.get("dest_storage_bin") or "").strip()
    if not primary_location:
        return None
    to_number = (row.get("to_number") or "").strip()
    item = (row.get("raw_row") or {}).get("item") or row.get("item") or ""
    if not to_number:
        return None
    expected_count = row.get("quantity")
    if expected_count is None:
        expected_count = 0
    return {
        "organization_id": req.organization_id,
        "task_type": ZONING_TASK_TYPE,
        "task_subtype": ZONING_TASK_SUBTYPE,
        "primary_location": primary_location,
        "subject_material": (row.get("material") or "").strip() or None,
        "warehouse": req.warehouse,
        "unit_of_measure": (row.get("unit_of_measure") or "").strip() or None,
        "priority": "normal",
        "payload": {
            "zone_id": zone_id,
            "expected_count": float(expected_count) if expected_count is not None else 0,
            "lt22_to_number": to_number,
        },
        "payload_version": 1,
        "idempotency_key": f"lt22:{to_number}:{item}" if item else f"lt22:{to_number}",
        "source_table": "sap_outbound_to_imports",
    }


def dispatch_zoning_tasks(
    state,
    req: Lt22ImportRequest,
    normalized_rows: list,
) -> int:
    """Fan a subset of LT22 rows out as zone_audit `work_tasks`.

    Returns the count of rows successfully inserted (zero when the
    feature flag is off, no rows match the predicate, or every insert
    short-circuits on the idempotency unique index).
    """
    if not _is_work_engine_enabled(state, req.organization_id):
        return 0

    eligible = [r for r in normalized_rows if is_zoning_eligible(r)]
    if not eligible:
        return 0

    inserted = 0
    for row in eligible:
        task = build_zoning_task(row, req)
        if not task:
            continue
        to_number = (row.get("to_number") or "").strip()
        item = (row.get("raw_row") or {}).get("item") or row.get("item") or ""
        try:
            resp = _lt22_request(
                "POST",
                f"{state.supabase_url}/rest/v1/work_tasks",
                json=[task],
                headers={
                    "apikey": state.supabase_key,
                    "Authorization": f"Bearer {state.supabase_token}",
                    "Content-Type": "application/json",
                    # `resolution=ignore-duplicates` so a re-played LT22
                    # import (same to_number+item) is a clean no-op
                    # rather than an HTTP 409. The unique index on
                    # (organization_id, task_type, idempotency_key)
                    # added by mig 256 owns the dedup.
                    "Prefer": "return=representation,resolution=ignore-duplicates",
                },
            )
            if resp.status_code >= 400:
                print(
                    f"[zoning-dispatch]  insert failed for to_number={to_number} "
                    f"item={item}: HTTP {resp.status_code} {resp.text[:200]}"
                )
                continue
            body = resp.json() if resp.content else []
            if body:
                inserted += 1
                task_id = body[0].get("id") if isinstance(body, list) else None
                print(
                    f"[zoning-dispatch]  inserted task {task_id} for "
                    f"to_number={to_number} item={item} zone={task['payload']['zone_id']}"
                )
            else:
                # ignore-duplicates returns an empty body when the
                # idempotency key already existed. That's the success
                # case for a re-played import.
                print(
                    f"[zoning-dispatch]  duplicate (idempotency hit) "
                    f"to_number={to_number} item={item}"
                )
        except Exception as exc:
            print(
                f"[zoning-dispatch]  insert exception for to_number={to_number} "
                f"item={item}: {exc}"
            )
    return inserted

# Created and developed by Jai Singh
