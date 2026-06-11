---
tags: [type/implementation, status/active, domain/backend, domain/frontend]
created: 2026-04-29
---
# Implement: Material-Master Diff / Dry-Run Preview (Phase D #11)

## Purpose / Context
Before bulk-running 500+ MM02 storage-bin or storage-type updates, users want a "dry run" preview that shows for each row: current SAP value vs proposed new value. Reduces accidental mass changes ("oops, I had a typo in the column header").

## Schema changes
None required. Reuses `sap_audit_log` for the dry-run trace if we want to persist them. Optional: add a `dry_run BOOLEAN` column to `sap_agent_jobs` if we route dry runs through the queue.

## Agent endpoints
- New `POST /sap/dry-run/material-master-bin` — opens MM02, navigates to the Warehouse Mgmt 2 tab, reads the current `MLGT-LGPLA` value, then **does NOT save**. Returns `{current_bin, proposed_bin, would_change: bool}`.
- Same shape for `/sap/dry-run/material-master-storage-types` (read `MLGN-LTKZA`, `MLGN-LTKZE`).
- Both new endpoints must press Back / cancel after reading so the next call starts clean.

## Frontend components
- Add a "Preview" button next to "Run Batch" in `BatchModePanel` that runs each row through the new dry-run endpoint and renders a diff table:
  | Row | Material | Plant | Current Bin | Proposed Bin | Will Change? |
- Highlight no-op rows (current == proposed) so the user can decide whether to skip.
- "Confirm + Run" button kicks off the actual write batch.

## File paths to edit
- `omni_agent/agent.py` — new dry-run endpoints
- `src/features/admin/sap-testing/components/inventory-management-tab.tsx` — Preview button, diff dialog
- `src/features/admin/sap-testing/components/agent-health-card.tsx` — extend metrics action list with `dry_run_*`

## Edge cases
- **Material doesn't exist**: dry run still returns the SAP error, marked "would-fail".
- **WM view not extended**: dry run reports "no current value" so the user knows the row would either fail or create the extension.
- **Slow batches**: dry-run scales linearly with rows. Consider batching 10 dry runs per UI tick so the table updates progressively.

## Effort estimate
Medium. ~150 lines agent, ~250 lines frontend. ~1 day.

## Related
- [[Implementations/Job-Queue-Architecture]]
- [[Implementations/SAP-Audit-Trail]]
