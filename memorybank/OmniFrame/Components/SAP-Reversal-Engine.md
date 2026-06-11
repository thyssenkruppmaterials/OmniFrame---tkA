---
tags: [type/component, status/active, domain/frontend, domain/backend, domain/database, reversal]
created: 2026-04-29
---
# SAP Reversal Engine

## Purpose / Context
Phase D #15 "time machine" for SAP mutations. Lives as a `kind: 'tool'` entry in the SAP Testing Inventory Management tab next to the [[SAP-Recorder]]. Lets an authorised user browse `sap_audit_log`, select past mutations, preview their inverse, and queue a reversal batch through the existing [[Implementations/Job-Queue-Architecture]].

## Architecture
Three layers:
1. **Database** — `sap_audit_log` was extended (migration 249) with `prev_state` JSONB, `reversal_status` enum, `reverses_audit_id` self-FK, plus a SECURITY DEFINER `mark_audit_row_reversed(original_id, reversal_id)` RPC that flips an `original` row to `reversed` once the inverse lands. The audit log stays append-only at the table level; the RPC is the only sanctioned mutator.
2. **Agent** (`omni_agent/reversal_engine.py`) — pure-python `compute_inverse(action, payload, prev_state)` plus a single FastAPI endpoint `POST /sap/reversal/compute-inverse` that surfaces it to the browser. Mounted at the bottom of `agent.py` via `app.include_router()`. Reversal jobs themselves go through the *existing* mutation endpoints (`/sap/material-master-bin`, `/sap/transfer-inventory`, `/sap/bin-blocks`, `/sap/material-master-storage-types`) — no new SAP-side workflow.
3. **Frontend** — `src/features/admin/sap-testing/components/reversal-panel.tsx` renders the filter / table / preview / queue UI. Reads `sap_audit_log` directly via the Supabase client (RLS-filtered), enqueues reversal jobs through the existing `useJobQueue.submitAndWait` hook, writes new `reversal` audit rows via `insertReversalAuditRow`, and finalises with `markAuditRowReversed`.

## Inverse semantics
| Action | Inverse strategy | prev_state needed? |
|---|---|---|
| `material_master_bin` | restore previous bin | yes |
| `material_master_storage_types` | restore previous LTKZA / LTKZE | yes |
| `transfer_inventory` | swap source ↔ dest | no (pure swap) |
| `set_bin_blocks` | flip flags back to previous | yes |
| `confirm_transfer_order` | **IRREVERSIBLE** — UI flags red and skips | n/a |

Anything else returns None and is treated as "cannot reverse — unsupported action".

## File paths
- `supabase/migrations/249_add_reversal_to_audit_log.sql`
- `omni_agent/reversal_engine.py` (~180 LOC)
- `omni_agent/agent.py` — registration glue + `WORKER-C-CAPABILITIES: 'reversal-engine'` comment
- `src/features/admin/sap-testing/components/reversal-panel.tsx` (~720 LOC)
- `src/features/admin/sap-testing/lib/sap-audit.ts` — `insertReversalAuditRow`, `markAuditRowReversed`, extended `SapAuditEntry`
- `src/features/admin/sap-testing/components/inventory-management-tab.tsx` — `QUERY_LIBRARY` entry, render switch, `prev_state` forwarding in `runMutation` / `runBatch`

## Capability
- Reported via `AGENT_CAPABILITIES` as `reversal-engine` (foreground merge — Worker C left a `WORKER-C-CAPABILITIES` comment).
- The Reversal Engine entry in the Query Library is gated via `requiredCapability: 'reversal-engine'`. Older agents render the panel disabled with an "agent v1.5.0+ required" badge.

## Reversal lifecycle on `sap_audit_log`
```
created      reversal_status   reverses_audit_id   prev_state
 ──────────  ────────────────  ──────────────────  ──────────
 forward          'original'        NULL          {storage_bin: OLD}
 reversal         'reversal'        original.id   NULL  (not strictly needed)
                                                          │
                  RPC: mark_audit_row_reversed(            │
                  original.id, reversal.id)                │
                  ↓                                        │
 forward          'reversed'        NULL          {storage_bin: OLD}
```

## Edge cases & guarantees
- **No double-reversal**: the RPC rejects when the original is already `'reversed'`. UI also dedupes by hiding rows that already have `reversal_status = 'reversed'` from the eligible set.
- **No cross-org reversal**: the RPC enforces org-equality between caller, original, and reversal.
- **Best-effort prev_state**: if missing, the row is skipped at queue time with a "no prev_state captured" reason — it never enqueues a half-baked inverse.
- **LT12 always irreversible**: the agent's `compute_inverse` returns None unconditionally for `confirm_transfer_order`. Frontend renders a red "irreversible" badge.

## Related
- [[Implementations/Implement-Reversal-Rollback-Engine]]
- [[Implementations/SAP-Audit-Trail]]
- [[Implementations/Job-Queue-Architecture]]
- [[Patterns/Agent-Capability-Negotiation]]
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Components/SAP-Recorder]]
