# Created and developed by Jai Singh
"""Wizard step 5 — SAPLogon executable path."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import customtkinter as ctk

from omni_agent.master import theme
from omni_agent.master.saplogon_locator import locate_saplogon
from omni_agent.master.wizard_state import WizardState


class SaplogonPathStep(ctk.CTkFrame):
    def __init__(self, master: Any, state: WizardState) -> None:
        super().__init__(master, fg_color="transparent")
        self._state = state

        ctk.CTkLabel(
            self,
            text="Path to saplogon.exe (used by recovery actions). Skip if SAP is not on this host.",
            text_color=theme.TEXT_MUTED,
            wraplength=640,
        ).pack(anchor="w", pady=(0, 8))

        self._path_var = ctk.StringVar(value="")
        entry_row = ctk.CTkFrame(self, fg_color="transparent")
        entry_row.pack(fill="x", pady=8)
        self._entry = ctk.CTkEntry(entry_row, textvariable=self._path_var, width=480)
        self._entry.pack(side="left", padx=(0, 8))
        ctk.CTkButton(entry_row, text="Autodetect", width=100, command=self._autodetect).pack(
            side="left"
        )

        self._skip_var = ctk.BooleanVar(value=False)
        ctk.CTkCheckBox(
            self,
            text="SAPLogon not installed on this host",
            variable=self._skip_var,
            command=self._on_skip_toggle,
        ).pack(anchor="w", pady=12)

    def _autodetect(self) -> None:
        found = locate_saplogon()
        if found:
            self._path_var.set(str(found))
            self._state.saplogon_path = str(found)
            self._skip_var.set(False)

    def _on_skip_toggle(self) -> None:
        if self._skip_var.get():
            self._entry.configure(state="disabled")
        else:
            self._entry.configure(state="normal")

    def is_valid(self) -> bool:
        if self._skip_var.get():
            return True
        path = self._path_var.get().strip()
        return bool(path) and Path(path).is_file()

    def to_state(self, state: WizardState) -> None:
        state.saplogon_not_installed = bool(self._skip_var.get())
        state.saplogon_path = "" if state.saplogon_not_installed else self._path_var.get().strip()

    def from_state(self, state: WizardState) -> None:
        self._state = state
        self._skip_var.set(state.saplogon_not_installed)
        path = state.saplogon_path
        if not path and not state.saplogon_not_installed:
            found = locate_saplogon()
            if found:
                path = str(found)
        self._path_var.set(path)
        self._on_skip_toggle()

# Created and developed by Jai Singh
