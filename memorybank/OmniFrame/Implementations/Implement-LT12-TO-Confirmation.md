---
tags: [type/implementation, status/active, domain/infra]
created: 2026-04-14
---
# Implement LT12 TO Confirmation in Omni-Bridge

## Context
Added batch Transfer Order confirmation via SAP LT12 to the Omni-Bridge desktop app. When users navigate to the Putaway Log Search page, the bridge detects pending TOs and provides a one-click "Confirm All TOs" button.

## Changes Made

### Python (`omni_bridge/onebox_sap_bridge.py`)
- `confirm_transfer_order(to_number, warehouse)` — SAP GUI COM automation for LT12
- `_update_putaway_status(to_number, warehouse)` — PATCHes `rf_putaway_operations` via Supabase REST
- `_log_to_transaction(to_number, warehouse, status, message)` — logs to `sap_transaction_logs`

### Injected JavaScript (INJECTION_JS)
- `obxIsPutawayLogPage()` — detects Putaway Log Search by checking for TO Number + Warehouse table headers
- `obxDetectPage()` — polls every 2s, switches bar between PGI and TO-confirm modes
- `obxScanPendingTOs()` — walks `<tbody>` rows, extracts TO number (column 4) and warehouse (column 1) for rows with "Pending TO Confirm" status (column 8)
- `obxGetPendingCount()` — reads "Pending Confirms" stat card value from DOM
- `obxFindNextPageButton()` — locates pagination Next button by h-8 w-8 p-0 class pattern
- `obxConfirmAllTOs()` — batch loop: confirm page, paginate, repeat until pending = 0
- `obxStopConfirm()` — sets stop flag for graceful halt

### Bar UI
- PGI controls (`obx-pgi-controls`): Delivery input + Post Goods Issue button
- TO controls (`obx-to-controls`): pending count label + Confirm All TOs + Stop button
- Visibility toggled by `obxDetectPage()` based on current page

## SAP LT12 Flow
1. `/nLT12` — navigate to transaction
2. `LTAK-TANUM` — set TO number
3. `LTAK-LGNUM` — set warehouse (WH5, PDC, JSF, DMC etc.)
4. Focus on `chkRL03T-OFPOS` checkbox + Enter — execute
5. `btn[11]` (Save/F11) — confirm the TO
6. Read status bar for success/error

## Related
- [[Omni-Bridge - SAP Bridge]]
- [[Sessions/2026-04-14]]
