-- Migration: Add WAWF shipping columns to outbound_to_data
-- WAWF (Wide Area Workflow) is a shipping type with a multi-step process:
--   1. Ready for NeFab / Staged to NeFab (intermediate statuses)
--   2. Complete TKA process in SAP (final step that pushes status to shipped)

-- Update shipper_type CHECK constraint to allow 'wawf'
ALTER TABLE outbound_to_data DROP CONSTRAINT IF EXISTS outbound_to_data_shipper_type_check;
ALTER TABLE outbound_to_data ADD CONSTRAINT outbound_to_data_shipper_type_check
  CHECK (shipper_type IN ('domestic', 'international', 'wawf'));

ALTER TABLE outbound_to_data
  ADD COLUMN IF NOT EXISTS wawf_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS wawf_placed_by UUID DEFAULT NULL REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS wawf_placed_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN outbound_to_data.wawf_status IS 'WAWF delivery status: ready_for_nefab, staged_to_nefab, or complete_tka_process';
COMMENT ON COLUMN outbound_to_data.wawf_placed_by IS 'User who placed the delivery into WAWF';
COMMENT ON COLUMN outbound_to_data.wawf_placed_at IS 'Timestamp when delivery was placed into WAWF';

CREATE INDEX IF NOT EXISTS idx_outbound_to_data_wawf_status
  ON outbound_to_data (wawf_status)
  WHERE wawf_status IS NOT NULL;
