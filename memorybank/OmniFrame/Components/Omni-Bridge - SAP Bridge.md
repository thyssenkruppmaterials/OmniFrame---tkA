---
tags: [type/component, status/active, domain/infra]
created: 2026-04-14
updated: 2026-04-16
---
# Omni-Bridge (SAP Bridge)

## Purpose
Windows desktop bridge (.exe) that runs on Citrix and relays data between SAP GUI and the OmniFrame web app via Supabase. Renamed from **OneBox SAP Bridge** to **OmniFrame SAP Bridge** (a.k.a. Omni-Bridge).

## Key Files
| File | Purpose |
|---|---|
| `omni_bridge/onebox_sap_bridge.py` | Main Python script — pywebview app with SAP COM automation |
| `omni_bridge/build_exe.bat` | Windows build script — builds `OmniFrame_SAP_Bridge.exe` via PyInstaller |
| `omni_bridge/OmniFrame_SAP_Bridge.spec` | PyInstaller spec file for the build |
| `omni_bridge/requirements.txt` | Python dependencies |
| `omni_bridge/sap_scripts/FullTest.vbs` | Reference VBS for full shipment process (7 steps) |
| `omni_bridge/sap_scripts/Confirming TO's.vbs` | Reference VBS for LT12 TO confirmation |

## Capabilities

### 1. One Click Ship — Full Shipment Process (v3.0)
Replaces the old PGI-only flow. User clicks "Process Shipment" in the bar, fills a form, and 6 SAP transactions execute sequentially:
1. **ZV26** — Enter serial numbers (optional, skipped if none)
2. **VL02N** — Pack items into BOX HU
3. **LT12** — Confirm Transfer Order
4. **VT01N** — Create shipment (TPLST=0001, SHTYP=Z002, assign delivery from KY01, set 4 statuses, save → capture shipment number from status bar)
5. **VT02N → VL02N** — Reopen shipment, pack BOX into CASE HU, set dimensions (LB, 10×10×4 IN), process output rows (printer PG44, 3/4/3 copies), save
6. **VL02N** — Enter tracking (BOLNR), Post Goods Issue

Originally designed as 7 steps based on an earlier recording; consolidated to 6 after the `Finaltesting.vbs` recording showed tracking is set during VT01N (Step 4) not as a separate VT02N step.

**Dynamic inputs:** delivery #, item #, TO number, warehouse, tracking #, serial numbers (optional)
**Fixed values:** BOX/CASE materials, Z002 shipment type, KY01 shipping point, PG44 printer, 10 LB / 10x10x4 dimensions

Also available as a web app tab: **One Click Ship** in SAP Testing (`src/features/admin/sap-testing/components/one-click-ship-tab.tsx`)

### 2. LT12 Transfer Order Batch Confirmation
- Auto-detects Putaway Log Search page (checks for TO Number + Warehouse table columns)
- Scans visible table rows for "Pending TO Confirm" status badges
- Shows pending TO count + "Confirm All TOs" button in the SAP bar
- Batch-confirms each pending TO via SAP LT12 transaction
- After SAP success, PATCHes `rf_putaway_operations` in Supabase and clicks the web app status button
- Uses in-page data refresh (clicks "More" > "Refresh Data") instead of hard reloading to preserve SAP connection
- Auto-paginates through pages until pending count reaches 0
- 15-second auto-refresh timer when all TOs confirmed, watches for new entries

### Page Detection
- Polls every 2 seconds via `setInterval`
- Switches bar between **Shipment mode** (Process Shipment button) and **TO Confirm mode** (pending count + Confirm All TOs)
- Detection: presence of `<th>` elements with "TO Number" and "Warehouse" text

### SAP Session Picker
- Settings dialog lists all open SAP connections and sessions
- Shows system name + current transaction for each
- User can switch which connection/session the bridge uses
- Defaults to connection 0, session 0

### Console Features
- **Resizable**: drag handle at top of bar, height persists in localStorage
- **Typewriter effect**: log entries animate character-by-character with blinking cursor
- **Font size control**: adjustable in Settings (8px–20px, persists)
- **Page zoom**: adjustable in Settings (50%–200%, persists)
- **Hard Reload**: button in Settings for manual full page reload

### Supabase Integration
- Logs all SAP transactions to `sap_transaction_logs` table
  - Shipment: `transaction_code = 'VL02N'`, `action = 'post_goods_issue'`
  - TO confirm: `transaction_code = 'LT12'`, `action = 'confirm_transfer_order'`
- Updates `rf_putaway_operations` rows after successful LT12 confirmation
- Warehouse values (WH5, PDC, JSF, DMC) pass through as-is

## Architecture
- **pywebview** renders the OmniFrame web app in a WebView2 (Chromium) window
- **INJECTION_JS** raw string is injected on every page load via `window.events.loaded` callback
- Injected JS communicates with Python via `window.pywebview.api.*` calls
- Python `SAPBridgeAPI` class handles SAP GUI COM automation and Supabase REST calls
- SAP connection uses `win32com.client` with `GetScriptingEngine` (property, not method) for Python 3.14 compatibility
- Layout: CSS overrides `.h-svh` / `#content` height to `calc(100svh - barHeight)` for clean stacking

## Build
Run `build_exe.bat` on Windows with Python 3.9+. Uses `pushd "%~dp0"` for UNC path support and `python -m PyInstaller` for PATH-independent builds.

## Version History
- **v1.0** (2026-04-02): VL02N Post Goods Issue with auto-detect Final Pack
- **v2.0** (2026-04-14): LT12 batch TO confirmation, page detection, Supabase updates
- **v3.0** (2026-04-16): Full 7-step shipment process, session picker, resizable console, typewriter logs, in-page data refresh, One Click Ship web tab

## Related
- [[Implement-LT12-TO-Confirmation]]
- [[Implement-One-Click-Ship]]
- [[Sessions/2026-04-14]]
- [[Sessions/2026-04-16]]
- [[Database-Schema-Overview]] — `rf_putaway_operations`, `sap_transaction_logs` tables
