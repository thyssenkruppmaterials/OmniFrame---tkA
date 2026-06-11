-- =====================================================
-- Migration: Create Drone Scans System with AI Analysis
-- Version: 102
-- Description: Drone warehouse scanner with Qwen3-VL AI analysis, 
--              full-text search, and real-time capabilities
-- Date: January 2026
-- =====================================================

-- =====================================================
-- 1. Create drone_missions table (flight plans)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.drone_missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Mission identification
  mission_name VARCHAR(100) NOT NULL,
  mission_type VARCHAR(50) DEFAULT 'inventory_scan',  -- inventory_scan, damage_inspection, coverage_map
  
  -- Mission planning
  waypoints JSONB,                    -- [{lat, lng, alt, action, dwell_time}]
  estimated_duration_minutes INTEGER,
  coverage_zones TEXT[],              -- Array of zone names to cover
  
  -- Mission status
  status VARCHAR(20) DEFAULT 'planned',  -- planned, in_progress, completed, aborted, failed
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Results summary
  total_scans INTEGER DEFAULT 0,
  successful_analyses INTEGER DEFAULT 0,
  failed_analyses INTEGER DEFAULT 0,
  
  -- Drone info
  drone_id TEXT,                      -- DJI drone serial number
  drone_model VARCHAR(50),            -- 'Mavic 3 Enterprise', 'Mini 4 Pro', etc.
  
  -- Relationships
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id),
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.drone_missions IS 'Flight mission plans and status for warehouse drone scanning operations';

-- =====================================================
-- 2. Create drone_scans table (main table with AI fields)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.drone_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Image storage
  image_url TEXT NOT NULL,            -- Supabase Storage URL
  thumbnail_url TEXT,                 -- Smaller preview image
  image_size_bytes INTEGER,
  image_dimensions VARCHAR(20),       -- '4000x3000'
  
  -- Location Data
  gps_lat DECIMAL(10, 8),
  gps_lng DECIMAL(11, 8),
  altitude_m DECIMAL(6, 2),
  heading_degrees DECIMAL(5, 2),      -- Drone compass heading
  warehouse_zone TEXT,
  aisle TEXT,
  shelf_position TEXT,
  rack_level TEXT,
  
  -- AI Analysis Tracking
  ai_model_used TEXT,                         -- 'qwen3-vl-8b', 'novita', 'deepseek-ocr'
  ai_analysis_status TEXT DEFAULT 'pending',  -- pending, processing, completed, failed
  ai_analysis_started_at TIMESTAMPTZ,
  ai_analysis_completed_at TIMESTAMPTZ,
  ai_processing_time_ms INTEGER,
  ai_fallback_used BOOLEAN DEFAULT false,
  ai_error_message TEXT,              -- Error details if failed
  ai_retry_count INTEGER DEFAULT 0,
  
  -- Structured AI Extraction Results
  detected_texts JSONB DEFAULT '[]'::jsonb,      
  -- [{value, type: 'sku'|'lot'|'barcode'|'label'|'expiration', confidence, bbox: [x,y,w,h]}]
  
  detected_objects JSONB DEFAULT '[]'::jsonb,    
  -- [{label, confidence, bbox, count}]
  
  detected_barcodes JSONB DEFAULT '[]'::jsonb,   
  -- [{value, format: 'UPC-A'|'EAN-13'|'QR'|'Code128', bbox}]
  
  inventory_assessment JSONB,
  -- {level: 'full'|'partial'|'empty', estimated_fill: 0.0-1.0, issues: [], damage_detected: bool}
  
  spatial_description TEXT,           -- AI-generated human-readable description
  
  -- Searchable Content (auto-generated)
  raw_text TEXT,                      -- All extracted text concatenated
  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', COALESCE(raw_text, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(spatial_description, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(warehouse_zone, '') || ' ' || COALESCE(aisle, '')), 'C')
  ) STORED,
  
  -- Relationships
  mission_id UUID REFERENCES public.drone_missions(id) ON DELETE SET NULL,
  drone_id TEXT,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scanned_by UUID REFERENCES auth.users(id),
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.drone_scans IS 'Drone-captured warehouse images with AI-powered analysis results for inventory tracking and search';
COMMENT ON COLUMN public.drone_scans.detected_texts IS 'Array of detected text items with type classification (sku, lot, barcode, label, expiration)';
COMMENT ON COLUMN public.drone_scans.inventory_assessment IS 'AI assessment of inventory levels and issues at scanned location';
COMMENT ON COLUMN public.drone_scans.search_vector IS 'Full-text search vector combining raw text, descriptions, and location info';

-- =====================================================
-- 3. Create Performance Indexes
-- =====================================================

-- Full-text search index (GIN for tsvector)
CREATE INDEX IF NOT EXISTS idx_drone_scans_search 
  ON public.drone_scans USING GIN(search_vector);

-- AI analysis status for queue processing
CREATE INDEX IF NOT EXISTS idx_drone_scans_ai_status 
  ON public.drone_scans(ai_analysis_status, created_at DESC)
  WHERE ai_analysis_status IN ('pending', 'processing');

-- Location-based queries
CREATE INDEX IF NOT EXISTS idx_drone_scans_location 
  ON public.drone_scans(warehouse_zone, aisle, shelf_position);

-- Organization + time for listing
CREATE INDEX IF NOT EXISTS idx_drone_scans_org_time 
  ON public.drone_scans(organization_id, captured_at DESC);

-- Mission lookup
CREATE INDEX IF NOT EXISTS idx_drone_scans_mission 
  ON public.drone_scans(mission_id)
  WHERE mission_id IS NOT NULL;

-- GPS coordinates for spatial queries
CREATE INDEX IF NOT EXISTS idx_drone_scans_gps 
  ON public.drone_scans(gps_lat, gps_lng)
  WHERE gps_lat IS NOT NULL;

-- Drone missions indexes
CREATE INDEX IF NOT EXISTS idx_drone_missions_org 
  ON public.drone_missions(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_drone_missions_status 
  ON public.drone_missions(status, started_at DESC);

-- =====================================================
-- 4. Create Updated_at Triggers
-- =====================================================

CREATE OR REPLACE FUNCTION update_drone_scans_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER drone_scans_updated_at
  BEFORE UPDATE ON public.drone_scans
  FOR EACH ROW
  EXECUTE FUNCTION update_drone_scans_updated_at();

CREATE OR REPLACE FUNCTION update_drone_missions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER drone_missions_updated_at
  BEFORE UPDATE ON public.drone_missions
  FOR EACH ROW
  EXECUTE FUNCTION update_drone_missions_updated_at();

-- =====================================================
-- 5. Enable Row Level Security
-- =====================================================

ALTER TABLE public.drone_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drone_missions ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 6. RLS Policies for drone_scans
-- =====================================================

-- Users can view scans in their organization
CREATE POLICY "Users can view organization drone scans"
  ON public.drone_scans
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Users can insert scans for their organization
CREATE POLICY "Users can insert drone scans"
  ON public.drone_scans
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Users can update scans in their organization
CREATE POLICY "Users can update organization drone scans"
  ON public.drone_scans
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Admins can delete scans in their organization
CREATE POLICY "Admins can delete organization drone scans"
  ON public.drone_scans
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
      AND up.organization_id = drone_scans.organization_id
      AND up.role IN ('superadmin', 'admin', 'manager')
    )
  );

-- =====================================================
-- 7. RLS Policies for drone_missions
-- =====================================================

-- Users can view missions in their organization
CREATE POLICY "Users can view organization drone missions"
  ON public.drone_missions
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Users can insert missions for their organization
CREATE POLICY "Users can insert drone missions"
  ON public.drone_missions
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Users can update missions in their organization
CREATE POLICY "Users can update organization drone missions"
  ON public.drone_missions
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Admins can delete missions
CREATE POLICY "Admins can delete organization drone missions"
  ON public.drone_missions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
      AND up.organization_id = drone_missions.organization_id
      AND up.role IN ('superadmin', 'admin', 'manager')
    )
  );

-- =====================================================
-- 8. Helper Functions
-- =====================================================

-- Function to search drone scans with full-text search
CREATE OR REPLACE FUNCTION public.search_drone_scans(
  p_query TEXT,
  p_organization_id UUID,
  p_warehouse_zone TEXT DEFAULT NULL,
  p_aisle TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  captured_at TIMESTAMPTZ,
  image_url TEXT,
  thumbnail_url TEXT,
  warehouse_zone TEXT,
  aisle TEXT,
  shelf_position TEXT,
  raw_text TEXT,
  spatial_description TEXT,
  detected_texts JSONB,
  detected_barcodes JSONB,
  inventory_assessment JSONB,
  ai_analysis_status TEXT,
  rank REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ds.id,
    ds.captured_at,
    ds.image_url,
    ds.thumbnail_url,
    ds.warehouse_zone,
    ds.aisle,
    ds.shelf_position,
    ds.raw_text,
    ds.spatial_description,
    ds.detected_texts,
    ds.detected_barcodes,
    ds.inventory_assessment,
    ds.ai_analysis_status,
    ts_rank(ds.search_vector, websearch_to_tsquery('english', p_query)) as rank
  FROM public.drone_scans ds
  WHERE ds.organization_id = p_organization_id
    AND ds.ai_analysis_status = 'completed'
    AND (p_warehouse_zone IS NULL OR ds.warehouse_zone = p_warehouse_zone)
    AND (p_aisle IS NULL OR ds.aisle = p_aisle)
    AND ds.search_vector @@ websearch_to_tsquery('english', p_query)
  ORDER BY rank DESC, ds.captured_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get pending scans for AI processing
CREATE OR REPLACE FUNCTION public.get_pending_drone_scans(
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  image_url TEXT,
  organization_id UUID,
  captured_at TIMESTAMPTZ,
  warehouse_zone TEXT,
  aisle TEXT
) AS $$
BEGIN
  -- Mark scans as processing and return them
  RETURN QUERY
  WITH scans_to_process AS (
    SELECT ds.id
    FROM public.drone_scans ds
    WHERE ds.ai_analysis_status = 'pending'
    ORDER BY ds.created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.drone_scans ds
  SET 
    ai_analysis_status = 'processing',
    ai_analysis_started_at = NOW()
  FROM scans_to_process stp
  WHERE ds.id = stp.id
  RETURNING 
    ds.id,
    ds.image_url,
    ds.organization_id,
    ds.captured_at,
    ds.warehouse_zone,
    ds.aisle;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to save AI analysis results
CREATE OR REPLACE FUNCTION public.save_drone_scan_analysis(
  p_scan_id UUID,
  p_ai_model TEXT,
  p_detected_texts JSONB,
  p_detected_objects JSONB,
  p_detected_barcodes JSONB,
  p_inventory_assessment JSONB,
  p_spatial_description TEXT,
  p_raw_text TEXT,
  p_fallback_used BOOLEAN DEFAULT false,
  p_processing_time_ms INTEGER DEFAULT NULL
)
RETURNS public.drone_scans AS $$
DECLARE
  v_scan public.drone_scans;
BEGIN
  UPDATE public.drone_scans
  SET 
    ai_model_used = p_ai_model,
    ai_analysis_status = 'completed',
    ai_analysis_completed_at = NOW(),
    ai_processing_time_ms = p_processing_time_ms,
    ai_fallback_used = p_fallback_used,
    detected_texts = COALESCE(p_detected_texts, '[]'::jsonb),
    detected_objects = COALESCE(p_detected_objects, '[]'::jsonb),
    detected_barcodes = COALESCE(p_detected_barcodes, '[]'::jsonb),
    inventory_assessment = p_inventory_assessment,
    spatial_description = p_spatial_description,
    raw_text = p_raw_text
  WHERE id = p_scan_id
  RETURNING * INTO v_scan;
  
  -- Update mission stats if applicable
  IF v_scan.mission_id IS NOT NULL THEN
    UPDATE public.drone_missions
    SET 
      successful_analyses = successful_analyses + 1,
      total_scans = total_scans + 1
    WHERE id = v_scan.mission_id;
  END IF;
  
  RETURN v_scan;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark scan analysis as failed
CREATE OR REPLACE FUNCTION public.fail_drone_scan_analysis(
  p_scan_id UUID,
  p_error_message TEXT
)
RETURNS public.drone_scans AS $$
DECLARE
  v_scan public.drone_scans;
BEGIN
  UPDATE public.drone_scans
  SET 
    ai_analysis_status = 'failed',
    ai_analysis_completed_at = NOW(),
    ai_error_message = p_error_message,
    ai_retry_count = ai_retry_count + 1
  WHERE id = p_scan_id
  RETURNING * INTO v_scan;
  
  -- Update mission stats if applicable
  IF v_scan.mission_id IS NOT NULL THEN
    UPDATE public.drone_missions
    SET 
      failed_analyses = failed_analyses + 1,
      total_scans = total_scans + 1
    WHERE id = v_scan.mission_id;
  END IF;
  
  RETURN v_scan;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get scan statistics by zone
CREATE OR REPLACE FUNCTION public.get_drone_scan_statistics(
  p_organization_id UUID,
  p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
  warehouse_zone TEXT,
  total_scans BIGINT,
  completed_analyses BIGINT,
  failed_analyses BIGINT,
  avg_processing_time_ms NUMERIC,
  items_detected BIGINT,
  damage_detected_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ds.warehouse_zone,
    COUNT(*) as total_scans,
    COUNT(*) FILTER (WHERE ds.ai_analysis_status = 'completed') as completed_analyses,
    COUNT(*) FILTER (WHERE ds.ai_analysis_status = 'failed') as failed_analyses,
    AVG(ds.ai_processing_time_ms)::NUMERIC as avg_processing_time_ms,
    SUM(jsonb_array_length(COALESCE(ds.detected_texts, '[]'::jsonb)))::BIGINT as items_detected,
    COUNT(*) FILTER (WHERE (ds.inventory_assessment->>'damage_detected')::boolean = true) as damage_detected_count
  FROM public.drone_scans ds
  WHERE ds.organization_id = p_organization_id
    AND ds.captured_at >= NOW() - (p_days || ' days')::INTERVAL
  GROUP BY ds.warehouse_zone
  ORDER BY total_scans DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 9. Grant Permissions
-- =====================================================

GRANT SELECT, INSERT, UPDATE ON public.drone_scans TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.drone_missions TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_drone_scans TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_drone_scans TO service_role;
GRANT EXECUTE ON FUNCTION public.save_drone_scan_analysis TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_drone_scan_analysis TO service_role;
GRANT EXECUTE ON FUNCTION public.get_drone_scan_statistics TO authenticated;

-- =====================================================
-- 10. Enable Realtime for drone_scans
-- =====================================================

-- Note: Run this in Supabase Dashboard or via API:
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.drone_scans;

-- =====================================================
-- End of Migration 102
-- =====================================================
