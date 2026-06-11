# Created and developed by Jai Singh
"""First-run Setup Wizard orchestrator (Phase E)."""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional

from omni_agent.master.config import (
    MasterConfig,
    MasterSettings,
    WorkerConfig,
    load_config,
    master_config_path,
    validate_config,
    write_master_config,
)
from omni_agent.master.pair_sessions_logic import (
    WorkerPairing,
    default_worker_pairings,
    validate_pair_sessions,
)
from omni_agent.master.register_identities_logic import (
    all_workers_registered,
    registration_status,
)
from omni_agent.master.wizard_state import (
    STEP_CONFIRM_PERSIST,
    STEP_PAIR_SESSIONS,
    STEP_PROBE_SAP,
    STEP_REGISTER_IDENTITIES,
    STEP_SAPLOGON_PATH,
    STEP_WELCOME,
    WizardState,
    clear_wizard_state,
    load_wizard_state,
    save_wizard_state,
)

LOG = logging.getLogger("omniframe.master.wizard")

STEP_IDS: tuple[str, ...] = (
    "welcome",
    "probe_sap",
    "pair_sessions",
    "register_identities",
    "saplogon_path",
    "confirm_persist",
)

STEP_TITLES: tuple[str, ...] = (
    "Welcome",
    "Probe SAP",
    "Pair Sessions",
    "Register Identities",
    "SAPLogon Path",
    "Confirm & Persist",
)


def is_wizard_required(cfg: MasterConfig | None = None) -> bool:
    """True when ``master_config.yaml`` or any worker service key is missing."""
    from omni_agent.master.config import canonical_service_key_path

    cfg = cfg or load_config()
    if not master_config_path().is_file():
        return True
    if not cfg.master.require_service_keys:
        return False
    n = cfg.master.workers
    for w in cfg.workers[:n]:
        if not canonical_service_key_path(w.id).is_file():
            return True
    return False


def initial_wizard_state(cfg: MasterConfig) -> WizardState:
    saved = load_wizard_state()
    if saved is not None:
        return saved
    host = cfg.workers[0].id.rsplit("-W", 1)[0] if cfg.workers else ""
    if not host and cfg.workers:
        host = cfg.workers[0].id.split("-W")[0]
    from omni_agent.master.config import default_host_prefix

    prefix = host or default_host_prefix()
    pairings = [p.to_dict() for p in default_worker_pairings(cfg.master.workers, host_prefix=prefix)]
    require_keys = True
    if master_config_path().is_file():
        require_keys = cfg.master.require_service_keys
    return WizardState(
        worker_count=cfg.master.workers,
        host_prefix=prefix,
        pairings=pairings,
        require_service_keys=require_keys,
    )


def step_index(step_id: str) -> int:
    return STEP_IDS.index(step_id)


def step_id(index: int) -> str:
    return STEP_IDS[max(0, min(index, len(STEP_IDS) - 1))]


def can_advance(step: int, state: WizardState, *, step_valid: bool) -> bool:
    """Pure gate for ``[Next]`` — UI sets ``step_valid`` from the active panel."""
    if not step_valid:
        return False
    if step >= len(STEP_IDS) - 1:
        return False
    return True


def can_finish(step: int, *, step_valid: bool) -> bool:
    return step == STEP_CONFIRM_PERSIST and step_valid


def pairing_objects(state: WizardState) -> list[WorkerPairing]:
    return [WorkerPairing.from_dict(p) for p in state.pairings]


def build_config_from_state(state: WizardState) -> MasterConfig:
    """Materialize ``MasterConfig`` from wizard state for persist step."""
    from omni_agent.master.saplogon_locator import locate_saplogon

    pairings = pairing_objects(state)
    err = validate_pair_sessions(pairings, state.worker_count)
    if err:
        raise ValueError(err)
    sap_path = state.saplogon_path
    if not sap_path and not state.saplogon_not_installed:
        found = locate_saplogon()
        if found:
            sap_path = str(found)
    master = MasterSettings(
        workers=state.worker_count,
        sap_logon_path=sap_path or MasterSettings.sap_logon_path,
        require_service_keys=state.require_service_keys,
    )
    workers = [
        WorkerConfig(
            id=p.worker_id,
            label=p.label,
            sap_conn_idx=p.conn_idx,
            sap_session_index=p.sess_idx,
            auto_start=p.auto_start,
            health_port=p.health_port,
        )
        for p in pairings
    ]
    cfg = MasterConfig(master=master, workers=workers, using_builtin_defaults=False)
    validate_config(cfg)
    return cfg


def persist_wizard(state: WizardState) -> MasterConfig:
    cfg = build_config_from_state(state)
    write_master_config(cfg)
    clear_wizard_state()
    return load_config()


def resume_step_for_missing_keys(state: WizardState) -> int:
    """If keys missing but config exists, jump to register step."""
    if not state.require_service_keys:
        return state.current_step
    ids = [p["worker_id"] for p in state.pairings if p.get("worker_id")]
    if not ids:
        ids = [f"{state.host_prefix}-W{i}" for i in range(1, state.worker_count + 1)]
    if not all_workers_registered(ids):
        return STEP_REGISTER_IDENTITIES
    return state.current_step


# ---------------------------------------------------------------------------
# CTk modal (imports CustomTkinter only when instantiated)
# ---------------------------------------------------------------------------


class MasterSetupWizard:
    """Modal ``CTkToplevel`` — six steps, resumable state, blocks main window."""

    def __init__(
        self,
        parent: Any,
        cfg: MasterConfig,
        *,
        on_complete: Callable[[MasterConfig], None],
        force_rerun: bool = False,
    ) -> None:
        import customtkinter as ctk

        from omni_agent.master.wizard_steps.confirm_persist import ConfirmPersistStep
        from omni_agent.master.wizard_steps.pair_sessions import PairSessionsStep
        from omni_agent.master.wizard_steps.probe_sap import ProbeSapStep
        from omni_agent.master.wizard_steps.register_identities import RegisterIdentitiesStep
        from omni_agent.master.wizard_steps.saplogon_path import SaplogonPathStep
        from omni_agent.master.wizard_steps.welcome import WelcomeStep

        self._ctk = ctk
        self._parent = parent
        self._cfg = cfg if force_rerun else cfg
        self._on_complete = on_complete
        self.state = initial_wizard_state(self._cfg)
        if master_config_path().is_file() and is_wizard_required(self._cfg):
            self.state.current_step = resume_step_for_missing_keys(self.state)

        self.window = ctk.CTkToplevel(parent)
        self.window.title("OmniFrame Setup Wizard")
        self.window.geometry("720x560")
        self.window.transient(parent)
        self.window.grab_set()
        self.window.protocol("WM_DELETE_WINDOW", self._on_close)

        self._step_index = self.state.current_step
        self._title_lbl = ctk.CTkLabel(
            self.window,
            text="",
            font=ctk.CTkFont(size=18, weight="bold"),
        )
        self._title_lbl.pack(padx=16, pady=(12, 4), anchor="w")

        self._progress_lbl = ctk.CTkLabel(self.window, text="")
        self._progress_lbl.pack(padx=16, pady=(0, 8), anchor="w")

        # Body frame is created first so it can parent the step panels, but
        # we DELAY packing it until after the nav row is packed at the
        # bottom. Tk ``pack`` allocates from the remaining cavity in pack
        # order; if we packed ``self._body`` here with ``expand=True``,
        # the body would consume the entire space below the header and
        # the nav row (Back/Next/Finish/Cancel) would be packed into a
        # zero-height slot, leaving the wizard with no way to advance —
        # the exact symptom seen in production on 2026-05-21.
        self._body = ctk.CTkFrame(self.window, fg_color="transparent")

        self._panels: list[Any] = [
            WelcomeStep(self._body, self.state),
            ProbeSapStep(self._body, self.state, on_rescan=self._on_rescan),
            PairSessionsStep(self._body, self.state),
            RegisterIdentitiesStep(self._body, self.state, on_saved=self._on_key_saved),
            SaplogonPathStep(self._body, self.state),
            ConfirmPersistStep(self._body, self.state),
        ]
        for panel in self._panels:
            panel.pack_forget()

        nav = ctk.CTkFrame(self.window, fg_color="transparent")
        self._back_btn = ctk.CTkButton(nav, text="Back", width=100, command=self._on_back)
        self._back_btn.grid(row=0, column=0, padx=4)
        self._next_btn = ctk.CTkButton(nav, text="Next", width=100, command=self._on_next)
        self._next_btn.grid(row=0, column=1, padx=4)
        self._finish_btn = ctk.CTkButton(
            nav, text="Finish", width=100, command=self._on_finish
        )
        self._finish_btn.grid(row=0, column=2, padx=4)
        self._cancel_btn = ctk.CTkButton(
            nav, text="Cancel", width=100, command=self._on_close, fg_color="gray30"
        )
        self._cancel_btn.grid(row=0, column=3, padx=(24, 4))

        # Pack order matters: ``side="bottom"`` reserves the bottom strip
        # for the nav row first, then ``self._body`` packs ``side="top"``
        # with ``expand=True`` and fills only the cavity between the
        # header (title + progress, packed earlier) and the nav row.
        nav.pack(side="bottom", fill="x", padx=16, pady=12)
        self._body.pack(side="top", fill="both", expand=True, padx=16, pady=8)

        self._show_step(self._step_index)

    def _active_panel(self) -> Any:
        return self._panels[self._step_index]

    def _sync_state_from_panel(self) -> None:
        self._active_panel().to_state(self.state)
        save_wizard_state(self.state)

    def _show_step(self, index: int) -> None:
        self._step_index = max(0, min(index, len(STEP_IDS) - 1))
        self.state.current_step = self._step_index
        for i, panel in enumerate(self._panels):
            if i == self._step_index:
                panel.from_state(self.state)
                panel.pack(fill="both", expand=True)
            else:
                panel.pack_forget()
        self._title_lbl.configure(text=STEP_TITLES[self._step_index])
        self._progress_lbl.configure(
            text=f"Step {self._step_index + 1} of {len(STEP_IDS)} — {STEP_IDS[self._step_index]}"
        )
        self._back_btn.configure(state="normal" if self._step_index > 0 else "disabled")
        valid = self._active_panel().is_valid()
        on_last = self._step_index == STEP_CONFIRM_PERSIST
        self._next_btn.configure(
            state="normal" if can_advance(self._step_index, self.state, step_valid=valid) and not on_last else "disabled"
        )
        self._finish_btn.configure(
            state="normal" if can_finish(self._step_index, step_valid=valid) else "disabled"
        )

    def _on_rescan(self) -> None:
        """Probe panel finished a scan — refresh the [Next] gate.

        ``ProbeSapStep.run_probe()`` calls this after each scan so the
        wizard can re-evaluate the [Next] button against the new
        ``panel.is_valid()`` result. Two correctness invariants:

        1. Must NOT call ``panel.run_probe()`` — that would recurse
           ``run_probe → on_rescan_cb → _on_rescan → run_probe → …``.
           The [Rescan] button in ``probe_sap.py`` already calls
           ``run_probe`` locally; the wizard only owns nav state.
        2. Must tolerate being called before ``self._panels`` exists.
           ``ProbeSapStep.__init__`` fires its first ``run_probe()`` at
           the tail of its own ``__init__``, which runs *during* this
           class's ``__init__`` (line that builds ``self._panels``).
           ``_show_step`` at the end of ``__init__`` will refresh nav
           buttons once the panels list has been assigned.
        """
        if not hasattr(self, "_panels"):
            return
        self._show_step(self._step_index)

    def _on_key_saved(self, worker_id: str) -> None:
        self.state.registration_done[worker_id] = True
        save_wizard_state(self.state)
        self._show_step(self._step_index)

    def _on_back(self) -> None:
        self._sync_state_from_panel()
        if self._step_index > 0:
            self._show_step(self._step_index - 1)

    def _on_next(self) -> None:
        panel = self._active_panel()
        if not panel.is_valid():
            return
        panel.to_state(self.state)
        save_wizard_state(self.state)
        if self._step_index < len(STEP_IDS) - 1:
            self._show_step(self._step_index + 1)

    def _on_finish(self) -> None:
        panel = self._active_panel()
        if not panel.is_valid():
            return
        panel.to_state(self.state)
        try:
            cfg = persist_wizard(self.state)
        except Exception as exc:
            LOG.error("Wizard persist failed: %s", exc)
            if hasattr(panel, "set_error"):
                panel.set_error(str(exc))
            return
        self.window.grab_release()
        self.window.destroy()
        self._on_complete(cfg)

    def _on_close(self) -> None:
        self._sync_state_from_panel()
        self.window.grab_release()
        self.window.destroy()

    def relaunch(self) -> None:
        """No-op placeholder — use ``open_setup_wizard(..., force_rerun=True)``."""
        pass


def open_setup_wizard(
    parent: Any,
    cfg: MasterConfig | None = None,
    *,
    on_complete: Callable[[MasterConfig], None],
    force_rerun: bool = False,
) -> MasterSetupWizard:
    base = cfg or load_config()
    if force_rerun:
        clear_wizard_state()
    return MasterSetupWizard(parent, base, on_complete=on_complete, force_rerun=force_rerun)

# Created and developed by Jai Singh
