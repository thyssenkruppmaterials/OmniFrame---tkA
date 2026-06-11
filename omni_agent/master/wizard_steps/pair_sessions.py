# Created and developed by Jai Singh
"""Wizard step 3 — Pair workers to SAP sessions."""

from __future__ import annotations

from typing import Any

import customtkinter as ctk

from omni_agent.master import theme
from omni_agent.master.pair_sessions_logic import (
    WorkerPairing,
    default_worker_pairings,
    find_duplicate_session_tuples,
    validate_pair_sessions,
)
from omni_agent.master.sap_probe import session_label
from omni_agent.master.wizard_state import WizardState


class PairSessionsStep(ctk.CTkFrame):
    def __init__(self, master: Any, state: WizardState) -> None:
        super().__init__(master, fg_color="transparent")
        self._state = state
        self._rows: list[dict[str, Any]] = []
        self._err_lbl = ctk.CTkLabel(self, text="", text_color=theme.PILL_DISCONNECTED)
        self._err_lbl.pack(anchor="w", pady=(0, 4))

        self._scroll = ctk.CTkScrollableFrame(self, fg_color=theme.BG_TILE, height=360)
        self._scroll.pack(fill="both", expand=True)

        hdr = ctk.CTkFrame(self._scroll, fg_color="transparent")
        hdr.pack(fill="x", pady=4)
        for col, text in enumerate(["Worker", "Label", "SAP session", "Auto-start"]):
            ctk.CTkLabel(hdr, text=text, font=ctk.CTkFont(weight="bold"), width=140 if col < 2 else 120).grid(
                row=0, column=col, padx=4, sticky="w"
            )

    def _session_options(self) -> list[tuple[str, tuple[int, int]]]:
        opts: list[tuple[str, tuple[int, int]]] = []
        for s in self._state.probe_sessions or []:
            key = (int(s.get("conn_idx", 0)), int(s.get("sess_idx", 0)))
            opts.append((session_label(s), key))
        if not opts:
            for i in range(self._state.worker_count):
                opts.append((f"conn 0 / sess {i}", (0, i)))
        return opts

    def _rebuild_rows(self) -> None:
        for child in self._scroll.winfo_children()[1:]:
            child.destroy()
        self._rows.clear()
        pairings = [WorkerPairing.from_dict(p) for p in self._state.pairings]
        if len(pairings) != self._state.worker_count:
            pairings = default_worker_pairings(
                self._state.worker_count, host_prefix=self._state.host_prefix
            )
        options = self._session_options()
        labels = [o[0] for o in options]
        keys = [o[1] for o in options]

        for idx, p in enumerate(pairings):
            row_frame = ctk.CTkFrame(self._scroll, fg_color="transparent")
            row_frame.pack(fill="x", pady=2)
            wid_lbl = ctk.CTkLabel(row_frame, text=p.worker_id, width=140, anchor="w")
            wid_lbl.grid(row=0, column=0, padx=4, sticky="w")
            label_entry = ctk.CTkEntry(row_frame, width=160)
            label_entry.insert(0, p.label)
            label_entry.grid(row=0, column=1, padx=4)
            sess_var = ctk.StringVar(value=labels[0] if labels else "")
            for li, lab in enumerate(labels):
                if keys[li] == (p.conn_idx, p.sess_idx):
                    sess_var.set(lab)
                    break
            sess_menu = ctk.CTkOptionMenu(row_frame, variable=sess_var, values=labels or ["—"])
            sess_menu.grid(row=0, column=2, padx=4)
            auto_var = ctk.BooleanVar(value=p.auto_start)
            auto_chk = ctk.CTkCheckBox(row_frame, text="", variable=auto_var, width=40)
            auto_chk.grid(row=0, column=3, padx=4)
            self._rows.append(
                {
                    "pairing": p,
                    "label_entry": label_entry,
                    "sess_var": sess_var,
                    "sess_keys": keys,
                    "sess_labels": labels,
                    "auto_var": auto_var,
                }
            )

    def _collect_pairings(self) -> list[WorkerPairing]:
        out: list[WorkerPairing] = []
        for row in self._rows:
            p: WorkerPairing = row["pairing"]
            label = row["label_entry"].get().strip()
            sel = row["sess_var"].get()
            labels = row["sess_labels"]
            keys = row["sess_keys"]
            conn, sess = p.conn_idx, p.sess_idx
            if sel in labels:
                conn, sess = keys[labels.index(sel)]
            out.append(
                WorkerPairing(
                    worker_id=p.worker_id,
                    label=label or p.label,
                    conn_idx=conn,
                    sess_idx=sess,
                    auto_start=bool(row["auto_var"].get()),
                    health_port=p.health_port,
                )
            )
        return out

    def is_valid(self) -> bool:
        pairings = self._collect_pairings() if self._rows else pairing_objects_fallback(self._state)
        err = validate_pair_sessions(pairings, self._state.worker_count)
        dups = find_duplicate_session_tuples(pairings)
        if err or dups:
            msg = err or f"Duplicate session (conn={dups[0][0]}, sess={dups[0][1]})"
            self._err_lbl.configure(text=msg)
            return False
        self._err_lbl.configure(text="")
        return True

    def to_state(self, state: WizardState) -> None:
        if self._rows:
            state.pairings = [p.to_dict() for p in self._collect_pairings()]

    def from_state(self, state: WizardState) -> None:
        self._state = state
        if not state.pairings:
            state.pairings = [
                p.to_dict()
                for p in default_worker_pairings(state.worker_count, host_prefix=state.host_prefix)
            ]
        self._rebuild_rows()


def pairing_objects_fallback(state: WizardState) -> list[WorkerPairing]:
    if state.pairings:
        return [WorkerPairing.from_dict(p) for p in state.pairings]
    return default_worker_pairings(state.worker_count, host_prefix=state.host_prefix)

# Created and developed by Jai Singh
