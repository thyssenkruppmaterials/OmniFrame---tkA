# Created and developed by Jai Singh
"""On-disk log rotation for per-worker console streams (Phase C)."""

from __future__ import annotations

import logging
import queue
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from omni_agent.master.console_buffer import ConsoleLineEntry, format_console_line

LOG = logging.getLogger("omniframe.master.log_rotation")

MAX_FILE_BYTES = 10 * 1024 * 1024
DATE_FMT = "%Y-%m-%d"
WORKER_NUM_RE = re.compile(r"-W(\d+)$", re.IGNORECASE)


def worker_log_prefix(worker_id: str) -> str:
    m = WORKER_NUM_RE.search(worker_id)
    if m:
        return f"W{m.group(1)}"
    safe = re.sub(r"[^\w\-]", "_", worker_id)
    return safe


def log_filename(prefix: str, day: str) -> str:
    return f"{prefix}-{day}.log"


def current_pointer_path(log_dir: Path, prefix: str) -> Path:
    return log_dir / f"{prefix}-current.txt"


def write_current_pointer(log_dir: Path, prefix: str, target: Path) -> None:
    """Windows-safe pointer (symlinks often blocked on Citrix)."""
    ptr = current_pointer_path(log_dir, prefix)
    ptr.write_text(str(target.resolve()), encoding="utf-8")


def sweep_old_logs(log_dir: Path, prefix: str, retention_days: int) -> None:
    if retention_days <= 0:
        return
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    pattern = f"{prefix}-*.log"
    for path in log_dir.glob(pattern):
        try:
            stem = path.stem  # W1-2026-05-21
            day_part = stem.rsplit("-", 3)[-3:]
            if len(day_part) != 3:
                continue
            day_str = "-".join(day_part)
            file_day = datetime.strptime(day_str, DATE_FMT).replace(tzinfo=timezone.utc)
            if file_day < cutoff:
                path.unlink(missing_ok=True)
        except (ValueError, OSError):
            continue


def rotation_loop(
    worker_id: str,
    log_dir: Path,
    log_queue: queue.Queue[ConsoleLineEntry],
    stop_event: threading.Event,
    *,
    retention_days: int = 7,
) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    prefix = worker_log_prefix(worker_id)
    sweep_old_logs(log_dir, prefix, retention_days)

    current_day = datetime.now(timezone.utc).strftime(DATE_FMT)
    current_path = log_dir / log_filename(prefix, current_day)
    current_path.parent.mkdir(parents=True, exist_ok=True)
    fh = current_path.open("a", encoding="utf-8")
    write_current_pointer(log_dir, prefix, current_path)
    fh.write(
        f"# OmniFrame Agent Master log — worker {worker_id} — {current_day}\n"
    )
    fh.flush()
    bytes_written = current_path.stat().st_size

    def _rotate_if_needed(now: datetime) -> None:
        nonlocal current_day, current_path, fh, bytes_written
        day = now.strftime(DATE_FMT)
        size_rotate = bytes_written >= MAX_FILE_BYTES
        day_rotate = day != current_day
        if not size_rotate and not day_rotate:
            return
        try:
            fh.close()
        except Exception:
            pass
        current_day = day
        current_path = log_dir / log_filename(prefix, current_day)
        fh = current_path.open("a", encoding="utf-8")
        write_current_pointer(log_dir, prefix, current_path)
        fh.write(
            f"# OmniFrame Agent Master log — worker {worker_id} — {current_day}\n"
        )
        fh.flush()
        bytes_written = current_path.stat().st_size
        if day_rotate:
            sweep_old_logs(log_dir, prefix, retention_days)

    while not stop_event.is_set():
        try:
            entry = log_queue.get(timeout=0.5)
        except queue.Empty:
            _rotate_if_needed(datetime.now(timezone.utc))
            continue
        line = format_console_line(entry) + "\n"
        encoded = line.encode("utf-8")
        fh.write(line)
        fh.flush()
        bytes_written += len(encoded)
        _rotate_if_needed(datetime.now(timezone.utc))

    # Drain remaining lines before exit
    while True:
        try:
            entry = log_queue.get_nowait()
        except queue.Empty:
            break
        line = format_console_line(entry) + "\n"
        fh.write(line)
    try:
        fh.flush()
        fh.close()
    except Exception:
        pass


def spawn_rotation_thread(
    worker_id: str,
    log_dir: Path,
    log_queue: queue.Queue[ConsoleLineEntry],
    stop_event: threading.Event,
    *,
    retention_days: int = 7,
) -> threading.Thread:
    thread = threading.Thread(
        target=rotation_loop,
        args=(worker_id, log_dir, log_queue, stop_event),
        kwargs={"retention_days": retention_days},
        name=f"log-rotation-{worker_id}",
        daemon=True,
    )
    thread.start()
    return thread

# Created and developed by Jai Singh
