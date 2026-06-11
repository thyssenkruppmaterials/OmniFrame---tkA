# Created and developed by Jai Singh
"""Hover tooltip overlay + pure copy builder."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any, Optional

import customtkinter as ctk

from omni_agent.connect.state import ConnectState, format_state_label

if TYPE_CHECKING:
    from omni_agent.connect.system_label import SystemLabelCache

HOVER_DELAY_MS = 500
AUTO_HIDE_MS = 8000
OFFSET_Y_PX = 8


def build_tooltip_text(
    state: ConnectState,
    system_label_cache: Optional["SystemLabelCache"],
    last_health: Optional[dict[str, Any]],
) -> str:
    """Plain-English hover text for the Connect widget."""
    connection_status = format_state_label(state.pill)
    user = state.user_label or "—"
    if system_label_cache is not None:
        parts = system_label_cache.as_subtitle_parts()
        if parts[0] != "—":
            user = parts[0]
        system = parts[1] if parts[1] != "—" else state.sap_system_label
    else:
        system = state.sap_system_label or "—"
    if last_health is None and state.last_health is not None:
        last_health = state.last_health
    if state.last_health_at is not None:
        seconds_ago = max(0, int(time.time() - state.last_health_at))
    else:
        seconds_ago = "—"
    restarts = len(state.restarts_in_window)
    return (
        f"OmniFrame {connection_status}\n"
        f"User: {user}\n"
        f"System: {system}\n"
        f"Last check: {seconds_ago}s ago\n"
        f"Restarts: {restarts}"
    )


class ConnectTooltip:
    """CTk-aware hover tooltip mounted on the widget body."""

    def __init__(self, master: ctk.CTk, body_widget: ctk.CTkBaseClass) -> None:
        self._master = master
        self._body = body_widget
        self._tip: Optional[ctk.CTkToplevel] = None
        self._label: Optional[ctk.CTkLabel] = None
        self._hover_after: Optional[str] = None
        self._hide_after: Optional[str] = None
        self._text_provider: Optional[callable] = None

        body_widget.bind("<Enter>", self._on_enter, add="+")
        body_widget.bind("<Leave>", self._on_leave, add="+")
        body_widget.bind("<Motion>", self._on_motion, add="+")

    def set_text_provider(self, provider: callable) -> None:
        self._text_provider = provider

    def _cancel_timers(self) -> None:
        for timer_id in (self._hover_after, self._hide_after):
            if timer_id is not None:
                self._master.after_cancel(timer_id)
        self._hover_after = None
        self._hide_after = None

    def _on_enter(self, _event) -> None:
        self._cancel_timers()
        self._hover_after = self._master.after(HOVER_DELAY_MS, self._show)

    def _on_leave(self, _event) -> None:
        self._cancel_timers()
        self._hide()

    def _on_motion(self, event) -> None:
        if self._tip is not None and self._tip.winfo_exists():
            self._position_at(event.x_root, event.y_root)

    def _show(self) -> None:
        if self._text_provider is None:
            return
        text = self._text_provider()
        if not text:
            return
        if self._tip is None or not self._tip.winfo_exists():
            self._tip = ctk.CTkToplevel(self._master)
            self._tip.overrideredirect(True)
            self._tip.attributes("-topmost", True)
            self._label = ctk.CTkLabel(
                self._tip,
                text=text,
                justify="left",
                anchor="w",
                padx=10,
                pady=6,
            )
            self._label.pack()
        else:
            self._label.configure(text=text)
        self._tip.update_idletasks()
        x = self._master.winfo_pointerx()
        y = self._master.winfo_pointery() + OFFSET_Y_PX
        self._position_at(x, y)
        self._tip.deiconify()
        self._hide_after = self._master.after(AUTO_HIDE_MS, self._hide)

    def _position_at(self, x_root: int, y_root: int) -> None:
        if self._tip is None:
            return
        self._tip.geometry(f"+{x_root}+{y_root + OFFSET_Y_PX}")

    def _hide(self) -> None:
        self._cancel_timers()
        if self._tip is not None and self._tip.winfo_exists():
            self._tip.withdraw()

    def destroy(self) -> None:
        self._cancel_timers()
        if self._tip is not None and self._tip.winfo_exists():
            self._tip.destroy()
        self._tip = None

# Created and developed by Jai Singh
