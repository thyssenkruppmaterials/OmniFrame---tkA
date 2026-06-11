-- Create GRIP Processing System
-- Migration: 033_create_grip_processing_system.sql
-- Description: Creates rr_grip_processing table and get_grip_processing_statistics RPC function

-- Create the rr_grip_processing table
CREATE TABLE IF NOT EXISTS public.rr_grip_processing (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Core GRIP processing fields
  material_number TEXT,
  batch_number TEXT,
  warehouse_number TEXT,
  processing_location TEXT,
  processed_by TEXT,
  processing_type TEXT,
  processing_status TEXT DEFAULT 'Pending',
  
  -- Quality hold information
  is_quality_hold BOOLEAN DEFAULT false,
  quality_hold_reason TEXT,
  
  -- Quantity information
  received_quantity NUMERIC,
  processed_quantity NUMERIC,
  rejected_quantity NUMERIC,
  unit_of_measure TEXT,
  
  -- GRIP workflow information
  grip_workflow_type TEXT,
  grip_stage TEXT,
  grip_priority TEXT DEFAULT 'NORMAL',
  
  -- Supplier information
  supplier_batch_info TEXT,
  
  -- Processing timestamps
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  
  -- Additional information
  notes TEXT
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_rr_grip_processing_organization_id ON public.rr_grip_processing(organization_id);
CREATE INDEX IF NOT EXISTS idx_rr_grip_processing_created_by ON public.rr_grip_processing(created_by);
CREATE INDEX IF NOT EXISTS idx_rr_grip_processing_material_number ON public.rr_grip_processing(material_number);
CREATE INDEX IF NOT EXISTS idx_rr_grip_processing_batch_number ON public.rr_grip_processing(batch_number);
CREATE INDEX IF NOT EXISTS idx_rr_grip_processing_warehouse_number ON public.rr_grip_processing(warehouse_number);
CREATE INDEX IF NOT EXISTS idx_rr_grip_processing_processing_status ON public.rr_grip_processing(processing_status);
CREATE INDEX IF NOT EXISTS idx_rr_grip_processing_created_at ON public.rr_grip_processing(created_at);

-- Enable RLS
ALTER TABLE public.rr_grip_processing ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view GRIP processing operations for their organization"
  ON public.rr_grip_processing FOR SELECT
  USING (organization_id = auth.jwt() ->> 'organization_id'::text);

CREATE POLICY "Users can insert GRIP processing operations for their organization"
  ON public.rr_grip_processing FOR INSERT
  WITH CHECK (organization_id = auth.jwt() ->> 'organization_id'::text);

CREATE POLICY "Users can update GRIP processing operations for their organization"
  ON public.rr_grip_processing FOR UPDATE
  USING (organization_id = auth.jwt() ->> 'organization_id'::text);

CREATE POLICY "Users can delete GRIP processing operations for their organization"
  ON public.rr_grip_processing FOR DELETE
  USING (organization_id = auth.jwt() ->> 'organization_id'::text);

-- Create get_grip_processing_statistics RPC function
CREATE OR REPLACE FUNCTION public.get_grip_processing_statistics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_processing INTEGER;
  today_processing INTEGER;
  unique_materials INTEGER;
  unique_operators INTEGER;
  quality_hold_processing INTEGER;
  completed_processing INTEGER;
  avg_completion_time_hours NUMERIC;
  status_breakdown JSON;
  warehouse_distribution JSON;
  grip_stage_breakdown JSON;
  priority_breakdown JSON;
  organization_id_val TEXT;
BEGIN
  -- Get organization ID from JWT
  organization_id_val := auth.jwt() ->> 'organization_id';
  
  -- Get total processing count
  SELECT COUNT(*) INTO total_processing
  FROM public.rr_grip_processing
  WHERE organization_id = organization_id_val::UUID;
  
  -- Get today's processing count
  SELECT COUNT(*) INTO today_processing
  FROM public.rr_grip_processing
  WHERE organization_id = organization_id_val::UUID
    AND DATE(created_at) = CURRENT_DATE;
  
  -- Get unique materials count
  SELECT COUNT(DISTINCT material_number) INTO unique_materials
  FROM public.rr_grip_processing
  WHERE organization_id = organization_id_val::UUID
    AND material_number IS NOT NULL;
  
  -- Get unique operators count
  SELECT COUNT(DISTINCT processed_by) INTO unique_operators
  FROM public.rr_grip_processing
  WHERE organization_id = organization_id_val::UUID
    AND processed_by IS NOT NULL;
  
  -- Get quality hold processing count
  SELECT COUNT(*) INTO quality_hold_processing
  FROM public.rr_grip_processing
  WHERE organization_id = organization_id_val::UUID
    AND is_quality_hold = true;
  
  -- Get completed processing count
  SELECT COUNT(*) INTO completed_processing
  FROM public.rr_grip_processing
  WHERE organization_id = organization_id_val::UUID
    AND processing_status = 'Completed';
  
  -- Calculate average completion time in hours
  SELECT AVG(EXTRACT(EPOCH FROM (processing_completed_at - processing_started_at))/3600) INTO avg_completion_time_hours
  FROM public.rr_grip_processing
  WHERE organization_id = organization_id_val::UUID
    AND processing_completed_at IS NOT NULL
    AND processing_started_at IS NOT NULL;
  
  -- Get status breakdown
  SELECT json_object_agg(COALESCE(processing_status, 'Unknown'), count) INTO status_breakdown
  FROM (
    SELECT processing_status, COUNT(*) as count
    FROM public.rr_grip_processing
    WHERE organization_id = organization_id_val::UUID
    GROUP BY processing_status
  ) t;
  
  -- Get warehouse distribution
  SELECT json_object_agg(COALESCE(warehouse_number, 'Unknown'), count) INTO warehouse_distribution
  FROM (
    SELECT warehouse_number, COUNT(*) as count
    FROM public.rr_grip_processing
    WHERE organization_id = organization_id_val::UUID
    GROUP BY warehouse_number
  ) t;
  
  -- Get GRIP stage breakdown
  SELECT json_object_agg(COALESCE(grip_stage, 'Unknown'), count) INTO grip_stage_breakdown
  FROM (
    SELECT grip_stage, COUNT(*) as count
    FROM public.rr_grip_processing
    WHERE organization_id = organization_id_val::UUID
    GROUP BY grip_stage
  ) t;
  
  -- Get priority breakdown
  SELECT json_object_agg(COALESCE(grip_priority, 'NORMAL'), count) INTO priority_breakdown
  FROM (
    SELECT grip_priority, COUNT(*) as count
    FROM public.rr_grip_processing
    WHERE organization_id = organization_id_val::UUID
    GROUP BY grip_priority
  ) t;
  
  -- Return comprehensive statistics
  RETURN json_build_object(
    'total_processing', COALESCE(total_processing, 0),
    'today_processing', COALESCE(today_processing, 0),
    'unique_materials', COALESCE(unique_materials, 0),
    'unique_operators', COALESCE(unique_operators, 0),
    'quality_hold_processing', COALESCE(quality_hold_processing, 0),
    'completed_processing', COALESCE(completed_processing, 0),
    'average_completion_time_hours', avg_completion_time_hours,
    'status_breakdown', COALESCE(status_breakdown, '{}'::JSON),
    'warehouse_distribution', COALESCE(warehouse_distribution, '{}'::JSON),
    'grip_stage_breakdown', COALESCE(grip_stage_breakdown, '{}'::JSON),
    'priority_breakdown', COALESCE(priority_breakdown, '{}'::JSON)
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_grip_processing_statistics() TO authenticated;

-- Create compliance_reports table (referenced in security service)
CREATE TABLE IF NOT EXISTS public.compliance_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  
  -- Report information
  report_type TEXT NOT NULL,
  report_data JSONB DEFAULT '{}'::JSONB,
  generated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  date_range JSONB DEFAULT '{}'::JSONB,
  status TEXT DEFAULT 'pending'
);

-- Enable RLS for compliance_reports
ALTER TABLE public.compliance_reports ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for compliance_reports
CREATE POLICY "Users can view compliance reports for their organization"
  ON public.compliance_reports FOR SELECT
  USING (organization_id = auth.jwt() ->> 'organization_id'::text);

CREATE POLICY "Users can insert compliance reports for their organization"
  ON public.compliance_reports FOR INSERT
  WITH CHECK (organization_id = auth.jwt() ->> 'organization_id'::text);

-- Create detect_suspicious_sessions RPC function (referenced in security service)
CREATE OR REPLACE FUNCTION public.detect_suspicious_sessions()
RETURNS SETOF RECORD
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  organization_id_val TEXT;
BEGIN
  -- Get organization ID from JWT
  organization_id_val := auth.jwt() ->> 'organization_id';
  
  -- Return empty result set for now (placeholder implementation)
  -- This can be enhanced later with actual suspicious session detection logic
  RETURN;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.detect_suspicious_sessions() TO authenticated;

