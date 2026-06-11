# Created and developed by Jai Singh
"""Pure registration helpers for Setup Wizard step 4 (no Tk)."""

from __future__ import annotations

from pathlib import Path

from omni_agent.master.config import canonical_service_key_path
from omni_agent.master.dialogs import build_reregister_url

SERVICE_KEY_PREFIX = "omni_sk_"


def is_valid_service_key(key: str) -> bool:
    """Plaintext keys from admin UI start with ``omni_sk_``."""
    stripped = (key or "").strip()
    return stripped.startswith(SERVICE_KEY_PREFIX) and len(stripped) > len(SERVICE_KEY_PREFIX)


def worker_key_registered(worker_id: str) -> bool:
    path = canonical_service_key_path(worker_id)
    return path.is_file() and path.stat().st_size > 0


def registration_status(worker_ids: list[str]) -> dict[str, bool]:
    return {wid: worker_key_registered(wid) for wid in worker_ids}


def all_workers_registered(worker_ids: list[str]) -> bool:
    return all(worker_key_registered(wid) for wid in worker_ids)


def gate_next(skip_strict: bool, worker_ids: list[str]) -> bool:
    """Return whether wizard Step 4 [Next] should be enabled."""
    if skip_strict:
        return True
    return all_workers_registered(worker_ids)


def reregister_url_for(worker_id: str, base: str | None = None) -> str:
    if base:
        return build_reregister_url(worker_id, base=base)
    return build_reregister_url(worker_id)


def key_path_display(worker_id: str) -> str:
    return str(canonical_service_key_path(worker_id))

# Created and developed by Jai Singh
