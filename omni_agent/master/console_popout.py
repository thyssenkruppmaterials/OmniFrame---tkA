# Created and developed by Jai Singh
"""Detached console pop-out + drawer widget (Phase C)."""

from __future__ import annotations

from typing import Callable, Optional

import customtkinter as ctk

from omni_agent.master import theme
from omni_agent.master.console_buffer import ConsoleRingBuffer, format_console_line
from omni_agent.master.console_drawer import (
    DRAWER_VISIBLE_LINES,
    ConsoleDrawerLogic,
    drain_gui_pending,
)


class ConsolePopOutWindow:
    """Live-updating read-only console for one worker."""

    def __init__(
        self,
        root: ctk.CTk,
        worker_id: str,
        label: str,
        buffer: ConsoleRingBuffer,
        *,
        on_closed: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.worker_id = worker_id
        self._buffer = buffer
        self._on_closed = on_closed

        self.window = ctk.CTkToplevel(root)
        self.window.title(f"Console — {label}")
        self.window.geometry("900x480")
        self.window.configure(fg_color=theme.BG_WINDOW)
        self.window.protocol("WM_DELETE_WINDOW", self.close)

        mono = ctk.CTkFont(family="Consolas", size=11)
        self.textbox = ctk.CTkTextbox(
            self.window,
            font=mono,
            fg_color=theme.BG_TILE,
            text_color=theme.TEXT_PRIMARY,
            wrap="none",
        )
        self.textbox.pack(fill="both", expand=True, padx=8, pady=8)
        self.textbox.configure(state="disabled")

        self._load_full_snapshot()

    def _load_full_snapshot(self) -> None:
        lines = [
            format_console_line(e)
            for e in self._buffer.snapshot()
            if e["worker_id"] == self.worker_id
        ]
        self._set_text("\n".join(lines))

    def _set_text(self, text: str) -> None:
        self.textbox.configure(state="normal")
        self.textbox.delete("1.0", "end")
        if text:
            self.textbox.insert("1.0", text)
        self.textbox.configure(state="disabled")
        self.textbox.see("end")

    def append_live_lines(self, lines: list[str]) -> None:
        if not lines:
            return
        self.textbox.configure(state="normal")
        for line in lines:
            self.textbox.insert("end", line + "\n")
        self.textbox.configure(state="disabled")
        self.textbox.see("end")

    def close(self) -> None:
        if self._on_closed:
            self._on_closed(self.worker_id)
        self.window.destroy()


class ConsoleDrawerWidget(ctk.CTkFrame):
    """Bottom console drawer with selector, pause/clear/pop-out."""

    def __init__(
        self,
        master: ctk.CTk,
        logic: ConsoleDrawerLogic,
        get_buffer: Callable[[str], Optional[ConsoleRingBuffer]],
        get_gui_pending: Callable[[str], tuple[list, object]],
        *,
        on_popout: Callable[[str], None],
        height: int = 120,
        **kwargs,
    ) -> None:
        super().__init__(master, fg_color=theme.BG_TILE, height=height, **kwargs)
        self.grid_propagate(False)
        self._logic = logic
        self._get_buffer = get_buffer
        self._get_gui_pending = get_gui_pending
        self._on_popout = on_popout
        self._line_cache: dict[str, list[str]] = {
            wid: [] for wid in logic.worker_ids
        }

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        toolbar = ctk.CTkFrame(self, fg_color="transparent")
        toolbar.grid(row=0, column=0, sticky="ew", padx=8, pady=(6, 2))
        toolbar.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            toolbar,
            text="Console:",
            text_color=theme.TEXT_MUTED,
        ).grid(row=0, column=0, padx=(0, 8))

        self._selector = ctk.CTkOptionMenu(
            toolbar,
            values=logic.selector_options(),
            command=self._on_selector_changed,
            width=180,
        )
        self._selector.grid(row=0, column=0, columnspan=2, sticky="w", padx=(60, 0))
        default_label = logic.worker_labels.get(
            logic.selected_worker_id, logic.selected_worker_id
        )
        self._selector.set(default_label)

        btn_frame = ctk.CTkFrame(toolbar, fg_color="transparent")
        btn_frame.grid(row=0, column=2, sticky="e")

        self._pause_btn = ctk.CTkButton(
            btn_frame, text="Pause", width=72, command=self._toggle_pause
        )
        self._pause_btn.grid(row=0, column=0, padx=2)
        ctk.CTkButton(
            btn_frame, text="Clear", width=72, command=self._clear_view
        ).grid(row=0, column=1, padx=2)
        ctk.CTkButton(
            btn_frame, text="Pop out", width=80, command=self._pop_out
        ).grid(row=0, column=2, padx=2)

        mono = ctk.CTkFont(family="Consolas", size=11)
        self._textbox = ctk.CTkTextbox(
            self,
            height=height - 40,
            font=mono,
            fg_color=theme.BG_WINDOW,
            text_color=theme.TEXT_PRIMARY,
            wrap="none",
        )
        self._textbox.grid(row=1, column=0, sticky="nsew", padx=8, pady=(0, 8))
        self._textbox.configure(state="disabled")

        self._refresh_from_buffer(logic.selected_worker_id)

    def show_worker(self, worker_id: str) -> None:
        self._logic.select_worker(worker_id)
        label = self._logic.worker_labels.get(worker_id, worker_id)
        self._selector.set(label)
        self._update_pause_button()
        self._refresh_from_buffer(worker_id)

    def _on_selector_changed(self, label: str) -> None:
        wid = self._logic.select_by_label(label)
        if wid:
            self._update_pause_button()
            self._refresh_from_buffer(wid)

    def _toggle_pause(self) -> None:
        paused = self._logic.pause_selected()
        self._pause_btn.configure(text="Resume" if paused else "Pause")

    def _clear_view(self) -> None:
        wid = self._logic.selected_worker_id
        self._logic.clear_selected()
        self._line_cache[wid] = []
        self._set_textbox("")

    def _pop_out(self) -> None:
        self._on_popout(self._logic.selected_worker_id)

    def _update_pause_button(self) -> None:
        wid = self._logic.selected_worker_id
        paused = self._logic.is_paused(wid)
        self._pause_btn.configure(text="Resume" if paused else "Pause")

    def _refresh_from_buffer(self, worker_id: str) -> None:
        buf = self._get_buffer(worker_id)
        if buf is None:
            self._set_textbox("")
            return
        if self._logic.is_cleared(worker_id):
            self._set_textbox("")
            return
        lines = self._logic.refill_after_clear_or_select(buf, worker_id)
        self._line_cache[worker_id] = lines
        self._set_textbox("\n".join(lines))

    def _set_textbox(self, text: str) -> None:
        self._textbox.configure(state="normal")
        self._textbox.delete("1.0", "end")
        if text:
            self._textbox.insert("1.0", text)
        self._textbox.configure(state="disabled")
        self._textbox.see("end")

    def tick(self, open_popouts: dict[str, ConsolePopOutWindow]) -> None:
        """50ms drainer — selected worker + open pop-outs only."""
        selected = self._logic.selected_worker_id
        targets = {selected}
        targets.update(open_popouts.keys())

        for wid in targets:
            pending_list, lock = self._get_gui_pending(wid)
            batch = drain_gui_pending(
                pending_list,
                lock,
                worker_filter=lambda e, w=wid: e["worker_id"] == w,
            )
            if not batch:
                continue
            formatted = [
                format_console_line(e) for e in batch if e["worker_id"] == wid
            ]
            if wid == selected and not self._logic.is_paused(wid):
                current = self._line_cache.get(wid, [])
                if self._logic.is_cleared(wid):
                    current = []
                    self._logic.view_states[wid].cleared = False
                current.extend(formatted)
                if len(current) > DRAWER_VISIBLE_LINES:
                    current = current[-DRAWER_VISIBLE_LINES:]
                self._line_cache[wid] = current
                self._set_textbox("\n".join(current))

            pop = open_popouts.get(wid)
            if pop is not None:
                try:
                    if pop.window.winfo_exists():
                        pop.append_live_lines(formatted)
                except Exception:
                    pass

# Created and developed by Jai Singh
