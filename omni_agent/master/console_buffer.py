# Created and developed by Jai Singh
"""Per-worker thread-safe console ring buffer (Phase C)."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, TypedDict


class ConsoleLineEntry(TypedDict):
    ts: str
    stream: str
    worker_id: str
    line: str


MIN_RING_SIZE = 100
MAX_RING_SIZE = 50_000
DEFAULT_RING_SIZE = 10_000


@dataclass
class ConsoleRingBuffer:
    """Fixed-size FIFO ring; ``maxlen`` enforced via ``collections.deque``."""

    maxlen: int = DEFAULT_RING_SIZE
    _deque: deque[ConsoleLineEntry] = field(init=False)
    _lock: Lock = field(default_factory=Lock, repr=False)
    tail_drops: int = 0

    def __post_init__(self) -> None:
        if self.maxlen < MIN_RING_SIZE or self.maxlen > MAX_RING_SIZE:
            raise ValueError(
                f"console ring size must be in [{MIN_RING_SIZE}, {MAX_RING_SIZE}]"
            )
        self._deque = deque(maxlen=self.maxlen)

    def append(self, entry: ConsoleLineEntry) -> None:
        with self._lock:
            self._deque.append(entry)

    def record_tail_drop(self) -> None:
        with self._lock:
            self.tail_drops += 1

    def snapshot(self, last_n: int | None = None) -> list[ConsoleLineEntry]:
        with self._lock:
            items = list(self._deque)
        if last_n is not None and last_n >= 0:
            return items[-last_n:] if last_n else []
        return items

    def __len__(self) -> int:
        with self._lock:
            return len(self._deque)


def format_console_line(entry: ConsoleLineEntry) -> str:
    """Human-readable line for drawer / pop-out / disk."""
    return f"{entry['ts']} [{entry['stream']}] {entry['line']}"


def coerce_entry(raw: dict[str, Any]) -> ConsoleLineEntry:
    return ConsoleLineEntry(
        ts=str(raw.get("ts", "")),
        stream=str(raw.get("stream", "stdout")),
        worker_id=str(raw.get("worker_id", "")),
        line=str(raw.get("line", "")),
    )

# Created and developed by Jai Singh
