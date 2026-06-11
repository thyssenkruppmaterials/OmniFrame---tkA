# Created and developed by Jai Singh
"""Wizard step 6 — Review summary and persist."""

from __future__ import annotations

from typing import Any

import customtkinter as ctk

from omni_agent.master import theme
from omni_agent.master.pair_sessions_logic import WorkerPairing
from omni_agent.master.register_identities_logic import key_path_display
from omni_agent.master.wizard_state import WizardState


class ConfirmPersistStep(ctk.CTkFrame):
    def __init__(self, master: Any, state: WizardState) -> None:
        super().__init__(master, fg_color="transparent")
        self._state = state
        self._error_lbl = ctk.CTkLabel(self, text="", text_color=theme.PILL_DISCONNECTED)
        self._error_lbl.pack(anchor="w")

        self._summary = ctk.CTkTextbox(self, height=380, fg_color=theme.BG_TILE)
        self._summary.pack(fill="both", expand=True, pady=8)
        self._summary.configure(state="disabled")

    def _build_summary_text(self) -> str:
        lines = [
            "Review configuration before Finish:",
            "",
            f"Workers: {self._state.worker_count}",
            f"SAPLogon: {self._state.saplogon_path or '(not installed / default)'}",
            "",
        ]
        for raw in self._state.pairings:
            p = WorkerPairing.from_dict(raw)
            key_path = key_path_display(p.worker_id)
            lines.append(
                f"• {p.worker_id} | {p.label} | conn={p.conn_idx} sess={p.sess_idx} | "
                f"port={p.health_port} | auto_start={p.auto_start}"
            )
            lines.append(f"  key: {key_path}")
        return "\n".join(lines)

    def set_error(self, message: str) -> None:
        self._error_lbl.configure(text=message)

    def is_valid(self) -> bool:
        return len(self._state.pairings) == self._state.worker_count

    def to_state(self, state: WizardState) -> None:
        pass

    def from_state(self, state: WizardState) -> None:
        self._state = state
        text = self._build_summary_text()
        self._summary.configure(state="normal")
        self._summary.delete("1.0", "end")
        self._summary.insert("1.0", text)
        self._summary.configure(state="disabled")
        self._error_lbl.configure(text="")

# Created and developed by Jai Singh
