# Created and developed by Jai Singh
"""Phase D4 — CTk modals and pure dialog logic (testable without Tk).

Pure helpers live at the top; CTk ``CTkToplevel`` classes below for runtime.
"""

from __future__ import annotations

import logging
import subprocess
import sys
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Optional, TYPE_CHECKING, Union
from urllib.parse import urlencode

from omni_agent.master.fix_engine import FixAction

if TYPE_CHECKING:
    import customtkinter as ctk

LOG = logging.getLogger("omniframe.master.dialogs")

# ---------------------------------------------------------------------------
# Pure logic (no Tk)
# ---------------------------------------------------------------------------

_ADMIN_CONFIRM_ACTIONS = frozenset(
    {
        FixAction.RESPAWN,
        FixAction.KILL_AND_RESPAWN,
        FixAction.SAP_REATTACH,
        FixAction.REASSIGN_SESSION,
    }
)

_BYPASS_ADMIN_CONFIRM = frozenset(
    {
        FixAction.WS_RECONNECT,
        FixAction.ABORT_STALE_JOB,
    }
)

ActionLike = Union[FixAction, str]


def _normalize_action(action: ActionLike) -> FixAction:
    if isinstance(action, FixAction):
        return action
    return FixAction(str(action))


def should_show_admin_confirm(
    action: ActionLike,
    job_age_seconds: Optional[int],
    fix_admin_confirm_required: bool,
) -> bool:
    """Return True when the destructive-fix confirm modal must appear."""

    if not fix_admin_confirm_required:
        return False
    if job_age_seconds is None:
        return False
    normalized = _normalize_action(action)
    if normalized in _BYPASS_ADMIN_CONFIRM:
        return False
    return normalized in _ADMIN_CONFIRM_ACTIONS


def select_healthy_peer_port(
    workers: dict[str, Any],
    exclude_id: str,
) -> Optional[int]:
    """First running peer with ``sap_attached=True`` (excluding ``exclude_id``)."""

    for worker_id, row in workers.items():
        if worker_id == exclude_id:
            continue
        if not _worker_running(row):
            continue
        if not _worker_sap_attached(row):
            continue
        port = _worker_health_port(row)
        if port is not None:
            return port
    return None


def parse_free_session_tuples(sessions_payload: dict[str, Any]) -> list[tuple[int, int]]:
    """Extract non-active ``(conn_idx, sess_idx)`` pairs from ``GET /sap/sessions``."""

    if not sessions_payload.get("ok"):
        return []

    free: list[tuple[int, int]] = []
    for conn in sessions_payload.get("connections") or []:
        conn_idx = int(conn.get("index", 0))
        for sess in conn.get("sessions") or []:
            if sess.get("is_active"):
                continue
            sess_idx = int(sess.get("index", 0))
            free.append((conn_idx, sess_idx))
    return free


def build_reregister_url(
    worker_id: str,
    base: str = "https://omniframe.up.railway.app",
) -> str:
    """Deep-link to Agent Setup with ``register=<worker_id>``."""

    params = urlencode({"tab": "agent-setup", "register": worker_id})
    return f"{base.rstrip('/')}/admin/sap-testing?{params}"


def fetch_free_sessions_from_peer(
    workers: dict[str, Any],
    exclude_id: str,
    *,
    fetch_sessions: Callable[[int], dict[str, Any]],
) -> tuple[Optional[int], list[tuple[int, int]]]:
    """One peer ``GET /sap/sessions`` → free ``(conn_idx, sess_idx)`` tuples."""

    peer_port = select_healthy_peer_port(workers, exclude_id)
    if peer_port is None:
        return None, []
    payload = fetch_sessions(peer_port)
    return peer_port, parse_free_session_tuples(payload)


def _worker_running(row: Any) -> bool:
    if isinstance(row, dict):
        return bool(row.get("process_alive"))
    return bool(getattr(row, "process_alive", False))


def _worker_sap_attached(row: Any) -> bool:
    if isinstance(row, dict):
        return bool(row.get("sap_attached"))
    return bool(getattr(row, "sap_attached", False))


def _worker_health_port(row: Any) -> Optional[int]:
    if isinstance(row, dict):
        raw = row.get("health_port")
    else:
        raw = getattr(row, "health_port", None)
    if raw is None:
        return None
    return int(raw)


def launch_sap_logon(path: str) -> None:
    """Fire-and-forget SAP Logon launcher."""

    flags = 0
    if sys.platform == "win32" and hasattr(subprocess, "CREATE_NO_WINDOW"):
        flags = subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]
    subprocess.Popen(
        [path],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=flags,
    )


# ---------------------------------------------------------------------------
# CTk dialogs (runtime) — imported lazily so pure-logic tests skip Tk deps.
# ---------------------------------------------------------------------------

try:
    import customtkinter as ctk

    from omni_agent.master import theme

    class AdminConfirmDialog(ctk.CTkToplevel):
        """Confirm destructive fix while a job is in flight."""

        def __init__(
            self,
            master: ctk.CTk,
            *,
            worker_label: str,
            job_id: str,
            job_step: str,
            on_result: Callable[[bool], None],
        ) -> None:
            super().__init__(master)
            self._on_result = on_result
            self.title("Confirm fix action")
            self.geometry("520x220")
            self.resizable(False, False)
            self.configure(fg_color=theme.BG_WINDOW)
            self.transient(master)
            self.grab_set()

            msg = (
                f"Worker {worker_label} is processing job {job_id} at step {job_step}.\n"
                "Restarting will fail this job (lease expires in ~90s; a peer worker "
                "can retake). Proceed?"
            )
            ctk.CTkLabel(
                self,
                text=msg,
                wraplength=480,
                justify="left",
                text_color=theme.TEXT_PRIMARY,
            ).pack(padx=16, pady=(16, 12), anchor="w")

            btn_row = ctk.CTkFrame(self, fg_color="transparent")
            btn_row.pack(padx=16, pady=(0, 16), fill="x")

            ctk.CTkButton(
                btn_row,
                text="Cancel",
                fg_color=theme.BTN_SECONDARY,
                command=lambda: self._finish(False),
            ).pack(side="right", padx=(8, 0))
            ctk.CTkButton(
                btn_row,
                text="Proceed",
                fg_color=theme.BTN_FIX,
                command=lambda: self._finish(True),
            ).pack(side="right")

            self.protocol("WM_DELETE_WINDOW", lambda: self._finish(False))

        def _finish(self, confirmed: bool) -> None:
            try:
                self.grab_release()
            except Exception:
                pass
            self.destroy()
            self._on_result(confirmed)

    class ReassignSessionDialog(ctk.CTkToplevel):
        """Pick a free SAP session tuple from a peer ``/sap/sessions`` payload."""

        def __init__(
            self,
            master: ctk.CTk,
            *,
            worker_label: str,
            free_tuples: list[tuple[int, int]],
            on_result: Callable[[Optional[tuple[int, int]]], None],
        ) -> None:
            super().__init__(master)
            self._on_result = on_result
            self.title("Reassign SAP session")
            self.geometry("420x320")
            self.resizable(False, False)
            self.configure(fg_color=theme.BG_WINDOW)
            self.transient(master)
            self.grab_set()

            ctk.CTkLabel(
                self,
                text=f"Choose a free SAP session for {worker_label}:",
                text_color=theme.TEXT_PRIMARY,
            ).pack(padx=16, pady=(16, 8), anchor="w")

            scroll = ctk.CTkScrollableFrame(self, fg_color=theme.BG_TILE)
            scroll.pack(padx=16, pady=8, fill="both", expand=True)

            if not free_tuples:
                ctk.CTkLabel(
                    scroll,
                    text="No free sessions found on the healthy peer.",
                    text_color=theme.TEXT_MUTED,
                ).pack(padx=8, pady=8, anchor="w")
            else:
                for conn_idx, sess_idx in free_tuples:
                    label = f"conn {conn_idx} / session {sess_idx}"
                    ctk.CTkButton(
                        scroll,
                        text=label,
                        anchor="w",
                        fg_color=theme.BTN_SECONDARY,
                        command=lambda c=conn_idx, s=sess_idx: self._finish((c, s)),
                    ).pack(fill="x", padx=4, pady=2)

            ctk.CTkButton(
                self,
                text="Cancel",
                fg_color=theme.BTN_SECONDARY,
                command=lambda: self._finish(None),
            ).pack(padx=16, pady=(0, 16))

            self.protocol("WM_DELETE_WINDOW", lambda: self._finish(None))

        def _finish(self, choice: Optional[tuple[int, int]]) -> None:
            try:
                self.grab_release()
            except Exception:
                pass
            self.destroy()
            self._on_result(choice)

    class ReregisterKeyDialog(ctk.CTkToplevel):
        """Open browser to re-register, or paste a new service key."""

        def __init__(
            self,
            master: ctk.CTk,
            *,
            worker_id: str,
            worker_label: str,
            on_result: Callable[[Optional[str]], None],
            base_url: str = "https://omniframe.up.railway.app",
        ) -> None:
            super().__init__(master)
            self._on_result = on_result
            self._worker_id = worker_id
            self._register_url = build_reregister_url(worker_id, base=base_url)
            self.title("Re-register service key")
            self.geometry("480x260")
            self.resizable(False, False)
            self.configure(fg_color=theme.BG_WINDOW)
            self.transient(master)
            self.grab_set()

            ctk.CTkLabel(
                self,
                text=f"Service key for {worker_label} ({worker_id}) is invalid.\n"
                "Open the admin UI to register, then paste the new key below.",
                wraplength=440,
                justify="left",
                text_color=theme.TEXT_PRIMARY,
            ).pack(padx=16, pady=(16, 8), anchor="w")

            ctk.CTkButton(
                self,
                text="Open Browser",
                fg_color=theme.BTN_FIX,
                command=self._open_browser,
            ).pack(padx=16, pady=4, anchor="w")

            self._key_entry = ctk.CTkEntry(
                self,
                placeholder_text="Paste omni_sk_* key here",
                width=440,
            )
            self._key_entry.pack(padx=16, pady=8)

            btn_row = ctk.CTkFrame(self, fg_color="transparent")
            btn_row.pack(padx=16, pady=(0, 16), fill="x")
            ctk.CTkButton(
                btn_row,
                text="Cancel",
                fg_color=theme.BTN_SECONDARY,
                command=lambda: self._finish(None),
            ).pack(side="right", padx=(8, 0))
            ctk.CTkButton(
                btn_row,
                text="Save Key",
                fg_color=theme.BTN_FIX,
                command=self._save,
            ).pack(side="right")

            self.protocol("WM_DELETE_WINDOW", lambda: self._finish(None))

        def _open_browser(self) -> None:
            try:
                webbrowser.open(self._register_url)
            except Exception as exc:
                LOG.warning("Failed to open browser for %s: %s", self._worker_id, exc)

        def _save(self) -> None:
            key = self._key_entry.get().strip()
            self._finish(key or None)

        def _finish(self, key: Optional[str]) -> None:
            try:
                self.grab_release()
            except Exception:
                pass
            self.destroy()
            self._on_result(key)

    class NetworkDiagnosticDialog(ctk.CTkToplevel):
        """Run ``network_diag`` checks off the UI thread and update status rows."""

        _CHECK_LABELS = ("DNS resolve", "TCP :443", "GET /health")

        def __init__(
            self,
            master: ctk.CTk,
            *,
            on_close: Optional[Callable[[], None]] = None,
            executor: Optional[ThreadPoolExecutor] = None,
        ) -> None:
            super().__init__(master)
            self._on_close = on_close
            self._executor = executor or ThreadPoolExecutor(max_workers=1)
            self._owns_executor = executor is None
            self.title("Network diagnostic")
            self.geometry("520x300")
            self.resizable(False, False)
            self.configure(fg_color=theme.BG_WINDOW)
            self.transient(master)
            self.grab_set()

            ctk.CTkLabel(
                self,
                text="Checking connectivity to rust-work-service…",
                text_color=theme.TEXT_PRIMARY,
            ).pack(padx=16, pady=(16, 8), anchor="w")

            self._rows: list[ctk.CTkLabel] = []
            for label in self._CHECK_LABELS:
                row = ctk.CTkLabel(
                    self,
                    text=f"{label}: …",
                    anchor="w",
                    text_color=theme.TEXT_MUTED,
                )
                row.pack(padx=16, pady=4, fill="x")
                self._rows.append(row)

            self._verdict = ctk.CTkLabel(
                self,
                text="Running checks…",
                wraplength=480,
                justify="left",
                text_color=theme.TEXT_PRIMARY,
            )
            self._verdict.pack(padx=16, pady=(12, 8), anchor="w")

            ctk.CTkButton(
                self,
                text="Close",
                fg_color=theme.BTN_SECONDARY,
                command=self._close,
            ).pack(padx=16, pady=(0, 16))

            self.protocol("WM_DELETE_WINDOW", self._close)
            self._start_checks()

        def _start_checks(self) -> None:
            self._executor.submit(self._run_checks_worker)

        def _run_checks_worker(self) -> None:
            try:
                from omni_agent.master.network_diag import (
                    compose_verdict,
                    run_all_checks,
                )

                results, verdict = run_all_checks()
                row_texts = [
                    f"{r.name}: {'OK' if r.status.value == 'ok' else 'FAIL'} — {r.detail}"
                    + (f" ({r.latency_ms} ms)" if r.latency_ms is not None else "")
                    for r in results
                ]
            except ImportError:
                row_texts = [
                    f"{label}: SKIP — network_diag module not available"
                    for label in self._CHECK_LABELS
                ]
                verdict = "Network diagnostic module unavailable (Phase D3)."
            except Exception as exc:
                LOG.exception("Network diagnostic failed")
                row_texts = [f"{label}: ERROR" for label in self._CHECK_LABELS]
                verdict = f"Diagnostic error: {exc}"

            self.after(0, lambda: self._apply_results(row_texts, verdict))

        def _apply_results(self, row_texts: list[str], verdict: str) -> None:
            for row, text in zip(self._rows, row_texts):
                row.configure(text=text)
            self._verdict.configure(text=verdict)

        def _close(self) -> None:
            try:
                self.grab_release()
            except Exception:
                pass
            if self._owns_executor:
                self._executor.shutdown(wait=False, cancel_futures=True)
            self.destroy()
            if self._on_close:
                self._on_close()

    class MasterDialogs:
        """Phase D5 facade — maps fix dispatcher callbacks to D4 dialog classes."""

        def __init__(
            self,
            root: ctk.CTk,
            *,
            admin_client: Any = None,
            get_workers: Optional[Callable[[], dict[str, Any]]] = None,
            toast: Optional[Callable[[str], None]] = None,
            on_service_key_saved: Optional[Callable[[str, str], None]] = None,
        ) -> None:
            self._root = root
            self._admin = admin_client
            self._get_workers = get_workers or (lambda: {})
            self._toast = toast or (lambda _msg: None)
            self._on_service_key_saved = on_service_key_saved

        def confirm_admin_action(
            self,
            snap: Any,
            action_label: str,
            *,
            on_confirm: Callable[[], None],
            on_cancel: Optional[Callable[[], None]] = None,
        ) -> None:
            worker_label = getattr(snap, "worker_id", None) or "worker"
            job_id = str(getattr(snap, "in_flight_job", None) or "active job")
            AdminConfirmDialog(
                self._root,
                worker_label=worker_label,
                job_id=job_id,
                job_step=action_label,
                on_result=lambda ok: on_confirm() if ok else (on_cancel() if on_cancel else None),
            )

        def show_reassign_session(
            self,
            snap: Any,
            *,
            on_choice: Callable[[Optional[tuple[int, int]]], None],
        ) -> None:
            worker_label = getattr(snap, "worker_id", None) or "worker"
            worker_id = str(worker_label)

            def _open(free_tuples: list[tuple[int, int]]) -> None:
                ReassignSessionDialog(
                    self._root,
                    worker_label=worker_label,
                    free_tuples=free_tuples,
                    on_result=on_choice,
                )

            def _fetch_worker() -> None:
                try:
                    workers = self._get_workers()
                    if self._admin is not None:
                        fetcher = self._admin.fetch_sap_sessions
                    else:
                        import httpx

                        def fetcher(port: int) -> dict[str, Any]:
                            resp = httpx.get(
                                f"http://127.0.0.1:{port}/sap/sessions",
                                timeout=5.0,
                            )
                            resp.raise_for_status()
                            return resp.json()

                    peer_port, free = fetch_free_sessions_from_peer(
                        workers,
                        worker_id,
                        fetch_sessions=fetcher,
                    )
                    if peer_port is None:
                        self._toast("No healthy peer with SAP attached")
                        _open([])
                    else:
                        _open(free)
                except Exception as exc:
                    LOG.warning("Peer /sap/sessions fetch failed: %s", exc)
                    self._toast(f"Failed to list peer sessions: {exc}")
                    _open([])

            threading.Thread(target=_fetch_worker, daemon=True).start()

        def show_reregister_modal(self, snap: Any) -> None:
            worker_id = getattr(snap, "worker_id", None) or "worker"

            def _on_key(key: Optional[str]) -> None:
                if not key:
                    return
                if self._on_service_key_saved:
                    self._on_service_key_saved(worker_id, key)
                else:
                    from omni_agent.master.config import write_service_key

                    write_service_key(worker_id, key)
                    self._toast(f"Service key saved for {worker_id}")

            ReregisterKeyDialog(
                self._root,
                worker_id=worker_id,
                worker_label=worker_id,
                on_result=_on_key,
            )

        def show_network_diagnostic(
            self,
            *,
            on_complete: Optional[Callable[[str], None]] = None,
        ) -> None:
            NetworkDiagnosticDialog(
                self._root,
                on_close=lambda: on_complete("done") if on_complete else None,
            )

except ImportError:  # pragma: no cover - CI without customtkinter
    AdminConfirmDialog = None  # type: ignore[misc, assignment]
    ReassignSessionDialog = None  # type: ignore[misc, assignment]
    ReregisterKeyDialog = None  # type: ignore[misc, assignment]
    NetworkDiagnosticDialog = None  # type: ignore[misc, assignment]
    MasterDialogs = None  # type: ignore[misc, assignment]

# Created and developed by Jai Singh
