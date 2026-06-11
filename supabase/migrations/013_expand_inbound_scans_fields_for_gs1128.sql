-- Expand rr_inbound_scans fields to accommodate GS1-128 barcode data
-- Migration: 013_expand_inbound_scans_fields_for_gs1128.sql
-- Date: 2025-10-04
-- Purpose: Allow import of legacy data containing raw GS1-128 barcode strings

-- Expand VARCHAR fields to accommodate longer GS1-128 data
-- Current limits: 100 characters
-- New limits: 500 characters (sufficient for GS1-128 format)

ALTER TABLE rr_inbound_scans
ALTER COLUMN tracking_number TYPE VARCHAR(500),
ALTER COLUMN so_line_rma_afa TYPE VARCHAR(500),
ALTER COLUMN material_number TYPE VARCHAR(500),
ALTER COLUMN tka_batch_number TYPE VARCHAR(500),
ALTER COLUMN barcode TYPE VARCHAR(500);

-- Expand quantity field to handle larger numbers
-- Current: NUMERIC(10,3) - max value ~9,999,999
-- New: NUMERIC(20,3) - max value ~99,999,999,999,999,999
-- This accommodates corrupted scanner data that may have captured
-- concatenated numeric values from GS1-128 barcodes

ALTER TABLE rr_inbound_scans
ALTER COLUMN quantity TYPE NUMERIC(20,3);

-- Update comments to reflect GS1-128 support
COMMENT ON COLUMN rr_inbound_scans.tracking_number IS 'Package/shipment tracking number (supports GS1-128 format)';
COMMENT ON COLUMN rr_inbound_scans.so_line_rma_afa IS 'Sales Order Line, RMA, or AFA number (supports GS1-128 format)';
COMMENT ON COLUMN rr_inbound_scans.material_number IS 'Material/part number being received (supports GS1-128 format)';
COMMENT ON COLUMN rr_inbound_scans.tka_batch_number IS 'TKA batch number for traceability (supports GS1-128 format)';
COMMENT ON COLUMN rr_inbound_scans.barcode IS 'Raw barcode data (supports GS1-128 format)';
COMMENT ON COLUMN rr_inbound_scans.quantity IS 'Quantity being received (expanded to support legacy data)';

-- Add note about GS1-128 data
COMMENT ON TABLE rr_inbound_scans IS 'Enhanced RF interface inbound scanner data - comprehensive inbound receiving with tracking, material, quantity, and batch information. Supports GS1-128 barcode format for legacy data import.';

-- No index changes needed - existing indexes will work with expanded fields

