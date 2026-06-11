# OmniFrame Connect — build, verify, ship

Phase H.4 packaging for the end-user Connect edition. Produces **`OmniFrame_Connect.exe`** plus **`OmniFrame_Connect.zip`** (Connect + worker + sidecars) from one `build_exe.bat` run on Windows. **Do not run PyInstaller on macOS** — this folder is operator documentation and smoke-check scripts only.

## Prerequisites

- Windows 10/11 with Python **3.10+** on `PATH`
- From `omni_agent/`:

```powershell
pip install -r requirements.txt
```

## Build (Windows)

```powershell
cd <path-to>\omni_agent
rmdir /s /q build dist 2>nul
build_exe.bat
```

### `dist/` layout after success

| Artifact | Purpose |
|----------|---------|
| `OmniFrame_Connect.exe` | End-user CustomTkinter widget (`--windowed`) |
| `OmniFrame_Connect.exe.sha256` | Operator hash verify |
| `OmniFrame_Connect.zip` | Connect EXE + worker EXE + sidecars + icon + README |
| `OmniFrame_Agent.exe` | Bundled worker (unchanged build) |
| `OmniFrame_AgentMaster.exe` | Master edition (unchanged) |
| `OmniFrame_AgentMaster.zip` | Master + worker bundle (unchanged) |

**No** `agent_service_key.txt` is bundled in the Connect zip — Connect uses legacy soft-fallback worker mode only.

### Multi-monitor note (v0.1.0)

Widget position restore uses optional `screeninfo` when installed; otherwise primary-monitor fallback via Tk screen dimensions. Multi-monitor edge cases may snap to bottom-right of primary — acceptable for v0.1.0.

## Post-build smoke check

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File connect\build\smoke_check_connect_exe.ps1
```

Validates: EXE exists, SHA-256 sidecar matches, `--version` prints `CONNECT_VERSION=0.1.0` and all Connect capability ids.

## Hash verify (operator)

```powershell
certutil -hashfile dist\OmniFrame_Connect.exe SHA256
type dist\OmniFrame_Connect.exe.sha256
```

## Manual upload — Supabase Storage `downloads/`

Public base: `https://wncpqxwmbxjgxvrpcake.supabase.co/storage/v1/object/public/downloads/`

### 1. Temporarily allow anon INSERT

```sql
CREATE POLICY "Temp anon upload downloads"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'downloads');
```

### 2. Upload Connect zip

```bash
curl -X POST \
  "https://wncpqxwmbxjgxvrpcake.supabase.co/storage/v1/object/downloads/OmniFrame_Connect.zip" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/zip" \
  -H "x-upsert: true" \
  --data-binary "@dist/OmniFrame_Connect.zip"
```

### 3. Upload versioned Connect EXE (for self-update bytes)

```bash
curl -X POST \
  "https://wncpqxwmbxjgxvrpcake.supabase.co/storage/v1/object/downloads/OmniFrame_Connect_0.1.0.exe" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/octet-stream" \
  -H "x-upsert: true" \
  --data-binary "@dist/OmniFrame_Connect.exe"
```

Hash-pin: copy the certutil SHA-256 into the manifest before publishing.

### 4. Publish manifest

Write `connect_manifest.json` locally with `exe_sha256` matching the uploaded EXE, then upload:

```bash
curl -X POST \
  "https://wncpqxwmbxjgxvrpcake.supabase.co/storage/v1/object/downloads/connect_manifest.json" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -H "x-upsert: true" \
  --data-binary "@connect_manifest.json"
```

Manifest URL (public read): `https://wncpqxwmbxjgxvrpcake.supabase.co/storage/v1/object/public/downloads/connect_manifest.json`

### 5. Drop temp policy

```sql
DROP POLICY "Temp anon upload downloads" ON storage.objects;
```

## Rollback

Re-publish `connect_manifest.json` pointing `channels.stable.exe_url` and `exe_sha256` at the prior EXE artifact. Connect clients poll every launch and every 24 h while running.

## Known gaps (v0.1.0)

- **No Authenticode signing** on the EXE
- **No ed25519 manifest signature** — SHA-256 from manifest is the only integrity check
- **No channel switching** — always reads `channels.stable`
- **No delta updates** — full EXE download every upgrade
- **No download resume** — partial files discarded on failure

## Related

- [[Implement-Phase-H1-Connect-MVP]]
- [[Implement-Phase-H2-Self-Diagnostic-Friendly-Errors-Reset]]
- [[Implement-Phase-H3-Connect-Widget-Polish]]
- [[Implement-Phase-G-Packaging-DualExe]]
- [[Implement-Omni-Agent]]
