---
tags: [type/debug, status/active, domain/backend, domain/sap]
created: 2026-05-09
---

# Fix-LT24-S1-Lgnum-Control-Mismatch

## Symptom

User reports the new **Inventory Management → WAREHOUSE → TO History** query (LT24) fails immediately with:

> LT24 query failed
> Could not set warehouse S1_LGNUM: (-2147352567, 'Exception occurred.', (619, 'SAP Frontend Server', 'The control could not be found by id.', 'C:\\Program Files (x86)\\SAP\\FrontEnd\\SAPgui\\saphont.HLP', 393215, 0), None)

Fleet agent: `USINDPR-CXA106V`. Inputs: Material `23077931`, Warehouse `WH5`.

SAP error code 619 ("The control could not be found by id") = SAP scripting can't locate the field at the path the agent asked for. The handler was sending `wnd[0]/usr/ctxtS1_LGNUM` but the user's LT24 selection screen does not render an `S1_LGNUM` control — it renders `T2_LGNUM` (and the rest of the T2_* family) under the **"All Transfer Orders"** sub-screen.

## Root cause

LT24 has two field-group variants on the selection screen:

| Sub-screen | Toggled by | Fields exposed |
|---|---|---|
| **Single TO** (legacy) | `radS1_*` | `ctxtS1_LGNUM`, `ctxtS1_TANUM-LOW`, `ctxtMATNR-LOW`, `ctxtS1_LGTYP-LOW`, `ctxtS1_LGPLA-LOW`, `ctxtS1_VBELN-LOW`, `ctxtS1_BDATU-LOW` |
| **All TAs** | `radT2_ALLTA` | `ctxtT2_LGNUM`, `ctxtT2_TANUM-LOW`, `ctxtT2_MATNR-LOW`, `ctxtT2_LGTYP-LOW`, `ctxtT2_LGPLA-LOW`, `ctxtT2_VBELN-LOW`, `ctxtT2_BDATU-LOW` |

The original `handler_lt24` (shipped when [[Implement-TO-History-Tab]] landed) targeted the S1 variant by hardcoded path. The user's SAP install renders the All-TAs variant by default — confirmed by the user's own recorded `LT24Exporting.vbs`:

```vbs
session.findById("wnd[0]/tbar[0]/okcd").text = "LT24"
session.findById("wnd[0]").sendVKey 0
session.findById("wnd[0]/usr/radT2_ALLTA").select        ' click "All TAs" radio
session.findById("wnd[0]/usr/ctxtT2_LGNUM").text = "WH5"
session.findById("wnd[0]/usr/ctxtT2_MATNR-LOW").text = "23077931"
session.findById("wnd[0]/usr/ctxtLISTV").text = "JSINGHX"  ' user-specific layout
session.findById("wnd[0]").sendVKey 8                       ' F8 / Execute
```

## Fix

`omni_agent/agent.py` line 10803-10905, function `handler_lt24` — replace the S1_* path with the T2_* path entirely. There is no SAP variant in scope where the S1 path works AND the T2 path doesn't, so we don't need a fallback the other way.

### Step 1b — radio toggle (new)

After `/nLT24` + `sendVKey(0)`, click the `radT2_ALLTA` radio button so the All-TAs sub-screen renders the T2_* fields. Wrapped in `try/except` because some installs may already be on the All-TAs variant (the radio group only renders when the toggle is needed).

```python
try:
    sess.findById("wnd[0]/usr/radT2_ALLTA").select()
    _wait_for_session(sess, 5)  # let the screen redraw
except Exception:
    pass
```

### Step 2 — field IDs swapped

| Mode | Old (broken) | New |
|---|---|---|
| (always) warehouse | `ctxtS1_LGNUM` | `ctxtT2_LGNUM` |
| `by_to` | `ctxtS1_TANUM-LOW` | `ctxtT2_TANUM-LOW` |
| `by_material` | `ctxtMATNR-LOW` | `ctxtT2_MATNR-LOW` |
| `by_bin` (storage type) | `ctxtS1_LGTYP-LOW` | `ctxtT2_LGTYP-LOW` |
| `by_bin` (storage bin) | `ctxtS1_LGPLA-LOW` | `ctxtT2_LGPLA-LOW` |
| `by_delivery` | `ctxtS1_VBELN-LOW` | `ctxtT2_VBELN-LOW` |
| date range from/to | `ctxtS1_BDATU-LOW/HIGH` | `ctxtT2_BDATU-LOW/HIGH` |

The required field-set for each mode keeps its hard `raise Exception` (so a future SAP variant that drops T2_* gets a clear error instead of a silent miss); optional fields stay best-effort.

### Step 2b — optional layout

Added an optional `layout` param (read from `params.get("layout", "")`). If the caller supplies a layout name, the handler sets `ctxtLISTV`. Skipped entirely otherwise — the user's personal layout (`JSINGHX`) is **never** hardcoded; every user has their own.

## What was deliberately NOT changed

- `AGENT_VERSION` — bug fix only, no API surface change.
- `QUERY_HANDLERS` registration — `"lt24": handler_lt24` was already correct.
- `_JOB_ENDPOINT_MODELS` — `/sap/query` intentionally has no Pydantic binding; it dispatches via the generic dict path in `_dispatch_job` (line 5000). The previous worker's note that the endpoint was `/sap/lt24` was incorrect — it's `/sap/query` with `handler: "lt24"`. Both local and fleet modes hit the same dispatcher.
- `AGENT_CAPABILITIES` — `"lt24"` already at line 1704.
- Frontend (`<TransferOrderHistoryView />`, `inventory-management-tab.tsx`) — bug is server-side only.
- LT10 / LT12 / MB52 / MMBE — none of those handlers use S1_* on a screen that renders T2_*; left alone.

## Verification

```bash
python3 -c "import ast; ast.parse(open('omni_agent/agent.py').read())"
# source: OK
python3 -c "import ast; ast.parse(open('/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py').read())"
# mirror: OK
cmp /Users/jaisingh/Documents/Projects/OneBoxFullStack/omni_agent/agent.py /Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py
# (no output — files identical)
```

## Test plan (Mac fleet mode)

1. Pick agent `USINDPR-CXA106V`.
2. Open **Inventory Management → WAREHOUSE → TO History**.
3. Material `23077931`, Warehouse `WH5`, leave TO Number blank.
4. **Run Query** — expected SAP flow:
   - `/nLT24` → `Enter` → LT24 selection screen renders.
   - `radT2_ALLTA.select()` → All-TAs sub-screen exposes T2_* fields.
   - `T2_LGNUM = WH5`, `T2_MATNR-LOW = 23077931`.
   - `F8` (Execute) → ALV grid of TO movements.
   - `_extract_alv_grid()` returns rows + columns.
5. UI renders the Journey/Timeline view with the user's actual movement data.

## Related

- [[Components/Omni-Agent - Headless SAP Agent]] — `handler_lt24` lives here.
- [[Components/LT24 - Transfer Order History]] — query semantics + frontend wiring.
- [[Implementations/Implement-LT24-History-Trail]] — the recent migration that exposed this bug (the standalone admin tab worked because tester's account always had the All-TAs variant pre-selected; the Query Library fan-out hit a wider range of SAP installs).
- [[Implementations/Implement-TO-History-Tab]] — original handler_lt24 implementation.
- Source recording: `/Users/jaisingh/Downloads/MacWindowsBridge/LT24Exporting.vbs`.
