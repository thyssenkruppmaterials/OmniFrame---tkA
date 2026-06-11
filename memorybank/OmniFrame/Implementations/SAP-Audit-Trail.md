---
tags: [type/implementation, status/active, domain/backend, domain/database, domain/frontend]
created: 2026-04-29
---
# SAP Audit Trail

## Purpose / Context
Append-only audit log of every SAP automation outcome (LT12, LT01, LS02N, MM02 storage bin, MM02 storage types, LS01N, ZV26, VL02N, VT01N, …). Phase A3 of the Tier-1 plan. Source of truth for the future rollback engine ([[Implement-Reversal-Rollback-Engine]]) and for cross-warehouse compliance reporting.

The existing `sap_transaction_logs` table is per-delivery and shipment-specific. `sap_audit_log` captures every action regardless of tying to a delivery, normalises the row shape across all transactions, and is written from the **authenticated browser** (not the agent) so the agent doesn't need its own Supabase token.

## Schema (migration 246)
- `public.sap_audit_log`
  - `id`, `organization_id`, `user_id`
  - `transaction_code` (e.g. LT12, LS02N, MM02)
  - `action` (handler name, e.g. `material_master_bin`)
  - `payload` JSONB, `result` JSONB
  - `status` CHECK success/error/warning
  - `step` (e.g. `org_levels_popup`, `save`)
  - `sap_message`, `sap_message_type` (S/E/A/W)
  - `agent_version`, `duration_ms`
  - `job_id` (optional FK back to `sap_agent_jobs`)
- Indexed on `(organization_id, created_at DESC)`, `(organization_id, action, created_at DESC)`, `(organization_id, status)`, `(user_id)`, `(job_id)`
- RLS: org-scoped SELECT/INSERT only (no UPDATE/DELETE — append-only)

## Frontend helper
`src/features/admin/sap-testing/lib/sap-audit.ts`
- `logSapAudit(entry)` — async, swallows errors so audit logging never blocks user-visible operations.
- Resolves `(user_id, organization_id)` once per page load and caches.

## Where it's called from
- `inventory-management-tab.tsx`: `runMutation`, `runBatch` (each row), `TransferInventoryDialog`, `BinBlocksDialog`
- The Agent Triggers runtime can be extended later to log post-success/post-failure.

## File paths edited
- `supabase/migrations/246_create_sap_audit_log.sql`
- `src/features/admin/sap-testing/lib/sap-audit.ts` — new
- `src/features/admin/sap-testing/components/inventory-management-tab.tsx` — integrations

## Edge cases
- **Anonymous session**: `logSapAudit` no-ops when `organization_id` can't be resolved, avoiding RLS violations and noise.
- **Network failure**: caught and logged to console; SAP operation still completes.
- **Type drift**: `payload` and `result` use the loose `Record<string, unknown> | object` types so endpoints with strict response interfaces (`TransferInventoryResponse`, `BinBlocksResponse`) can be passed in directly.

## Related
- [[Implementations/Job-Queue-Architecture]]
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Implementations/Implement-Reversal-Rollback-Engine]]
