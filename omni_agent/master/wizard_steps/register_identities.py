# Created and developed by Jai Singh
"""Wizard step 4 — Register per-worker service keys."""

from __future__ import annotations

import webbrowser
from typing import Any, Callable

import customtkinter as ctk

from omni_agent.master import theme
from omni_agent.master.config import write_service_key
from omni_agent.master.register_identities_logic import (
    gate_next,
    is_valid_service_key,
    key_path_display,
    reregister_url_for,
    registration_status,
    worker_key_registered,
)
from omni_agent.master.wizard_state import WizardState


class RegisterIdentitiesStep(ctk.CTkFrame):
    def __init__(
        self,
        master: Any,
        state: WizardState,
        *,
        on_saved: Callable[[str], None] | None = None,
    ) -> None:
        super().__init__(master, fg_color="transparent")
        self._state = state
        self._on_saved = on_saved
        self._worker_rows: list[dict[str, Any]] = []
        self._skip_var = ctk.BooleanVar(value=state.require_service_keys is False)

        self._skip_cb = ctk.CTkCheckBox(
            self,
            text="Skip registration for now (use user session fallback)",
            variable=self._skip_var,
            command=self._on_skip_toggle,
        )
        self._skip_cb.pack(anchor="w", pady=(0, 4))

        self._skip_hint = ctk.CTkLabel(
            self,
            text=(
                "Workers will fall back to your Supabase session. "
                "You can register keys later in Settings → Master globals."
            ),
            text_color=theme.TEXT_MUTED,
            wraplength=640,
            justify="left",
        )

        ctk.CTkLabel(
            self,
            text="Register each worker in the web admin, then paste the omni_sk_* key here.",
            text_color=theme.TEXT_MUTED,
            wraplength=640,
        ).pack(anchor="w", pady=(0, 8))

        self._scroll = ctk.CTkScrollableFrame(self, fg_color=theme.BG_TILE, height=400)
        self._scroll.pack(fill="both", expand=True)

    def _on_skip_toggle(self) -> None:
        self._update_skip_hint()
        self._rebuild()

    def _update_skip_hint(self) -> None:
        if self._skip_var.get():
            self._skip_hint.pack(anchor="w", pady=(0, 8), before=self._scroll)
        else:
            self._skip_hint.pack_forget()

    def _worker_ids(self) -> list[str]:
        if self._state.pairings:
            return [str(p.get("worker_id", "")) for p in self._state.pairings]
        return [f"{self._state.host_prefix}-W{i}" for i in range(1, self._state.worker_count + 1)]

    def _rebuild(self) -> None:
        for child in self._scroll.winfo_children():
            child.destroy()
        self._worker_rows.clear()
        ids = [w for w in self._worker_ids() if w]
        status = registration_status(ids)

        for wid in ids:
            row = ctk.CTkFrame(self._scroll, fg_color="transparent")
            row.pack(fill="x", pady=6, padx=4)
            registered = status.get(wid, False)
            status_text = "Already registered ✓" if registered else "Not registered"
            color = theme.PILL_CONNECTED if registered else theme.TEXT_MUTED
            ctk.CTkLabel(row, text=wid, width=160, anchor="w").grid(row=0, column=0, sticky="w")
            status_lbl = ctk.CTkLabel(row, text=status_text, text_color=color, width=140)
            status_lbl.grid(row=0, column=1, padx=8)

            if not registered:
                ctk.CTkButton(
                    row,
                    text="Open Browser",
                    width=110,
                    command=lambda w=wid: webbrowser.open(reregister_url_for(w)),
                ).grid(row=0, column=2, padx=4)
                paste = ctk.CTkTextbox(row, height=48, width=200)
                paste.grid(row=1, column=0, columnspan=2, pady=4, sticky="ew")
                err_lbl = ctk.CTkLabel(row, text="", text_color=theme.PILL_DISCONNECTED)
                err_lbl.grid(row=2, column=0, columnspan=3, sticky="w")

                def _save(w: str = wid, box: Any = paste, err: Any = err_lbl, st: Any = status_lbl) -> None:
                    key = box.get("1.0", "end").strip()
                    if not is_valid_service_key(key):
                        err.configure(text="Key must start with omni_sk_")
                        return
                    write_service_key(w, key)
                    err.configure(text="")
                    st.configure(text="Already registered ✓", text_color=theme.PILL_CONNECTED)
                    self._state.registration_done[w] = True
                    if self._on_saved:
                        self._on_saved(w)

                ctk.CTkButton(row, text="Save", width=80, command=_save).grid(
                    row=1, column=2, padx=4, pady=4
                )
                self._worker_rows.append({"worker_id": wid, "status_lbl": status_lbl})
            else:
                ctk.CTkLabel(
                    row,
                    text=key_path_display(wid),
                    text_color=theme.TEXT_MUTED,
                    font=ctk.CTkFont(size=11),
                ).grid(row=1, column=0, columnspan=3, sticky="w")

    def is_valid(self) -> bool:
        return gate_next(self._skip_var.get(), self._worker_ids())

    def to_state(self, state: WizardState) -> None:
        state.require_service_keys = not self._skip_var.get()
        for wid in self._worker_ids():
            state.registration_done[wid] = worker_key_registered(wid)

    def from_state(self, state: WizardState) -> None:
        self._state = state
        self._skip_var.set(state.require_service_keys is False)
        self._update_skip_hint()
        self._rebuild()

# Created and developed by Jai Singh
