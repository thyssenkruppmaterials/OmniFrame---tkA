---
tags: [type/implementation, status/active, domain/agent]
created: 2026-05-21
---
# Implement — Phase D5 Master GUI Integration

## Purpose / Context

Phase D5 wires D1 (`fix_engine`), D2 (`admin_client` + HTTP executors), and D4 (`dialogs`) into the Phase B master shell. Unblocks operator one-click Fix, SAP mass-detach banner, and mode-H network diagnostic from tile buttons.

## Details

### `master_gui.py`
- `FixActionDispatcher` + `MasterFixContext` per UI tick
- SAP restart banner via `detect_sap_restart_banner` (≥2 running workers, all `sap_attached=false`, ≥2 detach transitions in 5s)
- `ws_down_seconds` / `ws_down_since` tracked on probe patches + 1s tick
- Tile actions: Fix → decision tree; R → reassign bypass; Rst → kill+respawn; C → Phase C toast
- Banner active suppresses SAP reattach/reassign with soft toast

### `supervisor.py`
- `respawn`, `kill_and_respawn`
- `OMNIFRAME_AGENT_ADMIN_TOKEN` via `load_or_create_master_admin_token()`

### `tile.py`
- `last_health_snapshot: HealthSnapshot`
- `on_action(action_name, worker_id)` callback

### `fix_actions.py`
- `FixActionDispatcher` class (uses D2 `AdminClient` + D4 `MasterDialogs` facade)

### `dialogs.py`
- `MasterDialogs` facade wrapping D4 CTk dialog classes

### Tests
- `test_sap_banner_mass_fail.py` — banner + `all_workers_ws_down` pure functions
- Full suite: `omni_agent/master/tests/` — **87 passed, 2 skipped** (2026-05-21)

## Related
- [[Plan-Multi-Session-Agent-Master]]
- [[Implement-Phase-B-Master-GUI-Skeleton]]
- [[Implement-Phase-D1-Fix-Engine]]
- [[Implement-Phase-D3-Network-Diagnostic]]
