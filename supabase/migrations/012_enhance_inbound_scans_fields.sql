-- Enhance rr_inbound_scans table with 5 specific fields plus hot truck checkbox
-- Migration: 012_enhance_inbound_scans_fields.sql

-- First, add the new columns
ALTER TABLE rr_inbound_scans
ADD COLUMN tracking_number VARCHAR(100),
ADD COLUMN so_line_rma_afa VARCHAR(100),
ADD COLUMN material_number VARCHAR(100),
ADD COLUMN quantity NUMERIC(10,3),
ADD COLUMN tka_batch_number VARCHAR(100),
ADD COLUMN hot_truck BOOLEAN DEFAULT false;

-- Migrate existing barcode data to material_number field (preserve existing data)
UPDATE rr_inbound_scans 
SET material_number = barcode 
WHERE barcode IS NOT NULL AND material_number IS NULL;

-- Add comments for the new columns
COMMENT ON COLUMN rr_inbound_scans.tracking_number IS 'Package/shipment tracking number';
COMMENT ON COLUMN rr_inbound_scans.so_line_rma_afa IS 'Sales Order Line, RMA, or AFA number';
COMMENT ON COLUMN rr_inbound_scans.material_number IS 'Material/part number being received';
COMMENT ON COLUMN rr_inbound_scans.quantity IS 'Quantity being received (supports decimals)';
COMMENT ON COLUMN rr_inbound_scans.tka_batch_number IS 'TKA batch number for traceability';
COMMENT ON COLUMN rr_inbound_scans.hot_truck IS 'Flag indicating urgent/hot truck delivery';

-- Create additional indexes for the new fields
CREATE INDEX idx_rr_inbound_scans_tracking_number ON rr_inbound_scans(tracking_number);
CREATE INDEX idx_rr_inbound_scans_material_number ON rr_inbound_scans(material_number);
CREATE INDEX idx_rr_inbound_scans_so_line_rma_afa ON rr_inbound_scans(so_line_rma_afa);
CREATE INDEX idx_rr_inbound_scans_tka_batch_number ON rr_inbound_scans(tka_batch_number);
CREATE INDEX idx_rr_inbound_scans_hot_truck ON rr_inbound_scans(hot_truck);

-- Update the audit trigger function to handle new fields
CREATE OR REPLACE FUNCTION audit_rr_inbound_scans()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Log inbound scan creation with new fields
    INSERT INTO audit_logs (
      user_id,
      organization_id,
      action,
      resource_type,
      resource_id,
      changes
    ) VALUES (
      NEW.scanned_by,
      NEW.organization_id,
      'create'::audit_action,
      'inbound_scan',
      NEW.id,
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Log inbound scan updates with new fields
    INSERT INTO audit_logs (
      user_id,
      organization_id,
      action,
      resource_type,
      resource_id,
      changes
    ) VALUES (
      NEW.scanned_by,
      NEW.organization_id,
      'update'::audit_action,
      'inbound_scan',
      NEW.id,
      jsonb_build_object(
        'old', to_jsonb(OLD),
        'new', to_jsonb(NEW)
      )
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

-- Update table comment to reflect enhanced functionality
COMMENT ON TABLE rr_inbound_scans IS 'Enhanced RF interface inbound scanner data - comprehensive inbound receiving with tracking, material, quantity, and batch information';

-- Grant permissions for new fields
GRANT SELECT, INSERT, UPDATE ON rr_inbound_scans TO authenticated;
