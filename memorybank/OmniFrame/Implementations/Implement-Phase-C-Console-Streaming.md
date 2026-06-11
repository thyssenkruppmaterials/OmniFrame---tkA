---
tags: [type/implementation, status/active, domain/agent, domain/frontend, domain/infra]
created: 2026-05-21
---
# Implement Phase C — Console Streaming + Ring Buffer

Phase C of [[Plan-Multi-Session-Agent-Master]] replaces Phase B's `_drain_to_devnull` placeholder with a full console plane: per-worker ring buffers, live drawer, pop-out windows, on-disk rotation, and bounded memory under start/stop cycles.

## Purpose / Context

Operators need the last ~200 lines of each worker's stdout/stderr in the master GUI without opening log files or Task Manager. Phase B left a stub frame and dev-null drain threads; Phase D wired Fix/R/Rst while `[C]` still toasted "coming soon". Phase C delivers the console plane only — setup wizard (E), persistence/orphan adoption (F), and PyInstaller master EXE (G) remain deferred.

## Architecture

### Per-worker threads (on spawn)

| Thread | Role | Exit |
|---|---|---|
| `console-{id}-stdout` | Line-read `Popen.stdout` → ring + tail queue | EOF or stop event; `daemon=True` |
| `console-{id}-stderr` | Same for stderr | EOF or stop event; `daemon=True` |
| `console-fanout-{id}` | Drains tail queue → log queue + GUI pending list | stop event; `daemon=True` |
| `log-rotation-{id}` | Drains log queue → `log_dir/W<N>-YYYY-MM-DD.log` | stop event; `daemon=True` |

### Data structures

- **`ConsoleRingBuffer`** — `collections.deque(maxlen=console_ring_size)` default 10 000; thread-safe append/snapshot; `tail_drops` counter when tail queue is full.
- **`tail_queue`** — bounded `queue.Queue(maxsize=console_tail_queue_size)` default 2000; reader uses `put_nowait` (drops, never blocks).
- **`gui_pending`** — locked list fanned by fanout thread; Tk 50 ms tick drains only selected worker + open pop-outs.
- **Disk format** — `ISO8601 [stream] message` UTF-8; rotate at UTC midnight or file size > 10 MB; retention sweep on master start + each midnight roll via `master.log_retention_days` (default 7).
- **Pointer file** — `W<N>-current.txt` holds absolute path to today's log (symlinks avoided for Citrix/Windows ACL compatibility).

### GUI

- **`ConsoleDrawerWidget`** — bottom panel: worker selector, Pause/Clear/Pop out; shows last 200 lines from ring snapshot + live tail.
- **`ConsolePopOutWindow`** — full ring snapshot on open; live updates via same fanout pending drain until closed; multiple pop-outs allowed (one per worker).
- **Pause/Clear** — view-only; ring buffer and disk logging continue; re-select or un-pause refills last 200 from ring.
- **Tile `[C]`** — `master_gui.show_console_for(worker_id)` switches drawer selector.

### Supervisor lifecycle

`WorkerSupervisor.spawn_worker` → `_teardown_console` (if re-spawn) → `Popen` (unchanged Phase B encoding) → `WorkerConsoleResources.start_for_popen`.

`stop_worker` / `kill_and_respawn` / master `_on_close` → graceful/kill process → `_teardown_console` (set stop, join 2 s, replace registry entry for GC).

## Files

| File | Role |
|---|---|
| `console_buffer.py` | Ring buffer + line formatting |
| `console_reader.py` | Stream readers + fanout bridge |
| `log_rotation.py` | Daily/size rotation + retention |
| `console_drawer.py` | Pure drawer logic (testable without Tk) |
| `console_popout.py` | CTk drawer widget + pop-out toplevel |
| `supervisor.py` | Registry + spawn/teardown wiring |
| `master_gui.py` | Mount drawer, 50 ms tick, `[C]` handler |
| `config.py` | `console_ring_size`, `console_tail_queue_size`, `log_retention_days` |

## Tests

`omni_agent/master/tests/` — 112 passed, 2 skipped (admin token psutil, pre-existing):

- `test_console_buffer.py` — ring bounds, FIFO, thread safety, tail drops
- `test_console_reader.py` — stream tagging, EOF, queue full drops, daemon
- `test_log_rotation.py` — write, size roll, retention, pointer file
- `test_console_drawer_logic.py` — selector, pause/clear, last-200 slice (no Tk)
- `test_console_memory_50_cycles.py` — tracemalloc < 100 MB over 50 cycles (skips Python < 3.9)

## Seams for later phases

| Phase | Plugs into |
|---|---|
| **E — Setup wizard** | Same `master_config.yaml`; may surface `log_dir`, retention in Settings |
| **F — Persistence / orphan adoption** | Adopted workers have no `Popen` pipes — console stays empty until respawn; orphan PID kill unchanged |
| **G — Packaging** | `master_gui.py` entry; no new deps beyond Phase B |

## Related

- [[Plan-Multi-Session-Agent-Master]] — Sections 4, 8, 10 Phase C exit criteria
- [[Implement-Phase-B-Master-GUI-Skeleton]] — retired `_drain_to_devnull` + console stub
- [[Implement-Phase-D-Fix-State-Machine]] — Fix flow untouched; `[C]` rewired
- [[Implement-Phase-A-Worker-Hardening]] — worker `/health` probes unchanged
- [[Omni-Agent-System-Topology]] — fleet observability context
