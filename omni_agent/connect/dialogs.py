# Created and developed by Jai Singh
"""Friendly CTk modals and pure copy helpers for OmniFrame Connect."""

from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Optional

from omni_agent.connect.theme import BTN_FIX, BTN_SECONDARY

LOG = logging.getLogger("omniframe.connect.dialogs")

try:
    import customtkinter as ctk
except ImportError:  # pragma: no cover - tests use pure helpers only
    ctk = None  # type: ignore[assignment]

FRIENDLY_COPY: dict[str, dict[str, str]] = {
    "worker_spawn_failed": {
        "title": "Couldn't start OmniFrame",
        "body": (
            "Something stopped OmniFrame from starting. Try clicking Restart, "
            "or Reset if the problem keeps coming back."
        ),
        "cta_label": "Restart",
    },
    "crash_loop": {
        "title": "OmniFrame keeps stopping",
        "body": (
            "It's been crashing on startup. Tap Reset to fix it — that'll "
            "re-link your account."
        ),
        "cta_label": "Reset",
    },
    "sap_not_running": {
        "title": "SAP isn't open yet",
        "body": (
            "Please open SAP and sign in. OmniFrame will connect automatically "
            "when it's ready."
        ),
        "cta_label": "Got it",
    },
    "web_unreachable": {
        "title": "Can't reach OmniFrame",
        "body": (
            "It looks like the network or VPN is unavailable. Check your "
            "connection and try again in a moment."
        ),
        "cta_label": "Try again",
    },
    "port_blocked": {
        "title": "Another OmniFrame is running",
        "body": (
            "Looks like an older OmniFrame is still running. Close it first, "
            "or restart your computer if that doesn't help."
        ),
        "cta_label": "Got it",
    },
    "update_available": {
        "title": "Update ready",
        "body": (
            "A new version of OmniFrame is ready. Click Install to get the latest."
        ),
        "cta_label": "Install",
    },
    "sap_session_lost": {
        "title": "SAP was closed",
        "body": (
            "Your SAP session ended. Open SAP again and OmniFrame will reconnect."
        ),
        "cta_label": "Got it",
    },
    "service_key_invalid": {
        "title": "Sign-in needs refreshing",
        "body": (
            "Your sign-in expired. Tap Reset to refresh and sign in again."
        ),
        "cta_label": "Reset",
    },
    "unknown": {
        "title": "Something went wrong",
        "body": (
            "OmniFrame hit an unexpected problem. Try Restart, or Reset if "
            "it keeps happening."
        ),
        "cta_label": "Got it",
    },
}


def build_friendly_copy(error_kind: str, **context: Any) -> dict[str, str]:
    """Pure helper returning modal copy for an ``error_kind``."""
    _ = context
    return dict(FRIENDLY_COPY.get(error_kind, FRIENDLY_COPY["unknown"]))


def resolve_log_dir() -> Path:
    """Return ``%USERPROFILE%\\.omniframe\\`` (or POSIX home equivalent)."""
    profile = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    return Path(profile) / ".omniframe"


def open_log_dir(
    *,
    open_fn: Optional[Callable[[Path], None]] = None,
) -> Path:
    """Open the Connect log directory in the system file manager."""
    log_dir = resolve_log_dir()
    log_dir.mkdir(parents=True, exist_ok=True)
    if open_fn is not None:
        open_fn(log_dir)
        return log_dir
    if sys.platform == "win32":
        os.startfile(log_dir)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.run(["open", str(log_dir)], check=False)
    else:
        subprocess.run(["xdg-open", str(log_dir)], check=False)
    return log_dir


def compute_reset_steps() -> list[str]:
    """Ordered reset orchestration steps for tests and GUI."""
    return [
        "supervisor.pause",
        "cli.run_reset",
        "supervisor.restart",
        "dialogs.show_info_modal",
    ]


def _ensure_ctk() -> Any:
    if ctk is None:
        raise RuntimeError("customtkinter is required for Connect dialogs")
    return ctk


def show_info_modal(
    parent: Any,
    *,
    title: str,
    body: str,
    cta_label: str = "Got it",
    on_cta: Optional[Callable[[], None]] = None,
) -> None:
    """Dismissible info modal with a single CTA."""
    tk = _ensure_ctk()
    dialog = tk.CTkToplevel(parent)
    dialog.title(title)
    dialog.geometry("360x160")
    dialog.attributes("-topmost", True)
    dialog.grab_set()
    tk.CTkLabel(dialog, text=body, wraplength=320).pack(padx=16, pady=(16, 8))

    def dismiss() -> None:
        dialog.destroy()
        if on_cta:
            on_cta()

    tk.CTkButton(
        dialog,
        text=cta_label,
        fg_color=BTN_FIX,
        command=dismiss,
    ).pack(pady=8)


def show_friendly_error(
    parent: Any,
    error_kind: str,
    *,
    on_cta: Optional[Callable[[], None]] = None,
    **context: Any,
) -> None:
    """Show a friendly error modal for ``error_kind``."""
    copy = build_friendly_copy(error_kind, **context)
    tk = _ensure_ctk()
    dialog = tk.CTkToplevel(parent)
    dialog.title(copy["title"])
    dialog.geometry("380x170")
    dialog.attributes("-topmost", True)
    dialog.grab_set()
    tk.CTkLabel(dialog, text=copy["body"], wraplength=340).pack(
        padx=16, pady=(16, 8)
    )

    def act() -> None:
        dialog.destroy()
        if on_cta:
            on_cta()

    tk.CTkButton(
        dialog,
        text=copy["cta_label"],
        fg_color=BTN_FIX if copy["cta_label"] != "Got it" else BTN_SECONDARY,
        command=act,
    ).pack(pady=8)


def show_update_available_modal(
    parent: Any,
    *,
    version: str,
    release_notes: str = "",
    on_install: Callable[[], None],
    on_remind_later: Callable[[], None],
) -> None:
    """Update-available modal with Install, Remind me later, and dismiss-on-close."""
    tk = _ensure_ctk()
    body = FRIENDLY_COPY["update_available"]["body"]
    if release_notes.strip():
        body = f"{body}\n\n{release_notes.strip()}"
    dialog = tk.CTkToplevel(parent)
    dialog.title(FRIENDLY_COPY["update_available"]["title"])
    dialog.geometry("400x210")
    dialog.attributes("-topmost", True)
    dialog.grab_set()
    tk.CTkLabel(dialog, text=body, wraplength=360, justify="left").pack(
        padx=16, pady=(16, 8)
    )
    tk.CTkLabel(
        dialog,
        text=f"Version {version}",
        font=tk.CTkFont(size=11),
    ).pack(padx=16)

    btn_row = tk.CTkFrame(dialog, fg_color="transparent")
    btn_row.pack(pady=10)

    def install() -> None:
        dialog.destroy()
        on_install()

    def remind() -> None:
        dialog.destroy()
        on_remind_later()

    dialog.protocol("WM_DELETE_WINDOW", dialog.destroy)

    tk.CTkButton(
        btn_row,
        text="Install",
        fg_color=BTN_FIX,
        command=install,
    ).pack(side="left", padx=6)
    tk.CTkButton(
        btn_row,
        text="Remind me later",
        fg_color=BTN_SECONDARY,
        command=remind,
    ).pack(side="left", padx=6)

# Created and developed by Jai Singh
