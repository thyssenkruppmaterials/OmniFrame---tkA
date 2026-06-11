# Created and developed by Jai Singh
"""Health-port allocation and conflict detection for master workers."""

from __future__ import annotations

import socket
from typing import Iterable


BASE_HEALTH_PORT = 8765


def default_port_for_index(worker_index: int, base: int = BASE_HEALTH_PORT) -> int:
    """Return `base + worker_index` (0-based slot in the workers list)."""
    return base + worker_index


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """True if something is already listening on loopback `port`."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.25)
        return sock.connect_ex((host, port)) == 0


def find_port_conflicts(ports: Iterable[int], host: str = "127.0.0.1") -> list[int]:
    """Ports from `ports` that already have a listener (orphan adoption hint)."""
    return [p for p in ports if is_port_in_use(p, host=host)]

# Created and developed by Jai Singh
