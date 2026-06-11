---
tags: [type/debug, status/active, domain/backend, domain/infra]
created: 2026-04-14
---
# Fix — LX03 btn[16] is Dynamic Selections, not a Variant Picker

## Purpose / Context
Initial `handler_lx03` in `omni_agent/agent.py` described the flow as "select the /OmniFrame variant from a user-specific favorites tree." That was wrong. Reviewing the LX03 screenshot showed what btn[16] actually does.

## Details

### What the recording actually does

1. `/nLX03` → Bin Status Report: Initial Screen.
2. **btn[16]** toggles **Dynamic Selections** mode — SAP-standard feature in many selection screens (LX03, MB51, VA05, etc.). It reveals:
   - a left-side tree of selection criteria (Storage bins, Quants → Warehouse Number / Quant / Material / Plant / Batch / Stock Category / Special Stock)
   - an empty "dynamic fields" panel on the right.
3. Expanding node `"         48"` opens the **Quants** folder.
4. Double-clicking node `"         51"` (**Material**) **adds** Material as the first dynamic selection criterion. This creates an input field named `%%DYN001-LOW` on the right-side panel.
   - If we added Plant next, it would become `%%DYN002-LOW`, and so on. Numbering is by order of addition.
5. `chkPMITB` = **"Only Bins with Stock"** checkbox in Program Parameters, not a variant-specific flag.
6. Standard fields: `S1_LGNUM` (Warehouse), `S1_LGTYP-LOW` (Storage type).
7. F8 executes → ALV grid of bin rows.

### Why this matters

- Tree node IDs `"         48"` (Quants) and `"         51"` (Material) are **SAP-standard**, not user-specific favorites. Same for every user with LX03 access on the same SAP version. Handler works for anyone — no per-user setup.
- Old docstring/errors said "your variant favorites tree may differ" — misleading. Corrected to describe the actual Dynamic Selections mechanism.
- Trivially extensible: to filter by additional criteria, add more `tree.doubleClickNode(...)` calls and write to `%%DYN002-LOW`, `%%DYN003-LOW`, etc.

### Code changes

- Renamed params: `variant_folder_node` → `quants_folder_node`, `variant_node` → `material_attr_node`.
- Added param `only_bins_with_stock: bool` (default True) wired to `chkPMITB`.
- Rewrote docstring and error messages in terms of "Dynamic Selections" and "SAP-standard tree nodes".
- Frontend `inventory-management-tab.tsx` LX03 description updated.

## Related
- [[Component - Omni-Agent Query Framework]]
- [[Implementation - Inventory Management Tab]]