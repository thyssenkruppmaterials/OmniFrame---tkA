# Created and developed by Jai Singh
"""Line-read worker stdout/stderr into ring buffer + tail queue (Phase C)."""

from __future__ import annotations

import logging
import queue
import threading
from datetime import datetime, timezone
from typing import IO, Callable, Optional

from omni_agent.master.console_buffer import ConsoleLineEntry, ConsoleRingBuffer

LOG = logging.getLogger("omniframe.master.console_reader")

MIN_TAIL_QUEUE_SIZE = 100
MAX_TAIL_QUEUE_SIZE = 10_000
DEFAULT_TAIL_QUEUE_SIZE = 2000


def utc_iso_ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def read_stream_loop(
    worker_id: str,
    stream: IO[str],
    stream_name: str,
    buffer: ConsoleRingBuffer,
    tail_queue: queue.Queue[ConsoleLineEntry],
    stop_event: threading.Event,
) -> None:
    """Daemon reader: line-read ``stream`` until EOF or ``stop_event``."""
    try:
        while not stop_event.is_set():
            line = stream.readline()
            if line == "":
                break
            entry: ConsoleLineEntry = {
                "ts": utc_iso_ts(),
                "stream": stream_name,
                "worker_id": worker_id,
                "line": line.rstrip("\n\r"),
            }
            buffer.append(entry)
            try:
                tail_queue.put_nowait(entry)
            except queue.Full:
                buffer.record_tail_drop()
    except Exception:
        LOG.debug(
            "Console reader %s/%s exited",
            worker_id,
            stream_name,
            exc_info=True,
        )
    finally:
        try:
            stream.close()
        except Exception:
            pass


def spawn_stream_reader(
    worker_id: str,
    stream: Optional[IO[str]],
    stream_name: str,
    buffer: ConsoleRingBuffer,
    tail_queue: queue.Queue[ConsoleLineEntry],
    stop_event: threading.Event,
) -> Optional[threading.Thread]:
    if stream is None:
        return None
    thread = threading.Thread(
        target=read_stream_loop,
        args=(worker_id, stream, stream_name, buffer, tail_queue, stop_event),
        name=f"console-{worker_id}-{stream_name}",
        daemon=True,
    )
    thread.start()
    return thread


def fanout_tail_loop(
    tail_queue: queue.Queue[ConsoleLineEntry],
    log_queue: queue.Queue[ConsoleLineEntry],
    gui_pending: list[ConsoleLineEntry],
    gui_lock: threading.Lock,
    stop_event: threading.Event,
    *,
    gui_pending_max: int = 500,
) -> None:
    """Bridge reader tail queue → log rotation queue + GUI pending list."""
    while not stop_event.is_set():
        try:
            entry = tail_queue.get(timeout=0.2)
        except queue.Empty:
            continue
        try:
            log_queue.put_nowait(entry)
        except queue.Full:
            pass
        with gui_lock:
            gui_pending.append(entry)
            overflow = len(gui_pending) - gui_pending_max
            if overflow > 0:
                del gui_pending[:overflow]


def spawn_fanout_thread(
    worker_id: str,
    tail_queue: queue.Queue[ConsoleLineEntry],
    log_queue: queue.Queue[ConsoleLineEntry],
    gui_pending: list[ConsoleLineEntry],
    gui_lock: threading.Lock,
    stop_event: threading.Event,
) -> threading.Thread:
    thread = threading.Thread(
        target=fanout_tail_loop,
        args=(tail_queue, log_queue, gui_pending, gui_lock, stop_event),
        name=f"console-fanout-{worker_id}",
        daemon=True,
    )
    thread.start()
    return thread


def clamp_tail_queue_size(value: int) -> int:
    return max(MIN_TAIL_QUEUE_SIZE, min(MAX_TAIL_QUEUE_SIZE, int(value)))

# Created and developed by Jai Singh
