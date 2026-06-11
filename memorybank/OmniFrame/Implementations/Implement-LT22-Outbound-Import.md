---
tags: [type/implementation, status/completed, domain/frontend, domain/backend, domain/database]
created: 2026-04-29
---
# Implement LT22 Outbound TO Import

## Purpose / Context
Gives outbound users a one-click way to pull every open / waiting transfer order from SAP via LT22 directly into the OmniFrame outbound data manager — no more clipboard paste from a saved Smartsheet. Backed by the on-prem OmniFrame SAP agent (no SAP credentials in the cloud) and routed through the existing `sap_agent_jobs` queue so the run survives a page reload.

User's recorded selection-screen path lives in `omni_bridge/sap_scripts/DeliveryData.vbs` (verbatim copy of the original).

## Migration
`supabase/migrations/250_create_sap_outbound_to_imports.sql` — applied via Supabase MCP `apply_migration` (project `wncpqxwmbxjgxvrpcake`).

Two tables, both org-scoped via `user_profiles.organization_id IN (...)` RLS (matches the project's existing `sap_agent_jobs`, `sap_audit_log`, `sap_agents` pattern — the `auth.jwt()->>'org_id'` shape from the original spec was rewritten because this project does NOT mint an `org_id` JWT claim).

- `public.sap_outbound_to_imports` — append-only TO snapshot. Unique `(organization_id, to_number, import_batch_id)` so a re-run of the same batch is idempotent. Indexes on `(org, to_number)`, `(org, warehouse, status)`, `(org, imported_at desc)`, `(org, import_batch_id)`.
- `public.sap_outbound_to_import_runs` — per-job ledger (queued → running → completed/failed/partial/canceled). Realtime publication + REPLICA IDENTITY FULL drives the status pill in `<ImportLt22Dialog />`.

## Agent module — `omni_agent/lt22_import.py`
FastAPI `APIRouter` (mounted by `agent.py` near the bottom alongside `material_master_read` + `reversal_engine`). One endpoint:

- `POST /sap/import-lt22` — request body `Lt22ImportRequest` (warehouse, storage_type, show_verified, show_open_waiting, layout_variant="ONEBOXAPPX", date_from/to, organization_id, triggered_by, import_run_id).

Flow:
1. PATCH the `sap_outbound_to_import_runs` row to `status='running'`, stamp `agent_id` (`_agent_self_id()`), `started_at`.
2. `/nLT22` → fill `chkT3_SEVON`, `chkT3_SENAC`, `ctxtT3_LGNUM`, `ctxtT3_LGTYP-LOW`, `ctxtLISTV` → optional `ctxtT3_BDATU-LOW/HIGH` if the variant exposes them → press `btn[8]` (F8) with sendVKey 8 fallback.
3. Empty-result detection on the status bar (`no data`, `no transfer orders`, `no records found`, `no records selected`) — short-circuits to `status='completed', rows_imported=0`.
4. Bulk-export via `_extract_via_pc_export()` (Phase B4 `%pc → Unconverted` path). Falls back to `_extract_sap_list_output()` if the SAP variant rejects the export dialog.
5. `normalize_lt22_row()` fuzzy-matches column titles (lowercased) against ~5 aliases per field (handles SAP's English/German/abbreviated headers AND the `ONEBOXAPPX` layout variant). Drops rows without a TO number. Numbers handle SAP trailing-minus + comma thousands separators; dates try `MM/DD/YYYY`, `DD.MM.YYYY`, `YYYY-MM-DD`, `YYYYMMDD`.
6. Batch-INSERT to PostgREST in chunks of 500 (auth via `state.supabase_token`; respects RLS).
7. PATCH the run row to terminal state with `rows_imported`, `duration_ms`, `completed_at`. `_log_sap_txn` for the audit log.

Capability id (foreground merges into `AGENT_CAPABILITIES`): `import-lt22`. **`AGENT_VERSION` was NOT bumped per spec.**

## Frontend
### Dialog — `src/features/outbound/components/import-lt22-dialog.tsx` (~470 LOC)
- Read-only agent strip showing `<agent name> · v<version>` (or amber when unavailable).
- Form: warehouse (sticky), storage type (sticky, defaults `916`), layout variant (sticky, defaults `ONEBOXAPPX`), Switch toggles for `show_open_waiting` (default ON, T3_SENAC) and `show_verified` (default OFF, T3_SEVON), optional date range, optional pin-to-agent dropdown (only shown when ≥2 online agents).
- Submit: INSERT `sap_outbound_to_import_runs` (status=queued) → INSERT `sap_agent_jobs` with `endpoint='/sap/import-lt22'`, `payload.import_run_id=run.id`, `priority=80`, optional `assigned_agent_id`. Idempotency key `lt22-<run.id>` so accidental double-clicks no-op. Patches the run row with the resulting `job_id` for cross-linking.
- Realtime subscription on `sap_outbound_to_import_runs.id=eq.<run.id>` → live status pill (queued / running / completed / failed) with rows count + agent id + retry button on failure.
- On `completed` → toast + 800ms delay + close + invoke `onImported(rows)` so the data-manager grid refreshes.
- Recent runs list: last 5 from the same warehouse, color-coded by status with relative time.

### Wired into `src/components/outbound-data-manager.tsx`
Replaced the lone `<Button onClick={handleImportData}>Import Data</Button>` with `<SmartImportButton options=[csv, agent] />`. CSV option preferred when no agent; agent option preferred + visible only when one is detected. Mounts `<ImportLt22Dialog />` next to the existing modals; `onImported` calls `refreshData()`.

## Build
- `npm run build` — passes (~10.3s). `feature-outbound` chunk grew with the new dialog → 210.75 KB / 47.38 KB gzipped. `feature-admin-sap` grew slightly with the shared hook.
- `python3 -c 'import ast; ast.parse(open("omni_agent/agent.py").read())'` and same on `lt22_import.py` — pass.
- `agent.py` + `lt22_import.py` copied to `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/`.

## Decisions worth user review
1. **RLS rewritten to use `user_profiles` lookup.** The spec used `(auth.jwt()->>'org_id')::uuid`, which would have produced a no-op policy in this project (verified: `current_setting('request.jwt.claims', true)` returns `NULL` and the JWT contains no `org_id` claim). Rewrote to match the project's existing `sap_agent_jobs` / `sap_agents` pattern. Functionally equivalent, demonstrably correct.
2. **`/sap/import-lt22` is now a registered queue endpoint** (`_JOB_ENDPOINT_MODELS['/sap/import-lt22'] = Lt22ImportRequest`) so the existing `_dispatch_job` path handles queue claims without a one-off branch. Patched dynamically inside the include_router try-block so a missing module doesn't pollute the queue map.
3. **Layout variant defaults to `ONEBOXAPPX`** — the customer's pre-built outbound-friendly column set the user mentioned. Free-text input so a different warehouse can swap to its own layout without a code change.
4. **`agent_id` is `_agent_self_id()`** (`<HOST>-<SESSIONNAME>-<PID>`) — same identifier used by the multi-agent fleet for `claimed_by` so cross-references work across `sap_agents`, `sap_agent_jobs`, and the new run ledger.
5. **Fallback extraction.** `_extract_via_pc_export` is the default because LT22 result sets are routinely 5K-15K rows and Ctrl+PgDn pagination is painful. The fallback to `_extract_sap_list_output` keeps the endpoint working on SAP variants where the export dialog has different control IDs.
6. **Idempotency key `lt22-<run_id>`** — protects against double-submit if the user mashes the button or the network blips between the run-row INSERT and the job INSERT.

## Concrete next steps for the user
1. Open Parallels → `cd C:\OmniFrameBridge\Omni-Agent && build_exe.bat` to rebuild the EXE with `lt22_import.py` bundled (PyInstaller auto-discovers it from the import in `agent.py`).
2. Push frontend to `main` (the Smart Import Button auto-promotes the agent option as soon as the new EXE comes online).
3. Foreground: merge `import-lt22` into `AGENT_CAPABILITIES` at the next agent version bump.

## Related
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Patterns/Smart-Import-Button]]
- [[Patterns/Agent-Capability-Negotiation]]
- [[Implementations/Job-Queue-Architecture]]
- [[Implementations/Bulk-Export-via-pc]]
