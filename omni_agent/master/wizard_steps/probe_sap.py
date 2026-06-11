# Created and developed by Jai Singh
"""Wizard step 2 — Probe SAP sessions."""

from __future__ import annotations

from typing import Any, Callable

import customtkinter as ctk

from omni_agent.master import theme
from omni_agent.master.sap_probe import probe_sap_sessions, session_label
from omni_agent.master.wizard_state import WizardState


class ProbeSapStep(ctk.CTkFrame):
    def __init__(
        self,
        master: Any,
        state: WizardState,
        *,
        on_rescan: Callable[[], None] | None = None,
    ) -> None:
        super().__init__(master, fg_color="transparent")
        self._state = state
        self._on_rescan_cb = on_rescan

        ctk.CTkLabel(
            self,
            text="Detect open SAP GUI sessions via the scripting engine.",
            text_color=theme.TEXT_MUTED,
            wraplength=640,
        ).pack(anchor="w", pady=(0, 8))

        btn_row = ctk.CTkFrame(self, fg_color="transparent")
        btn_row.pack(anchor="w", pady=4)
        ctk.CTkButton(btn_row, text="Rescan", width=100, command=self.run_probe).pack(
            side="left", padx=(0, 8)
        )

        self._warn_lbl = ctk.CTkLabel(self, text="", text_color=theme.PILL_CONNECTING)
        self._warn_lbl.pack(anchor="w", pady=4)

        self._error_lbl = ctk.CTkLabel(self, text="", text_color=theme.PILL_DISCONNECTED)
        self._error_lbl.pack(anchor="w", pady=4)

        self._list = ctk.CTkTextbox(self, height=280, fg_color=theme.BG_TILE)
        self._list.pack(fill="both", expand=True, pady=8)
        self._list.configure(state="disabled")

        self.run_probe()

    def run_probe(self) -> None:
        result = probe_sap_sessions()
        sessions = result.get("sessions") or []
        self._state.probe_sessions = list(sessions)
        self._state.probe_error = result.get("error")

        lines: list[str] = []
        if result.get("error"):
            lines.append(f"Probe error: {result['error']}")
            if result.get("error_detail"):
                lines.append(str(result["error_detail"]))
            lines.append("")
        if not sessions:
            lines.append("No sessions detected.")
        else:
            for s in sessions:
                lines.append(session_label(s))
        self._list.configure(state="normal")
        self._list.delete("1.0", "end")
        self._list.insert("1.0", "\n".join(lines))
        self._list.configure(state="disabled")

        n = len(sessions)
        need = self._state.worker_count
        if n < need:
            self._warn_lbl.configure(
                text=(
                    f"Only {n} session(s) detected. Open {need - n} more in SAPLogon and rescan."
                    if n < need
                    else ""
                )
            )
        else:
            self._warn_lbl.configure(text=f"Detected {n} session(s) — OK for {need} workers.")

        if self._on_rescan_cb:
            self._on_rescan_cb()

    def is_valid(self) -> bool:
        sessions = self._state.probe_sessions or []
        return len(sessions) >= 1

    def to_state(self, state: WizardState) -> None:
        state.probe_sessions = list(self._state.probe_sessions)
        state.probe_error = self._state.probe_error

    def from_state(self, state: WizardState) -> None:
        self._state = state
        if state.probe_sessions:
            lines = [session_label(s) for s in state.probe_sessions]
            self._list.configure(state="normal")
            self._list.delete("1.0", "end")
            self._list.insert("1.0", "\n".join(lines) or "No sessions.")
            self._list.configure(state="disabled")
        if state.probe_error:
            self._error_lbl.configure(text=f"Last error: {state.probe_error}")

# Created and developed by Jai Singh
