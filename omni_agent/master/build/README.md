# OmniFrame Agent Master — build, verify, ship

Phase G packaging for [[Plan-Multi-Session-Agent-Master]] Section 9. Produces **two** PyInstaller one-file executables from one `build_exe.bat` run on Windows (Parallels / bare metal). **Do not run PyInstaller on macOS** — this folder is operator documentation and smoke-check scripts only.

## Prerequisites

- Windows 10/11 with Python **3.10+** on `PATH`
- SAP GUI not required for build; required on the target host for `--probe-only` / wizard
- From `omni_agent/`:

```powershell
pip install -r requirements.txt
```

**Pin wheels for reproducible builds** (recommended after a green build):

```powershell
pip freeze > master\build\requirements-build.lock
```

Commit the lock file reference in [[Implement-Phase-G-Packaging-DualExe]] — not the lock itself if it contains machine-specific paths.

## Build (Windows)

```powershell
cd <path-to>\omni_agent
rmdir /s /q build dist 2>nul
build_exe.bat
```

### `dist/` layout after success

| Artifact | Purpose |
|----------|---------|
| `OmniFrame_Agent.exe` | Legacy headless worker (unchanged flow) |
| `OmniFrame_Agent.exe.sha256` | Operator hash verify (certutil format) |
| `OmniFrame_Agent.bat` | Citrix launcher — pins `TEMP/TMP` to `_omniframe_tmp\` next to the worker `.exe`. Source of truth: `omni_agent/launchers/OmniFrame_Agent.bat` |
| `OmniFrame_AgentMaster.exe` | CustomTkinter supervisor (`--windowed`) |
| `OmniFrame_AgentMaster.exe.sha256` | Master hash sidecar |
| `OmniFrame_AgentMaster.bat` | Citrix launcher — **recommended double-click entry point** on non-persistent VDIs. Pins `TEMP/TMP` to `_omniframe_tmp\` next to the `.exe` so the PyInstaller onefile bootloader doesn't crash with *"Could not create temporary directory!"* when the per-session `%TEMP%` is locked down. Source: `omni_agent/launchers/OmniFrame_AgentMaster.bat`. See [[Fix-AgentMaster-Citrix-Temp-Directory]] |
| `OmniFrame_AgentMaster.zip` | Both EXEs + both `.bat` launchers + both sidecars + `master_icon.ico` |
| `agent_service_key.txt` | Optional — copied only if present in build folder (worker convenience; **never** upload with public zip) |

### Icon

`master_icon.ico` at `omni_agent/master_icon.ico` is passed to `--icon`. Current file is copied from `omni_agent_v2/crates/agent-gui/icons/icon.ico` (256×256 PNG-in-ICO). Replace with a production asset anytime — PyInstaller only needs a valid `.ico` at build time.

### CustomTkinter / PyInstaller

`build_exe.bat` passes `--collect-data customtkinter` so theme JSON ships inside `_MEIPASS`. `master_gui.py` uses the built-in theme name `dark-blue` (no custom JSON path). A runtime hook is **not** required today; if you add a custom theme file later, see `master/pyinstaller_runtime_hook.py` (optional) and pass `--runtime-hook master\pyinstaller_runtime_hook.py` on the PyInstaller line.

### Citrix non-persistent launcher .bat (required for VDIs)

PyInstaller's `--onefile` bootloader extracts a `_MEIxxxxxx` payload to `%TEMP%` at every launch. In Citrix non-persistent environments that path is often locked down, redirected, or wiped mid-session — the AgentMaster surfaces this as a Win32 dialog reading **"Could not create temporary directory!"** and the worker silently exits.

The fix is the `.bat` launchers in `omni_agent/launchers/`. Each one sets `TEMP` and `TMP` to a `_omniframe_tmp` folder **next to itself** before running the matching `.exe`, so the bootloader's `GetTempPathW` resolves to a guaranteed-writable directory inside the operator's deploy folder. Subprocesses spawned by the AgentMaster (the workers) inherit that environment, so the entire process tree extracts into the same persistent folder.

| Launcher | Use case |
|----------|----------|
| `OmniFrame_AgentMaster.bat` | Primary GUI entry — recommended for all Citrix double-clicks |
| `OmniFrame_Connect.bat` | Connect bundle entry — same rationale, `--windowed` |
| `OmniFrame_Agent.bat` | Worker run standalone (diagnostics); inline `cmd` window doubles as live log |

Do **not** add `--runtime-tmpdir` to the PyInstaller line. That static flag would make the bootloader ignore `TEMP/TMP` env vars and break the launcher pattern. See [[Fix-AgentMaster-Citrix-Temp-Directory]] for the full root-cause analysis.

### CLI flags (smoke / automation)

Run **before** any GUI window opens:

| Flag | Behavior |
|------|----------|
| `--version` | Prints `AGENT_VERSION=2.1.0` and eight `capability=` lines (Phase A worker caps the master expects), exit 0 |
| `--probe-only` | Prints JSON from `probe_sap_sessions()`, exit 0 |

```powershell
dist\OmniFrame_AgentMaster.exe --version
dist\OmniFrame_AgentMaster.exe --probe-only
```

## Post-build smoke check

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File master\build\smoke_check_master_exe.ps1
```

Validates: EXE exists, SHA-256 sidecar matches `certutil -hashfile`, `--version` output contains `AGENT_VERSION=2.1.0` and all eight capability ids.

## Hash verify (operator)

```powershell
certutil -hashfile dist\OmniFrame_AgentMaster.exe SHA256
type dist\OmniFrame_AgentMaster.exe.sha256
```

First token on the sidecar line must match the certutil hash (case-insensitive).

## Manual upload — Supabase Storage `downloads/`

**Do not commit binaries to git.** Upload from your workstation after build + smoke PASS.

Public base: `https://wncpqxwmbxjgxvrpcake.supabase.co/storage/v1/object/public/downloads/`

### 1. Temporarily allow anon INSERT (Supabase SQL editor or MCP)

```sql
CREATE POLICY "Temp anon upload downloads"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'downloads');
```

### 2. Upload zip (upsert)

```bash
curl -X POST \
  "https://wncpqxwmbxjgxvrpcake.supabase.co/storage/v1/object/downloads/OmniFrame_AgentMaster.zip" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/zip" \
  -H "x-upsert: true" \
  --data-binary "@dist/OmniFrame_AgentMaster.zip"
```

Optional: also refresh the legacy single-agent artifact if the worker EXE changed:

```bash
# Worker-only zip (legacy operators)
powershell -Command "Compress-Archive -Path dist\OmniFrame_Agent.exe,dist\OmniFrame_Agent.exe.sha256 -DestinationPath dist\OmniFrame_Agent.zip -Force"

curl -X POST \
  "https://wncpqxwmbxjgxvrpcake.supabase.co/storage/v1/object/downloads/OmniFrame_Agent.zip" \
  ...
```

### 3. Drop temp policy

```sql
DROP POLICY "Temp anon upload downloads" ON storage.objects;
```

### 4. Verify download

```powershell
curl -o OmniFrame_AgentMaster.zip "https://wncpqxwmbxjgxvrpcake.supabase.co/storage/v1/object/public/downloads/OmniFrame_AgentMaster.zip"
certutil -hashfile OmniFrame_AgentMaster.zip SHA256
```

Compare against a hash you recorded at upload time. Extract and re-run smoke check on the extracted `OmniFrame_AgentMaster.exe`.

## Rollback

1. Keep the previous `OmniFrame_Agent.zip` / `OmniFrame_AgentMaster.zip` in a dated backup folder before upsert.
2. Re-upload the backup with `x-upsert: true` (same curl pattern).
3. Confirm public URL serves the old byte size + hash.
4. Operators on Citrix can continue with **worker-only** `OmniFrame_Agent.exe` — the master EXE is optional; legacy single-session flow is unchanged.

## Known gaps

| Gap | Notes |
|-----|-------|
| **`agent_id` on `/health`** | Worker `/health` may not yet expose `agent_id` for orphan adoption matching (Phase A.1 follow-up). Master adoption uses port + health body heuristics today. |
| **Code signing** | No Authenticode signature — SmartScreen / CASB may still prompt. Plan Section 11 R2. |
| **Auto-update** | No manifest poll; operators re-download manually. |
| **`agent_service_key.txt` in dist** | Build-folder convenience only — never publish beside a shared zip ([[Implement-Phase10-Service-Key-First-Rollout]]). |

## Related

- [[Implement-Omni-Agent]] — original single-EXE distribution
- [[Implement-Phase10-Service-Key-First-Rollout]] — service-key runbook
- [[Fix-Agent-Distribution-Issues]] — CASB / zip / hash pitfalls
- [[Plan-Multi-Session-Agent-Master]] — Section 9–10
