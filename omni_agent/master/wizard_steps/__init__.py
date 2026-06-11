# Created and developed by Jai Singh
"""Setup Wizard step panels (Phase E)."""

from omni_agent.master.wizard_steps.confirm_persist import ConfirmPersistStep
from omni_agent.master.wizard_steps.pair_sessions import PairSessionsStep
from omni_agent.master.wizard_steps.probe_sap import ProbeSapStep
from omni_agent.master.wizard_steps.register_identities import RegisterIdentitiesStep
from omni_agent.master.wizard_steps.saplogon_path import SaplogonPathStep
from omni_agent.master.wizard_steps.welcome import WelcomeStep

__all__ = [
    "WelcomeStep",
    "ProbeSapStep",
    "PairSessionsStep",
    "RegisterIdentitiesStep",
    "SaplogonPathStep",
    "ConfirmPersistStep",
]

# Created and developed by Jai Singh
