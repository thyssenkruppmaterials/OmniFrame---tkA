# Created and developed by Jai Singh
"""Single worker tile — CTkFrame with status pill and Phase D actions."""

from __future__ import annotations

import time
from typing import Callable, Optional

import customtkinter as ctk

from omni_agent.master.fix_engine import HealthSnapshot, snapshot_from_runtime
from omni_agent.master.layout import compute_tile_grid
from omni_agent.master.state import (
    TilePillState,
    WorkerRuntimeState,
    compute_button_state,
)
from omni_agent.master import theme

__all__ = [
    "WorkerTile",
    "compute_button_state",
    "compute_tile_grid",
    "pill_colors",
    "pill_label",
]

_BUTTON_LAYOUT: tuple[tuple[str, str, str], ...] = (
    ("Fix", "fix", theme.BTN_FIX),
    ("Start", "start", theme.BTN_SECONDARY),
    ("Stop", "stop", theme.BTN_SECONDARY),
    ("Restart", "restart", theme.BTN_SECONDARY),
    ("Reassign", "reassign", theme.BTN_SECONDARY),
    ("Console", "console", theme.BTN_SECONDARY),
)


def pill_colors(state: TilePillState) -> tuple[str, str]:
    mapping = {
        TilePillState.CONNECTED: (theme.PILL_CONNECTED, theme.PILL_TEXT_LIGHT),
        TilePillState.CONNECTING: (theme.PILL_CONNECTING, theme.PILL_TEXT_DARK),
        TilePillState.DEGRADED: (theme.PILL_DEGRADED, theme.PILL_TEXT_LIGHT),
        TilePillState.DISCONNECTED: (
            theme.PILL_DISCONNECTED,
            theme.PILL_TEXT_LIGHT,
        ),
        TilePillState.STOPPED: (theme.PILL_STOPPED, theme.PILL_TEXT_LIGHT),
    }
    return mapping.get(state, (theme.PILL_STOPPED, theme.PILL_TEXT_LIGHT))


def pill_label(state: TilePillState) -> str:
    return {
        TilePillState.CONNECTED: "Connected",
        TilePillState.CONNECTING: "Connecting",
        TilePillState.DEGRADED: "Degraded",
        TilePillState.DISCONNECTED: "Disconnected",
        TilePillState.STOPPED: "Stopped",
    }.get(state, "Stopped")


def _format_compact_session(snap: WorkerRuntimeState) -> str:
    return f"conn {snap.sap_conn_idx} / sess {snap.sap_session_index}"


def _format_heartbeat(snap: WorkerRuntimeState) -> str:
    if snap.heartbeat_age_s is not None:
        return f"{int(max(0.0, snap.heartbeat_age_s))}s ago"
    if snap.last_success_at:
        age = max(0.0, time.time() - snap.last_success_at)
        return f"{int(age)}s ago"
    return "--"


def _format_last_error(snap: WorkerRuntimeState) -> Optional[str]:
    err = (snap.last_error or "").strip()
    if not err or err == "--":
        return None
    return err


class WorkerTile(ctk.CTkFrame):
    """One worker card in the 3-column master grid."""

    def __init__(
        self,
        master: ctk.CTk,
        runtime: WorkerRuntimeState,
        *,
        on_action: Callable[[str, str], None],
        row: int,
        col: int,
        **kwargs,
    ) -> None:
        super().__init__(
            master,
            fg_color=theme.BG_TILE,
            border_color=theme.BORDER_TILE,
            border_width=1,
            corner_radius=8,
            height=theme.TILE_MIN_HEIGHT,
            **kwargs,
        )
        self._runtime = runtime
        self._worker_id = runtime.worker_id
        self._on_action = on_action
        self.last_health_snapshot: Optional[HealthSnapshot] = None
        self.grid(row=row, column=col, padx=8, pady=8, sticky="nsew")
        self.grid_propagate(False)
        self.grid_columnconfigure(0, weight=1)

        info = ctk.CTkFrame(self, fg_color="transparent")
        info.grid(row=0, column=0, sticky="ew", padx=10, pady=(10, 4))
        info.grid_columnconfigure(1, weight=1)

        self._label = ctk.CTkLabel(
            info,
            text=runtime.label,
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color=theme.TEXT_PRIMARY,
            anchor="w",
        )
        self._label.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 4))

        self._pill = ctk.CTkLabel(
            info,
            text=pill_label(TilePillState.STOPPED),
            fg_color=theme.PILL_STOPPED,
            text_color=theme.PILL_TEXT_LIGHT,
            corner_radius=12,
            height=24,
            font=ctk.CTkFont(size=12, weight="bold"),
        )
        self._pill.grid(row=1, column=0, columnspan=2, sticky="w", pady=2)

        self._adopted_badge = ctk.CTkLabel(
            info,
            text="ADOPTED",
            fg_color="#334155",
            text_color="#94a3b8",
            corner_radius=8,
            height=18,
            font=ctk.CTkFont(size=10, weight="bold"),
        )
        self._adopted_badge.grid(row=2, column=0, columnspan=2, sticky="w", pady=(0, 4))
        self._adopted_badge.grid_remove()

        self._info_labels: dict[str, ctk.CTkLabel] = {}
        info_rows = [
            ("System", "PRD"),
            ("Session", _format_compact_session(runtime)),
            ("Heartbeat", _format_heartbeat(runtime)),
            ("Job", runtime.in_flight_job or "idle"),
        ]
        for i, (title, value) in enumerate(info_rows):
            row_idx = 3 + i
            ctk.CTkLabel(
                info,
                text=f"{title}:",
                font=ctk.CTkFont(size=11, weight="bold"),
                text_color=theme.TEXT_MUTED,
                anchor="w",
                width=72,
            ).grid(row=row_idx, column=0, sticky="w")
            val_lbl = ctk.CTkLabel(
                info,
                text=value,
                font=ctk.CTkFont(size=11),
                text_color=theme.TEXT_MUTED,
                anchor="w",
            )
            val_lbl.grid(row=row_idx, column=1, sticky="ew")
            self._info_labels[title.lower()] = val_lbl

        self._err_title = ctk.CTkLabel(
            info,
            text="Last error:",
            font=ctk.CTkFont(size=11, weight="bold"),
            text_color=theme.PILL_DISCONNECTED,
            anchor="w",
            width=72,
        )
        self._err = ctk.CTkLabel(
            info,
            text="",
            font=ctk.CTkFont(size=11),
            text_color=theme.PILL_DISCONNECTED,
            anchor="w",
            wraplength=220,
        )
        self._err_row = 7
        self._err_title.grid(row=self._err_row, column=0, sticky="w")
        self._err.grid(row=self._err_row, column=1, sticky="ew", pady=(0, 4))
        self._err_title.grid_remove()
        self._err.grid_remove()

        btn_zone = ctk.CTkFrame(self, fg_color="transparent")
        btn_zone.grid(row=1, column=0, sticky="ew", padx=8, pady=(4, 10))
        for col in range(3):
            btn_zone.grid_columnconfigure(col, weight=1)

        self._buttons: dict[str, ctk.CTkButton] = {}
        for idx, (label, action, color) in enumerate(_BUTTON_LAYOUT):
            btn_row = idx // 3
            btn_col = idx % 3
            b = ctk.CTkButton(
                btn_zone,
                text=label,
                height=32,
                fg_color=color,
                command=lambda a=action: self._on_action(a, self._worker_id),
            )
            b.grid(row=btn_row, column=btn_col, padx=2, pady=2, sticky="ew")
            self._buttons[action] = b

    def apply_state(self, snap: WorkerRuntimeState) -> None:
        self._runtime = snap
        self.last_health_snapshot = snapshot_from_runtime(snap, now=time.time())
        bg, fg = pill_colors(snap.pill)
        self._pill.configure(
            text=pill_label(snap.pill),
            fg_color=bg,
            text_color=fg,
        )
        if snap.is_adopted:
            self._adopted_badge.grid()
        else:
            self._adopted_badge.grid_remove()

        self._info_labels["session"].configure(text=_format_compact_session(snap))
        self._info_labels["heartbeat"].configure(text=_format_heartbeat(snap))
        self._info_labels["job"].configure(text=snap.in_flight_job or "idle")

        err_text = _format_last_error(snap)
        if err_text:
            self._err_title.grid()
            self._err.grid()
            self._err.configure(text=err_text)
        else:
            self._err_title.grid_remove()
            self._err.grid_remove()

        states = compute_button_state(snap)
        for action, btn in self._buttons.items():
            btn.configure(state="normal" if states.get(action) else "disabled")

# Created and developed by Jai Singh
