---
tags: [type/implementation, status/completed, domain/backend, domain/frontend, domain/database, worker-c]
created: 2026-04-29
completed: 2026-04-29
---
# Implement: Reversal / Rollback Engine (Phase D #15) — SHIPPED

## Purpose / Context
Mass MM02 / LS01N / LS02N updates occasionally need to be undone (typo in the CSV, wrong warehouse selected, etc.). With Phase A3's `sap_audit_log` we now have the per-row "before" and "after" state for every successful mutation. The reversal engine generates the inverse SAP transactions and feeds them back through the existing `sap_agent_jobs` queue.

## Implementation summary
Worker-C touched only the new module + the existing inventory tab's `kind: 'tool'` plumbing. Did NOT modify the existing mutation handlers in `agent.py`, did NOT bump `AGENT_VERSION`, and did NOT modify `/health.capabilities` directly — left a `WORKER-C-CAPABILITIES` comment for foreground merge into `AGENT_CAPABILITIES`.

The inverse for every supported action runs through the SAME mutation endpoint as the forward call, just with a transformed payload. Reversal is *not* a new SAP workflow — it's the existing one with the dict swapped or a flag flipped.

## Schema (migration `249_add_reversal_to_audit_log.sql`)
Three additive columns on `public.sap_audit_log`:
- `reverses_audit_id UUID` — when this row IS a reversal of an earlier mutation, points at the original.
- `reversal_status TEXT` — `original | reversal | reversed | cannot_reverse` (NULL on legacy rows).
- `prev_state JSONB` — pre-mutation snapshot the engine needs to invert this action (e.g. `{storage_bin: 'OLD-BIN-A-01'}`).

Plus two indexes:
- `idx_sap_audit_log_lookup` on `(transaction_code, organization_id, created_at DESC)` — fast filter for the reversal browser UI.
- `idx_sap_audit_log_reverses_audit_id` partial index on rows where `reverses_audit_id IS NOT NULL`.

Plus a SECURITY DEFINER RPC `mark_audit_row_reversed(p_original_id, p_reversal_id)`:
- Org-scoped via `auth.uid()` lookup → `user_profiles.organization_id`.
- Pre-condition checked: original must currently be 'original' or NULL (no double-reversal); reversal must already be 'reversal' with `reverses_audit_id` pointing at the original.
- Returns BOOLEAN. Permissively callable by `authenticated`; nothing else.
- Avoids opening a permissive UPDATE policy on `sap_audit_log` (which remains append-only via RLS).

## Inversion semantics (`omni_agent/reversal_engine.py`)

| Action | Forward | Inverse | Needs prev_state? |
|---|---|---|---|
| `material_master_bin` | bin = NEW | bin = prev_state.storage_bin | yes |
| `material_master_storage_types` | LTKZA=A, LTKZE=B | LTKZA=prevA, LTKZE=prevB | yes |
| `transfer_inventory` | (T_a/B_a) → (T_b/B_b) | (T_b/B_b) → (T_a/B_a) | no — pure swap |
| `set_bin_blocks` | putaway=X removal=Y | putaway=prevX removal=prevY | yes |
| `confirm_transfer_order` (LT12) | confirm | **IRREVERSIBLE** | n/a |

`compute_inverse(action, payload, prev_state)` returns the inverse `dict` or `None`. `None` flags a row as 'cannot reverse' in the UI. The function is pure and unit-testable; the FastAPI endpoint is a thin wrapper.

## Agent — `omni_agent/reversal_engine.py` (~180 LOC, new module)
Single FastAPI `APIRouter` mounted at the bottom of `agent.py`:
- `POST /sap/reversal/compute-inverse` — pure compute, no SAP calls. Returns either `{ok: true, reversible: true, inverse_payload, endpoint}` (where `endpoint` is the SAME mutation endpoint as the forward call) or a structured `{ok: false, reversible: false, reason, message}` for irreversible / unsupported / missing-prev_state cases.

## Agent — `omni_agent/agent.py` registration glue (~20 LOC)
Just before `def main()`:
```python
# WORKER-C-CAPABILITIES: 'reversal-engine'
try:
    from reversal_engine import router as _reversal_router
    app.include_router(_reversal_router)
    print("[boot]   Mounted reversal_engine router (1 endpoint: /sap/reversal/compute-inverse)")
except Exception as _e:
    print(f"[boot]   WARN reversal_engine import failed: {_e}")
```
The capability comment is the foreground signal — merge `reversal-engine` into `AGENT_CAPABILITIES` at the next agent bump.

## Frontend — new component `reversal-panel.tsx` (~720 LOC)
Time-machine UI under the existing `kind: 'tool'` Query Library entry:
- Date-range filter (default last 24h), action type (multi → single), user_id, status, free-text payload search.
- Sortable table of audit rows with per-row checkbox; "select all visible" master checkbox.
- Selected count + estimated reversal time (`N × 2s avg per mutation`).
- **Compute Inverse**: parallel `POST /sap/reversal/compute-inverse` for every selected row. Renders a preview dialog showing each row's inverse summary with red flags for irreversible / missing-prev_state rows.
- **Queue Reversal Batch**: walks reversible rows, calls `useJobQueue.submitAndWait` for each (priority 50), writes a new `reversal` audit row via `insertReversalAuditRow` with `reverses_audit_id` pointing at the original, then invokes `markAuditRowReversed` RPC to flip the original's `reversal_status` to `'reversed'`. Live progress bar + per-row status chips.
- Capability-gated via `requiredCapability: 'reversal-engine'`. Agent without that capability shows an "agent v1.5.0+ required" badge in the card header.

## Frontend — `lib/sap-audit.ts` extensions
Added three optional fields to `SapAuditEntry`:
- `prevState?: Record<string, unknown> | object | null`
- `reversalStatus?: 'original' | 'reversal' | 'cannot_reverse' | null`
- `reversesAuditId?: string | null`

Plus two new helpers:
- `insertReversalAuditRow(entry & {reversesAuditId})` — writes the row + returns `id`.
- `markAuditRowReversed(originalId, reversalId)` — calls the SECURITY DEFINER RPC, returns boolean.

`logSapAudit` only writes the new columns when supplied so old call sites remain unchanged byte-for-byte.

## Frontend — `inventory-management-tab.tsx` wiring
1. Imported `RotateCcw` icon, `ReversalPanel`.
2. Extended `toolId` union to `'recorder' | 'reversal-engine'`.
3. Added a new `QUERY_LIBRARY` entry under category `tools`:
   ```ts
   { id: 'reversal-engine', name: 'Reversal Engine', transaction: 'AUDIT',
     category: 'tools', icon: RotateCcw, kind: 'tool',
     toolId: 'reversal-engine', requiredCapability: 'reversal-engine', inputs: [] }
   ```
4. Extended the `kind: 'tool'` render switch to mount `<ReversalPanel />` for `toolId === 'reversal-engine'` (same shape as the existing recorder entry).
5. `runMutation` and `runBatch` now forward `prev_state` from the agent response (when present) and pass `reversalStatus: 'original'` to `logSapAudit`. Today no agent endpoint returns `prev_state`; this is forward-compatible plumbing for once Worker B's dry-run captures pre-state and threads it back. Until then the audit row stores `prev_state = NULL` and the reversal engine flags the row as "cannot reverse — no prev_state captured".

## Capabilities to merge into `AGENT_CAPABILITIES`
- `reversal-engine`

## File paths
- `supabase/migrations/249_add_reversal_to_audit_log.sql` — new
- `omni_agent/reversal_engine.py` — new
- `omni_agent/agent.py` — +20 LOC (router include glue + WORKER-C-CAPABILITIES comment)
- `src/features/admin/sap-testing/components/reversal-panel.tsx` — new (~720 LOC)
- `src/features/admin/sap-testing/lib/sap-audit.ts` — extended (`prevState`, `reversalStatus`, `reversesAuditId`, `insertReversalAuditRow`, `markAuditRowReversed`)
- `src/features/admin/sap-testing/components/inventory-management-tab.tsx` — QUERY_LIBRARY entry, render switch, prev_state forwarding in runMutation/runBatch

## Build status
- `npm run build` — passes (~9.4s). `feature-admin-sap` chunk grew from 332.6 KB → 372.97 KB (absorbed the reversal panel).
- `python3 -m py_compile omni_agent/agent.py omni_agent/reversal_engine.py` — passes.
- Migration applied via Supabase MCP `apply_migration` (project `wncpqxwmbxjgxvrpcake`).

## Files copied to bridge folder for Parallels rebuild
- `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py`
- `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/reversal_engine.py`

## Edge cases
- **Original op didn't capture before-state**: row flagged as "cannot reverse — no prev_state captured" in the preview pane. Skipped at queue time.
- **LT12 confirmations**: hard-coded "irreversible" — confirms are atomic in SAP. UI shows a red "irreversible" badge; the row is skipped.
- **Subsequent edits after the original op**: not currently surfaced in the preview. Future enhancement: show "last 3 ops on this same key" so the user can assess whether the inverse will revert later corrections.
- **Time bound**: not enforced. The user can browse arbitrary historical rows; warn copy is on the operator.
- **Double-reversal**: prevented at the SQL layer — `mark_audit_row_reversed` RPC rejects when the original is already 'reversed'. Even if the UI somehow re-queues, the second attempt's RPC call fails benignly and the audit row stays consistent.

## Decisions made worth user review
1. **`mark_audit_row_reversed` is a SECURITY DEFINER function rather than a relaxed RLS UPDATE policy.** Keeps the audit log strictly append-only at the table level; reversal mutation goes through a single, state-checked function. If you want to extend it (e.g. attach a comment), edit the function rather than opening up UPDATE.
2. **Reversal jobs run at priority 50** (vs. 100 for the regular batch path). Higher priority so unblocking a typo doesn't queue behind in-flight bulk runs.
3. **Inverse computation is server-driven via the agent endpoint** even though the same logic lives on the client. We keep one source of truth (`compute_inverse` in Python) and call it from the UI so the reversal logic ships with the agent EXE; the frontend stays a thin renderer. Cost: an extra round-trip per row. Acceptable because it's pure compute and runs in parallel.
4. **`prev_state` is NULL today.** Worker C didn't reach into the dry-run dialog (Worker B's territory). The audit-write helper accepts `prevState` and the columns exist; once the dry-run dialog threads its read results back into runMutation/runBatch (or any future mutation endpoint returns `prev_state` in its response), every new audit row will be reversible. Existing rows pre-Phase D #15 stay flagged as "cannot reverse — no prev_state".
5. **The reversal panel reads `sap_audit_log` directly via the Supabase client**, not through the agent. RLS does the filtering. No new HTTP surface needed for browsing.

## Concrete next steps for the user
1. Open Parallels → `cd C:\OmniFrameBridge\Omni-Agent && build_exe.bat` to rebuild the EXE with `reversal_engine.py` bundled (PyInstaller picks it up automatically because `agent.py` imports it via `app.include_router`).
2. Foreground merge `reversal-engine` into `AGENT_CAPABILITIES` at the next agent version bump alongside Workers A + B's new caps.
3. Wire the dry-run dialog (#11) to thread `prev_state` into the runMutation / runBatch audit calls so newly-committed rows become reversible end-to-end.
4. Test in OmniFrame UI → Admin → SAP Testing → Inventory Management → pick **Reversal Engine** in the Tools section of the Query Library → filter to recent successful mutations → select rows → **Compute Inverse** → **Queue Reversal Batch**.

## Related
- [[Implementations/SAP-Audit-Trail]]
- [[Implementations/Job-Queue-Architecture]]
- [[Patterns/Agent-Capability-Negotiation]]
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Components/Inventory-Management - SAP Query Framework]]
- [[Components/SAP-Reversal-Engine]]
