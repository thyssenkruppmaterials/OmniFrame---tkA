---
tags: [type/implementation, status/active, domain/agent, domain/frontend]
created: 2026-05-21
---
# Improve Tile Layout And Per-Bay Start/Stop

## Purpose / Context

Operators could not read the Phase B tile action row (`[Fix] [R] [Rst] [C]`) and had no per-bay Start/Stop — only global Start All / Stop All. This pass implements Plan Section 4 GUI polish: full-word labels, a 3×2 action grid, per-worker spawn/stop, and a pure disabled-state matrix testable without Tk.

## Details

### Tile layout (`omni_agent/master/tile.py`)

- **Top zone:** bold 14pt worker label, status pill, optional ADOPTED badge, compact info grid (System / Session / Heartbeat / Job / Last error).
- Last error hidden when empty or `--`; non-empty errors use `theme.PILL_DISCONNECTED`.
- **Bottom zone:** 3×2 `grid` button toolbar (~32px height, `sticky="ew"`, column weight 1):
  - Row 1: Fix | Start | Stop
  - Row 2: Restart | Reassign | Console
- `theme.TILE_MIN_HEIGHT = 350` + `grid_propagate(False)` so six workers fit in 1280×800 without tile scrollbars.

### Action keys (`master_gui._on_tile_action`)

| Label | Key |
|-------|-----|
| Fix | `fix` |
| Start | `start` |
| Stop | `stop` |
| Restart | `restart` |
| Reassign | `reassign` |
| Console | `console` |

### Disabled-state matrix (`state.compute_button_state`)

Pure helper alongside `is_running()` (`process_alive or is_adopted`):

- **Stopped:** Start + Fix on; others off.
- **Running** (connecting / connected / disconnected / degraded): Stop, Restart, Reassign, Fix on; Start off; Console on when `console_available` and not adopted.
- **Adopted:** same as running but Console off (Phase F — no live pipes).

### Supervisor

- `WorkerSupervisor.start_worker(worker_id)` — wraps `spawn_worker` when not `is_alive()`.
- `stop_worker(worker_id)` already existed; tile/menu Stop routes through `_on_tile_action("stop")`.

### Context menu (`tile_context_menu.py`)

Aligned labels: **Start**, **Reassign Session**, **Restart**, **Stop** (plus existing rename / auto-start entries).

### Tests

- `test_tile_button_state.py` — matrix cases without Tk.
- `test_supervisor_spawn.py` — `start_worker` spawn/no-op.
- `test_phase_g_packaging_static.py` — `__main__` import check compares modules loaded *during* exec, not suite pollution.

## Related

- [[Plan-Multi-Session-Agent-Master]]
- [[Implement-Phase-B-Master-GUI-Skeleton]]
- [[Implement-Phase-D-Fix-State-Machine]]
- [[Implement-Phase-F-Persistence-Orphan-Adoption]]
- [[Implement-Phase-C-Console-Streaming]]
