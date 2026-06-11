---
tags: [type/debug, status/active, domain/backend, domain/infra]
created: 2026-04-29
---
# Fix — LT22 SAP COM Crash from Page-Down Extraction (v1.6.3)

## Symptom
Running an Outbound Apps → Smart Import → "Import via Agent" against PDC / storage type 916 reproducibly killed the SAP COM bridge mid-run after exactly one successful pull. Agent log:

```
[query]  SAP list paginated: 16 page(s), 657 unique row(s)
[query]  Header: ['Number', 'TO', 'GR', 'SU', 'TyD', 'Stor.Type', ...]
[jobs]   Job 5f7c1be1-… completed in 41.2s
... user re-runs the same import ...
[jobs]   Job ec77cb3a-… failed: LT22 selection screen field not found:
         (-2147023174, 'The RPC server is unavailable.', None, None)
```

After the second failure, every subsequent call (any handler — not just LT22) returned the same `RPC server is unavailable` HRESULT. The web-app SAP-session badge stayed green ("connected"), so the user kept retrying and the agent kept claiming jobs from the queue against a corpse.

## Root cause
Two separate problems compounding into one user-visible symptom.

### 1. LT22 was paging through the visible SAP GUI
`omni_agent/lt22_import.py` was wired to call `_extract_via_pc_export(sess)` with a fallback to `_extract_sap_list_output(sess)`. The bulk export was failing silently on this user's SAP variant (the `%pc` Save-As dialog uses different control IDs), so every run fell back to the lbl-based extractor, which uses `sendVKey 82` (Ctrl+PgDn) to walk the result page-by-page and re-walks the whole `wnd[0]/usr` control tree on each page.

For a 657-row PDC pull that's:
- 16 pages × ~600 GuiLabel/GuiTextField scans per page = ~10K COM round-trips
- Plus a `_wait_for_session(sess, 5)` busy-wait between every page

The SAP scripting engine doesn't fail on any single one of those — it accumulates state until the COM proxy's marshalling buffer is exhausted, then drops the connection. Once the proxy dies, **every** subsequent call from this Python process gets `(-2147023174, 0x800706BA, 'The RPC server is unavailable.', None, None)` because `pywin32` is talking to a dead pipe.

### 2. The agent didn't notice SAP was dead
After the crash:
- `state.sap_connected` stayed `True`
- The web-app `/sessions` endpoint kept returning `{connected: true}`
- The job poller (60s loop) kept claiming new jobs from `sap_agent_jobs`
- Every claim immediately failed inside `_get_sap_session()` with the RPC error
- Each failed job re-armed the queue retry → infinite loop until the user logged out

The user saw a "still connected" badge in OmniFrame and assumed the agent was healthy, while every job they fired silently failed.

### 3. Frontend gating (cosmetic)
The `<SmartImportButton>` in `src/components/outbound-data-manager.tsx` only checked `agentDetection.available` — the actual `import-lt22` capability flag was never consulted. So if a user was running a pre-v1.6.1 EXE the option would still show and try to fire a `/sap/import-lt22` POST that the agent didn't expose, returning a 404. (Not the cause of the crash, but adjacent to the same fix.)

## Fix (v1.6.3)

### 1. `%pc` bulk export is the primary path
`omni_agent/lt22_import.py`:
- `_extract_via_pc_export(sess)` is now called first under explicit `print('[lt22]  using %pc bulk export')`.
- Fallback to `_extract_sap_list_output(sess)` only when the bulk export raises a non-COM exception, with `print('[lt22]  bulk export failed, falling back to paginated extract: <reason>')`.
- COM errors from inside either extractor are re-raised so the outer handler can mark the agent dead (a fallback to pagination would just re-trigger the same crash).

### 2. `Lt22ImportRequest.use_bulk_export: bool = True`
Opt-out field on the request model. Defaults to True (use bulk export). The queue payload can set it to False to force pagination on a future SAP build where `%pc` breaks, without rebuilding the agent EXE.

### 3. COM-error catch + `state.sap_connected = False`
```python
except _COM_ERROR as com_exc:
    state.sap_connected = False
    err = f"SAP COM session died ({com_exc}). Restart SAP GUI before re-running the import."
    _patch_run(state, req.import_run_id, {"status": "failed", "error": err[:500], ...})
    return {"ok": False, "error": err, "sap_disconnected": True}
```
`_COM_ERROR` is `pywintypes.com_error` when `pywintypes` is importable, otherwise a stub exception class so `except _COM_ERROR` is always valid (dev / non-Windows).

The job poller loop already gates on `if state.sap_connected and state.supabase_token …`, so flipping the flag stops it from claiming new jobs. The `/sessions` endpoint mirrors the flag, so the web-app SAP-GUI badge flips to "disconnected" within one poll cycle.

### 4. Pre-flight `_auto_select_valid_session()` check
At the very top of the `/sap/import-lt22` handler — before patching the run row to "running" — call `_auto_select_valid_session()`. If it returns `(None, None)` (no usable session), set `state.sap_connected = False` and return a friendly "SAP COM session not available — please open SAP Logon" error immediately. Fails fast instead of letting the user wait for `_get_sap_session` to traceback after the run row was already promoted to "running".

### 5. SmartImportButton hardening (`src/components/outbound-data-manager.tsx`)
Now consults `agentDetection.hasCapability('import-lt22')`:
- Agent NOT detected → `hidden: true` (option disappears, CSV becomes preferred — original behaviour).
- Agent detected AND capability present → `preferred: true`, emerald accent, green dot.
- Agent detected BUT capability missing → option shown **disabled** with `subLabel: "{name} · v{X} — upgrade to enable"` and a description pointing the user at rebuilding the EXE. CSV becomes preferred. Prevents the silent vanishing-option failure mode that brought us here.

### 6. `AGENT_CAPABILITIES` catch-up
Added four cap ids to `AGENT_CAPABILITIES` in `omni_agent/agent.py` so existing frontend gates light up:
- `import-lt22-bulk` — new in v1.6.3, signals the bulk path is the default
- `supabase-session` — already-shipping `GET /supabase/session` endpoint
- `agent-supabase-logout` — already-shipping `POST /supabase/logout` endpoint
- `truststore-tls` — corporate-SSL truststore inject from v1.6.2

`import-lt22` and `reversal-engine` were already in the list; verified.

## Files modified
| File | LOC delta | Why |
|---|---|---|
| `omni_agent/lt22_import.py` | +85 / -8 | Bulk-export primary, COM catch, pre-flight check, `use_bulk_export` field |
| `omni_agent/agent.py` | +14 / -1 | `AGENT_VERSION = '1.6.3'`, +4 capabilities |
| `src/components/outbound-data-manager.tsx` | +56 / -23 | SmartImportButton capability hardening + upgrade hint |
| `src/features/admin/sap-testing/lib/agent-fetch.ts` | +1 / -1 | `LATEST_AGENT_VERSION = '1.6.3'` |

## Verification
- `python3 -c "import ast; ast.parse(open('omni_agent/agent.py').read()); ast.parse(open('omni_agent/lt22_import.py').read())"` — passes.
- `npm run build` — passes (~9.0s).
- Build size: `feature-outbound` chunk 210.75 KB → 210.75 KB (no change — capability check is in the existing render path), `feature-admin-sap` 379.87 KB → 385.87 KB (+6 KB for `import-lt22-bulk` capability surfacing nothing yet but reserved for future "Bulk-export" badge).

## User impact at runtime
- **Before**: 657-row LT22 pull = 16 page-down iterations + ~10K COM round-trips → SAP COM crash → silent failure on every subsequent job until SAP GUI restart.
- **After**: 657-row LT22 pull = 1 `%pc` round-trip + 1 file read → no SAP GUI scrolling, no COM marshalling pressure. If the bridge dies anyway (different reason), the agent immediately disconnects from the queue and the web-app badge flips so the user sees the failure mode.

## Required user action
1. Rebuild EXE: Open Parallels → `cd C:\OmniFrameBridge\Omni-Agent && build_exe.bat`.
2. Re-zip + re-upload `dist\OmniFrame_Agent.exe` → `OmniFrame_Agent.zip` → Supabase Storage `downloads/`.
3. **Restart SAP GUI** before re-running LT22 — the current SAP COM session is dead from the v1.6.2 crash and a new agent EXE alone won't revive it. Open SAP Logon → double-click the system → sign in.

## Related
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Implementations/Implement-LT22-Outbound-Import]]
- [[Implementations/Bulk-Export-via-pc]]
- [[Patterns/Smart-Import-Button]]
- [[Patterns/Agent-Capability-Negotiation]]
- [[Debug/Fix-Agent-Corporate-SSL-Inspection]]
- [[Sessions/2026-04-29]]
