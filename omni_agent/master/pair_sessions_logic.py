# Created and developed by Jai Singh
"""Pure pairing helpers for Setup Wizard step 3 (no Tk)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from omni_agent.master.config import default_host_prefix
from omni_agent.master.ports import default_port_for_index


@dataclass
class WorkerPairing:
    worker_id: str
    label: str
    conn_idx: int
    sess_idx: int
    auto_start: bool
    health_port: int

    def session_tuple(self) -> tuple[int, int]:
        return (self.conn_idx, self.sess_idx)

    def to_dict(self) -> dict[str, Any]:
        return {
            "worker_id": self.worker_id,
            "label": self.label,
            "conn_idx": self.conn_idx,
            "sess_idx": self.sess_idx,
            "auto_start": self.auto_start,
            "health_port": self.health_port,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> WorkerPairing:
        return cls(
            worker_id=str(raw.get("worker_id", "")),
            label=str(raw.get("label", "")),
            conn_idx=int(raw.get("conn_idx", 0)),
            sess_idx=int(raw.get("sess_idx", 0)),
            auto_start=bool(raw.get("auto_start", True)),
            health_port=int(raw.get("health_port", 8765)),
        )


def default_worker_pairings(
    worker_count: int,
    *,
    host_prefix: str | None = None,
) -> list[WorkerPairing]:
    """Default W<i> → (0, i-1), label ``Bay i — Generic``, W6 auto_start false when count≥6."""
    prefix = host_prefix or default_host_prefix()
    out: list[WorkerPairing] = []
    for i in range(1, worker_count + 1):
        auto = True
        if worker_count >= 6 and i == 6:
            auto = False
        out.append(
            WorkerPairing(
                worker_id=f"{prefix}-W{i}",
                label=f"Bay {i} — Generic",
                conn_idx=0,
                sess_idx=i - 1,
                auto_start=auto,
                health_port=default_port_for_index(i - 1),
            )
        )
    return out


def find_duplicate_session_tuples(
    pairings: list[WorkerPairing],
) -> list[tuple[int, int]]:
    """Return duplicate ``(conn_idx, sess_idx)`` tuples (empty if all unique)."""
    seen: dict[tuple[int, int], int] = {}
    dups: list[tuple[int, int]] = []
    for p in pairings:
        key = p.session_tuple()
        seen[key] = seen.get(key, 0) + 1
        if seen[key] == 2:
            dups.append(key)
    return dups


def validate_pair_sessions(pairings: list[WorkerPairing], worker_count: int) -> str | None:
    """Return an error message, or ``None`` when valid."""
    if len(pairings) != worker_count:
        return f"Expected {worker_count} worker rows"
    for p in pairings:
        if not p.worker_id.strip():
            return "Worker id is required"
        if not p.label.strip():
            return f"Label required for {p.worker_id}"
    dups = find_duplicate_session_tuples(pairings)
    if dups:
        c, s = dups[0]
        return f"Duplicate SAP session assignment (conn={c}, sess={s})"
    return None

# Created and developed by Jai Singh
