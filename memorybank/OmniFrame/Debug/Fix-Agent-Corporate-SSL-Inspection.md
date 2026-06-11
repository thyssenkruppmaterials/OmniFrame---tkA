---
tags: [type/debug, status/active, domain/infra, domain/auth, domain/backend]
created: 2026-04-29
---
# Fix: Agent Corporate SSL Inspection (Netskope) — v1.6.2

## Symptom
In the Rolls-Royce Citrix environment, `POST http://127.0.0.1:8765/supabase/login` (called by the new [[Implementations/Implement-Agent-Supabase-Login-UI|Connect Account dialog]]) returned:

```
HTTPSConnectionPool(host='wncpqxwmbxjgxvrpcake.supabase.co', port=443):
  Max retries exceeded with url: /auth/v1/token?grant_type=password
  (Caused by SSLError(SSLCertVerificationError(
    1, 'SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed:
    self-signed certificate in certificate chain (_ssl.c:1041)')))
```

The agent EXE could not authenticate against Supabase. All other agent → Supabase calls (heartbeat / job claim / audit log / LT22 import) would have failed with the same error the moment they tried to talk over HTTPS.

## Root Cause
Rolls-Royce runs **Netskope SSL inspection** on outbound web traffic. The corporate proxy terminates TLS, presents its own root CA, then re-encrypts. Windows trusts that root CA (it's pushed to the machine cert store via Group Policy), so Chrome / Edge / .NET work fine.

**But PyInstaller-bundled Python doesn't read the Windows cert store.** It ships with `certifi`'s Mozilla root list — which knows nothing about the Netskope CA. Result: `requests.post(...)` fails verification on every HTTPS call originating from the EXE.

This isn't a bug in any one library; it's the standard PyInstaller-on-corporate-network friction.

## Fix (agent v1.6.1 → v1.6.2)

### 1. `truststore` — bridge Python's `ssl` to the Windows trust store
Added `truststore>=0.10` to [[Components/Omni-Agent - Headless SAP Agent|`omni_agent/requirements.txt`]]. `truststore` is the official, maintained library that monkey-patches `ssl.SSLContext` to use the OS-native trust store (Windows SChannel / macOS Keychain / OpenSSL on Linux).

In `omni_agent/agent.py`, **before `import requests`** (and before any other HTTPS-touching import):

```python
if sys.platform == "win32":
    try:
        import truststore
        truststore.inject_into_ssl()
        print("[boot] truststore injected — using Windows certificate store for TLS verification")
    except Exception as exc:
        print(f"[boot] truststore unavailable ({exc}); falling back to certifi bundle. Corporate SSL inspection may break login/Supabase calls.")
```

The ordering is critical — `truststore.inject_into_ssl()` swaps the default `SSLContext` class. Anything imported afterwards (requests, urllib3, httpx, websockets used by the Realtime client) uses the new context automatically. Modules already holding a reference to the old class wouldn't pick it up.

### 2. `--hidden-import truststore` for PyInstaller
`build_exe.bat` now passes `--hidden-import truststore` so PyInstaller bundles the package even though it's only imported inside a `try`. The `OmniFrame_Agent.spec` in MacWindowsBridge also has `'truststore'` appended to `hiddenimports=[...]` as a belt-and-braces measure for spec-driven builds.

`truststore` is pure Python — no extra `--add-data` needed.

### 3. `OMNIFRAME_INSECURE_SSL=1` env-var escape hatch
Defense-in-depth for the rare case where the corp pushes the CA to the **user's** personal store instead of the machine store (truststore can't see the user store at module-load time). Setting `OMNIFRAME_INSECURE_SSL=1` flips a module-level `_SSL_VERIFY = False` and every `requests.post/get/patch` in the agent passes `verify=_SSL_VERIFY`.

Boot warning when active:

```
[boot] OMNIFRAME_INSECURE_SSL=1 detected — TLS verification DISABLED. Use only on trusted networks.
```

Applied to all 12 `requests.*` call sites in `agent.py`:
- `/supabase/login` (token + profile read)
- `claim_sap_agent_job` RPC (job queue claim)
- `sap_agent_jobs` PATCH (job status updates)
- `sap_agents` upsert + listing (registry / heartbeat)
- `bump_sap_agent_job_lease`, `reap_stale_sap_agents` (heartbeat lease + reaper)
- `sap_transaction_logs` POST (audit trail)
- `rf_putaway_operations` PATCH (TO confirmation update)

And both call sites in `omni_agent/lt22_import.py` (`sap_outbound_to_imports` chunk insert + `sap_outbound_to_import_runs` PATCH). `material_master_read.py` and `reversal_engine.py` make no `requests` calls — nothing to wrap there.

### 4. Version bump
- `AGENT_VERSION = "1.6.2"` in agent.py with an updated banner-comment summarising both the SSL fix and yesterday's Supabase login UI endpoints.
- `LATEST_AGENT_VERSION = '1.6.2'` in `src/features/admin/sap-testing/lib/agent-fetch.ts` so the "update your agent" banner clears for users on the new EXE.
- `MIN_REQUIRED_AGENT_VERSION` left at `1.4.0` — agents on 1.5/1.6.x still satisfy minimums, this is purely additive.

## Verification
- Python AST parse of agent.py + lt22_import.py — both clean.
- `npm run build` — passes (~8.9s, no TypeScript errors, no new lint).
- Files copied to `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/` for the user's Parallels rebuild.

## User Rebuild Steps (Parallels)
```cmd
cd C:\OmniFrameBridge\Omni-Agent
pip install -r requirements.txt --upgrade
build_exe.bat
```
Then re-zip and re-upload `dist\OmniFrame_Agent.exe` to Supabase Storage `downloads/OmniFrame_Agent.zip`.

## Why `truststore` over alternatives
- **`certifi-win32` / `python-certifi-win32`** — old, abandoned, hooks deeper into urllib3 internals.
- **`pip-system-certs`** — overrides `pip` only, doesn't help `requests` at runtime in the agent.
- **`REQUESTS_CA_BUNDLE` env var** — requires the user to know where the Netskope cert is on their Citrix box (they don't).
- **`truststore`** — official PyPA-adjacent project, used by `pip` itself in `--use-feature=truststore`, future-proof, pure Python, one import line.

## Related
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Implementations/Implement-Agent-Supabase-Login-UI]]
- [[Sessions/2026-04-29]]
- [[Implementations/Implement-Omni-Agent]]
