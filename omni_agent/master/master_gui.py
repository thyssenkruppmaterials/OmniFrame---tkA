# Created and developed by Jai Singh
"""OmniFrame Agent Master — Phase B GUI + Phase D fix integration.

Launch: ``python -m omni_agent.master.master_gui``
"""

from __future__ import annotations

import logging
import math
import os
import queue
import subprocess
import sys
import time
from typing import Any

import customtkinter as ctk

from omni_agent.master import theme
from omni_agent.master.admin_client import AdminClient
from omni_agent.master.config import MasterConfig, load_config
from omni_agent.master.wizard import is_wizard_required, open_setup_wizard
from omni_agent.master.dialogs import MasterDialogs
from omni_agent.master.fix_actions import FixActionDispatcher
from omni_agent.master.fix_engine import (
    MasterFixContext,
    SAP_BANNER_SUPPRESS_SECONDS,
    all_workers_ws_down,
    detect_sap_restart_banner,
    should_suppress_sap_fix_toast,
    snapshot_from_runtime,
)
from omni_agent.master.logging_setup import configure_master_logging
from omni_agent.master.probe import HealthProbeLoop, build_initial_runtime
from omni_agent.master.state import MasterRuntimeState
from omni_agent.master.supervisor import WorkerSupervisor
from omni_agent.master.console_drawer import ConsoleDrawerLogic
from omni_agent.master.console_popout import ConsoleDrawerWidget, ConsolePopOutWindow
from omni_agent.master.layout import compute_tile_grid
from omni_agent.master.orphan_adoption import (
    adopt_running_workers,
    apply_adoptions_to_supervisor,
)
from omni_agent.master.settings_dialog import open_settings_dialog
from omni_agent.master.tile import WorkerTile
from omni_agent.master.tile_context_menu import (
    apply_rename_label,
    apply_toggle_auto_start,
    mount_context_menu,
)

LOG = logging.getLogger("omniframe.master.gui")

_SAP_BANNER_TEXT = (
    "SAP GUI restart detected — workers will reattach when sessions reappear"
)


class AgentMasterApp:
    def __init__(self) -> None:
        self.cfg: MasterConfig = load_config()
        configure_master_logging(self.cfg)
        self.runtime = MasterRuntimeState(
            using_builtin_defaults=self.cfg.using_builtin_defaults
        )
        self.result_queue: queue.Queue[tuple[str, dict[str, Any]]] = queue.Queue()
        self.supervisor: WorkerSupervisor | None = None
        self.probe: HealthProbeLoop | None = None
        self.tiles: dict[str, WorkerTile] = {}
        self._toast_label: ctk.CTkLabel | None = None
        self._master_start = time.time()
        self._fix_context = MasterFixContext()
        self._sap_transitions: list[tuple[float, str]] = []
        self._prev_sap_attached: dict[str, bool] = {}
        self._sap_banner_visible = False
        self._sap_banner_suppress_until = 0.0
        self._console_popouts: dict[str, ConsolePopOutWindow] = {}
        self._console_drawer: ConsoleDrawerWidget | None = None
        self._main_mounted = False
        self._admin: AdminClient | None = None
        self._dialogs: MasterDialogs | None = None
        self._fix_dispatcher: FixActionDispatcher | None = None
        self._setup_banner: ctk.CTkLabel | None = None

        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("dark-blue")

        self.root = ctk.CTk()
        self.root.title(theme.WINDOW_TITLE)
        self.root.geometry(f"{theme.DEFAULT_WIDTH}x{theme.DEFAULT_HEIGHT}")
        self.root.minsize(theme.MIN_WIDTH, theme.MIN_HEIGHT)
        self.root.configure(fg_color=theme.BG_WINDOW)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

        if is_wizard_required(self.cfg):
            self.root.withdraw()
            self._launch_setup_wizard(blocking_startup=True)
        else:
            self._init_runtime_services()
            self._run_orphan_adoption()
            self._mount_main_ui()

    def _init_runtime_services(self) -> None:
        self.supervisor = WorkerSupervisor(self.cfg)
        self.probe = HealthProbeLoop(
            self.cfg,
            self.result_queue,
            is_process_alive=self.supervisor.is_process_alive,
        )
        self._dialogs = MasterDialogs(
            self.root,
            admin_client=None,
            get_workers=self._runtime_workers_view,
            toast=self._show_toast,
            on_service_key_saved=self._on_service_key_saved,
        )
        self._admin = AdminClient(self.supervisor.admin_token)
        self._dialogs._admin = self._admin
        self._fix_dispatcher = FixActionDispatcher(
            self.cfg,
            self.runtime,
            self.supervisor,
            self._admin,
            self._dialogs,
            fix_context=self._current_fix_context,
            toast=self._show_toast,
            get_worker_port=self._worker_health_port,
        )

    def _run_orphan_adoption(self) -> None:
        if self.supervisor is None:
            return
        agent_exe = str(self.supervisor.resolve_agent_exe())
        result = adopt_running_workers(
            self.cfg,
            agent_exe_path=agent_exe,
        )
        apply_adoptions_to_supervisor(
            self.supervisor,
            self.runtime,
            result,
            toast=self._show_toast,
        )

        def _spawn_remaining() -> None:
            if self.supervisor is not None:
                self.supervisor.start_workers(only_auto_start=True)

        import threading

        threading.Thread(target=_spawn_remaining, daemon=True).start()

    def _on_wizard_complete(self, cfg: MasterConfig) -> None:
        self.cfg = cfg
        self.runtime.using_builtin_defaults = False
        if self.supervisor is None:
            self._init_runtime_services()
        self._run_orphan_adoption()
        self.root.deiconify()
        if not self._main_mounted:
            self._mount_main_ui()

    def _launch_setup_wizard(self, *, blocking_startup: bool = False, force_rerun: bool = False) -> None:
        open_setup_wizard(
            self.root,
            self.cfg,
            on_complete=self._on_wizard_complete,
            force_rerun=force_rerun,
        )

    def _mount_main_ui(self) -> None:
        if self._main_mounted:
            return
        assert self.supervisor is not None and self.probe is not None
        self._build_layout()
        self.probe.start()
        self._schedule_ui_tick()
        self._schedule_probe_tick()
        self._schedule_console_tick()
        self._main_mounted = True

    def _build_layout(self) -> None:
        self.root.grid_columnconfigure(0, weight=1)
        self.root.grid_rowconfigure(1, weight=1)
        self.root.grid_rowconfigure(2, weight=0)

        top = ctk.CTkFrame(self.root, fg_color=theme.BG_TILE, corner_radius=0)
        top.grid(row=0, column=0, sticky="ew", padx=0, pady=0)
        top.grid_columnconfigure(4, weight=1)

        title = ctk.CTkLabel(
            top,
            text=theme.WINDOW_TITLE,
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color=theme.TEXT_PRIMARY,
        )
        title.grid(row=0, column=0, padx=12, pady=8, sticky="w")

        self._healthy_lbl = ctk.CTkLabel(
            top, text="0/6 healthy", text_color=theme.TEXT_MUTED
        )
        self._healthy_lbl.grid(row=0, column=1, padx=8)

        self._jobs_hr = ctk.CTkLabel(top, text="jobs/hr —", text_color=theme.TEXT_MUTED)
        self._jobs_hr.grid(row=0, column=2, padx=8)

        self._err_hr = ctk.CTkLabel(top, text="errors/hr —", text_color=theme.TEXT_MUTED)
        self._err_hr.grid(row=0, column=3, padx=8)

        self._uptime_lbl = ctk.CTkLabel(top, text="uptime 0s", text_color=theme.TEXT_MUTED)
        self._uptime_lbl.grid(row=0, column=4, padx=8, sticky="w")

        # Phase D — SAP GUI restart banner
        self._sap_banner = ctk.CTkLabel(
            top,
            text=_SAP_BANNER_TEXT,
            fg_color=theme.BANNER_WARNING_BG,
            text_color=theme.BANNER_WARNING_FG,
            height=28,
        )
        self._sap_banner.grid(row=1, column=0, columnspan=10, sticky="ew", padx=12, pady=(0, 4))
        self._sap_banner.grid_remove()

        if is_wizard_required(self.cfg):
            self._setup_banner = ctk.CTkLabel(
                top,
                text="Setup not run — open Wizard",
                text_color=theme.PILL_CONNECTING,
                cursor="hand2",
            )
            self._setup_banner.grid(row=2, column=0, columnspan=10, sticky="w", padx=12, pady=(0, 4))
            self._setup_banner.bind(
                "<Button-1>",
                lambda _e: self._launch_setup_wizard(force_rerun=True),
            )

        btn_frame = ctk.CTkFrame(top, fg_color="transparent")
        btn_frame.grid(row=0, column=5, columnspan=5, padx=8, pady=8, sticky="e")

        specs = [
            ("Start All", self._on_start_all),
            ("Stop All", self._on_stop_all),
            ("Refresh Fleet", self._on_refresh),
            ("Open Logs Folder", self._open_logs),
            ("Settings", self._on_settings),
        ]
        for i, (text, cmd) in enumerate(specs):
            ctk.CTkButton(btn_frame, text=text, command=cmd, width=110).grid(
                row=0, column=i, padx=4
            )

        body = ctk.CTkFrame(self.root, fg_color="transparent")
        body.grid(row=1, column=0, sticky="nsew", padx=12, pady=8)
        n = self.cfg.master.workers
        rows = max(1, math.ceil(n / theme.GRID_COLUMNS))
        for c in range(theme.GRID_COLUMNS):
            body.grid_columnconfigure(c, weight=1)
        for r in range(rows):
            body.grid_rowconfigure(r, weight=1)

        workers = self.cfg.workers[:n]
        positions = compute_tile_grid(len(workers))
        with self.runtime.lock:
            for w, (row, col) in zip(workers, positions):
                snap = build_initial_runtime(w)
                self.runtime.workers[w.id] = snap
                tile = WorkerTile(
                    body,
                    snap,
                    on_action=self._on_tile_action,
                    row=row,
                    col=col,
                )
                self.tiles[w.id] = tile
                self._mount_tile_context_menu(tile, w.id)

        self._healthy_lbl.configure(text=f"0/{n} healthy")

        worker_ids = [w.id for w in workers]
        labels = {w.id: w.label for w in workers}
        console_logic = ConsoleDrawerLogic(
            worker_ids=worker_ids,
            worker_labels=labels,
            selected_worker_id=worker_ids[0] if worker_ids else "",
        )
        self._console_drawer = ConsoleDrawerWidget(
            self.root,
            console_logic,
            get_buffer=self.supervisor.get_console_buffer,
            get_gui_pending=self.supervisor.get_gui_pending,
            on_popout=self._open_console_popout,
            height=120,
        )
        self._console_drawer.grid(row=2, column=0, sticky="ew", padx=12, pady=(0, 12))

    def _runtime_workers_view(self) -> dict[str, Any]:
        with self.runtime.lock:
            return dict(self.runtime.workers)

    def _on_service_key_saved(self, worker_id: str, key: str) -> None:
        from omni_agent.master.config import write_service_key

        write_service_key(worker_id, key)
        self._show_toast(f"Service key saved for {worker_id}")

    def _current_fix_context(self) -> MasterFixContext:
        return self._fix_context

    def _worker_health_port(self, worker_id: str) -> int:
        with self.runtime.lock:
            snap = self.runtime.workers.get(worker_id)
            if snap:
                return snap.health_port
        for w in self.cfg.workers:
            if w.id == worker_id:
                return w.health_port
        return 8765

    def _on_tile_action(self, action_name: str, worker_id: str) -> None:
        tile = self.tiles.get(worker_id)
        if not tile or tile.last_health_snapshot is None:
            with self.runtime.lock:
                snap_state = self.runtime.workers.get(worker_id)
            if not snap_state:
                self._show_toast(f"Unknown worker {worker_id}")
                return
            snap = snapshot_from_runtime(snap_state, now=time.time())
        else:
            snap = tile.last_health_snapshot

        if self._fix_dispatcher is None:
            return
        if action_name == "fix":
            self._fix_dispatcher.dispatch_fix(worker_id, snap)
        elif action_name == "reassign":
            self._fix_dispatcher.dispatch_reassign_bypass(worker_id, snap)
        elif action_name == "restart":
            self._fix_dispatcher.dispatch_kill_and_respawn(worker_id)
        elif action_name == "console":
            with self.runtime.lock:
                snap_state = self.runtime.workers.get(worker_id)
            if snap_state and (snap_state.is_adopted or not snap_state.console_available):
                self._show_toast(
                    "Console available after Restart — adopted workers cannot stream live output."
                )
                return
            self.show_console_for(worker_id)
        elif action_name == "start":
            self._start_worker(worker_id)
        elif action_name == "stop":
            self._stop_worker(worker_id)
        else:
            self._show_toast(f"Unknown action {action_name}")

    def _show_toast(self, message: str) -> None:
        if self._toast_label is None:
            self._toast_label = ctk.CTkLabel(
                self.root,
                text=message,
                fg_color=theme.BG_TILE,
                corner_radius=8,
            )
            self._toast_label.place(relx=0.5, rely=0.92, anchor="center")
        else:
            self._toast_label.configure(text=message)
        self.root.after(2500, self._hide_toast)

    def _hide_toast(self) -> None:
        if self._toast_label:
            self._toast_label.place_forget()

    def _on_start_all(self) -> None:
        if self.supervisor is None:
            return

        def _run() -> None:
            self.supervisor.start_workers(only_auto_start=True)

        import threading

        threading.Thread(target=_run, daemon=True).start()
        self._show_toast("Starting workers…")

    def _on_stop_all(self) -> None:
        if self.supervisor is None:
            return

        def _run() -> None:
            self.supervisor.stop_all()

        import threading

        threading.Thread(target=_run, daemon=True).start()
        self._show_toast("Stopping workers…")

    def _on_refresh(self) -> None:
        if self.probe is not None:
            self.probe.probe_all_now()

    def _open_logs(self) -> None:
        log_dir = self.cfg.master.resolved_log_dir()
        log_dir.mkdir(parents=True, exist_ok=True)
        path = str(log_dir)
        try:
            if sys.platform == "win32":
                os.startfile(path)  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.Popen(["open", path])
            else:
                subprocess.Popen(["xdg-open", path])
        except Exception as exc:
            LOG.error("Failed to open logs folder: %s", exc)
            self._show_toast(f"Cannot open {path}")

    def _on_settings(self) -> None:
        open_settings_dialog(
            self.root,
            self.cfg,
            on_saved=self._on_settings_saved,
            on_rerun_wizard=lambda: self._launch_setup_wizard(force_rerun=True),
        )

    def _on_settings_saved(
        self,
        new_cfg: MasterConfig,
        restart_fields: frozenset[str],
        auto_restart: bool,
    ) -> None:
        old_cfg = self.cfg
        self.cfg = new_cfg
        self.runtime.using_builtin_defaults = False
        self._show_toast("Settings saved")
        if restart_fields and auto_restart and self.supervisor is not None:

            def _restart() -> None:
                for w in new_cfg.workers[: new_cfg.master.workers]:
                    if self.supervisor is None:
                        return
                    if self.supervisor.is_worker_adopted(w.id):
                        self.supervisor.restart_adopted(w.id)
                    elif self.supervisor.is_process_alive(w.id):
                        self.supervisor.kill_and_respawn(w.id)

            import threading

            threading.Thread(target=_restart, daemon=True).start()
        elif restart_fields:
            self._show_toast(
                "Restart required for: " + ", ".join(sorted(restart_fields))
            )
        if new_cfg.master.workers != old_cfg.master.workers:
            self._show_toast("Worker count changed — restart master to refresh tiles")

    def _mount_tile_context_menu(self, tile: WorkerTile, worker_id: str) -> None:
        def _get_state() -> dict[str, Any]:
            return self._tile_context_state(worker_id)

        def _get_auto_start() -> bool:
            worker = next((w for w in self.cfg.workers if w.id == worker_id), None)
            return worker.auto_start if worker else True

        def _persist_rename(label: str) -> None:
            self.cfg = apply_rename_label(self.cfg, worker_id, label)
            with self.runtime.lock:
                snap = self.runtime.workers.get(worker_id)
                if snap:
                    snap.label = label
            tile_obj = self.tiles.get(worker_id)
            if tile_obj:
                tile_obj._label.configure(text=label)
            self._show_toast(f"Label updated for {worker_id}")

        def _persist_toggle_auto_start() -> None:
            self.cfg, new_value = apply_toggle_auto_start(self.cfg, worker_id)
            state = "enabled" if new_value else "disabled"
            self._show_toast(f"Auto-start {state} for {worker_id}")

        mount_context_menu(
            self.root,
            tile,
            {
                "get_state": _get_state,
                "get_auto_start": _get_auto_start,
                "persist_rename": _persist_rename,
                "persist_toggle_auto_start": _persist_toggle_auto_start,
                "on_start": lambda: self._on_tile_action("start", worker_id),
                "on_repair_session": lambda: self._on_tile_action("reassign", worker_id),
                "on_restart": lambda: self._on_tile_action("restart", worker_id),
                "on_stop": lambda: self._on_tile_action("stop", worker_id),
            },
        )

    def _tile_context_state(self, worker_id: str) -> dict[str, Any]:
        worker_cfg = next((w for w in self.cfg.workers if w.id == worker_id), None)
        with self.runtime.lock:
            snap = self.runtime.workers.get(worker_id)
            if snap is None:
                return {
                    "is_adopted": False,
                    "process_alive": False,
                    "auto_start": worker_cfg.auto_start if worker_cfg else True,
                    "sap_attached": False,
                    "identity_ok": True,
                    "label": worker_cfg.label if worker_cfg else worker_id,
                }
            identity_ok = snap.identity_status in (
                "ok",
                "registered",
                "valid",
                "unknown",
            )
            return {
                "is_adopted": snap.is_adopted,
                "process_alive": snap.process_alive,
                "auto_start": worker_cfg.auto_start if worker_cfg else True,
                "sap_attached": snap.sap_attached,
                "identity_ok": identity_ok,
                "label": snap.label,
            }

    def _start_worker(self, worker_id: str) -> None:
        if self.supervisor is None:
            return

        def _run() -> None:
            started = self.supervisor.start_worker(worker_id)
            if not started:
                return

        import threading

        threading.Thread(target=_run, daemon=True).start()
        self._show_toast(f"Starting {worker_id}…")

    def _stop_worker(self, worker_id: str) -> None:
        if self.supervisor is None:
            return

        def _run() -> None:
            self.supervisor.stop_worker(worker_id)
            with self.runtime.lock:
                snap = self.runtime.workers.get(worker_id)
                if snap:
                    snap.is_adopted = False
                    snap.adopted_pid = None
                    snap.console_available = True
                    snap.process_alive = False

        import threading

        threading.Thread(target=_run, daemon=True).start()
        self._show_toast(f"Stopping {worker_id}…")

    def _drain_probe_queue(self) -> None:
        """Marshal probe results onto the Tk main loop (never touch widgets off-thread)."""
        batch: list[tuple[str, dict[str, Any]]] = []
        while True:
            try:
                batch.append(self.result_queue.get_nowait())
            except queue.Empty:
                break
        if batch:

            def _apply_batch() -> None:
                for worker_id, patch in batch:
                    self._apply_probe_patch(worker_id, patch)

            self.root.after(0, _apply_batch)

    def _apply_probe_patch(self, worker_id: str, patch: dict[str, Any]) -> None:
        now = time.time()
        with self.runtime.lock:
            snap = self.runtime.workers.get(worker_id)
            if not snap:
                return
            prev_sap = snap.sap_attached
            for key, val in patch.items():
                if hasattr(snap, key):
                    setattr(snap, key, val)
            if patch.get("http_ok"):
                snap.heartbeat_age_s = 0.0
            if "ws_connected" in patch:
                if snap.ws_connected:
                    snap.ws_down_since = None
                    snap.ws_down_seconds = 0.0
                elif snap.ws_down_since is None:
                    snap.ws_down_since = now
            if "sap_attached" in patch and prev_sap and not snap.sap_attached:
                self._sap_transitions.append((now, worker_id))
            self._prev_sap_attached[worker_id] = snap.sap_attached
            tile = self.tiles.get(worker_id)
            if tile:
                tile.apply_state(snap)

    def _update_ws_down_and_fix_context(self, now: float) -> None:
        detected = False
        any_sap_attached = False
        with self.runtime.lock:
            for snap in self.runtime.workers.values():
                if not snap.ws_connected and snap.ws_down_since is not None:
                    snap.ws_down_seconds = now - snap.ws_down_since
                elif snap.ws_connected:
                    snap.ws_down_seconds = 0.0
                if snap.process_alive and snap.sap_attached:
                    any_sap_attached = True
            self._fix_context.all_workers_ws_down = all_workers_ws_down(
                self.runtime.workers
            )
            detected = detect_sap_restart_banner(
                self.runtime.workers,
                self._sap_transitions,
                now,
            )
        if detected and self._sap_banner_suppress_until <= now:
            self._sap_banner_suppress_until = now + SAP_BANNER_SUPPRESS_SECONDS
        suppress_active = should_suppress_sap_fix_toast(
            now, self._sap_banner_suppress_until
        )
        self._fix_context.sap_restart_banner_active = suppress_active
        self._sap_transitions = [
            (ts, wid) for ts, wid in self._sap_transitions if now - ts <= 10.0
        ]
        show_banner = detected and not any_sap_attached
        if show_banner and not self._sap_banner_visible:
            self._sap_banner.grid()
            self._sap_banner_visible = True
        elif (any_sap_attached or not detected) and self._sap_banner_visible:
            self._sap_banner.grid_remove()
            self._sap_banner_visible = False

    def _ui_tick(self) -> None:
        self._drain_probe_queue()
        n = self.cfg.master.workers
        healthy = self.runtime.recompute_healthy_count()
        self._healthy_lbl.configure(text=f"{healthy}/{n} healthy")
        uptime = int(time.time() - self._master_start)
        self._uptime_lbl.configure(text=f"uptime {uptime}s")
        now = time.time()
        self._update_ws_down_and_fix_context(now)
        with self.runtime.lock:
            for snap in self.runtime.workers.values():
                if snap.last_success_at:
                    snap.heartbeat_age_s = now - snap.last_success_at
                tile = self.tiles.get(snap.worker_id)
                if tile:
                    tile.apply_state(snap)

    def _schedule_ui_tick(self) -> None:
        interval = max(250, self.cfg.master.ui_refresh_ms)

        def tick() -> None:
            self._ui_tick()
            self.root.after(interval, tick)

        self.root.after(interval, tick)

    def _schedule_probe_tick(self) -> None:
        if self.probe is None:
            return
        interval = max(500, self.cfg.master.health_probe_interval_ms)

        def tick() -> None:
            if self.probe is not None:
                self.probe.schedule_tick()
            self.root.after(interval, tick)

        self.root.after(interval, tick)

    def show_console_for(self, worker_id: str) -> None:
        if self._console_drawer is not None:
            self._console_drawer.show_worker(worker_id)

    def _open_console_popout(self, worker_id: str) -> None:
        existing = self._console_popouts.get(worker_id)
        if existing is not None:
            try:
                if existing.window.winfo_exists():
                    existing.window.lift()
                    return
            except Exception:
                pass
        buf = self.supervisor.get_console_buffer(worker_id)
        if buf is None:
            return
        label = worker_id
        for w in self.cfg.workers:
            if w.id == worker_id:
                label = w.label
                break

        def _on_closed(wid: str) -> None:
            self._console_popouts.pop(wid, None)

        self._console_popouts[worker_id] = ConsolePopOutWindow(
            self.root,
            worker_id,
            label,
            buf,
            on_closed=_on_closed,
        )

    def _schedule_console_tick(self) -> None:
        """50ms console drainer — selected worker + open pop-outs only."""

        def tick() -> None:
            if self._console_drawer is not None:
                self._console_drawer.tick(self._console_popouts)
            self.root.after(50, tick)

        self.root.after(50, tick)

    def _on_close(self) -> None:
        for pop in list(self._console_popouts.values()):
            try:
                pop.close()
            except Exception:
                pass
        self._console_popouts.clear()
        if self.probe is not None:
            self.probe.stop()
        if self._admin is not None:
            self._admin.close()
        if self.supervisor is not None:
            self.supervisor.stop_all()
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()


def main(argv: list[str] | None = None) -> None:
    from omni_agent.master.cli import handle_cli_before_gui

    if handle_cli_before_gui(argv):
        raise SystemExit(0)
    app = AgentMasterApp()
    app.run()


if __name__ == "__main__":
    main()

# Created and developed by Jai Singh
