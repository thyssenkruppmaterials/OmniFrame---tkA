---
tags: [type/implementation, status/active, domain/agent, domain/frontend, domain/infra]
created: 2026-05-21
---

# Implement — Phase H.4 OmniFrame Connect Self-Update + Packaging

Final Connect edition slice: SHA-256–verified self-update (manifest poll + in-place EXE swap via `--replace-helper`) and a third PyInstaller target (`OmniFrame_Connect.exe`) bundled with the worker in `OmniFrame_Connect.zip`.

## Package layout (additive)

```
omni_agent/connect/
├── manifest.py           # fetch_manifest / parse_manifest / is_update_available
├── update_state.py       # connect_update_state.json + 24h should_check
├── self_update.py        # download, verify, supervisor shutdown, spawn helper
├── self_replace.py       # --replace-helper os.replace + relaunch
├── connect_gui.py        # launch poll, Updating… pill, modal wiring
├── dialogs.py            # show_update_available_modal (Install / Remind me later)
├── cli.py                # --check-update / --apply-update / --replace-helper
└── build/
    ├── README.md           # operator runbook (build → upload → manifest)
    ├── OmniFrame_Connect.spec
    └── smoke_check_connect_exe.ps1
```

## Self-update flow (v0.1.0)

1. On launch + every 24 h: background manifest fetch.
2. If `channels.stable.version` > installed and not dismissed → `show_update_available_modal`.
3. Install: stream download → SHA-256 verify → `supervisor.shutdown_connect()` → spawn same EXE with `--replace-helper` → exit.
4. Helper waits ≤5 s, `os.replace`, relaunches Connect.

Trust model: manifest `exe_sha256` only — no Authenticode, no ed25519 (documented gap).

## Packaging

`build_exe.bat` Phase H.4 block (after Phase G):

- Robocopy `connect/` → `omni_agent/connect/` during workspace sync.
- PyInstaller `--onefile --windowed --name OmniFrame_Connect` with CTk hidden imports + `--icon master_icon.ico`.
- SHA-256 sidecar + `OmniFrame_Connect.zip` (Connect EXE + worker EXE + sidecars + icon + README.txt).

Worker + master builds unchanged; `OmniFrame_AgentMaster.zip` still produced.

## Tests

```bash
python3 -m pytest omni_agent/connect/tests/ omni_agent/master/tests/ -q
```

296 passed, 1 skipped (2026-05-21).

## Related

- [[Implement-Phase-H1-Connect-MVP]]
- [[Implement-Phase-H2-Self-Diagnostic-Friendly-Errors-Reset]]
- [[Implement-Phase-H3-Connect-Widget-Polish]]
- [[Implement-Phase-G-Packaging-DualExe]]
- [[Implement-Omni-Agent]]
- [[Omni-Agent - Headless SAP Agent]]
