---
tags: [type/implementation, status/active, domain/infra]
created: 2026-04-16
updated: 2026-04-16
---
# Implement One Click Ship — Full Shipment Process

## Context
Replaced the simple PGI-only flow in the Omni-Bridge with a complete **6-step** end-to-end shipment process. Also added a web app tab for inputting shipment data, later extended into a headless-agent-compatible flow.

Initially designed as 7 steps based on the original recording; consolidated to 6 after the `Finaltesting.vbs` recording confirmed that tracking is set during VT01N (Step 4) not as a separate VT02N step.

## Bridge Changes (`omni_bridge/onebox_sap_bridge.py`)

### Python: `process_shipment(data)`
Accepts dict with: `delivery`, `item`, `serials` (list), `to_number`, `warehouse`, `tracking`.
Runs 6 SAP steps sequentially, each wrapped in try/except with status bar checks:

1. **ZV26 Serial Numbers** — Optional. Enters delivery + item, fills serial number table rows, saves.
2. **VL02N Pack BOX** — Opens delivery, clicks Pack (btn[18]), sets material "BOX", Enter, selects rows 0, clicks Pack All (AUTOTEXT001), saves.
3. **LT12 Confirm TO** — Enters TO number + warehouse, executes, saves.
4. **VT01N Create Shipment** — Sets `VTTK-TPLST=0001`, `VTTK-SHTYP=Z002`, assigns delivery (shipping point KY01), clicks Plan (btn[16]), sets `VTTK-EXTI1=tracking`, sets 4 status buttons (STDIS/STREG/STLBG/STLAD), saves, captures shipment number from status bar via `re.search(r'(\d{7,})', sbar)`.
5. **VL02N Pack CASE + Output** — Opens shipment via `/nVT02N` + captured TKNUM, clicks Create HU (btn[21]), material "CASE", Enter, switches to UE6HUS tab, selects rows 0, AUTOTEXT004/011 pack, sets dimensions (GEWEI=LB, MEABM=IN, BRGEW/LAENG/BREIT=10, HOEHE=4), saves. Then Output (btn[18]): refreshes rows 2-3 (btn[6]), 3 print rounds with PG44 and copies 3/4/3 (btn[2] change, Back), sets send type VSZTP=4 on row 7 (btn[5]), final save.
6. **VL02N Tracking + PGI** — Opens delivery in VL02N, presses btn[8] header detail, selects tab T\04, sets `LIKP-BOLNR=tracking`, clicks PGI (btn[20]).

Returns `{ok, failed_step, error, results, shipment_number}`.

### Fixed Values (not configurable)
- Packaging: `BOX` → `CASE`
- Shipment type: `Z002` (R-R Standard Shipment)
- Shipping point: `KY01`
- Transport planning point: `0001` (City 1)
- Printer: `PG44` with 3/4/3 copies
- Dimensions: 10 LB, 10×10×4 IN

### Injected JS: Shipment Form Modal
- "Process Shipment" button replaced old Delivery input + PGI button in bar
- Opens form modal with: Delivery #, Item # (default 0010), TO Number, Warehouse, Tracking # (default "Tracking"), Serial Numbers (textarea)
- On submit: closes modal, logs step-by-step results with typewriter effect

### Removed
- `post_goods_issue()` Python method
- `obxRunPGI` JS function
- Final Pack auto-detect click listener and mutation observer

## Web App Tab: One Click Ship
- **File:** `src/features/admin/sap-testing/components/one-click-ship-tab.tsx`
- Added as last tab in SAP Testing page (`index.tsx`)
- Later rewrote to support both Bridge and Agent modes with unified status bar, live progress, and collapsible summary (see [[Implement-Omni-Agent]])

## Other Improvements in This Session

### SAP Session Picker
- `list_sap_sessions()` — enumerates all connections + sessions with system name/transaction
- `set_sap_session(conn_idx, sess_idx)` — switches active connection/session
- Module-level `_sap_conn_idx` / `_sap_sess_idx` used by `_get_sap_session()`
- Dropdown in Settings dialog (bridge) and inline in status bar (agent)

### Resizable Console (bridge)
- Drag handle at top of bar, 60–400 px range
- Height persisted in `localStorage('obx-bar-height')`

### Typewriter Log Effect (bridge)
- Queue-based animation, 3 chars per tick, blinking green cursor
- Speed adapts to message length

### In-Page Data Refresh (replaces reload)
- `obxRefreshTableData()` clicks web app's "More" > "Refresh Data"
- Triggers React Query refetch without full page reload
- SAP connection and batch state preserved
- Used by batch TO confirm loop and 15-second auto-refresh timer

### Console Font Size (bridge)
- +/− controls in Settings (8–20 px)
- Persisted in `localStorage('obx-font-size')`

### Build Fixes
- `pushd "%~dp0"` in `build_exe.bat` for UNC path support (Parallels shared folders)
- `python -m PyInstaller` for PATH-independent builds
- `GetScriptingEngine` as property (not method) for Python 3.14 COM compatibility
- `conn.Description` wrapped in try/except

## Related
- [[Omni-Bridge - SAP Bridge]]
- [[Omni-Agent - Headless SAP Agent]] — headless alternative sharing the same SAP automation
- [[Implement-Omni-Agent]] — agent implementation details
- [[Implement-LT12-TO-Confirmation]]
- [[Fix-Agent-Distribution-Issues]] — every bug encountered and resolution
- [[Sessions/2026-04-16]]
