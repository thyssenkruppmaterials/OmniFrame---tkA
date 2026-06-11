---
tags: [type/component, status/active, domain/backend, domain/frontend]
created: 2026-04-18
---
# LT24 — Transfer Order History

## Purpose
Provides full lifecycle tracking of Transfer Orders in SAP WM. Surfaces the data from SAP transaction LT24 (Display Transfer Orders) through the Omni-Agent, and renders it as a navigable graph + timeline in the web app.

## Agent Handler

**Function:** `handler_lt24(sess, params)` in `omni_agent/agent.py`
**Registry key:** `lt24`

### Selection Modes
| Mode | Required Fields | SAP Element IDs |
|------|------|------|
| `by_to` | warehouse, to_number | `S1_LGNUM`, `S1_TANUM-LOW` |
| `by_material` | warehouse, material | `S1_LGNUM`, `MATNR-LOW` |
| `by_bin` | warehouse, storage_bin, (storage_type) | `S1_LGNUM`, `S1_LGPLA-LOW`, `S1_LGTYP-LOW` |
| `by_delivery` | warehouse, delivery | `S1_LGNUM`, `S1_VBELN-LOW` |

Optional date range: `S1_BDATU-LOW` / `S1_BDATU-HIGH` (applies to all modes).

### Graph Shaping
`_rows_to_graph(rows, focus)` extracts entities and relationships:
- **Node types:** `to`, `material`, `bin`, `user`, `delivery`
- **Edge relations:** `moves`, `picks_from`, `puts_to`, `created_by`, `confirmed_by`, `references`
- Column matching is fuzzy (tries SAP tech names like `TANUM`, `MATNR` and display titles like `TO number`, `Material`).

## Frontend Component

**File:** `src/features/admin/sap-testing/components/to-history-tab.tsx`
**Export:** `TOHistoryTab`

Three-column layout:
1. Focus Picker (left) — mode selector, inputs, recent focuses
2. Force-directed graph (center) — `react-force-graph-2d`, dark canvas, color-by-type
3. Details panel (right) — summary, timeline, raw data table

## Related
- [[Component - Omni-Agent Query Framework]]
- [[Implementation - Implement-TO-History-Tab]]
- [[Patterns - React-Force-Graph-Local-Graphs]]



## 2026-05-09 — Frontend re-homed in Inventory Management

The standalone `to-history-tab.tsx` was retired on 2026-05-09. The same LT24 backend now feeds the **Inventory Management Query Library → WAREHOUSE → TO History** entry (`lt24-history`) and renders through the new `<TransferOrderHistoryView />` (Journey + Timeline modes, Detail Drawer, stat ribbon, filter chips, virtualisation). The agent handler did not change — this was a pure frontend migration that took advantage of the auto-mode-inference already baked into `handler_lt24` (line 10750-10756).

See [[Implementations/Implement-LT24-History-Trail]] for the full design + test plan.



## 2026-05-09 — Personal Layout Field (Frontend)

The agent's `handler_lt24` already accepted an optional `layout` param (added during the S1→T2 fix — see [[Fix-LT24-S1-Lgnum-Control-Mismatch]]), but the frontend had no UI to set it. Each user has their own SAP layout (e.g. `JSINGHX`), so it's stored as a per-browser preference rather than per-query session data.

### Frontend wiring

**File:** `src/features/admin/sap-testing/components/inventory-management-tab.tsx`

- **State:** `lt24Layout: string` (separate from `inputs` map; mirrors the `pinnedAgentId` localStorage pattern).
- **localStorage key:** `omniframe.sap-testing.lt24.layout` (constant `LT24_LAYOUT_KEY`). Hydrated on mount, written on every change. Default `''`.
- **Input field:** Rendered as a full-width sibling row BELOW the standard 3-column input grid (NOT a 4th grid cell — see the 2026-05-09 polish subsection below for the rationale). Conditional on `selectedQuery.id === 'lt24-history'` so the other queries (LT10, MB52, MMBE) are unaffected.
- **Behavior:** auto-uppercased on change (`e.target.value.toUpperCase()`), `maxLength={12}` (SAP layout names are typically ≤12 chars), `font-mono uppercase` className for visual SAP-code cue, Enter triggers Run Query, optional (no required gate).
- **Label:** `Layout (optional)`. **Helper text:** `SAP display variant (LISTV) — e.g. JSINGHX. Leave blank for SAP default. Saved per browser.`
- **Dispatch:** in `runQuery`, when `selectedQuery.id === 'lt24-history'`, params become `{ ...inputs, layout: lt24Layout.trim() }`. Empty string is fine — the agent's `handler_lt24` treats `""` as "no layout" and skips the `ctxtLISTV` write entirely.

### Why a separate localStorage key (not `INPUT_HISTORY_KEY`)?

`INPUT_HISTORY_KEY` (`omniframe.inventory_query_inputs.v1`) is keyed by query-id and stores per-query session data — material numbers, TO numbers, warehouses — that the user expects to wipe between runs (and that varies wildly by what they're investigating). The layout is a USER-level preference: one value per browser, reused across every LT24 run, and meaningful to the same user across hundreds of distinct queries. Splitting it out keeps the semantics clean — clearing one user's session inputs doesn't wipe their layout, and the layout doesn't sneak into the per-query history payload.

### Constraints satisfied

- `AGENT_VERSION` NOT bumped — agent already supports `layout` per the S1→T2 fix.
- LT10 / MB52 / MMBE forms untouched (the new field is gated on `selectedQuery.id === 'lt24-history'`).
- `pnpm tsc -b --noEmit` clean | `pnpm build` clean | `ReadLints` clean.
- No new `supabase.channel(...)` callsites (per `realtime-policy.mdc`).
- No new dependencies; no `manualChunks` change.

### Test plan

1. Open **SAP Testing → Inventory Management → WAREHOUSE → TO History**.
2. Type `jsinghx` in the new Layout field — confirm it auto-uppercases to `JSINGHX`.
3. Try typing more than 12 chars — confirm input rejects beyond 12.
4. Material `23077931`, Warehouse `WH5`, click **Run Query** — confirm console / agent log shows `params.layout = JSINGHX` and the agent applies `ctxtLISTV = "JSINGHX"` (visible in console log if the agent prints it, otherwise verify via SAP's row arrangement matching the user's saved layout).
5. Reload the page — confirm the Layout field is pre-populated with `JSINGHX`.
6. Clear the Layout field, click **Run Query** — confirm the request still succeeds (handler treats empty as no layout).



## 2026-05-09 (later) — Layout field placement polish

Same-day follow-up to the **Personal Layout Field (Frontend)** subsection above. The first pass rendered the Layout input as a 4th cell *inside* the form's `md:grid-cols-2 lg:grid-cols-3` input grid — which dangled as a narrow cell on its own row at `lg`+ (3 fixed cells from `selectedQuery.inputs.map` + 1 conditional 4th = 3+1 wrap, leaving Layout 1/3-width on the second row).

### Change

Relocated the Layout input from inside the input grid to a *sibling row directly below* it. Now:

- **`lg`+ (the desktop case):** the standard 3-input grid (Material / Warehouse / TO Number) keeps its tight 3-column rhythm on row 1, and Layout occupies a full-width row 2 — visually signaling that it's a different category of input (a per-user preference, not a per-query session value). This matches the pattern used by `TransferInventoryDialog`'s LDEST field (`sm:col-span-3` on a 3-col grid for the same "supplemental field that pairs as a full-width row" rationale).
- **`md`:** standard 2-col grid renders [Material | Warehouse] / [TO Number | (empty)], then Layout rolls onto its own full-width row below. Cleaner than 4th-cell-wraps-with-TO-Number which made the row look like 4 inputs of equal weight.
- **`<md`:** single-column stack — no behavioral diff vs. the prior approach.

### Copy tightening

Label: `Layout` → `Layout (optional)` (matches the prior workers' `TO Number (optional)` pattern).

Helper text:

> Before: `Optional — your personal SAP layout (ctxtLISTV). e.g., JSINGHX. Saved per browser.`
> After: `SAP display variant (LISTV) — e.g. JSINGHX. Leave blank for SAP default. Saved per browser.`

The new copy leads with what the field IS (a SAP display variant), names the SAP control inline (LISTV), shows the example (JSINGHX in `font-mono`), and tells users what happens when they leave it blank — closing the loop on the empty-string branch the agent's `if layout:` gate handles.

### Visual cue

Added `className='font-mono uppercase'` to the Input — matches the LT01 BESTQ/SOBKZ/LDEST pattern (`TransferInventoryDialog`) so SAP control codes consistently render mono-cased throughout the SAP Testing tab. Consistent visual grammar for SAP IDs.

### Constraints satisfied

- **`AGENT_VERSION` NOT bumped** — layout polish is FE-only.
- **`omni_agent/agent.py` NOT touched** — handler already accepts `layout` (verified: source line 10769 + Windows-bridge mirror identical via `cmp`).
- **No new capability** — LT24 capability already advertised.
- **No new persistence key** — `LT24_LAYOUT_KEY` already shipped in the prior pass.
- **No new dispatch shape** — same `{handler, params}` envelope; `params.layout` already wired in `runQuery`.
- **`pnpm tsc -b --noEmit`** clean (21.7s) | **`pnpm build`** clean (9.84s; `feature-admin-sap` 378.28 KB / gzip 95.83 KB — unchanged within rounding) | **`ReadLints`** clean (0 diagnostics).

### Files

- MODIFIED `src/features/admin/sap-testing/components/inventory-management-tab.tsx` — single hunk relocation (lines 2860-2890 removed from inside the grid; lines 2862-2900 inserted as a sibling block below the grid).



## 2026-05-09 (later) — BDATU date range + field-ID correction

Same-day extension to the **Personal Layout Field (Frontend)** subsection above. The user dropped `LT24ExportingwithDateRange.vbs` (2 KB, mtime 20:48) in `/Users/jaisingh/Downloads/MacWindowsBridge/` to capture the SAP control IDs for the LT24 BDATU date-range fields. Two findings drove this round:

### Field-ID correction

The radT2_ALLTA sub-screen exposes the BDATU range OUTSIDE the `T2_*` group:

| Field | Pre-fix (WRONG) | Post-fix (per .vbs) |
|------|------|------|
| Creation date (from) | `wnd[0]/usr/ctxtT2_BDATU-LOW` | `wnd[0]/usr/ctxtBDATU-LOW` |
| Creation date (to) | `wnd[0]/usr/ctxtT2_BDATU-HIGH` | `wnd[0]/usr/ctxtBDATU-HIGH` |

The previous code wrote `ctxtT2_BDATU-LOW/HIGH` — the lookup raised "field not found" which the surrounding `try/except: pass` silently swallowed. So no date filter was EVER applied, even though the meta payload echoed back the requested `date_from` / `date_to` values. Other range fields on the same sub-screen DO carry the `T2_` prefix (`ctxtT2_TANUM-LOW`, `ctxtT2_MATNR-LOW`, etc.) — BDATU is the exception, not the rule. The .vbs is the source of truth:

```vbs
session.findById("wnd[0]/usr/ctxtBDATU-LOW").text  = "01/01/2025"
session.findById("wnd[0]/usr/ctxtBDATU-HIGH").text = "05/09/2026"
```

### Date format conversion (ISO → SAP US)

The .vbs writes `MM/DD/YYYY` (US locale). HTML5 `<input type="date">` emits ISO 8601 (`YYYY-MM-DD`) regardless of the user's browser locale, so a normaliser is mandatory. Added `_format_sap_date(value: str)` in `omni_agent/agent.py` just above `handler_lt24`:

```python
def _format_sap_date(value: str) -> str:
    s = (value or "").strip()
    if not s:
        return ""
    if "/" in s and "-" not in s:
        return s  # already MM/DD/YYYY
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        try:
            y, m, d = s.split("-")
            if len(y) == 4 and len(m) == 2 and len(d) == 2:
                return f"{m}/{d}/{y}"
        except Exception:
            pass
    return s  # leave non-ISO/non-US untouched
```

Behaviour table (verified under Python AST):

| Input | Output | Why |
|------|------|------|
| `""` | `""` | empty; caller's `if sap_date_*:` gate skips the write |
| `"  "` | `""` | whitespace strips to empty |
| `"2026-05-09"` (ISO) | `"05/09/2026"` | ISO → US |
| `"2025-01-01"` (ISO) | `"01/01/2025"` | ISO → US |
| `"05/09/2026"` (already US) | `"05/09/2026"` | passthrough |
| `"not a date"` | `"not a date"` | passthrough; SAP raises a clearer "Invalid date" status if it ever reaches the GUI |
| `"2026-5-9"` (partial ISO) | `"2026-5-9"` | passthrough; the SAP picker handles or rejects |

### Frontend — BDATU date range inputs

**Files:** `src/features/admin/sap-testing/components/inventory-management-tab.tsx`

- **localStorage keys:** `omniframe.sap-testing.lt24.date-from` and `omniframe.sap-testing.lt24.date-to` (constants `LT24_DATE_FROM_KEY` / `LT24_DATE_TO_KEY`). Same per-browser-preference rationale as `LT24_LAYOUT_KEY` — an LT24 user typically re-runs the same date window across many materials/TOs while investigating a shipment.
- **State:** `lt24DateFrom` / `lt24DateTo` mirror the `lt24Layout` pattern — hydrated on mount, written on every change, default empty. NO auto-default to today/yesterday — explicit blank means "no date filter" and matches pre-fix behaviour exactly.
- **Inputs:** Two `<input type="date">` cells (Date From, Date To) rendered as a SECOND grid row below the standard Material/Warehouse/TO Number/Layout grid (gated on `selectedQuery.id === 'lt24-history'`). HTML5 native picker — no new dependency. The two inputs constrain each other: From has `max={lt24DateTo || undefined}` and To has `min={lt24DateFrom || undefined}` so the picker prevents inverted ranges client-side.
- **Theme alignment:** `bg-background` className applied to keep the native picker on the theme-aware shadcn surface (browser default is a light grey that clashes with dark mode).
- **Clear button:** "Clear date range" ghost button appears as a 3rd grid cell ONLY when at least one date is set; clicking resets both to empty.
- **Dispatch:** the LT24 dispatch payload spread becomes `{ ...inputs, layout: lt24Layout.trim(), date_from: lt24DateFrom.trim(), date_to: lt24DateTo.trim() }`. The agent's `handler_lt24` already reads `params.get("date_from")` and `params.get("date_to")` — the keys round-trip but now actually reach SAP.

### Why a separate localStorage key (not `INPUT_HISTORY_KEY`)

Same reasoning as the Layout key. `INPUT_HISTORY_KEY` is keyed by query-id and stores per-query session data the user expects to wipe between runs. The date range is a USER-level preference reused across many distinct queries while investigating an incident. Splitting it out keeps the semantics clean.

### Constraints satisfied

- **`AGENT_VERSION` NOT bumped** — handler signature accepts the same `params` keys it always did; only the field-ID + format-converter implementation changed. Older agents on the fleet were silently dropping the BDATU writes anyway.
- **No new dependencies** — HTML5 `<input type="date">` only.
- **No hardcoded colors** — `bg-background` theme token; works in light + dark mode.
- **No new `supabase.channel(...)` callsites** (per `realtime-policy.mdc`).
- **No new capability** — LT24 capability already advertised on every fleet agent.
- **Source/mirror in sync** — `cmp` confirms `omni_agent/agent.py` and `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py` are byte-identical post-edit. `python3 -c "import ast; ast.parse(...)"` clean for both.
- **`pnpm tsc -b --noEmit`** clean (20.5s) | **`pnpm build`** clean (10.43s; `feature-admin-sap` 379.91 KB / gzip 96.22 KB — +1.6 KB / +0.4 KB gzip vs. the prior pass) | **`ReadLints`** clean (0 diagnostics).

### Related

- [[Sessions/2026-05-09]] — "LT24 date range + layout cutoff fix" subsection.
- [[Implementations/Implement-LT24-History-Trail]] — date-range row added to the input shape; layout-cutoff fix documented.
