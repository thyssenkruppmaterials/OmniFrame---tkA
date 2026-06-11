# Created and developed by Jai Singh
"""One-shot ``/sap/sessions`` fetch and pinned-session label parsing."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Callable, Optional

import httpx

from omni_agent.connect.diagnostic import SAP_LABEL_CACHE_TTL_S
from omni_agent.connect.state import WORKER_PORT


@dataclass
class SystemLabelCache:
    """Cached SAP session identity for the Connect subtitle row."""

    user: str = "—"
    system: str = "—"
    transaction: str = "—"
    fetched_at: float = 0.0

    def is_stale(self, now: Optional[float] = None) -> bool:
        ts = now if now is not None else time.time()
        if not self.fetched_at:
            return True
        return ts - self.fetched_at >= SAP_LABEL_CACHE_TTL_S

    def as_subtitle_parts(self) -> tuple[str, str, str]:
        return self.user or "—", self.system or "—", self.transaction or "—"


def parse_label(sessions_payload: dict[str, Any]) -> Optional[SystemLabelCache]:
    """Parse pinned session system/client/user/transaction from worker JSON."""
    if not sessions_payload.get("ok"):
        return None
    for conn in sessions_payload.get("connections") or []:
        for sess in conn.get("sessions") or []:
            if not sess.get("pinned"):
                continue
            user = str(sess.get("user") or "").strip() or "—"
            system = str(sess.get("system") or "").strip() or "—"
            transaction = str(sess.get("transaction") or "").strip() or "—"
            return SystemLabelCache(
                user=user,
                system=system,
                transaction=transaction,
                fetched_at=time.time(),
            )
    return None


def fetch_system_label(
    port: int = WORKER_PORT,
    *,
    agent_token: Optional[str] = None,
    get_fn: Callable[..., httpx.Response] = httpx.get,
    timeout_s: float = 3.0,
) -> Optional[SystemLabelCache]:
    """GET ``/sap/sessions`` and parse the pinned session label."""
    url = f"http://127.0.0.1:{port}/sap/sessions"
    headers: dict[str, str] = {}
    if agent_token:
        headers["X-Agent-Token"] = agent_token
    try:
        resp = get_fn(url, headers=headers, timeout=timeout_s)
        if resp.status_code != 200:
            return None
        return parse_label(resp.json())
    except Exception:
        return None

# Created and developed by Jai Singh
