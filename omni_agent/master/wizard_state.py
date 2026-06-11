# Created and developed by Jai Singh
"""Resumable Setup Wizard progress at ``%USERPROFILE%\\.omniframe\\wizard_state.json``."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from omni_agent.master.config import default_host_prefix, omniframe_home

LOG = logging.getLogger("omniframe.master.wizard_state")

STATE_VERSION = 1
STATE_FILENAME = "wizard_state.json"

# Step indices (0-based) — must match wizard.STEP_IDS order
STEP_WELCOME = 0
STEP_PROBE_SAP = 1
STEP_PAIR_SESSIONS = 2
STEP_REGISTER_IDENTITIES = 3
STEP_SAPLOGON_PATH = 4
STEP_CONFIRM_PERSIST = 5


def wizard_state_path() -> Path:
    return omniframe_home() / STATE_FILENAME


@dataclass
class WizardState:
    """JSON schema (inline documentation for operators/debugging).

    Fields:
      version: int — schema version (currently 1)
      current_step: int — 0..5 step index
      worker_count: int — ``master.workers`` at wizard start
      host_prefix: str — ``COMPUTERNAME`` used for ``-W<N>`` ids
      probe_sessions: list[dict] — last SAP probe rows
      probe_error: str | null — typed probe failure code
      pairings: list[dict] — WorkerPairing.to_dict() rows
      saplogon_path: str — chosen or autodetected path
      saplogon_not_installed: bool — step 5 skip checkbox
      registration_done: dict[str, bool] — worker_id → registered flag cache
      require_service_keys: bool — strict service-key gate (default True)
    """

    current_step: int = STEP_WELCOME
    worker_count: int = 6
    host_prefix: str = ""
    probe_sessions: list[dict[str, Any]] = field(default_factory=list)
    probe_error: str | None = None
    pairings: list[dict[str, Any]] = field(default_factory=list)
    saplogon_path: str = ""
    saplogon_not_installed: bool = False
    registration_done: dict[str, bool] = field(default_factory=dict)
    require_service_keys: bool = True
    version: int = STATE_VERSION

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "current_step": self.current_step,
            "worker_count": self.worker_count,
            "host_prefix": self.host_prefix,
            "probe_sessions": self.probe_sessions,
            "probe_error": self.probe_error,
            "pairings": self.pairings,
            "saplogon_path": self.saplogon_path,
            "saplogon_not_installed": self.saplogon_not_installed,
            "registration_done": self.registration_done,
            "require_service_keys": self.require_service_keys,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> WizardState:
        return cls(
            version=int(raw.get("version", STATE_VERSION)),
            current_step=int(raw.get("current_step", STEP_WELCOME)),
            worker_count=int(raw.get("worker_count", 6)),
            host_prefix=str(raw.get("host_prefix", "") or default_host_prefix()),
            probe_sessions=list(raw.get("probe_sessions") or []),
            probe_error=raw.get("probe_error"),
            pairings=list(raw.get("pairings") or []),
            saplogon_path=str(raw.get("saplogon_path", "")),
            saplogon_not_installed=bool(raw.get("saplogon_not_installed", False)),
            registration_done=dict(raw.get("registration_done") or {}),
            require_service_keys=bool(raw.get("require_service_keys", True)),
        )


def load_wizard_state() -> WizardState | None:
    path = wizard_state_path()
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return None
        return WizardState.from_dict(raw)
    except (OSError, json.JSONDecodeError) as exc:
        LOG.warning("Could not load wizard state: %s", exc)
        return None


def save_wizard_state(state: WizardState) -> Path:
    path = wizard_state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state.to_dict(), indent=2), encoding="utf-8")
    return path


def clear_wizard_state() -> None:
    path = wizard_state_path()
    try:
        if path.is_file():
            path.unlink()
    except OSError as exc:
        LOG.warning("Could not clear wizard state: %s", exc)

# Created and developed by Jai Singh
