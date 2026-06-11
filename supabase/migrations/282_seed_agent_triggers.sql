-- Phase 9 of `.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md` —
-- companion seed migration to `281_create_agent_triggers.sql`.
--
-- DESIGN DECISION: NO DATA SEEDED.
--
-- Per the Phase 9 plan and the Option C ("full dynamic DSL") commitment,
-- the canonical user-facing path is admin → CRUD UI in the SAP Testing
-- "Agent Triggers" tab → INSERT into `agent_triggers`. Seeding default
-- rows in this migration would (a) implicitly create rules per-org
-- without admin consent (mirrors the `_HARDCODED_TRIGGERS` problem this
-- phase exists to solve), and (b) make the post-Phase 9 fleet behavior
-- diverge between orgs that ran 282 in different states.
--
-- Admins can re-create the previously-hardcoded triggers via the new
-- CRUD UI in two clicks each:
--
--   1. "Auto-Confirm Completed Putaways" — source_table=rf_putaway_operations,
--      events={INSERT,UPDATE}, match_filter=
--          { all: [
--            { eq: { field: "to_status", value: "Completed" } },
--            { neq: { field: "is_mca_workflow", value: true } },
--            { is_null: { field: "confirmed_source" } }
--          ] },
--      target_endpoint=/sap/confirm-to,
--      payload_template={ to_number: "{{row.to_number}}", warehouse: "{{row.warehouse}}" },
--      post_success_patch={
--        table: "rf_putaway_operations",
--        filter: { eq: { field: "id", value: "{{row.id}}" } },
--        update: { confirmed_source: "agent_trigger_direct" }
--      }.
--
--   2. "Queued Shipment Processor" — source_table=shipment_queue (when the
--      table exists), events={INSERT}, match_filter={}, target_endpoint=
--      /sap/process-shipment, payload_template uses delivery / item /
--      to_number / warehouse / tracking row fields.
--
--   3. "Auto-Confirm Completed Picks → LT12" — source_table=work_tasks,
--      events={INSERT,UPDATE}, match_filter=
--          { all: [
--            { eq: { field: "task_type", value: "pick" } },
--            { eq: { field: "status", value: "completed" } },
--            { is_null: { field: "payload.lt12_confirmed_at" } }
--          ] },
--      target_endpoint=/sap/lt12, payload_template references
--      payload.transfer_order, warehouse, result_payload.picked_qty.
--
-- A future optional seeding pass — gated on an admin opt-in toggle in
-- the CRUD UI ("Add starter triggers") — can call a dedicated RPC that
-- INSERTs the three rows scoped to the calling user's org. That RPC
-- has not been implemented in Phase 9; admins type the rules in for
-- now. The CRUD UI ships with these three patterns as TEMPLATES (form
-- pre-fill buttons) so the cost is one click + a name.
--
-- Idempotent — this migration is intentionally a no-op so it can run on
-- any database state (fresh, mid-migration, post-Phase 9 cutover, etc).

DO $$
BEGIN
  RAISE NOTICE
    'Phase 9 migration 282: no seed data inserted by design — admins '
    'create triggers via the SAP Testing CRUD UI. See migration '
    'comment for the three previously-hardcoded patterns.';
END;
$$;
