# Created and developed by Jai Singh
"""OmniFrame Connect floating widget (CustomTkinter)."""

from __future__ import annotations

import logging
import os
import signal
import threading
import time
import webbrowser
from datetime import datetime, timezone
from typing import Optional

import customtkinter as ctk

from omni_agent.connect.animation import schedule_pulse
from omni_agent.connect.cli import run_reset
from omni_agent.connect.diagnostic import (
    compute_diagnostic_subtitle_hint,
    mark_diagnostic_modal_shown,
    run_self_diagnostic,
    should_show_diagnostic_modal,
    update_diagnostic_state,
)
from omni_agent.connect.dialogs import (
    compute_reset_steps,
    open_log_dir,
    show_friendly_error,
    show_info_modal,
    show_update_available_modal,
)
from omni_agent.connect.error_handler import install as install_error_handler
from omni_agent.connect.logging_setup import configure_connect_logging
from omni_agent.connect.state import (
    ConnectPillState,
    ConnectState,
    PAUSED_SUBTITLE_PREFIX,
    WORKER_PORT,
    compute_pill_color,
    format_health_subtitle,
    format_state_label,
    is_paused_state,
    resolve_subtitle_hint,
)
from omni_agent.connect.self_update import (
    PILL_UPDATING_COLOR,
    UPDATING_LABEL,
    SelfUpdateController,
    check_for_update,
    clear_dismiss_if_installed_matches,
    configure_controller,
    current_exe_path,
    dismiss_update_for_version,
    record_check,
    should_offer_update,
    start_install,
)
from omni_agent.connect.supervisor import WatchdogSupervisor
from omni_agent.connect.update_state import read_update_state, should_check
from omni_agent.connect.theme import (
    BG_TILE,
    BG_WINDOW,
    BTN_FIX,
    BTN_SECONDARY,
    CONNECT_HEIGHT,
    CONNECT_WIDTH,
    CONNECT_WINDOW_TITLE,
    TEXT_MUTED,
    TEXT_PRIMARY,
)
from omni_agent.connect.tooltip import ConnectTooltip
from omni_agent.connect.widget_position import (
    Position,
    clamp_to_visible_monitor,
    list_monitors_fallback,
    position_path,
    read_position,
    try_list_monitors,
    write_position,
)

LOG = logging.getLogger("omniframe.connect.gui")

DEFAULT_WEB_URL = "https://omniframe.up.railway.app/"
POLL_MS = 200
DRAG_WRITE_THROTTLE_S = 0.5
PAUSED_BORDER_COLOR = "#1e293b"
UPDATE_POLL_MS = 24 * 60 * 60 * 1000


def resolve_web_url() -> str:
    return os.environ.get("OMNI_WEB_URL", DEFAULT_WEB_URL).strip() or DEFAULT_WEB_URL


def orchestrate_reset(supervisor: WatchdogSupervisor) -> None:
    """Execute the in-widget Reset sequence (pure step order in ``compute_reset_steps``)."""
    for step in compute_reset_steps():
        if step == "supervisor.pause":
            supervisor.pause()
        elif step == "cli.run_reset":
            run_reset()
        elif step == "supervisor.restart":
            supervisor.restart()


class ConnectWidget(ctk.CTk):
    """Always-on-top frameless draggable Connect widget."""

    def __init__(self) -> None:
        super().__init__()
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self.title(CONNECT_WINDOW_TITLE)
        self.geometry(f"{CONNECT_WIDTH}x{CONNECT_HEIGHT}")
        self.configure(fg_color=BG_WINDOW)
        self.overrideredirect(True)
        self.attributes("-topmost", True)

        self._drag_x = 0
        self._drag_y = 0
        self._dragging = False
        self._last_position_write = 0.0
        self._last_monitor_key: Optional[tuple[int, ...]] = None
        self._pos_path = position_path()
        self._menu_open = False
        self._menu_frame: Optional[ctk.CTkFrame] = None
        self._root_frame: Optional[ctk.CTkFrame] = None
        self._tooltip: Optional[ConnectTooltip] = None
        self._last_pill_color = compute_pill_color(ConnectPillState.CONNECTING)
        self._supervisor = WatchdogSupervisor()
        self._shutting_down = False
        self._crash_modal_shown = False
        self._update_modal_shown = False
        self._install_in_progress = False
        self._pending_update_entry = None
        self._web_url = resolve_web_url()
        self._diagnostic_result = run_self_diagnostic(
            f"http://127.0.0.1:{WORKER_PORT}/health",
            self._web_url,
        )
        self._diagnostic_state = update_diagnostic_state(self._diagnostic_result)

        install_error_handler(self)

        configure_controller(
            SelfUpdateController(
                on_updating=self._on_update_started,
                on_error=self._on_update_error,
                on_exit_for_replace=self._on_exit_for_replace,
                supervisor_shutdown=self._supervisor.shutdown_connect,
            )
        )
        clear_dismiss_if_installed_matches()

        self._build_ui()
        self._apply_initial_position()
        self.protocol("WM_DELETE_WINDOW", self._on_close_request)
        self.bind("<ButtonPress-1>", self._on_drag_start)
        self.bind("<B1-Motion>", self._on_drag_motion)
        self.bind("<ButtonRelease-1>", self._on_drag_end)
        self.bind("<Configure>", self._on_configure, add="+")

        signal.signal(signal.SIGTERM, self._on_sigterm)

        self._supervisor.start()
        self._apply_state(self._supervisor.state)
        self.after(0, self._maybe_show_launch_diagnostic)
        self.after(0, self._schedule_update_check)
        self.after(POLL_MS, self._drain_queues)

    def _current_monitors(self) -> list[tuple[int, int, int, int]]:
        monitors = try_list_monitors()
        if not monitors:
            self.update_idletasks()
            monitors = list_monitors_fallback(
                self.winfo_screenwidth(),
                self.winfo_screenheight(),
            )
        return monitors

    def _current_geometry_position(self) -> Position:
        self.update_idletasks()
        x = self.winfo_x()
        y = self.winfo_y()
        monitors = self._current_monitors()
        monitor = monitors[0] if monitors else (0, 0, self.winfo_screenwidth(), self.winfo_screenheight())
        for rect in monitors:
            if (
                x >= rect[0]
                and y >= rect[1]
                and (x + CONNECT_WIDTH) <= (rect[0] + rect[2])
                and (y + CONNECT_HEIGHT) <= (rect[1] + rect[3])
            ):
                monitor = rect
                break
        return Position(x=x, y=y, monitor_geometry=monitor)

    def _apply_geometry(self, pos: Position) -> None:
        self.geometry(f"{CONNECT_WIDTH}x{CONNECT_HEIGHT}+{pos.x}+{pos.y}")

    def _place_bottom_right(self) -> None:
        self.update_idletasks()
        monitors = self._current_monitors()
        if monitors:
            rx, ry, rw, rh = monitors[-1]
            x = max(rx, rx + rw - CONNECT_WIDTH - 16)
            y = max(ry, ry + rh - CONNECT_HEIGHT - 48)
        else:
            sw = self.winfo_screenwidth()
            sh = self.winfo_screenheight()
            x = max(0, sw - CONNECT_WIDTH - 16)
            y = max(0, sh - CONNECT_HEIGHT - 48)
        self._apply_geometry(Position(x=x, y=y, monitor_geometry=monitors[-1] if monitors else (0, 0, self.winfo_screenwidth(), self.winfo_screenheight())))

    def _apply_initial_position(self) -> None:
        saved = read_position(self._pos_path)
        if saved is None:
            self._place_bottom_right()
            self._ensure_on_screen(force=True)
            return
        monitors = self._current_monitors()
        clamped = clamp_to_visible_monitor(
            saved,
            monitors,
            widget_width=CONNECT_WIDTH,
            widget_height=CONNECT_HEIGHT,
        )
        inside = any(
            saved.x >= m[0]
            and saved.y >= m[1]
            and (saved.x + CONNECT_WIDTH) <= (m[0] + m[2])
            and (saved.y + CONNECT_HEIGHT) <= (m[1] + m[3])
            for m in monitors
        )
        if inside:
            self._apply_geometry(saved)
        else:
            self._apply_geometry(clamped)
        self._ensure_on_screen(force=True)

    def _ensure_on_screen(self, *, force: bool = False) -> None:
        monitors = self._current_monitors()
        monitor_key = tuple(v for rect in monitors for v in rect)
        if not force and monitor_key == self._last_monitor_key:
            return
        self._last_monitor_key = monitor_key
        current = self._current_geometry_position()
        clamped = clamp_to_visible_monitor(
            current,
            monitors,
            widget_width=CONNECT_WIDTH,
            widget_height=CONNECT_HEIGHT,
        )
        if clamped.x != current.x or clamped.y != current.y:
            self._apply_geometry(clamped)

    def _maybe_write_position(self, *, force: bool = False) -> None:
        now = time.monotonic()
        if not force and (now - self._last_position_write) < DRAG_WRITE_THROTTLE_S:
            return
        self._last_position_write = now
        try:
            write_position(self._pos_path, self._current_geometry_position())
        except OSError as exc:
            LOG.warning("[ERR] widget position write failed -> %s", exc)

    def _build_ui(self) -> None:
        root = ctk.CTkFrame(self, fg_color=BG_TILE, corner_radius=8)
        root.pack(fill="both", expand=True, padx=2, pady=2)
        self._root_frame = root

        top = ctk.CTkFrame(root, fg_color="transparent")
        top.pack(fill="x", padx=8, pady=(6, 2))

        self._pill = ctk.CTkLabel(
            top,
            text="●",
            width=16,
            text_color=compute_pill_color(ConnectPillState.CONNECTING),
            font=ctk.CTkFont(size=14),
        )
        self._pill.pack(side="left")

        self._brand = ctk.CTkLabel(
            top,
            text="OmniFrame",
            text_color=TEXT_PRIMARY,
            font=ctk.CTkFont(size=13, weight="bold"),
        )
        self._brand.pack(side="left", padx=(4, 0))

        self._state_label = ctk.CTkLabel(
            top,
            text=format_state_label(ConnectPillState.CONNECTING),
            text_color=TEXT_MUTED,
            font=ctk.CTkFont(size=12),
        )
        self._state_label.pack(side="left", padx=(6, 0))

        self._close_btn = ctk.CTkButton(
            top,
            text="×",
            width=24,
            height=24,
            fg_color="transparent",
            hover_color=BTN_SECONDARY,
            text_color=TEXT_MUTED,
            command=self._on_close_request,
        )
        self._close_btn.pack(side="right")

        self._subtitle = ctk.CTkLabel(
            root,
            text=format_health_subtitle(ConnectState()),
            text_color=TEXT_MUTED,
            font=ctk.CTkFont(size=11),
            anchor="w",
        )
        self._subtitle.pack(fill="x", padx=10, pady=(0, 4))

        self._hint = ctk.CTkLabel(
            root,
            text="",
            text_color=TEXT_MUTED,
            font=ctk.CTkFont(size=10),
            anchor="w",
        )
        self._hint.pack(fill="x", padx=10, pady=(0, 2))

        bottom = ctk.CTkFrame(root, fg_color="transparent")
        bottom.pack(fill="x", padx=8, pady=(0, 6))

        self._open_btn = ctk.CTkButton(
            bottom,
            text="Open Web App",
            fg_color=BTN_FIX,
            hover_color="#059669",
            command=self._open_web_app,
        )
        self._open_btn.pack(side="left", fill="x", expand=True, padx=(0, 4))

        self._menu_btn = ctk.CTkButton(
            bottom,
            text="≡",
            width=36,
            fg_color=BTN_SECONDARY,
            hover_color="#475569",
            command=self._toggle_menu,
        )
        self._menu_btn.pack(side="right")

        self._tooltip = ConnectTooltip(self, root)
        self._tooltip.set_text_provider(self._tooltip_text)

    def _tooltip_text(self) -> str:
        from omni_agent.connect.tooltip import build_tooltip_text

        return build_tooltip_text(
            self._supervisor.state,
            self._supervisor.system_label_cache,
            self._supervisor.state.last_health,
        )

    def _interactive_widgets(self):
        return (
            self._open_btn,
            self._menu_btn,
            self._close_btn,
        )

    def _on_drag_start(self, event) -> None:
        if event.widget in self._interactive_widgets():
            return
        w = event.widget
        while w is not None and w not in (self,):
            if w in self._interactive_widgets():
                return
            if getattr(w, "winfo_class", lambda: "")() == "CTkButton":
                return
            w = w.master
        self._drag_x = event.x
        self._drag_y = event.y
        self._dragging = True

    def _on_drag_motion(self, event) -> None:
        if not self._dragging:
            return
        x = self.winfo_x() + event.x - self._drag_x
        y = self.winfo_y() + event.y - self._drag_y
        self.geometry(f"+{x}+{y}")

    def _on_drag_end(self, event) -> None:
        if not self._dragging:
            return
        self._dragging = False
        self._maybe_write_position(force=True)

    def _on_configure(self, event) -> None:
        if event.widget is not self:
            return
        self._ensure_on_screen()

    def _diagnostic_hint(self) -> str:
        return compute_diagnostic_subtitle_hint(
            self._diagnostic_result,
            self._diagnostic_state,
        )

    def _probe_hint(self, state: ConnectState) -> str:
        if state.pill == ConnectPillState.CONNECTING:
            return "Connecting…"
        if state.pill == ConnectPillState.RECONNECTING:
            return "Reconnecting…"
        return ""

    def _apply_state(self, state: ConnectState) -> None:
        if self._install_in_progress:
            self._pill.configure(text_color=PILL_UPDATING_COLOR)
            self._state_label.configure(text=UPDATING_LABEL)
            self._subtitle.configure(text="Downloading the latest version…")
            self._hint.configure(text="")
            return
        target_color = compute_pill_color(state.pill)
        if target_color != self._last_pill_color:
            schedule_pulse(
                self,
                self._pill,
                self._last_pill_color,
                target_color,
                on_complete=lambda: setattr(self, "_last_pill_color", target_color),
            )
        else:
            self._pill.configure(text_color=target_color)
        self._state_label.configure(text=format_state_label(state.pill))
        health_text = format_health_subtitle(
            state,
            self._supervisor.system_label_cache,
        )
        if is_paused_state(state):
            self._subtitle.configure(
                text=f"{PAUSED_SUBTITLE_PREFIX} — Tap Resume to start."
            )
            if self._root_frame is not None:
                self._root_frame.configure(fg_color=PAUSED_BORDER_COLOR)
            self.configure(fg_color=PAUSED_BORDER_COLOR)
            self._hint.configure(text="")
        else:
            self._subtitle.configure(text=health_text)
            if self._root_frame is not None:
                self._root_frame.configure(fg_color=BG_TILE)
            self.configure(fg_color=BG_WINDOW)
            self._hint.configure(
                text=resolve_subtitle_hint(
                    state,
                    diagnostic_hint=self._diagnostic_hint(),
                    probe_hint=self._probe_hint(state),
                )
            )

    def _schedule_update_check(self) -> None:
        if self._shutting_down:
            return
        state = read_update_state()
        now = datetime.now(timezone.utc)
        if not should_check(state, now):
            self.after(UPDATE_POLL_MS, self._schedule_update_check)
            return

        def worker() -> None:
            available, _manifest, entry, result = check_for_update()
            record_check(
                offered_version=entry.version if entry is not None else None,
                state=state,
            )
            if not available or entry is None or not result.ok:
                return
            refreshed = read_update_state()
            if not should_offer_update(refreshed, entry.version):
                return
            self._pending_update_entry = entry
            self.after(0, self._maybe_show_update_modal)

        threading.Thread(target=worker, daemon=True, name="connect-update-check").start()
        self.after(UPDATE_POLL_MS, self._schedule_update_check)

    def _maybe_show_update_modal(self) -> None:
        if self._shutting_down or self._update_modal_shown or self._install_in_progress:
            return
        entry = self._pending_update_entry
        if entry is None:
            return
        self._update_modal_shown = True

        def install() -> None:
            start_install(entry, current_exe_path())

        def remind_later() -> None:
            dismiss_update_for_version(entry.version)

        show_update_available_modal(
            self,
            version=entry.version,
            release_notes=entry.release_notes_md,
            on_install=install,
            on_remind_later=remind_later,
        )

    def _on_update_started(self) -> None:
        def ui() -> None:
            self._install_in_progress = True
            self._apply_state(self._supervisor.state)

        self.after(0, ui)

    def _on_update_error(self, message: str) -> None:
        def ui() -> None:
            self._install_in_progress = False
            self._apply_state(self._supervisor.state)
            show_info_modal(self, title="Update failed", body=message, cta_label="Got it")

        self.after(0, ui)

    def _on_exit_for_replace(self) -> None:
        def ui() -> None:
            self._perform_shutdown()

        self.after(0, ui)

    def _maybe_show_launch_diagnostic(self) -> None:
        if self._shutting_down:
            return
        if not should_show_diagnostic_modal(
            self._diagnostic_result,
            self._diagnostic_state,
        ):
            return
        summary = self._diagnostic_result.friendly_summary
        if not summary:
            return
        mark_diagnostic_modal_shown(self._diagnostic_result)
        show_info_modal(
            self,
            title="Heads up",
            body=summary,
            cta_label="Got it",
        )

    def _drain_queues(self) -> None:
        if self._shutting_down:
            return
        while True:
            try:
                state = self._supervisor.state_queue.get_nowait()
            except Exception:
                break
            self._supervisor.handle_probe_state(state)
            self._apply_state(self._supervisor.state)
        while True:
            try:
                pill = self._supervisor.pill_intent_queue.get_nowait()
            except Exception:
                break
            _ = pill
            self._apply_state(self._supervisor.state)
        if self._supervisor.state.circuit_breaker_tripped and not self._crash_modal_shown:
            self._crash_modal_shown = True
            self.after(0, lambda: show_friendly_error(self, "crash_loop"))
        self.after(POLL_MS, self._drain_queues)

    def _open_web_app(self) -> None:
        url = self._web_url
        LOG.info("[OK] Open Web App -> %s", url)
        webbrowser.open(url, new=0)

    def _toggle_menu(self) -> None:
        if self._menu_open:
            self._close_menu()
            return
        self._menu_open = True
        self._menu_frame = ctk.CTkFrame(self, fg_color=BG_TILE, corner_radius=6)
        self._menu_frame.place(relx=1.0, rely=1.0, anchor="se", x=-8, y=-36)

        pause_label = "Resume" if self._supervisor.is_paused() else "Pause"
        for label, cmd in (
            (pause_label, self._menu_pause_resume),
            ("Restart", self._menu_restart),
            ("Reset", self._menu_reset),
            ("Open Logs", self._menu_open_logs),
            ("Quit", self._menu_quit),
        ):
            btn = ctk.CTkButton(
                self._menu_frame,
                text=label,
                width=100,
                height=28,
                fg_color=BTN_SECONDARY,
                anchor="w",
                command=cmd,
            )
            btn.pack(padx=4, pady=2)

    def _close_menu(self) -> None:
        self._menu_open = False
        if self._menu_frame is not None:
            self._menu_frame.destroy()
            self._menu_frame = None

    def _menu_pause_resume(self) -> None:
        self._close_menu()
        if self._supervisor.is_paused():
            self._supervisor.resume()
        else:
            self._supervisor.pause()
        self._apply_state(self._supervisor.state)

    def _menu_restart(self) -> None:
        self._close_menu()
        self._supervisor.restart()
        self._apply_state(self._supervisor.state)

    def _menu_reset(self) -> None:
        self._close_menu()
        self._confirm_reset()

    def _confirm_reset(self) -> None:
        dialog = ctk.CTkToplevel(self)
        dialog.title("Reset OmniFrame")
        dialog.geometry("360x170")
        dialog.attributes("-topmost", True)
        dialog.grab_set()
        ctk.CTkLabel(
            dialog,
            text=(
                "Reset OmniFrame? This signs you out and clears local settings. "
                "(You'll need to re-link your account.)"
            ),
            wraplength=320,
        ).pack(padx=16, pady=(16, 8))

        btn_row = ctk.CTkFrame(dialog, fg_color="transparent")
        btn_row.pack(pady=8)

        def yes() -> None:
            dialog.destroy()
            self._perform_reset()

        ctk.CTkButton(btn_row, text="Reset", fg_color=BTN_FIX, command=yes).pack(
            side="left", padx=8
        )
        ctk.CTkButton(
            btn_row, text="Cancel", fg_color=BTN_SECONDARY, command=dialog.destroy
        ).pack(side="left", padx=8)

    def _perform_reset(self) -> None:
        orchestrate_reset(self._supervisor)
        self._apply_state(self._supervisor.state)
        show_info_modal(
            self,
            title="Reset complete",
            body="Click 'Open Web App' to sign in again.",
            cta_label="Got it",
        )

    def _menu_open_logs(self) -> None:
        self._close_menu()
        try:
            open_log_dir()
        except Exception as exc:
            LOG.warning("[ERR] open logs failed -> %s", exc)
            show_friendly_error(self, "unknown")

    def _menu_quit(self) -> None:
        self._close_menu()
        self._confirm_quit()

    def _confirm_quit(self) -> None:
        dialog = ctk.CTkToplevel(self)
        dialog.title("Quit")
        dialog.geometry("320x140")
        dialog.attributes("-topmost", True)
        dialog.grab_set()
        ctk.CTkLabel(
            dialog,
            text="Quit OmniFrame Connect?\nAny in-flight SAP work will be lost.",
            wraplength=280,
        ).pack(padx=16, pady=(16, 8))

        btn_row = ctk.CTkFrame(dialog, fg_color="transparent")
        btn_row.pack(pady=8)

        def yes() -> None:
            dialog.destroy()
            self._perform_shutdown()

        ctk.CTkButton(btn_row, text="Yes", fg_color=BTN_FIX, command=yes).pack(
            side="left", padx=8
        )
        ctk.CTkButton(
            btn_row, text="No", fg_color=BTN_SECONDARY, command=dialog.destroy
        ).pack(side="left", padx=8)

    def _on_close_request(self) -> None:
        self._confirm_quit()

    def _on_sigterm(self, signum, frame) -> None:
        self._perform_shutdown()

    def _perform_shutdown(self) -> None:
        if self._shutting_down:
            return
        self._shutting_down = True
        self._maybe_write_position(force=True)
        self._close_menu()
        if self._tooltip is not None:
            self._tooltip.destroy()
        self._supervisor.shutdown_connect()
        self.destroy()

    def run(self) -> None:
        self.mainloop()


def main() -> None:
    configure_connect_logging()
    LOG.info("[OK] OmniFrame Connect starting")
    app = ConnectWidget()
    app.run()


if __name__ == "__main__":
    main()

# Created and developed by Jai Singh
