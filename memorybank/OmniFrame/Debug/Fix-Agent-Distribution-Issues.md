---
tags: [type/debug, status/resolved, domain/infra]
created: 2026-04-16
---
# Fix Agent Distribution + Runtime Issues

Rolling log of every issue hit when deploying the Omni-Agent to Citrix, and the resolution. Most were browser-security or corporate-security related; all are fixed.

## 1. Railway serving `index.html` for `.exe` downloads → "corrupted and unreadable"
**Symptom:** User downloads `OmniFrame_Agent.exe` from `/downloads/`, Windows refuses to execute with "The file or directory is corrupted and unreadable." Downloaded file is 6 KB.

**Cause:** `public/downloads/` was empty (the `.gitignore` excluded `*.exe` and no build was ever committed). Railway's SPA fallback returns `index.html` for unmatched routes. Chrome saved ~6 KB of HTML as `.exe`.

**Fix:** Moved distribution to Supabase Storage bucket `downloads` (public-read). See [[Implement-Omni-Agent]] upload flow.

## 2. Netskope FedRAMP blocking `.exe` download
**Symptom:** Rolls-Royce corporate CASB (Netskope) blocks the Supabase URL with: `[SWG22] [Default] Binary and Executable File Type BLOCK`.

**Cause:** Corporate policy blocks raw `.exe` downloads from non-allowlisted domains regardless of file contents.

**Fix:** Repackaged as `OmniFrame_Agent.zip` containing the EXE. ZIPs pass CASB inspection. User extracts with Windows built-in, then runs the EXE inside. Updated `AGENT_DOWNLOAD_URL` constant and the download modal to reflect 4-step flow (Download→Extract→Run→Return).

## 3. PyInstaller `--windowed` + uvicorn logging crash
**Symptom:** Double-click the built `.exe`, popup: `Failed to execute script 'agent' due to unhandled exception: Unable to configure formatter 'default'`. Stack trace shows `AttributeError: 'NoneType' object has no attribute 'isatty'` in `uvicorn/logging.py:42`.

**Cause:** When built with `--windowed`, Python sets `sys.stdout = None` and `sys.stderr = None`. Uvicorn's default logging config calls `sys.stderr.isatty()` on startup to decide color output. `None.isatty()` crashes.

**Fix:** At module top (before uvicorn import), redirect None streams to `os.devnull`:
```python
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")
```
This lets the default uvicorn logger run without crashing in either `--console` or `--windowed` mode.

## 4. Web app not detecting agent — CSP block
**Symptom:** Agent running fine (`Uvicorn running on http://127.0.0.1:8765` in its console), but web app still shows "SAP Agent Not Detected". Chrome DevTools console shows: `Fetch API cannot load http://127.0.0.1:8765/health. Refused to connect because it violates the document's Content Security Policy.`

**Cause:** `api/main.py` production CSP `connect-src` directive didn't allow `http://127.0.0.1:*` or `http://localhost:*`. Even though Chrome exempts HTTPS→loopback from mixed-content blocking, **CSP is a separate layer** and must explicitly permit loopback.

**Fix:** Added `http://localhost:*`, `http://127.0.0.1:*`, `ws://localhost:*`, `ws://127.0.0.1:*` to the production `connect-src` in `api/main.py` (both debug and production branches).

## 5. Chrome Private Network Access (PNA) preflight
**Symptom:** Anticipated issue. Chrome 108+ sends preflight OPTIONS requests for HTTPS→loopback fetches with header `Access-Control-Request-Private-Network: true`.

**Fix:** Added `add_private_network_headers` middleware to agent that:
- Responds to OPTIONS preflights with `Access-Control-Allow-Private-Network: true`
- Adds the header to all regular responses
- Combined with `CORSMiddleware(allow_origins=["*"])`

## 6. SAP Logon Pad has index 0 but 0 sessions — error 614
**Symptom:** Shipment fails at Step 0 with:
```
SAP session: (-2147352567, 'Exception occurred.', (614, 'saplogon',
'The enumerator of the collection cannot find an element with the specified index.', ...))
```

**Cause:** Default attachment was `app.Children(0).Children(0)`. When the SAP Logon Pad launcher is itself the first "connection" (with 0 sessions), `Children(0)` on an empty collection fails. Hardcoded index assumptions don't survive users closing SAP sessions.

**Fix:** New `_auto_select_valid_session()` helper walks all connections, finds the first one with a usable `wnd[0]` session, and returns `(conn_idx, sess_idx)`. Called in:
- `/sap/connect` (auto-pick on attach)
- `_get_sap_session()` as fallback when current selection becomes invalid
- `/sap/session` POST validates selections before accepting

## 7. SAP scripting popup causing "Control not found by id" at Step 2
**Symptom:** VL02N Pack BOX fails with `(-2147352567, 'Exception occurred.', (619, 'SAP Frontend Server', 'The control could not be found by id.', ...))`.

**Cause:** SAP GUI shows "A script is attempting to access SAP GUI" popup on each new process's first interaction. While popup is displayed, `_wait_for_session()` returns because `sess.Busy=False` (SAP is idle waiting for user input). Script proceeds and tries to find Pack button which doesn't exist yet (delivery hadn't loaded).

**Fix:**
- New `_wait_for_control(sess, control_id, timeout)` helper polls for the specific expected element
- Used before each critical interaction (e.g. wait for `tbar[1]/btn[18]` Pack button before pressing it)
- Error message now tells user to click OK on any SAP scripting prompt or disable notification in SAP GUI Options

## 8. Incompletion Log blocks VL02N navigation
**Symptom:** After VT01N saves, next VL02N attempt hits "Delivery XXX Change: Incompletion" screen. Subsequent `findById("wnd[0]/tbar[1]/btn[18]")` fails.

**Fix:** `open_vl02n()` now:
1. Calls `reset_to_easy_access()` first — types `/n` in OK Code, handles "data will be lost" dialogs
2. After loading delivery, checks window title for "ncompl" and presses Back (F3) to skip past it
3. Uses `safe_set_text()` / `safe_press()` helpers with informative errors

## 9. VT01N "Transportation planning point does not exist"
**Symptom:** Step 4 fails with info dialog: `Transportation planning point does not exist`.

**Cause:** VT01N requires a Transport Planning Point. Older code tried to rely on session defaults which worked in recording but fail in automation.

**Fix:** Explicitly set `VTTK-TPLST` = `"0001"` and `VTTK-SHTYP` = `"Z002"` before pressing Enter. Based on the `Finaltesting.vbs` recording that worked.

## 10. Step 5 needed shipment number capture
**Symptom:** After VT01N save, we need to reopen the shipment in VT02N to continue packing. Didn't know the shipment number.

**Fix:** After VT01N save, regex-match the status bar (`r"(\d{7,})"`) to extract the shipment number ("Shipment XXXXXXXX has been saved"). Used in Step 5 to open the shipment via `/nVT02N` + `VTTK-TKNUM`.

## Related
- [[Omni-Agent - Headless SAP Agent]]
- [[Implement-Omni-Agent]]
- [[Sessions/2026-04-16]]
