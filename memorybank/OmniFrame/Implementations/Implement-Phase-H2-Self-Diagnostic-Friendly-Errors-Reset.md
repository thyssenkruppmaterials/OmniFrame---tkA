---
tags: [type/implementation, status/active, domain/agent, domain/frontend]
created: 2026-05-21
---

# Implement — Phase H.2 OmniFrame Connect Self-Diagnostic + Friendly Errors + Reset

End-user friendliness layer on [[Implement-Phase-H1-Connect-MVP]]. Warn-only launch diagnostics, plain-English error modals (no tracebacks), in-widget Reset orchestration, Open Logs menu, and one-shot SAP session label from `/sap/sessions`.

## Package layout (additive)

```
omni_agent/connect/
├── diagnostic.py       # run_self_diagnostic + 24h first-run modal gate
├── dialogs.py          # build_friendly_copy + CTk modals + resolve_log_dir
├── error_handler.py      # sys.excepthook → classify_exception → show_friendly_error
├── system_label.py       # fetch_system_label + parse_label (5 min cache TTL)
├── connect_gui.py        # Reset / Open Logs menu, launch diagnostic, error hook install
├── supervisor.py         # _system_label_cache refresh on first green transition
├── state.py              # format_health_subtitle(state, cache)
└── cli.py                # run_reset() → structured result dict
```

## Self-diagnostic (warn-only)

`run_self_diagnostic(probe_url, web_url)` checks:

| Check | Pass | Fail id |
|-------|------|---------|
| Port 8765 free | socket connect fails | `port_blocked` (critical) |
| SAP GUI scripting | win32com Dispatch OK | `sap_not_running` / `sap_scripting_disabled` |
| Web app | httpx 2xx | `web_unreachable` |

- **Never blocks spawn** — supervisor always starts worker.
- Modal gate persisted at `%USERPROFILE%\.omniframe\connect_diagnostic_state.json`.
- Show dismissible "Heads up" modal once per failure episode; suppress after 24 h → widget subtitle hint (e.g. "Open SAP to connect").
- `sap_unavailable_dev_host` ignored on macOS/Linux dev hosts.

## Friendly errors

`error_handler.install(root)` registers `sys.excepthook`. `classify_exception(exc)` maps to `error_kind`; GUI surfaces via `dialogs.show_friendly_error` only.

Copy table lives in `dialogs.FRIENDLY_COPY`. `test_dialogs_pure_copy.py::test_no_python_jargon` hard-gates: no Exception/Traceback/port/127.0.0.1/8765/etc.

`update_available` modal wired with `# TODO(H.4): trigger self-update install` stub.

## Reset orchestration

Menu: Pause → Restart → **Reset** → Open Logs → Quit.

```
1. supervisor.pause()
2. cli.run_reset()          # deletes connect_widget_pos.json + worker config.json
3. supervisor.restart()
4. show_info_modal("Reset complete", …)
```

Pure helper `compute_reset_steps()` for tests.

## System label on first green

`WatchdogSupervisor._maybe_refresh_system_label`: on first transition to `CONNECTED`, one `GET /sap/sessions` (3 s, optional `X-Agent-Token`). Parses pinned session → `SystemLabelCache`. Re-fetch only when cache older than 5 min.

`format_health_subtitle(state, cache)` → `<user> · <system> · <transaction>`.

## Tests

```bash
python3 -m pytest omni_agent/connect/tests/ omni_agent/master/tests/ -q
```

New: `test_diagnostic_helpers`, `test_dialogs_pure_copy`, `test_error_handler_mapping`, `test_system_label_parsing`, `test_connect_gui_reset_flow_logic`, `test_first_run_diagnostic_gate`.

## Deferred (H.3 / H.4)

- H.3: drag position persist, off-screen guard, hover tooltip
- H.4: PyInstaller `OmniFrame_Connect.exe`, self-update install action

## Related

- [[Implement-Phase-H1-Connect-MVP]]
- [[Implement-Phase-D-Fix-State-Machine]] — friendly modal tone reference
- [[Plan-Multi-Session-Agent-Master]]
