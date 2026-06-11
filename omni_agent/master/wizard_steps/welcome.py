# Created and developed by Jai Singh
"""Wizard step 1 — Welcome."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import customtkinter as ctk

from omni_agent.master import theme

if TYPE_CHECKING:
    from omni_agent.master.wizard_state import WizardState


class WelcomeStep(ctk.CTkFrame):
    def __init__(self, master: Any, state: WizardState) -> None:
        super().__init__(master, fg_color="transparent")
        self._state = state
        ctk.CTkLabel(
            self,
            text="OmniFrame Agent Master — First-Run Setup",
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color=theme.TEXT_PRIMARY,
        ).pack(anchor="w", pady=(0, 12))
        body = (
            f"This wizard configures {state.worker_count} SAP worker agents on this host.\n\n"
            "You will:\n"
            "• Probe open SAP GUI sessions\n"
            "• Pair each worker to a session (static assignment)\n"
            "• Register a fleet service key per worker (browser + paste)\n"
            "• Confirm SAPLogon path and save master_config.yaml\n\n"
            "Log into SAP GUI separately — this wizard never asks for SAP credentials."
        )
        ctk.CTkLabel(
            self,
            text=body,
            justify="left",
            text_color=theme.TEXT_MUTED,
            wraplength=640,
        ).pack(anchor="w")

    def is_valid(self) -> bool:
        return True

    def to_state(self, state: WizardState) -> None:
        pass

    def from_state(self, state: WizardState) -> None:
        self._state = state

# Created and developed by Jai Singh
