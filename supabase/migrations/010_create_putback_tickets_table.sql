-- Create putback_status enum
CREATE TYPE putback_status AS ENUM ('open', 'completed', 'cancelled');

-- Create putback_tickets table
CREATE TABLE IF NOT EXISTS putback_tickets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  putback_number VARCHAR(50) NOT NULL UNIQUE,
  delivery_id VARCHAR(100) NOT NULL,
  material_number VARCHAR(100) NOT NULL,
  material_description TEXT,
  quantity_returned INTEGER NOT NULL CHECK (quantity_returned > 0),
  original_storage_bin VARCHAR(100),
  original_delivery_data JSONB, -- Store reference delivery data
  status putback_status DEFAULT 'open'::putback_status,
  
  -- Timestamps and user tracking
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE,
  processed_by UUID,
  
  -- Organization context
  organization_id UUID NOT NULL,
  
  -- Constraints
  CONSTRAINT putback_tickets_created_by_fkey 
    FOREIGN KEY (created_by) REFERENCES user_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT putback_tickets_processed_by_fkey 
    FOREIGN KEY (processed_by) REFERENCES user_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT putback_tickets_organization_id_fkey 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX idx_putback_tickets_putback_number ON putback_tickets(putback_number);
CREATE INDEX idx_putback_tickets_delivery_id ON putback_tickets(delivery_id);
CREATE INDEX idx_putback_tickets_organization_id ON putback_tickets(organization_id);
CREATE INDEX idx_putback_tickets_status ON putback_tickets(status);
CREATE INDEX idx_putback_tickets_created_by ON putback_tickets(created_by);
CREATE INDEX idx_putback_tickets_created_at ON putback_tickets(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE putback_tickets ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can only see putback tickets from their organization
CREATE POLICY "Users can view putback tickets from their organization" ON putback_tickets
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

-- Users can create putback tickets for their organization
CREATE POLICY "Users can create putback tickets for their organization" ON putback_tickets
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND created_by = auth.uid()
  );

-- Users can update putback tickets from their organization
CREATE POLICY "Users can update putback tickets from their organization" ON putback_tickets
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

-- Create function to generate next putback number
CREATE OR REPLACE FUNCTION generate_putback_number(org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  next_number INTEGER;
  putback_number TEXT;
BEGIN
  -- Get the next sequential number for this organization
  SELECT COALESCE(MAX(
    CASE 
      WHEN putback_number ~ '^Putback-[0-9]+$' 
      THEN CAST(SUBSTRING(putback_number FROM 'Putback-([0-9]+)') AS INTEGER)
      ELSE 0 
    END
  ), 0) + 1
  INTO next_number
  FROM putback_tickets 
  WHERE organization_id = org_id;
  
  -- Format as Putback-00001, Putback-00002, etc.
  putback_number := 'Putback-' || LPAD(next_number::TEXT, 5, '0');
  
  RETURN putback_number;
END;
$$;

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE ON putback_tickets TO authenticated;
GRANT USAGE ON SEQUENCE putback_tickets_id_seq TO authenticated;
GRANT EXECUTE ON FUNCTION generate_putback_number(UUID) TO authenticated;

-- Add audit trigger for putback tickets (if audit system exists)
CREATE OR REPLACE FUNCTION audit_putback_tickets()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Log putback ticket creation
    INSERT INTO audit_logs (
      user_id,
      organization_id,
      action,
      resource_type,
      resource_id,
      changes
    ) VALUES (
      NEW.created_by,
      NEW.organization_id,
      'create'::audit_action,
      'putback_ticket',
      NEW.id::TEXT,
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Log putback ticket updates
    INSERT INTO audit_logs (
      user_id,
      organization_id,
      action,
      resource_type,
      resource_id,
      changes
    ) VALUES (
      COALESCE(NEW.processed_by, OLD.created_by),
      NEW.organization_id,
      'update'::audit_action,
      'putback_ticket',
      NEW.id::TEXT,
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
CREATE TRIGGER audit_putback_tickets_trigger
  AFTER INSERT OR UPDATE ON putback_tickets
  FOR EACH ROW
  EXECUTE FUNCTION audit_putback_tickets();

-- Comment on table and columns
COMMENT ON TABLE putback_tickets IS 'Putback tickets for excess quantities returned to shelf';
COMMENT ON COLUMN putback_tickets.putback_number IS 'Unique putback ticket number (Putback-00001 format)';
COMMENT ON COLUMN putback_tickets.delivery_id IS 'Reference to the original delivery';
COMMENT ON COLUMN putback_tickets.material_number IS 'Material being returned to shelf';
COMMENT ON COLUMN putback_tickets.quantity_returned IS 'Quantity being returned to shelf';
COMMENT ON COLUMN putback_tickets.original_storage_bin IS 'Original storage bin location';
COMMENT ON COLUMN putback_tickets.original_delivery_data IS 'Snapshot of original delivery data';
COMMENT ON COLUMN putback_tickets.status IS 'Current status of the putback ticket';


