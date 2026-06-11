-- Create rr_inbound_scans table for RF interface inbound scanner
CREATE TABLE IF NOT EXISTS rr_inbound_scans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  barcode VARCHAR(255) NOT NULL,
  scanned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  scanned_by UUID NOT NULL,
  scan_location VARCHAR(100),
  notes TEXT,
  organization_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT rr_inbound_scans_scanned_by_fkey 
    FOREIGN KEY (scanned_by) REFERENCES user_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT rr_inbound_scans_organization_id_fkey 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX idx_rr_inbound_scans_barcode ON rr_inbound_scans(barcode);
CREATE INDEX idx_rr_inbound_scans_organization_id ON rr_inbound_scans(organization_id);
CREATE INDEX idx_rr_inbound_scans_scanned_by ON rr_inbound_scans(scanned_by);
CREATE INDEX idx_rr_inbound_scans_scanned_at ON rr_inbound_scans(scanned_at DESC);
CREATE INDEX idx_rr_inbound_scans_created_at ON rr_inbound_scans(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE rr_inbound_scans ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can only see inbound scans from their organization
CREATE POLICY "Users can view inbound scans from their organization" ON rr_inbound_scans
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

-- Users can create inbound scans for their organization
CREATE POLICY "Users can create inbound scans for their organization" ON rr_inbound_scans
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND scanned_by = auth.uid()
  );

-- Users can update inbound scans from their organization (for notes, etc.)
CREATE POLICY "Users can update inbound scans from their organization" ON rr_inbound_scans
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_rr_inbound_scans_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Create trigger to automatically update updated_at timestamp
CREATE TRIGGER update_rr_inbound_scans_updated_at_trigger
  BEFORE UPDATE ON rr_inbound_scans
  FOR EACH ROW
  EXECUTE FUNCTION update_rr_inbound_scans_updated_at();

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE ON rr_inbound_scans TO authenticated;

-- Add audit trigger for inbound scans
CREATE OR REPLACE FUNCTION audit_rr_inbound_scans()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Log inbound scan creation
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
    -- Log inbound scan updates
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

-- Create audit trigger
CREATE TRIGGER audit_rr_inbound_scans_trigger
  AFTER INSERT OR UPDATE ON rr_inbound_scans
  FOR EACH ROW
  EXECUTE FUNCTION audit_rr_inbound_scans();

-- Comment on table and columns
COMMENT ON TABLE rr_inbound_scans IS 'RF interface inbound scanner data - tracks all barcode scans performed via the RF terminal';
COMMENT ON COLUMN rr_inbound_scans.barcode IS 'The barcode that was scanned';
COMMENT ON COLUMN rr_inbound_scans.scanned_at IS 'Timestamp when the barcode was scanned';
COMMENT ON COLUMN rr_inbound_scans.scanned_by IS 'User who performed the scan';
COMMENT ON COLUMN rr_inbound_scans.scan_location IS 'Optional location where the scan was performed';
COMMENT ON COLUMN rr_inbound_scans.notes IS 'Optional notes about the scan';
COMMENT ON COLUMN rr_inbound_scans.organization_id IS 'Organization context for multi-tenancy';
