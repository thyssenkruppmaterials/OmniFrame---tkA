---
tags: [type/implementation, status/active, domain/agent, domain/frontend]
created: 2026-05-21
---
# Implement Phase F3 Settings Context Menu

## Purpose / Context
Phase F3 delivers the CTk Settings modal and tile right-click menu UI. Pure logic is testable without Tk; F4 wires both into `master_gui.py`.

## Details

### `settings_dialog.py`
- `MasterSettingsDialog` — modal editor for `master_config.yaml`.
- **Master globals:** workers 1–12, `ui_refresh_ms`, `health_probe_interval_ms`, `parallel_spawn_concurrency`, `fix_admin_confirm_required`, `log_retention_days`, SAP Logon / Agent.exe browse.
- **Per-worker rows:** read-only id; editable label, ports, SAP indices, auto_start, `extra_env` JSON textarea.
- **Workers decrease:** Keep keys vs Delete keys → `master.workers_decrement_policy` (via F1 `cleanup_removed_worker_keys`).
- **Save:** restart-required warning panel + auto-restart checkbox when F1 `detect_restart_required` returns fields.
- **Strict service key:** read-only notice + tooltip (`OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1` cannot be lowered).
- Delegates validation/diffing to [[settings_logic]] (Phase F1).

### `tile_context_menu.py`
- `ContextMenuCommand` enum: `RENAME_LABEL`, `TOGGLE_AUTO_START`, `REPAIR_SESSION`, `RESTART`, `STOP`.
- `commands_for_state(...)` — enable/disable per worker snapshot.
- `apply_rename_label` / `apply_toggle_auto_start` — persist via `write_master_config`.
- `mount_context_menu(root, tile, callbacks)` — Tk `Menu` on `<Button-3>`.

### Tests
- `test_tile_context_menu_logic.py` — 10 pure-logic tests (no Tk root).

## Related
- [[Implement-Phase-E-Setup-Wizard]]
- [[Implement-Phase-F2-Orphan-Adoption]]
- [[Plan-Multi-Session-Agent-Master]]
