---
tags: [type/implementation, status/active, domain/frontend, domain/backend]
created: 2026-05-09
---
# Implement LT24 History Trail (TO History → Inventory Query Library)

## Purpose / Context

The standalone **TO History** admin tab (`?tab=to-history`) was retired and folded into the **Inventory Management → Query Library → WAREHOUSE** category as a new query named `lt24-history` (TO History — "LT24 — Movement history trail by material / TO"). The flat-table view of the old tab was replaced with a dual-mode visualization (`<TransferOrderHistoryView />`) that reconstructs the **physical bin-to-bin journey** of every Transfer Order returned by LT24.

See:
- [[Components/Inventory-Management - SAP Query Framework]]
- [[Components/Omni-Agent - Headless SAP Agent]] — `handler_lt24`
- [[Implementations/Implement-Inventory-Mgmt-Detail-Pane-Redesign]]
- [[Implementations/Implement-Inventory-Management-Fleet-Routing]]

## Migration shape

| Aspect | Before (admin tab) | After (Library query) |
|---|---|---|
| Location | `SAP Testing → TO History` | `SAP Testing → Inventory Management → WAREHOUSE → TO History` |
| Data source | `/sap/query` `handler: 'lt24'` (unchanged) | `/sap/query` `handler: 'lt24'` (unchanged) |
| Form | Three-column workspace, focus picker (TO/Material/Bin/Delivery) | Standard Library form: Material + Warehouse + TO Number (optional), with **Layout (optional)** as a per-user preference row below the input grid (persisted via `LT24_LAYOUT_KEY` so a user types `JSINGHX` once and it auto-applies on every subsequent run). "At least one of material/to_number" gate added in `runQuery` for the `lt24-history` id. |
| Result rendering | `react-force-graph-2d` graph + flat table + small timeline | `<TransferOrderHistoryView />` — Journey View (per-TO trail cards) + Timeline View (day-clustered) + Detail Drawer + 4-card stat ribbon + filter bar |
| Routing | Local-only `fetch('http://127.0.0.1:8765/sap/query')` | `executionMode.dispatch('/sap/query', ...)` — local + fleet routing via the existing toggle. |
| Capability | `lt24` (already advertised) | `lt24` (no agent change required) |
| Bundle | `feature-admin-sap` ≈ 456 KB | `feature-admin-sap` ≈ 369 KB (`react-force-graph-2d` no longer imported, ~87 KB reduction) |

## Visualization design

### Stat ribbon (4 cards)
1. **Total Movements** — count of LT24 rows after filters; subtitle shows unique-TO count.
2. **Quantity Moved** — sum of `Actual qty` across the filtered set.
3. **Avg Time to Confirm** — mean `confirmed_at − created_at` for confirmed rows.
4. **In-Flight** — count of rows where `confirmed_at` is null or `00/00/0000`. Turns emerald when zero.

### Filter bar
- Free-text search (matches TO, material, bin, user, delivery, mvt type).
- **Status chips** — `All / Confirmed / Pending`.
- **Movement Type chips** — top 12 distinct types in the data, each with a hue from the `MOVEMENT_META` palette.
- **Storage Type chips** — top 10 distinct types observed across source + destination bins.
- One-click **Clear filters** action when any filter is active.

### Mode A — Journey View (default)
Groups rows by TO number; renders one card per TO with all line items as a chip → arrow → chip trail. Each card shows:
- TO number badge + status pill + distinct movement-type pills
- Material code + description (line-clamped)
- Total quantity + line count
- Per-item leg with **Source BinChip** → `→` → **Destination BinChip**, item index, status dot, hover-revealed "details →" link
- Footer with Created/Confirmed timestamps + users + duration + warehouse/plant + delivery

Groups are sorted by latest activity (most-recent first). Virtualised via `@tanstack/react-virtual` when > 80 journeys to keep the 7000+ row LT24 export performant.

### Mode B — Timeline View
Vertical day-clustered timeline. Each cluster has a sticky day header with a fading gradient rule on either side. Each row shows:
- Time (HH:MM:SS, tabular-nums)
- TO #/item badge
- Movement-type pill
- Material chip
- Source → Destination bin chips
- Quantity + UoM
- Created/Confirmed users

Clicking any row opens the Detail Drawer.

### Detail Drawer (`<Sheet side='right'>`)
- Hero card: large bin-trail (Source → Destination) + quantity
- Material code + description
- Created / Confirmed grid (timestamps + users)
- Duration callout (when confirmed)
- Warehouse / Plant / SLoc / Delivery / Reference Doc grid
- Sibling movements (other items in the same TO) — clickable
- Copy TO# action

### Color system
- **Movement type pills** — distinct hues per common type. `101=sky` (receipt), `319=emerald` (putaway), `320=amber` (pick), `311=violet` (transfer), `351=fuchsia` (STO), `919=rose` (adjustment), `980=blue` (workflow), `999=orange` (gain/loss). Custom types fall through to `stone`.
- **Status pills** — emerald (confirmed) / amber (pending) / rose (cancelled). Status dots have shadow-glow for visual emphasis.
- **Bin chips** — hashed against a 5-tone palette (blue/emerald/amber/violet/rose) so the same storage type always picks the same colour.

## Data flow

```
┌─ User picks 'TO History' in the Library ─────────────────┐
│  Form: Material 23077931 / Warehouse WH5 / (TO# blank)    │
│  Click Run                                                │
└──────────────┬───────────────────────────────────────────┘
               │  runQuery() → executionMode.dispatch('/sap/query',
               │                {handler:'lt24', params:{material,warehouse,to_number}},
               │                {capability:'lt24'})
               ▼
  Local mode: agentFetch → http://127.0.0.1:8765/sap/query
  Fleet mode: INSERT sap_agent_jobs (assigned_agent_id=fleetAgentId)
               │   → wait for WsEvent::SapJobStatusChanged
               ▼
  agent.handler_lt24() infers mode='by_material' from the present params,
  drives /nLT24, fills S1_LGNUM/MATNR-LOW, F8 to execute, _extract_alv_grid
  pulls every row, _rows_to_graph builds the legacy graph payload (preserved
  but unused by the new view), returns {columns, rows, total, graph, meta}.
               │
               ▼
  TransferOrderHistoryView normalises rows via tolerant column resolver
  (mirrors agent's _col helper — substring match on title/id with positional
  override for the duplicate Typ / User columns), groups by TO, renders.
```

## Key files

- **NEW** `src/features/admin/sap-testing/components/transfer-order-history-view.tsx` — the dual-mode visualization (≈1100 LOC, TypeScript)
- **MODIFIED** `src/features/admin/sap-testing/components/inventory-management-tab.tsx`:
  - Added `Route` to lucide imports
  - Imported `TransferOrderHistoryView`
  - Added `lt24-history` entry to `QUERY_LIBRARY`
  - Added handoff-receiver `useEffect` (consumes `omniframe.inventory_query_handoff.v1`)
  - Added `lt24-history`-specific "at least one of material/to_number" gate in `runQuery`
  - Branched result rendering — `selectedQuery.id === 'lt24-history'` → `<TransferOrderHistoryView />`, else `<ResultsCard />`
- **MODIFIED** `src/features/admin/sap-testing/index.tsx` — removed `to-history` tab + import + case branch
- **MODIFIED** `src/features/admin/sap-testing/lib/console-helpers.ts` — `openToNumberInToHistory` now writes the new handoff key + switches to `?tab=inventory-management`
- **DELETED** `src/features/admin/sap-testing/components/to-history-tab.tsx`

## Backend

**No agent changes required.** The existing `handler_lt24` already:
- Accepts the simple `{material, warehouse, to_number}` shape (mode auto-inferred — see comment at line 10750-10756)
- Returns the standard `{columns, rows, total, meta}` shape (plus a legacy `graph` payload that's now unused but harmless)
- Is registered under `/sap/query` (Generic dict path in `_dispatch_job`, line 5000)
- Capability `lt24` is in `AGENT_CAPABILITIES` (advertised since the old tab shipped)

## Performance

The example LT24 export referenced (`/Users/jaisingh/Downloads/MacWindowsBridge/LT24Exporting.txt`) contained ~7,000 rows. The Journey view virtualises when `journeys.length > 80`; the Timeline uses native scroll inside a `<ScrollArea>` (which keeps day-cluster headers sticky). Stat aggregation is pre-computed once per filter change — `useMemo` over `filteredMovements`. No measurable jank in informal test on the 7K-row dataset.

## Bundle impact

```
Before (with react-force-graph-2d in old tab):  feature-admin-sap = 455.93 KB
After  (force-graph dropped from import graph):  feature-admin-sap = 368.64 KB
Delta:                                          −87.29 KB
```

The `react-force-graph-2d` dependency is no longer imported by any source file. It remains in `package.json` for now; a follow-up `pnpm knip` pass should remove it.

## Quality gates

- `pnpm tsc -b --noEmit` — clean
- `pnpm build` — clean, no chunk regressions
- `pnpm lint:check` — 91 warnings (was 93 baseline — improved by 2)
- `node scripts/check-bundle-budget.mjs` — pre-existing failures only (warehouse-location-map / feature-admin); my changes net-improve total by ~155 KB
- `pnpm test:unit` — same pass/fail as baseline (4 unrelated test files fail in both branches)

## Test plan (manual)

1. From a Mac (no local agent), open `SAP Testing → Inventory Management`. Toggle execution mode to **Fleet Agent** and pick `USINDPR-CXA106V`.
2. Click `WAREHOUSE → TO History` in the Query Library.
3. Enter Material `23077931`, Warehouse `WH5` (default). Click **Run Query**. Wait for the fleet agent to claim + complete (~10-30s).
4. Stat ribbon should populate (Total Movements ≈ 7000+, Quantity Moved, Avg Time to Confirm, In-Flight).
5. **Journey View** (default) should render one card per unique TO. Hover a card — slight lift. Click a bin chip — Detail Drawer opens with the full row.
6. Toggle to **Timeline View**. Day clusters should be visible with sticky headers; scroll smoothly.
7. Apply filter chips (Movement type 319, Status `Confirmed`) — counts on chips should match remaining items. Click **Clear filters** to reset.
8. Click **Export CSV** — file downloads with friendly headers (TO Number, Item, Movement Type, …) and respects the active filters.
9. From the SAP Console (any tab), click a TO number link — verify it switches to Inventory Management → TO History query with the TO Number pre-filled.
10. From a Windows machine with the local agent running, switch back to **Local Agent** mode and re-run to confirm the same flow works against the localhost path.

## Open follow-ups

- Real-time LT24 watcher — react to `WsEvent::SapAgentJobChanged` for handler `lt24` and append new movements without a full re-query. Requires a Phase-9 trigger DSL extension.
- Drilldown into LT22 (delivery confirmation) from the Detail Drawer's `Delivery` field — would let users walk from "this movement" → "the delivery it serviced" without leaving the trail.
- Knip pass to drop `react-force-graph-2d` from `package.json` now that no source file imports it.
- Heatmap by-bin overlay — overlay the warehouse-location-map with bin-touch frequency from a recent LT24 trail.

## Related

- [[Components/Inventory-Management - SAP Query Framework]]
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Implementations/Implement-Inventory-Mgmt-Detail-Pane-Redesign]]
- [[Implementations/Implement-Inventory-Management-Fleet-Routing]]
- [[Implementations/Implement-TO-History-Tab]] — superseded by this note
- [[Components/LT24 - Transfer Order History]]



## 2026-05-09 (later) — Personal Layout (LISTV) field added

Same-day follow-up. The agent's `handler_lt24` already accepted an optional `layout` param after the [[Fix-LT24-S1-Lgnum-Control-Mismatch]] fix landed (`agent.py:10769`), but the FE Library form had no input to set it — so users couldn't apply their personal SAP layout (e.g. `JSINGHX` for the current operator) and SAP fell back to the default layout's column shape. This pass adds the missing FE input.

### What landed

- **New constant** `LT24_LAYOUT_KEY = 'omniframe.sap-testing.lt24.layout'` (`inventory-management-tab.tsx:429`) sits next to the other localStorage keys. Per-browser user-level preference; explicitly NOT folded into `INPUT_HISTORY_KEY` because layout is a one-value-per-user preference, not per-query session data.
- **New state hook** `lt24Layout: string` (`inventory-management-tab.tsx:1197-1210`) hydrated from `localStorage` on mount; `useEffect` writes back on every change. Default `''` so first-ever use shows an empty placeholder rather than baking in another user's variant.
- **New input field** rendered as a sibling row below the standard 3-input grid, scoped to `selectedQuery.id === 'lt24-history'` (`inventory-management-tab.tsx:2862-2900`). Auto-uppercased on type via `setLt24Layout(e.target.value.toUpperCase())` (mirrors the LT01 BESTQ/SOBKZ/LDEST pattern), `maxLength={12}`, `font-mono uppercase` className for visual SAP-code cue, Enter triggers Run Query.
- **Dispatch wiring** (`inventory-management-tab.tsx:1519-1522`) — in `runQuery`, when `selectedQuery.id === 'lt24-history'`, the dispatch params become `{ ...inputs, layout: lt24Layout.trim() }`. Empty string is fine — the agent's `handler_lt24` treats `""` as "no layout" and skips the `ctxtLISTV` write entirely.

### Why a sibling row, not a 4th grid cell

The form's existing input grid is `md:grid-cols-2 lg:grid-cols-3`. Dropping Layout in as a 4th cell wraps it onto its own row at `lg`+ (3 fixed cells fill row 1, Layout dangles 1/3-width on row 2). The full-width sibling row below the grid keeps the LT10/MMBE/MB52 forms' 3-column rhythm intact AND visually expresses the "per-user preference, not per-query session" semantic split. Same rationale used by `TransferInventoryDialog`'s LDEST field (`sm:col-span-3` on a 3-col grid).

### Constraints satisfied

- **`AGENT_VERSION` NOT bumped** — layout-param support already shipped.
- **`omni_agent/agent.py` NOT touched** — verified the handler reads `params.get("layout", "")` at `agent.py:10769`. `cmp` confirms source + Windows-bridge mirror identical.
- **No new capability** — `lt24` already advertised.
- **No new dispatch shape** — same `{handler, params}` envelope.
- **No `JSINGHX` hardcode** anywhere — the placeholder uses it as an example only; the actual value is whatever the user types and persists in their own browser.
- **No new `supabase.channel(...)` callsites** (per `realtime-policy.mdc`).
- **`pnpm tsc -b --noEmit`** clean (21.7s) | **`pnpm build`** clean (9.84s; `feature-admin-sap` 378.28 KB / gzip 95.83 KB) | **`ReadLints`** clean.

### Validation

- Empty layout → handler runs LT24 on the SAP default layout (current behavior preserved for users who haven't set one yet).
- Non-empty layout → handler writes `ctxtLISTV` before F8 → SAP returns rows in the user's variant column shape. The handler's existing try/except around the `ctxtLISTV` write handles SAP variants where the layout field is missing or named differently.

### Test plan (user-visible)

1. Open **SAP Testing → Inventory Management → WAREHOUSE → TO History**.
2. Confirm a new full-width **Layout (optional)** row sits directly below Material / Warehouse / TO Number, with placeholder `JSINGHX` and helper text "SAP display variant (LISTV) — e.g. JSINGHX. Leave blank for SAP default. Saved per browser."
3. Type `jsinghx` — confirm it auto-uppercases to `JSINGHX` and renders mono-cased.
4. Try typing more than 12 chars — confirm input rejects beyond 12.
5. Material `23077931`, Warehouse `WH5`, click **Run Query** — confirm the agent applies `ctxtLISTV = "JSINGHX"` and SAP returns rows in the user's variant column shape.
6. Reload the page — confirm the Layout field is pre-populated with `JSINGHX`.
7. Clear the Layout field, click **Run Query** — confirm the request still succeeds (handler treats empty as no layout, falls back to SAP default).
8. Switch to LT10 / MB52 / MMBE — confirm no Layout field appears.



## 2026-05-09 (later) — BDATU date range + page-bg cutoff fix

Two related fixes off the LT24 Timeline view (User-flagged 2026-05-09 evening on the round-5 unified detail pane). One layout/theme regression on the SAP testing page wrapper, and one missing-feature item on the LT24 query (BDATU date range) — bundled because they both touch the LT24 Library entry surface.

### Page-background cutoff (Fix 1)

**Symptom (dark mode).** On the LT24 Timeline view, scrolling the right pane past the Query Library's sticky height left the area below painted in the html canvas default (light) instead of the dark theme. Visually: page bg "ended" at the Library height.

**Root cause.** `<Main>` in `src/features/admin/sap-testing/index.tsx` had no explicit bg + no `min-h`. The body's bg (with `background-attachment: fixed`) only paints WITHIN the body's box, and `#content` in `authenticated-layout.tsx` is `flex h-svh` (capped at one viewport height). When the right pane overflowed past viewport, body's box ended at `svh`, body's bg stopped painting, and the html canvas default bled through.

**Fix.** Added `className='bg-background min-h-[calc(100svh-4rem)]'` to the SAP testing `<Main>`:

- `bg-background` is the same theme token (`oklch(1 0 0)` light / `oklch(0.205 0 0)` dark) the body uses, so the surface follows whichever theme the user picks — no hardcoded color.
- `min-h-[calc(100svh-4rem)]` (svh minus the fixed header's 4rem) makes Main fill the viewport when content is short AND grow past viewport when the right pane has hundreds of timeline rows. The bg follows because `bg-background` paints throughout Main's whole box.

The `#content` `h-svh` cap stays unchanged — that's a global behaviour shared by every authenticated route. The fix is surgical to the SAP testing page only.

### BDATU date range (Fix 2)

**Capture.** `LT24ExportingwithDateRange.vbs` (2 KB, mtime 20:48) in `/Users/jaisingh/Downloads/MacWindowsBridge/`. Two key findings:

1. **Field IDs are NOT `T2_BDATU-*`.** The radT2_ALLTA sub-screen exposes BDATU OUTSIDE the `T2_*` group: `wnd[0]/usr/ctxtBDATU-LOW` and `wnd[0]/usr/ctxtBDATU-HIGH`. Other range fields on the same sub-screen DO carry `T2_*` (`ctxtT2_TANUM-LOW`, `ctxtT2_MATNR-LOW`, etc.) — BDATU is the exception. The previous handler wrote `ctxtT2_BDATU-LOW/HIGH` — the lookup raised "field not found" which the surrounding `try/except: pass` silently swallowed. So no date filter was EVER applied even though the meta payload echoed the requested values back.
2. **Date format is MM/DD/YYYY.** The .vbs writes `01/01/2025` and `05/09/2026`. Browser `<input type="date">` emits ISO 8601 (`YYYY-MM-DD`) regardless of user locale, so a normaliser is mandatory.

**Agent changes (`omni_agent/agent.py`):**

- Added `_format_sap_date(value: str)` helper just above `handler_lt24`. Empty → "" (caller skips), already MM/DD/YYYY → unchanged, ISO `YYYY-MM-DD` → split-and-reorder, anything else → unchanged. Sanity-checked under Python AST (`iso → us`, `us → us`, `empty → ""`, `garbage → garbage`).
- Replaced both `ctxtT2_BDATU-LOW/HIGH` writes with `ctxtBDATU-LOW/HIGH` and threaded the values through `_format_sap_date` first. Comment block above the field-set rewritten to document the BDATU-no-T2-prefix quirk + cite the .vbs.
- Meta payload extended: emit BOTH `date_from` / `date_to` (canonical ISO from the browser) AND `date_from_sap` / `date_to_sap` (SAP-formatted).

**Frontend changes (`src/features/admin/sap-testing/components/inventory-management-tab.tsx`):**

- Two new localStorage keys: `omniframe.sap-testing.lt24.date-from` and `omniframe.sap-testing.lt24.date-to`. Same per-browser-preference rationale as `LT24_LAYOUT_KEY`.
- Two new state hooks (`lt24DateFrom`, `lt24DateTo`) following the `lt24Layout` pattern. NO auto-default to today/yesterday — explicit blank means "no date filter" and matches pre-fix behaviour exactly.
- New input row rendered as a SECOND grid below the standard input grid (gated on `selectedQuery.id === 'lt24-history'`). Two `<input type="date">` cells (Date From, Date To) + a "Clear date range" ghost button that appears only when at least one date is set. HTML5 native picker — no new dependency.
- The two date inputs constrain each other: From has `max={lt24DateTo || undefined}` and To has `min={lt24DateFrom || undefined}` — picker prevents inverted ranges client-side.
- `bg-background` className keeps the native picker on the theme-aware shadcn surface (browser default is a light grey that clashes with dark mode).
- Dispatch payload extended: `selectedQuery.id === 'lt24-history' ? { ...inputs, layout: lt24Layout.trim(), date_from: lt24DateFrom.trim(), date_to: lt24DateTo.trim() } : inputs`.

### Migration shape (current LT24 Library entry)

| Field | Where it lives | Source of truth |
|------|------|------|
| Material | `selectedQuery.inputs` | per-query session, in `INPUT_HISTORY_KEY` |
| Warehouse | `selectedQuery.inputs` | per-query session, in `INPUT_HISTORY_KEY` |
| TO Number (optional) | `selectedQuery.inputs` | per-query session, in `INPUT_HISTORY_KEY` |
| Layout (optional) | own `lt24Layout` state | per-browser, in `LT24_LAYOUT_KEY` |
| Date From (optional) | own `lt24DateFrom` state | per-browser, in `LT24_DATE_FROM_KEY` |
| Date To (optional) | own `lt24DateTo` state | per-browser, in `LT24_DATE_TO_KEY` |

### Constraints satisfied

- **`AGENT_VERSION` NOT bumped** — handler signature unchanged; only field-IDs + format-converter implementation updated.
- **No new dependencies** — HTML5 `<input type="date">` only.
- **No hardcoded colors** — `bg-background` theme token; works in light + dark mode.
- **No new `supabase.channel(...)` callsites** (per `realtime-policy.mdc`).
- **No new capability** — LT24 capability already advertised.
- **Source/mirror in sync** — `cmp` confirms `omni_agent/agent.py` and `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py` byte-identical post-edit. `python3 -c "import ast; ast.parse(...)"` clean for both.
- **`pnpm tsc -b --noEmit`** clean (20.5s) | **`pnpm build`** clean (10.43s; `feature-admin-sap` 379.91 KB / gzip 96.22 KB — +1.6 KB / +0.4 KB gzip vs. the prior pass) | **`ReadLints`** clean (0 diagnostics).

### Files

- MODIFIED `omni_agent/agent.py` (added `_format_sap_date` helper; corrected field IDs from `ctxtT2_BDATU-*` → `ctxtBDATU-*`; extended meta payload).
- MODIFIED `omni_agent/agent.py` MIRROR at `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py` (cmp-verified identical).
- MODIFIED `src/features/admin/sap-testing/components/inventory-management-tab.tsx` (LT24_DATE_FROM_KEY + LT24_DATE_TO_KEY; lt24DateFrom + lt24DateTo state + persistence; date-range input row; dispatch payload spread).
- MODIFIED `src/features/admin/sap-testing/index.tsx` (added `bg-background min-h-[calc(100svh-4rem)]` to `<Main>` for the page-bg cutoff fix).

### Test plan (user-visible)

1. **Dark-bg cutoff regression check** — Open the LT24 Timeline view in dark mode, run a query that returns hundreds of rows. Scroll past the Query Library's sticky height. Confirm the dark theme background extends ALL THE WAY DOWN — no light bleed-through.
2. **Light mode check** — Toggle ThemeSwitch to light mode, repeat step 1.
3. **No-date-filter regression** — Leave both date inputs blank, run LT24 with Material `23077931` / Warehouse `WH5`. Confirm result set identical to pre-fix runs (handler skips BDATU writes when formatted strings are empty).
4. **Single-bound** — Set Date From `2025-01-01`, leave Date To blank, run. Confirm the SAP screen shows `BDATU-LOW = 01/01/2025` and BDATU-HIGH unset; rows from 01/01/2025 onward.
5. **Both-bound** — Set Date From `2025-01-01` + Date To `2026-05-09`, run. Confirm SAP returns rows in the inclusive window. Confirm `meta.date_from = "2025-01-01"`, `meta.date_from_sap = "01/01/2025"`, `meta.date_to = "2026-05-09"`, `meta.date_to_sap = "05/09/2026"`.
6. **Persistence** — Reload, confirm both date inputs pre-populate with last-used values. Click "Clear date range" — both clear, button hides until next set.
7. **Inverted-range guard** — Set Date To `2025-01-01`, then try Date From `2025-06-01`. Confirm the picker disallows the inverted selection.
8. **Other queries unaffected** — Switch to LT10/MB52/MMBE — confirm NO date inputs appear.



## 2026-05-09 (later) — Compact + elegant pass

User feedback on the round-1 visualisation (per the **Visualization design** section above): the Journey + Timeline cards were vertically generous (~80–120px per movement), making the surface feel low-density. User asked for the same information in a tighter, more robust + elegant package — Linear-style commit list / Vercel-style deploy list density. Pure FE refinement; no agent / data-shape change.

### Surface-by-surface rewrite

#### Stat ribbon (top of view)
- **Before:** four `<Card>`s with `p-4`, `text-2xl` numbers, `h-9 w-9` icon tiles, hover-lift transform, `gap-3` grid.
- **After:** four bordered tiles (`border-border/40 bg-card/50 px-3 py-2`), `text-xl` numbers, plain icon at the right, color-only hover, `gap-2` grid. ~46px tile vs ~96px tile.

#### Toolbar
- **Before:** standard `<Card>`, `text-xs` description, `h-8` toggle, `min-w-[220px] flex-1` search.
- **After:** `<Card>` with `border-border/40 bg-card/50 shadow-none` softer chrome. `text-sm font-medium` title with count badge `M / N` (was `M of N`). `text-[11px] line-clamp-1` description. `h-7 p-0.5` `<TabsList>` with `h-6 text-[11px]` triggers. `h-7 px-2` Refresh + Export buttons. Search input capped at `max-w-xs` with `h-7 text-[11px]` so it stops dominating the toolbar row.

#### Filter chips
- **Before:** `px-2.5 py-0.5` chip padding, `gap-1.5` between chips, `hover:bg-muted` background.
- **After:** `h-6 px-2` chip padding, `gap-1` between chips, `hover:bg-accent` background. Mvmt and Storage chip-row eyebrows shortened to `Mvmt` / `Storage` (was `Movement` / `Storage Type`).

#### Journey card (Mode A)
Replaces the round-1 stacked-card design entirely. Layout is now a 3-row dense strip per TO inside a single bordered wrapper:

- **Row 1 — single-line header:** status dot (6px solid emerald/amber, replaces `<StatusPill>`) · `TO {number}` badge button (h-5 px-1.5 py-0) · hover-revealed copy button · `·` separator · distinct movement-type pills (`<MovementPill size='sm'>`) · `·` · material code (mono) · `·` description (hidden `<md`) · `ml-auto` total qty + uom + leg count.
- **Row 2 — bin trail:** one inline group per leg, wrapping naturally. Each leg: item index (mono `text-[9px]`) · source `<BinChip size='sm'>` · 12px arrow · destination `<BinChip size='sm'>` · per-leg qty (only when multi-leg).
- **Row 3 — meta footer:** all inline `·`-separated muted metadata. `Created HH:MM:SS by USER · Confirmed HH:MM:SS by USER · ⏱ 27s · WH5 / Plant · Delivery 4780987571`. Times use `formatCompactTime` (HH:MM:SS for same-day TOs, `MMM DD, HH:MM AM` for cross-day, year added for cross-year).
- **Card chrome:** dropped. Each card is just a `<div>` with `border-b border-border/40` — the divider IS the chrome. Hover: `bg-accent/30` colour-only, no transform / no shadow.
- **Vertical footprint:** ~70–90px for a single-leg TO, ~100–130px multi-leg. Round-1 was 150–200px.

#### Timeline row (Mode B)
- **Before:** 28×28 padded outer ring around a 10px inner dot, 3-line body, hover border.
- **After:** single 8px dot directly anchored to the rail with `ring-background` halo (so the rail visually breaks at the dot — no extra wrapper). 2-line body:
  - **Line 1:** time (mono, tabular-nums) · TO badge (h-5) · mvmt pill (`size='sm'`) · material (mono) · `ml-auto` qty + uom.
  - **Line 2 (muted, `text-[10px]`):** source `<BinChip size='sm'>` → destination `<BinChip size='sm'>` · `<User>` createdBy · `<CheckCircle2>` confirmedBy (only when different from createdBy) · `<Timer>` duration.
- Whole body is the click target (was a card-style border with hover).
- Hover: `bg-accent/30` colour-only.
- Vertical footprint: ~50–65px (round-1 was 90–110px).

#### Day-cluster header
- **Before:** centred uppercase label + count between two `from-primary/30 to-primary/0 bg-linear-to-r` gradient hairlines + `border-b` rule.
- **After:** left-aligned `text-[10px] font-semibold tracking-widest uppercase` label · inline `text-[10px] tabular-nums text-muted-foreground/60 · N movements` count. No gradients. Sticky-positioned with `bg-card/30 backdrop-blur` so it remains readable when scrolled. Clusters are separated by a `border-t border-border/30` (only between, not before the first).

#### Containers
- **Journey (non-virtualised):** `<div className='border-x border-t border-border/40 bg-card/30 rounded-md overflow-hidden'>` — the wrapper has no bottom border; the last card's `border-b` doubles as the wrapper bottom edge so the box is closed cleanly without a 2px stack.
- **Journey (virtualised):** same wrapper class; absolute-positioned virtual items each render a `JourneyCard` which carries its own `border-b`. Virtualizer `estimateSize: () => 96` (was 240) and `overscan: 8` (was 6) to match the new dense card footprint.
- **Timeline:** `<Card className='border-border/40 bg-card/30 overflow-hidden shadow-none'>` with `<CardContent className='p-2'>` (was `p-4`). `<ScrollArea max-h-[70vh]>` preserved for performance.

### Two helpers added

- **`formatCompactTime(ms)`** (near the existing `formatDayHeader`) — same-day → `HH:MM:SS`, different day same year → `MMM DD, HH:MM`, different year → `MMM DD 'YY, HH:MM`. Lets the Journey footer fit `Created 02:54:07 PM` on a single chip on the most common case (a same-day TO that completed within minutes).
- **`<Sep />`** (just before `JourneyCard`) — a quiet `text-muted-foreground/40` `·` divider used everywhere in the dense rows. `aria-hidden`, `select-none`, `px-px` for visual rhythm.

### Vertical density delta (1440×900 laptop viewport)

| Surface | Before | After | Above-the-fold |
|---|---|---|---|
| Stat ribbon row | ~96px | ~60px | — |
| Toolbar | ~150px | ~120px | — |
| Journey single-leg TO card | ~150–180px | ~70–90px | 4–5 → 12+ |
| Timeline row | ~90–110px | ~50–65px | ~12 → ~22+ |

### Theme tokens used (no hardcoded colours)

- Surfaces: `bg-card`, `bg-card/50`, `bg-card/30`, `bg-accent/30`, `bg-background`
- Borders: `border-border/40`, `border-border/30`, `border-border/60`
- Text: `text-foreground`, `text-foreground/70`, `text-muted-foreground`, `text-muted-foreground/40` (sep), `text-muted-foreground/60` (cluster count), `text-muted-foreground/70` (per-leg item idx)
- Status (movement-type pill colours unchanged — `MOVEMENT_META` palette table); `bg-emerald-500` / `bg-amber-500` / `bg-rose-500` reserved for the 6–8px status dots and the timeline rail dot.
- Type ramp: `text-sm` for toolbar title only · `text-xs` for body content (material, dimensions) · `text-[11px]` for muted metadata + footer + filter-chip labels · `text-[10px]` for hints + uppercase eyebrows + chip badges · `text-[9px]` for storage-type sub-chips inside `BinChip`. Mono reserved for SAP codes; `tabular-nums` everywhere numbers stack across rows.

### Constraints satisfied

- **Information preserved.** Header still surfaces TO + status (dot) + every distinct movement type + material + description + qty + leg count. Bin trail still shows per-leg source→destination chips with item-index prefix. Footer still carries Created/Confirmed timestamps + users + duration + warehouse/plant + delivery. The only field hidden on narrow viewports is `description` (`hidden md:inline`); it remains in the detail drawer regardless.
- **No new dependencies.** Pure shadcn/ui primitives + Tailwind tokens.
- **No `AGENT_VERSION` bump** — pure FE refinement.
- **No new `supabase.channel(...)` callsites** (per [[realtime-policy]]).
- **Virtualisation preserved** — `@tanstack/react-virtual` still kicks in at >80 journeys.
- **Theme-aware in light + dark.**
- **Animation discipline** — colour-only transitions (`transition-colors duration-75`); no `translate`, `scale`, or `shadow-md` lifts.
- **Detail drawer left untouched** — destination, not a constant on-screen surface.

### Quality gates

- `pnpm exec tsc -b --noEmit` — clean (20.5s).
- `pnpm build` — clean (9.86s). `feature-admin-sap`: 379.91 KB → 380.65 KB raw / 96.22 KB → 96.32 KB gzip (+0.74 KB raw / +0.10 KB gzip; well within budget).
- `pnpm lint:check` — 0 errors, 91 warnings (unchanged baseline; touched file is 0/0).
- `ReadLints` — zero diagnostics on the touched file.

### Files

- MODIFIED `src/features/admin/sap-testing/components/transfer-order-history-view.tsx` — five major rewrites:
  - **Lines ~263–290 (helpers):** added `formatCompactTime` near the existing date helpers.
  - **Lines ~782–815 (helpers):** added `Sep` component just before `JourneyCard`.
  - **Lines ~819–1020 (`JourneyCard`):** complete rewrite — single-line header, tight bin trail row, inline footer with `·` separators.
  - **Lines ~1095–1210 (`TimelineRow`):** complete rewrite — 8px dot with `ring-background`, 2-line body.
  - **Lines ~1380–1410 (`FilterChip`):** padding `px-2.5 py-0.5` → `h-6 px-2`, hover `bg-muted` → `bg-accent`.
  - **Lines ~1690–1820 (stat ribbon):** dropped Card wrappers, used inline bordered tiles.
  - **Lines ~1820–1990 (toolbar + filter bar):** softened Card chrome, `h-7` toggle, `max-w-xs` search, tighter chip rows.
  - **Lines ~1996–2110 (main render area):** new bordered Journey wrapper (`border-x border-t`), Timeline cluster minimal headers, virtualizer estimateSize 240 → 96.

### Open items

- No commit / push performed — ready for user review.
- Detail drawer (`<DetailDrawer>`) left untouched — open follow-up if user wants the same compact pass applied to it (it's a destination, so the round-1 generosity reads OK there).

### Related

- [[Sessions/2026-05-09]] § "LT24 Journey/Timeline — compact + elegant pass"
- [[Components/LT24 - Transfer Order History]]
