# Created and developed by Jai Singh
"""Console drawer pure logic + tail dispatch helpers (Phase C)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

from omni_agent.master.console_buffer import (
    ConsoleLineEntry,
    ConsoleRingBuffer,
    format_console_line,
)

DRAWER_VISIBLE_LINES = 200


@dataclass
class WorkerConsoleViewState:
    """Per-worker drawer view state (pause/clear are view-only)."""

    paused: bool = False
    cleared: bool = False
    rendered_count: int = 0


@dataclass
class ConsoleDrawerLogic:
    """Pure logic for selector, pause/clear, and line rendering — no Tk."""

    worker_ids: list[str]
    worker_labels: dict[str, str]
    selected_worker_id: str
    view_states: dict[str, WorkerConsoleViewState] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for wid in self.worker_ids:
            self.view_states.setdefault(wid, WorkerConsoleViewState())

    def selector_options(self) -> list[str]:
        return [self.worker_labels.get(wid, wid) for wid in self.worker_ids]

    def label_to_worker_id(self, label: str) -> Optional[str]:
        for wid in self.worker_ids:
            if self.worker_labels.get(wid, wid) == label:
                return wid
        return None

    def select_worker(self, worker_id: str) -> None:
        if worker_id in self.worker_ids:
            self.selected_worker_id = worker_id

    def select_by_label(self, label: str) -> Optional[str]:
        wid = self.label_to_worker_id(label)
        if wid:
            self.select_worker(wid)
        return wid

    def pause_selected(self) -> bool:
        st = self.view_states[self.selected_worker_id]
        st.paused = not st.paused
        return st.paused

    def clear_selected(self) -> None:
        st = self.view_states[self.selected_worker_id]
        st.cleared = True
        st.rendered_count = 0

    def is_paused(self, worker_id: str) -> bool:
        return self.view_states[worker_id].paused

    def is_cleared(self, worker_id: str) -> bool:
        return self.view_states[worker_id].cleared

    def drawer_lines_from_buffer(
        self,
        buffer: ConsoleRingBuffer,
        worker_id: Optional[str] = None,
    ) -> list[str]:
        wid = worker_id or self.selected_worker_id
        entries = buffer.snapshot(last_n=DRAWER_VISIBLE_LINES)
        return [format_console_line(e) for e in entries if e["worker_id"] == wid]

    def popout_lines_from_buffer(self, buffer: ConsoleRingBuffer, worker_id: str) -> list[str]:
        entries = buffer.snapshot()
        return [format_console_line(e) for e in entries if e["worker_id"] == worker_id]

    def apply_pending_lines(
        self,
        worker_id: str,
        pending: list[ConsoleLineEntry],
        current_text_lines: list[str],
        *,
        max_visible: int = DRAWER_VISIBLE_LINES,
    ) -> tuple[list[str], list[ConsoleLineEntry], bool]:
        """Return updated lines, consumed pending tail, and whether view changed."""
        st = self.view_states[worker_id]
        if st.paused or not pending:
            return current_text_lines, [], False

        consumed: list[ConsoleLineEntry] = []
        new_lines = list(current_text_lines)
        changed = False
        for entry in pending:
            if entry["worker_id"] != worker_id:
                continue
            consumed.append(entry)
            if st.cleared:
                st.cleared = False
                new_lines = []
            new_lines.append(format_console_line(entry))
            changed = True
        if len(new_lines) > max_visible:
            new_lines = new_lines[-max_visible:]
        if changed:
            st.rendered_count = len(new_lines)
        return new_lines, consumed, changed

    def refill_after_clear_or_select(
        self,
        buffer: ConsoleRingBuffer,
        worker_id: str,
    ) -> list[str]:
        st = self.view_states[worker_id]
        st.cleared = False
        lines = self.drawer_lines_from_buffer(buffer, worker_id)
        st.rendered_count = len(lines)
        return lines


def drain_gui_pending(
    pending: list[ConsoleLineEntry],
    lock,
    worker_filter: Optional[Callable[[ConsoleLineEntry], bool]] = None,
) -> list[ConsoleLineEntry]:
    with lock:
        if not pending:
            return []
        if worker_filter is None:
            out = list(pending)
            pending.clear()
            return out
        kept: list[ConsoleLineEntry] = []
        out: list[ConsoleLineEntry] = []
        for entry in pending:
            if worker_filter(entry):
                out.append(entry)
            else:
                kept.append(entry)
        pending[:] = kept
        return out

# Created and developed by Jai Singh
