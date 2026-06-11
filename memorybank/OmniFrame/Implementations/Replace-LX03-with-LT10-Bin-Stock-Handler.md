---
tags: [type/implementation, status/active, domain/backend, domain/frontend]
created: 2026-04-18
---
# Replace LX03 with LT10 for Bin Stock Lookups

## Purpose / Context
LX03 required a multi-step Dynamic Selections dance (toggle btn[16], expand Quants folder, double-click Material leaf, then write to `%%DYN001-LOW`). The LT10 "Stock Transfer: Start" screen exposes the same data through standard named context fields on a single selection screen — simpler, faster, and portable across users/SAP versions. User recorded `LT10xScript.vbs` and asked to swap.

## Details

### LT10 flow (from `omni_bridge/sap_scripts/LT10xScript.vbs`)
```
/nLT10
wnd[0]/usr/ctxtS1_LGNUM        = warehouse (e.g. WH5)
wnd[0]/usr/ctxtS1_LGTYP-LOW    = storage type (default '*')
wnd[0]/usr/ctxtMATNR-LOW       = material number
wnd[0]/tbar[1]/btn[8].press    # F8 execute
```
Result screen ("Stock Transfer: Overview") is an ALV grid with columns:
`I, Typ, St, Material, Plnt, SLoc, StorageBin, Avail.st, Stock, Inv.D, S, TO number, Special Stock Number, Last mvmt, Batch, Last inv., PutawayS, Pick qty, Last changer`

### Files changed
- **`omni_agent/agent.py`** — removed `handler_lx03`, added `handler_lt10`. Registry entry `"lt10": handler_lt10`. Updated 3 doc comments that referenced LX03. Result extraction uses `_extract_alv_grid` with a `_extract_table_control` fallback.
- **`src/features/admin/sap-testing/components/inventory-management-tab.tsx`** — query-library entry renamed from `lx03-bin-stock` → `lt10-bin-stock`, transaction `LX03` → `LT10`, handler `lx03` → `lt10`, description rewritten.
- **`omni_bridge/sap_scripts/LT10xScript.vbs`** — archived the user's recording in-tree.

### Why this is better
- **One screen.** No tree expansion, no double-click node, no dynamic field probing.
- **Standard fields.** `ctxtMATNR-LOW`, `ctxtS1_LGNUM`, `ctxtS1_LGTYP-LOW` are SAP-standard; they exist in every SAP version with LT10 access, no per-user setup.
- **TO number column included.** LT10's Overview grid shows the TO number natively, which is exactly what the Putaway/Confirm-TO workflow needs — future enhancement: click a row → pre-fill LT12 confirm.
- **Fewer failure modes.** Nothing to go wrong in Dynamic Selections tree traversal.

### Distribution status
Agent rebuilt in Parallels + uploaded to Supabase Storage `downloads/OmniFrame_Agent.zip` (public URL). See [[Fix-Agent-Distribution-Issues]].

## Related
- [[Component - Omni-Agent Query Framework]]
- [[Implementation - Inventory Management Tab]]
- [[Fix-LX03-Dynamic-Selections-vs-Variant-Picker]]