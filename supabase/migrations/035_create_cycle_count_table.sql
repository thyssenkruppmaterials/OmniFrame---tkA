-- Create Cycle Count Data Table
-- Migration: 035_create_cycle_count_table.sql  
-- Description: Creates rr_cyclecount_data table for manual inventory counts with proper indexes, RLS policies, and audit trails

-- Create cycle count status enum
CREATE TYPE cycle_count_status AS ENUM ('pending', 'in_progress', 'completed', 'variance_review', 'approved', 'cancelled');

-- Create the rr_cyclecount_data table
CREATE TABLE IF NOT EXISTS public.rr_cyclecount_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Core cycle count fields
  count_number VARCHAR(50) NOT NULL UNIQUE, -- CC-YYYYMMDD-XXXX format
  material_number VARCHAR(100) NOT NULL,
  material_description TEXT,
  location VARCHAR(100) NOT NULL,
  warehouse VARCHAR(50),
  
  -- Quantity information
  system_quantity NUMERIC(10,3) NOT NULL DEFAULT 0,
  counted_quantity NUMERIC(10,3),
  variance_quantity NUMERIC(10,3),
  unit_of_measure VARCHAR(10) DEFAULT 'EA',
  
  -- Count information
  count_type VARCHAR(50) DEFAULT 'cycle_count', -- cycle_count, physical_count, spot_count
  count_reason VARCHAR(100),
  counter_name VARCHAR(100),
  count_date DATE DEFAULT CURRENT_DATE,
  count_time TIME DEFAULT CURRENT_TIME,
  
  -- Status tracking
  status cycle_count_status DEFAULT 'pending',
  
  -- Variance handling
  variance_percentage NUMERIC(5,2),
  requires_recount BOOLEAN DEFAULT false,
  recount_completed BOOLEAN DEFAULT false,
  recount_by VARCHAR(100),
  recount_date DATE,
  
  -- Approval workflow
  approved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  approval_comments TEXT,
  
  -- Additional information
  batch_number VARCHAR(100),
  serial_numbers TEXT[], -- Array of serial numbers if applicable
  notes TEXT,
  
  -- Metadata
  scanner_type VARCHAR(50) DEFAULT 'manual',
  session_id VARCHAR(100),
  
  -- Constraints
  CONSTRAINT rr_cyclecount_data_organization_id_fkey 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT rr_cyclecount_data_created_by_fkey 
    FOREIGN KEY (created_by) REFERENCES user_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT rr_cyclecount_data_approved_by_fkey 
    FOREIGN KEY (approved_by) REFERENCES user_profiles(id) ON DELETE SET NULL,
  CONSTRAINT rr_cyclecount_data_variance_check 
    CHECK (variance_quantity = counted_quantity - system_quantity)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_organization_id ON public.rr_cyclecount_data(organization_id);
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_created_by ON public.rr_cyclecount_data(created_by);
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_count_number ON public.rr_cyclecount_data(count_number);
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_material_number ON public.rr_cyclecount_data(material_number);
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_location ON public.rr_cyclecount_data(location);
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_warehouse ON public.rr_cyclecount_data(warehouse);
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_status ON public.rr_cyclecount_data(status);
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_count_date ON public.rr_cyclecount_data(count_date DESC);
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_created_at ON public.rr_cyclecount_data(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_data_requires_recount ON public.rr_cyclecount_data(requires_recount) WHERE requires_recount = true;

-- Enable Row Level Security (RLS)
ALTER TABLE rr_cyclecount_data ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can only see cycle count data from their organization
CREATE POLICY "Users can view cycle count data from their organization" ON rr_cyclecount_data
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Users can insert cycle count data for their organization
CREATE POLICY "Users can insert cycle count data for their organization" ON rr_cyclecount_data
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM user_profiles 
      WHERE id = auth.uid()
    )
    AND created_by = auth.uid()
  );

-- Users can update cycle count data in their organization (with proper permissions)
CREATE POLICY "Users can update cycle count data in their organization" ON rr_cyclecount_data
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM user_profiles 
      WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Create audit trigger function
CREATE OR REPLACE FUNCTION audit_rr_cyclecount_data()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Log cycle count data creation
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
      'cycle_count',
      NEW.id::TEXT,
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Log cycle count data updates
    INSERT INTO audit_logs (
      user_id,
      organization_id,
      action,
      resource_type,
      resource_id,
      changes
    ) VALUES (
      COALESCE(NEW.approved_by, NEW.created_by),
      NEW.organization_id,
      'update'::audit_action,
      'cycle_count',
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
CREATE TRIGGER audit_rr_cyclecount_data_trigger
  AFTER INSERT OR UPDATE ON rr_cyclecount_data
  FOR EACH ROW
  EXECUTE FUNCTION audit_rr_cyclecount_data();

-- Create function to generate count number
CREATE OR REPLACE FUNCTION generate_count_number()
RETURNS VARCHAR(50)
LANGUAGE plpgsql
AS $$
DECLARE
  count_date TEXT;
  sequence_num INTEGER;
  count_number VARCHAR(50);
BEGIN
  -- Get current date in YYYYMMDD format
  count_date := to_char(CURRENT_DATE, 'YYYYMMDD');
  
  -- Get next sequence number for today
  SELECT COALESCE(MAX(CAST(SUBSTRING(count_number FROM 'CC-' || count_date || '-(.+)') AS INTEGER)), 0) + 1
  INTO sequence_num
  FROM rr_cyclecount_data
  WHERE count_number LIKE 'CC-' || count_date || '-%';
  
  -- Format the count number
  count_number := 'CC-' || count_date || '-' || LPAD(sequence_num::TEXT, 4, '0');
  
  RETURN count_number;
END;
$$;

-- Create RPC function to get cycle count statistics
CREATE OR REPLACE FUNCTION get_cycle_count_statistics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  user_org_id UUID;
BEGIN
  -- Get user's organization ID
  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = auth.uid();
  
  IF user_org_id IS NULL THEN
    RAISE EXCEPTION 'User not found or not associated with an organization';
  END IF;
  
  -- Build statistics
  SELECT json_build_object(
    'totalCounts', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id
    ),
    'pendingCounts', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id 
      AND status = 'pending'
    ),
    'completedCounts', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id 
      AND status = 'completed'
    ),
    'varianceReviewCounts', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id 
      AND status = 'variance_review'
    ),
    'totalVarianceValue', (
      SELECT COALESCE(SUM(ABS(variance_quantity)), 0) 
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id 
      AND variance_quantity IS NOT NULL
    ),
    'countsRequiringRecount', (
      SELECT COUNT(*) 
      FROM rr_cyclecount_data 
      WHERE organization_id = user_org_id 
      AND requires_recount = true 
      AND recount_completed = false
    )
  ) INTO result;
  
  RETURN result;
END;
$$;

-- Add comments for documentation
COMMENT ON TABLE rr_cyclecount_data IS 'Cycle count data for manual inventory counting and variance tracking';
COMMENT ON COLUMN rr_cyclecount_data.count_number IS 'Unique count number in CC-YYYYMMDD-XXXX format';
COMMENT ON COLUMN rr_cyclecount_data.system_quantity IS 'System/expected quantity before count';
COMMENT ON COLUMN rr_cyclecount_data.counted_quantity IS 'Physically counted quantity';
COMMENT ON COLUMN rr_cyclecount_data.variance_quantity IS 'Calculated variance (counted - system)';
COMMENT ON COLUMN rr_cyclecount_data.variance_percentage IS 'Variance as percentage of system quantity';
COMMENT ON COLUMN rr_cyclecount_data.requires_recount IS 'Flag indicating if variance requires recount';
COMMENT ON COLUMN rr_cyclecount_data.serial_numbers IS 'Array of serial numbers for serialized items';



