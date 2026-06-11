# Created and developed by Jai Singh
"""Fix action dispatcher — ties engine, admin client, supervisor, dialogs."""

from __future__ import annotations

import logging
import threading
from typing import Any, Callable, Optional, Protocol

from omni_agent.master.admin_client import AdminClient
from omni_agent.master.config import MasterConfig
from omni_agent.master.fix_engine import (
    FixAction,
    HealthSnapshot,
    MasterFixContext,
    is_sap_recovery_action,
    pick_fix_action,
    requires_admin_confirm,
)
from omni_agent.master.state import MasterRuntimeState
from omni_agent.master.supervisor import WorkerSupervisor

LOG = logging.getLogger("omniframe.master.fix_actions")


class MasterDialogsPort(Protocol):
    def confirm_admin_action(
        self,
        snap: HealthSnapshot,
        action_label: str,
        *,
        on_confirm: Callable[[], None],
    ) -> None: ...

    def show_reassign_session(
        self,
        snap: HealthSnapshot,
        *,
        on_choice: Callable[[Optional[tuple[int, int]]], None],
    ) -> None: ...

    def show_reregister_modal(self, snap: HealthSnapshot) -> None: ...

    def show_network_diagnostic(
        self,
        *,
        on_complete: Callable[[str], None],
    ) -> None: ...


def _safe_admin(call: Callable[[], dict]) -> dict:
    try:
        return call()
    except Exception as exc:
        LOG.warning("Admin call failed: %s", exc)
        return {"ok": False, "error": repr(exc)}


class FixActionDispatcher:
    """Execute fix tree actions (Plan Section 5)."""

    def __init__(
        self,
        cfg: MasterConfig,
        runtime: MasterRuntimeState,
        supervisor: WorkerSupervisor,
        admin: AdminClient,
        dialogs: MasterDialogsPort,
        *,
        fix_context: Callable[[], MasterFixContext],
        toast: Callable[[str], None],
        get_worker_port: Callable[[str], int],
    ) -> None:
        self._cfg = cfg
        self._runtime = runtime
        self._supervisor = supervisor
        self._admin = admin
        self._dialogs = dialogs
        self._fix_context = fix_context
        self._toast = toast
        self._get_worker_port = get_worker_port

    def dispatch_fix(self, worker_id: str, snap: HealthSnapshot) -> None:
        ctx = self._fix_context()
        action = pick_fix_action(snap, ctx)
        if action == FixAction.SHOW_HEALTHY_TOAST:
            self._toast(f"{worker_id}: healthy — no action needed")
            return
        if ctx.sap_restart_banner_active and is_sap_recovery_action(action):
            self._toast("Banner active — auto-recovery in progress")
            return
        if action == FixAction.REASSIGN_SESSION:
            if requires_admin_confirm(
                action,
                snap,
                self._cfg.master.fix_admin_confirm_required,
            ):
                self._dialogs.confirm_admin_action(
                    snap,
                    action.value.replace("_", " "),
                    on_confirm=lambda: self._open_reassign_dialog(worker_id, snap),
                )
                return
            self._open_reassign_dialog(worker_id, snap)
            return
        if requires_admin_confirm(
            action,
            snap,
            self._cfg.master.fix_admin_confirm_required,
        ):
            self._dialogs.confirm_admin_action(
                snap,
                action.value.replace("_", " "),
                on_confirm=lambda: self._execute(worker_id, action, snap),
            )
            return
        self._execute(worker_id, action, snap)

    def dispatch_reassign_bypass(self, worker_id: str, snap: HealthSnapshot) -> None:
        """Tile ``R`` — skip tree, open reassign dialog."""
        ctx = self._fix_context()
        if ctx.sap_restart_banner_active:
            self._toast("Banner active — auto-recovery in progress")
            return
        self._open_reassign_dialog(worker_id, snap)

    def _open_reassign_dialog(self, worker_id: str, snap: HealthSnapshot) -> None:
        self._dialogs.show_reassign_session(
            snap,
            on_choice=lambda choice: self._apply_reassign(worker_id, choice),
        )

    def _apply_reassign(
        self, worker_id: str, choice: Optional[tuple[int, int]]
    ) -> None:
        if choice is None:
            return
        conn_idx, sess_idx = choice
        worker_cfg = self._find_worker_config(worker_id)
        if worker_cfg is None:
            self._toast(f"Unknown worker config {worker_id}")
            return
        worker_cfg.sap_conn_idx = conn_idx
        worker_cfg.sap_session_index = sess_idx
        with self._runtime.lock:
            snap = self._runtime.workers.get(worker_id)
            if snap:
                snap.sap_conn_idx = conn_idx
                snap.sap_session_index = sess_idx
        self._toast(
            f"Reassigned {worker_id} → conn {conn_idx} sess {sess_idx}; restarting…"
        )

        def _run() -> None:
            if self._is_adopted(worker_id):
                self._supervisor.restart_adopted(worker_id)
                self._clear_adopted_runtime(worker_id)
            else:
                self._supervisor.kill_and_respawn(worker_id)
            self._toast(f"{worker_id} restarted with new SAP session")

        threading.Thread(target=_run, daemon=True).start()

    def _find_worker_config(self, worker_id: str):
        for w in self._cfg.workers:
            if w.id == worker_id:
                return w
        return None

    def _is_adopted(self, worker_id: str) -> bool:
        with self._runtime.lock:
            snap = self._runtime.workers.get(worker_id)
            if snap is not None and snap.is_adopted:
                return True
        return self._supervisor.is_worker_adopted(worker_id)

    def _clear_adopted_runtime(self, worker_id: str) -> None:
        with self._runtime.lock:
            snap = self._runtime.workers.get(worker_id)
            if snap is None:
                return
            snap.is_adopted = False
            snap.adopted_pid = None
            snap.console_available = True

    def dispatch_kill_and_respawn(self, worker_id: str) -> None:
        """Tile ``Rst`` — hard restart (adopted → restart_adopted)."""
        if self._is_adopted(worker_id):
            self._toast(f"Restarting adopted {worker_id}…")

            def _run() -> None:
                self._supervisor.restart_adopted(worker_id)
                self._clear_adopted_runtime(worker_id)
                self._toast(f"{worker_id} restarted with console streaming")

            threading.Thread(target=_run, daemon=True).start()
            return

        self._toast(f"Restarting {worker_id}…")

        def _run() -> None:
            self._supervisor.kill_and_respawn(worker_id)
            self._toast(f"{worker_id} restarted")

        threading.Thread(target=_run, daemon=True).start()

    def _execute(self, worker_id: str, action: FixAction, snap: HealthSnapshot) -> None:
        handlers = {
            FixAction.RESPAWN: self.respawn,
            FixAction.KILL_AND_RESPAWN: self.kill_and_respawn,
            FixAction.WS_RECONNECT: self.ws_reconnect,
            FixAction.SAP_REATTACH: self.sap_reattach,
            FixAction.REASSIGN_SESSION: self.reassign_session,
            FixAction.REREGISTER_KEY: self.reregister,
            FixAction.ABORT_STALE_JOB: self.abort_stale_job,
            FixAction.SHOW_NETWORK_DIAGNOSTIC: self.network_diagnostic,
        }
        handler = handlers.get(action)
        if handler is None:
            return
        handler(worker_id, snap)

    def respawn(self, worker_id: str, _snap: Optional[HealthSnapshot] = None) -> None:
        self._toast(f"Respawning {worker_id}…")

        def _run() -> None:
            self._supervisor.respawn(worker_id)
            self._toast(f"{worker_id} respawned")

        threading.Thread(target=_run, daemon=True).start()

    def kill_and_respawn(
        self, worker_id: str, _snap: Optional[HealthSnapshot] = None
    ) -> None:
        """Mode B — adopted workers skip Popen kill ladder."""
        self.dispatch_kill_and_respawn(worker_id)

    def ws_reconnect(self, worker_id: str, _snap: Optional[HealthSnapshot] = None) -> None:
        port = self._get_worker_port(worker_id)
        self._toast(f"WS reconnect {worker_id}…")

        def _run() -> None:
            result = _safe_admin(lambda: self._admin.ws_reconnect(port))
            if result.get("ok"):
                self._toast(f"{worker_id}: WS reconnect OK")
            else:
                self._toast(f"{worker_id}: WS reconnect failed — {result.get('error', '?')}")

        threading.Thread(target=_run, daemon=True).start()

    def sap_reattach(self, worker_id: str, _snap: Optional[HealthSnapshot] = None) -> None:
        port = self._get_worker_port(worker_id)
        self._toast(f"SAP reattach {worker_id}…")

        def _run() -> None:
            result = _safe_admin(lambda: self._admin.sap_reattach(port))
            if result.get("ok"):
                self._toast(f"{worker_id}: SAP reattached")
            elif result.get("error") == "GetObject SAPGUI failed":
                self._toast(f"{worker_id}: SAP GUI not running — launch SAPLogon")
            else:
                self._toast(f"{worker_id}: reattach failed — {result.get('error', '?')}")

        threading.Thread(target=_run, daemon=True).start()

    def reassign_session(self, worker_id: str, snap: HealthSnapshot) -> None:
        self._open_reassign_dialog(worker_id, snap)

    def reregister(self, worker_id: str, snap: HealthSnapshot) -> None:
        self._dialogs.show_reregister_modal(snap)

    def abort_stale_job(self, worker_id: str, _snap: Optional[HealthSnapshot] = None) -> None:
        port = self._get_worker_port(worker_id)
        self._toast(f"Aborting stale job on {worker_id}…")

        def _run() -> None:
            result = _safe_admin(lambda: self._admin.job_abort(port))
            if result.get("ok"):
                self._toast(f"{worker_id}: job abort sent")
            else:
                self._toast(f"{worker_id}: abort failed — {result.get('error', '?')}")

        threading.Thread(target=_run, daemon=True).start()

    def network_diagnostic(
        self, _worker_id: str, _snap: Optional[HealthSnapshot] = None
    ) -> None:
        self._dialogs.show_network_diagnostic(
            on_complete=lambda summary: self._toast("Network diagnostic complete")
        )


# ---------------------------------------------------------------------------
# Phase D2 — HTTP-only executors (injectable AdminClient + callbacks)
# ---------------------------------------------------------------------------


class AdminClientFactory(Protocol):
    def __call__(self, admin_token: str) -> AdminClient:
        ...


def _default_client_factory(admin_token: str) -> AdminClient:
    return AdminClient(admin_token)


def execute_ws_reconnect(
    port: int,
    *,
    admin_token: str,
    client_factory: AdminClientFactory = _default_client_factory,
    on_success: Optional[Callable[[dict[str, Any]], None]] = None,
    on_error: Optional[Callable[[Exception], None]] = None,
) -> dict[str, Any]:
    client = client_factory(admin_token)
    try:
        result = client.ws_reconnect(port)
        if result.get("ok") and on_success:
            on_success(result)
        return result
    except Exception as exc:
        if on_error:
            on_error(exc)
        raise
    finally:
        client.close()


def execute_abort_stale_job(
    port: int,
    *,
    admin_token: str,
    detail: str = "aborted by master controller",
    client_factory: AdminClientFactory = _default_client_factory,
    on_success: Optional[Callable[[dict[str, Any]], None]] = None,
    on_error: Optional[Callable[[Exception], None]] = None,
) -> dict[str, Any]:
    client = client_factory(admin_token)
    try:
        result = client.job_abort(port, detail=detail)
        if result.get("ok") and on_success:
            on_success(result)
        return result
    except Exception as exc:
        if on_error:
            on_error(exc)
        raise
    finally:
        client.close()


def execute_sap_reattach(
    port: int,
    *,
    admin_token: str,
    client_factory: AdminClientFactory = _default_client_factory,
    on_success: Optional[Callable[[dict[str, Any]], None]] = None,
    on_error: Optional[Callable[[Exception], None]] = None,
) -> dict[str, Any]:
    client = client_factory(admin_token)
    try:
        result = client.sap_reattach(port)
        if result.get("ok") and on_success:
            on_success(result)
        return result
    except Exception as exc:
        if on_error:
            on_error(exc)
        raise
    finally:
        client.close()

# Created and developed by Jai Singh
