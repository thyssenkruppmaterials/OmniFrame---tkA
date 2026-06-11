# Created and developed by Jai Singh
"""Phase F3 — tile right-click context menu (pure logic + Tk mount).

Pure helpers are testable without a Tk root. ``mount_context_menu`` wires
``WorkerTile`` right-clicks at runtime (Phase F4 integration).
"""

from __future__ import annotations

import logging
import sys
from dataclasses import replace
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Mapping, Optional

from omni_agent.master.config import (
    MasterConfig,
    load_config,
    master_config_path,
    validate_config,
    write_master_config,
)

LOG = logging.getLogger("omniframe.master.tile_context_menu")

MAX_LABEL_LEN = 30


class ContextMenuCommand(str, Enum):
    RENAME_LABEL = "rename_label"
    TOGGLE_AUTO_START = "toggle_auto_start"
    START = "start"
    REPAIR_SESSION = "repair_session"
    RESTART = "restart"
    STOP = "stop"


_COMMAND_LABELS: dict[ContextMenuCommand, str] = {
    ContextMenuCommand.RENAME_LABEL: "Rename label…",
    ContextMenuCommand.TOGGLE_AUTO_START: "Toggle auto-start",
    ContextMenuCommand.START: "Start",
    ContextMenuCommand.REPAIR_SESSION: "Reassign Session",
    ContextMenuCommand.RESTART: "Restart",
    ContextMenuCommand.STOP: "Stop",
}


def commands_for_state(
    *,
    is_adopted: bool = False,
    process_alive: bool = False,
    auto_start: bool = True,
    sap_attached: bool = False,
    identity_ok: bool = True,
) -> dict[ContextMenuCommand, bool]:
    """Return per-command enabled flags for the current worker snapshot."""

    _ = is_adopted  # adopted workers use the same menu shape (F4 badge only)
    alive = bool(process_alive or is_adopted)
    stopped = not alive
    return {
        ContextMenuCommand.RENAME_LABEL: True,
        ContextMenuCommand.TOGGLE_AUTO_START: True,
        ContextMenuCommand.START: stopped,
        ContextMenuCommand.REPAIR_SESSION: alive and not sap_attached and identity_ok,
        ContextMenuCommand.RESTART: alive,
        ContextMenuCommand.STOP: alive,
    }


def toggle_auto_start_label(current: bool) -> str:
    return "Disable auto-start" if current else "Enable auto-start"


def normalize_label(raw: str) -> str:
    return raw.strip()[:MAX_LABEL_LEN]


def apply_rename_label(
    cfg: MasterConfig,
    worker_id: str,
    new_label: str,
    *,
    path: Path | None = None,
) -> MasterConfig:
    """Persist a trimmed worker label (hot-apply field)."""

    label = normalize_label(new_label)
    if not label:
        raise ValueError("Label cannot be empty")
    workers = []
    found = False
    for w in cfg.workers:
        if w.id == worker_id:
            workers.append(replace(w, label=label))
            found = True
        else:
            workers.append(w)
    if not found:
        raise ValueError(f"Unknown worker id: {worker_id}")
    updated = MasterConfig(
        master=cfg.master,
        workers=workers,
        source_path=cfg.source_path,
        using_builtin_defaults=cfg.using_builtin_defaults,
    )
    validate_config(updated)
    write_master_config(updated, path)
    return updated


def apply_toggle_auto_start(
    cfg: MasterConfig,
    worker_id: str,
    *,
    path: Path | None = None,
) -> tuple[MasterConfig, bool]:
    """Flip ``auto_start`` for one worker and persist."""

    new_value: bool | None = None
    workers = []
    found = False
    for w in cfg.workers:
        if w.id == worker_id:
            new_value = not w.auto_start
            workers.append(replace(w, auto_start=new_value))
            found = True
        else:
            workers.append(w)
    if not found or new_value is None:
        raise ValueError(f"Unknown worker id: {worker_id}")
    updated = MasterConfig(
        master=cfg.master,
        workers=workers,
        source_path=cfg.source_path,
        using_builtin_defaults=cfg.using_builtin_defaults,
    )
    validate_config(updated)
    write_master_config(updated, path)
    return updated, new_value


def load_persisted_config(path: Path | None = None) -> MasterConfig:
    """Load config from disk (defaults when file absent)."""

    return load_config(path or master_config_path())


def persist_hot_config(cfg: MasterConfig, path: Path | None = None) -> Path:
    """Write hot-apply config changes (label, auto_start, master globals)."""

    validate_config(cfg)
    return write_master_config(cfg, path)


# ---------------------------------------------------------------------------
# Tk mount (runtime)
# ---------------------------------------------------------------------------

try:
    import tkinter as tk
    from tkinter import simpledialog

    import customtkinter as ctk

    from omni_agent.master import theme

    class _ContextMenuCallbacks:
        """Typed bag of optional command handlers."""

        def __init__(
            self,
            *,
            on_rename_label: Optional[Callable[[str], None]] = None,
            on_toggle_auto_start: Optional[Callable[[], None]] = None,
            on_start: Optional[Callable[[], None]] = None,
            on_repair_session: Optional[Callable[[], None]] = None,
            on_restart: Optional[Callable[[], None]] = None,
            on_stop: Optional[Callable[[], None]] = None,
            get_auto_start: Optional[Callable[[], bool]] = None,
            get_state: Optional[Callable[[], Mapping[str, Any]]] = None,
            persist_rename: Optional[Callable[[str], None]] = None,
            persist_toggle_auto_start: Optional[Callable[[], None]] = None,
        ) -> None:
            self.on_rename_label = on_rename_label
            self.on_toggle_auto_start = on_toggle_auto_start
            self.on_start = on_start
            self.on_repair_session = on_repair_session
            self.on_restart = on_restart
            self.on_stop = on_stop
            self.get_auto_start = get_auto_start or (lambda: True)
            self.get_state = get_state or (lambda: {})
            self.persist_rename = persist_rename
            self.persist_toggle_auto_start = persist_toggle_auto_start

    def mount_context_menu(
        root: ctk.CTk,
        tile: ctk.CTkFrame,
        callbacks: Mapping[str, Any] | _ContextMenuCallbacks,
    ) -> None:
        """Bind right-click on ``tile`` to a dynamic context menu."""

        if isinstance(callbacks, Mapping):
            cb = _ContextMenuCallbacks(**callbacks)
        else:
            cb = callbacks

        menu = tk.Menu(root, tearoff=0)

        def _show_menu(event: tk.Event) -> None:
            menu.delete(0, tk.END)
            state = dict(cb.get_state())
            enabled = commands_for_state(
                is_adopted=bool(state.get("is_adopted")),
                process_alive=bool(state.get("process_alive")),
                auto_start=bool(state.get("auto_start", cb.get_auto_start())),
                sap_attached=bool(state.get("sap_attached")),
                identity_ok=bool(state.get("identity_ok", True)),
            )
            auto_start = bool(state.get("auto_start", cb.get_auto_start()))

            entries: list[tuple[str, ContextMenuCommand, Callable[[], None] | None]] = [
                (_COMMAND_LABELS[ContextMenuCommand.RENAME_LABEL], ContextMenuCommand.RENAME_LABEL, _rename),
                (
                    toggle_auto_start_label(auto_start),
                    ContextMenuCommand.TOGGLE_AUTO_START,
                    _toggle_auto_start,
                ),
                (_COMMAND_LABELS[ContextMenuCommand.START], ContextMenuCommand.START, cb.on_start),
                (
                    _COMMAND_LABELS[ContextMenuCommand.REPAIR_SESSION],
                    ContextMenuCommand.REPAIR_SESSION,
                    cb.on_repair_session,
                ),
                (_COMMAND_LABELS[ContextMenuCommand.RESTART], ContextMenuCommand.RESTART, cb.on_restart),
                (_COMMAND_LABELS[ContextMenuCommand.STOP], ContextMenuCommand.STOP, cb.on_stop),
            ]
            for label, cmd, handler in entries:
                menu.add_command(
                    label=label,
                    state=tk.NORMAL if enabled[cmd] else tk.DISABLED,
                    command=(lambda h=handler: h()) if handler else None,
                )
            try:
                menu.tk_popup(event.x_root, event.y_root)
            finally:
                menu.grab_release()

        def _rename() -> None:
            state = dict(cb.get_state())
            current = str(state.get("label", ""))
            new_label = simpledialog.askstring(
                "Rename worker label",
                "Label (max 30 chars):",
                initialvalue=current,
                parent=root,
            )
            if new_label is None:
                return
            trimmed = normalize_label(new_label)
            if not trimmed:
                return
            if cb.persist_rename:
                cb.persist_rename(trimmed)
            if cb.on_rename_label:
                cb.on_rename_label(trimmed)

        def _toggle_auto_start() -> None:
            if cb.persist_toggle_auto_start:
                cb.persist_toggle_auto_start()
            if cb.on_toggle_auto_start:
                cb.on_toggle_auto_start()

        tile.bind("<Button-3>", _show_menu)
        if sys.platform == "darwin":
            tile.bind("<Button-2>", _show_menu)

except ImportError:  # pragma: no cover
    def mount_context_menu(*_args: Any, **_kwargs: Any) -> None:  # type: ignore[misc]
        LOG.warning("customtkinter unavailable — context menu not mounted")

# Created and developed by Jai Singh
