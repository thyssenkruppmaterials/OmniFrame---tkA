---
tags: [type/implementation, status/active, domain/agent, domain/frontend]
created: 2026-05-21
---

# Implement — Phase H.1 OmniFrame Connect MVP

End-user edition: a single always-on-top floating widget supervises one
`OmniFrame_Agent.exe` on port 8765 (legacy soft-fallback mode). Mirrors
master supervisor patterns simplified to one worker — no console drawer, no
system tray, no auto-launch.

## Package layout

```
omni_agent/connect/
├── __main__.py          # PyInstaller entry; CLI before Tk
├── cli.py               # --version, --reset
├── capabilities.py      # CONNECT_VERSION=0.1.0
├── connect_gui.py       # CTk frameless widget
├── theme.py             # re-exports master palette
├── state.py             # ConnectState + pure pill/breaker helpers
├── supervisor.py        # WatchdogSupervisor
├── probe.py             # /health loop (5 s, 3-fail respawn)
├── child_kill.py        # Job Object + psutil kill tree
├── logging_setup.py     # %USERPROFILE%\.omniframe\connect.log (daily rotate)
└── tests/               # 21 pytest cases (pure helpers + mocked supervisor)
```

## Worker spawn (soft-fallback)

- `PYTHONIOENCODING=utf-8:replace`
- `OMNIFRAME_AGENT_PORT=8765`
- **No** `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY`, `SELF_ID_OVERRIDE`, SAP index overrides
- Windows: `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP`
- Stdout/stderr → PIPE, drained to connect.log

## Watchdog

- `httpx.get http://127.0.0.1:8765/health` every 5 s (daemon thread)
- 3 consecutive failures → kill descendants + respawn
- 5 respawns / 60 s → circuit breaker (`Reset needed`, Restart clears)

## Clean shutdown invariant

On Quit / WM_DELETE_WINDOW / SIGTERM:

1. Stop probe loop
2. POST `/shutdown` (2 s timeout)
3. 3 s grace → `kill_descendants` (Job Object close on Windows, psutil fallback)
4. Audit no surviving `OmniFrame_Agent.exe`
5. Destroy widget

## Deferred (H.2 / H.3 / H.4)

- H.2: self-diagnostic, friendly errors, Reset CTA, Open Logs
- H.3: drag-position persist (`connect_widget_pos.json`), off-screen guard
- H.4: PyInstaller `OmniFrame_Connect.exe`, self-update
- TODO in `parse_health_subtitle`: real SAP system name from `/sap/sessions`

## Tests

```bash
python3 -m pytest omni_agent/connect/tests/ -q
```

21 passed, 1 skipped (Windows-only creationflags bit check on macOS).

## Related

- [[Plan-Multi-Session-Agent-Master]]
- [[Implement-Phase-B-Master-GUI-Skeleton]]
- [[Implement-Phase-D-Fix-State-Machine]]
- [[Implement-Phase-F-Persistence-Orphan-Adoption]]
- [[Implement-Phase-G-Packaging-DualExe]]
- [[Omni-Agent-System-Topology]]
