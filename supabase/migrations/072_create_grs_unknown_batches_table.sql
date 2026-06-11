-- =====================================================
-- Migration: Create GRS Unknown Batches Table
-- Version: 072
-- Description: Stores unknown batches found during GRS cycle counts with photo documentation
-- Date: November 22, 2025
-- =====================================================

-- Create GRS unknown batches table
CREATE TABLE IF NOT EXISTS public.grs_unknown_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Organization relationship
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Location and batch information
  found_at_location VARCHAR(100) NOT NULL,
  batch_number VARCHAR(100) NOT NULL,
  material_number VARCHAR(100),
  serial_number VARCHAR(100),
  
  -- Documentation
  grs_notes TEXT,
  photo_url TEXT,  -- URL to photo in grs-photos storage bucket
  
  -- Audit fields
  found_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  found_by_name VARCHAR(100),
  found_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE public.grs_unknown_batches IS 
  'Stores unknown batches discovered during GRS cycle counts that were not expected at the scanned location. Includes photo documentation for verification.';

-- Add column comments
COMMENT ON COLUMN public.grs_unknown_batches.found_at_location IS 'Location code where the unexpected batch was discovered';
COMMENT ON COLUMN public.grs_unknown_batches.batch_number IS 'Batch number of the unexpected material';
COMMENT ON COLUMN public.grs_unknown_batches.material_number IS 'Material/part number if identified';
COMMENT ON COLUMN public.grs_unknown_batches.serial_number IS 'Serial number if applicable';
COMMENT ON COLUMN public.grs_unknown_batches.grs_notes IS 'Additional notes from the operator';
COMMENT ON COLUMN public.grs_unknown_batches.photo_url IS 'Public URL to photo in grs-photos storage bucket';
COMMENT ON COLUMN public.grs_unknown_batches.found_by IS 'User ID of operator who found the batch';
COMMENT ON COLUMN public.grs_unknown_batches.found_by_name IS 'Name of operator who found the batch';
COMMENT ON COLUMN public.grs_unknown_batches.found_at IS 'Timestamp when batch was discovered';

-- Create performance indexes
CREATE INDEX IF NOT EXISTS idx_grs_unknown_batches_organization 
  ON public.grs_unknown_batches(organization_id);

CREATE INDEX IF NOT EXISTS idx_grs_unknown_batches_location 
  ON public.grs_unknown_batches(found_at_location);

CREATE INDEX IF NOT EXISTS idx_grs_unknown_batches_batch 
  ON public.grs_unknown_batches(batch_number);

CREATE INDEX IF NOT EXISTS idx_grs_unknown_batches_material 
  ON public.grs_unknown_batches(material_number) 
  WHERE material_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grs_unknown_batches_found_by 
  ON public.grs_unknown_batches(found_by) 
  WHERE found_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grs_unknown_batches_found_at 
  ON public.grs_unknown_batches(found_at DESC);

-- Add auto-update trigger for updated_at
CREATE OR REPLACE FUNCTION update_grs_unknown_batches_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER grs_unknown_batches_updated_at
  BEFORE UPDATE ON public.grs_unknown_batches
  FOR EACH ROW
  EXECUTE FUNCTION update_grs_unknown_batches_updated_at();

-- Create RLS policies
ALTER TABLE public.grs_unknown_batches ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view unknown batches from their organization
CREATE POLICY "Users can view own organization unknown batches"
  ON public.grs_unknown_batches
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Policy: Authenticated users can insert unknown batches for their organization
CREATE POLICY "Users can insert unknown batches"
  ON public.grs_unknown_batches
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Policy: Users can update their own organization's unknown batches
CREATE POLICY "Users can update own organization unknown batches"
  ON public.grs_unknown_batches
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Policy: Admins and managers can delete unknown batches
CREATE POLICY "Admins can delete unknown batches"
  ON public.grs_unknown_batches
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.organization_id = grs_unknown_batches.organization_id
        AND up.role IN ('superadmin', 'admin', 'manager')
    )
  );

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON public.grs_unknown_batches TO authenticated;
GRANT DELETE ON public.grs_unknown_batches TO authenticated;

-- Analyze table for query optimizer
ANALYZE public.grs_unknown_batches;

-- =====================================================
-- End of Migration 072
-- =====================================================

