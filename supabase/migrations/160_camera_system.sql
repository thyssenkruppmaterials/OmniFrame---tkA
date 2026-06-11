-- =====================================================
-- Migration: Camera System for ExacqVision Integration
-- Version: 160
-- Description: Creates camera management system tables for
--              ExacqVision VMS integration with devices,
--              recordings, events, and user preferences
-- Date: January 2026
-- =====================================================

-- =====================================================
-- 1. Create camera_devices table
-- =====================================================
-- Stores camera metadata synced from ExacqVision VMS

CREATE TABLE IF NOT EXISTS public.camera_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- ExacqVision identification
  exacq_camera_id BIGINT NOT NULL,           -- ExacqVision camera ID (e.g., 5898496)
  name TEXT NOT NULL,                         -- Camera display name
  
  -- Network information
  ip_address INET,                            -- Camera IP address
  mac_address TEXT,                           -- Camera MAC address
  
  -- Camera specifications
  model TEXT,                                 -- Camera model name
  location TEXT,                              -- Physical location (e.g., "Shipping", "North Lot")
  category TEXT,                              -- Category (e.g., "indoor", "outdoor", "entrance")
  
  -- Stream configuration
  resolution_width INT,                       -- Horizontal resolution in pixels
  resolution_height INT,                      -- Vertical resolution in pixels
  framerate INT,                              -- Frames per second
  format INT,                                 -- Video format: 6=MJPEG, 7=H.264
  
  -- Status and capabilities
  is_active BOOLEAN DEFAULT true,             -- Whether camera is currently active
  is_ptz BOOLEAN DEFAULT false,               -- Whether camera supports pan/tilt/zoom
  stream_ids JSONB,                           -- Array of stream IDs for multi-sensor cameras
  
  -- Timestamps
  last_seen_at TIMESTAMPTZ,                   -- Last communication with camera
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(organization_id, exacq_camera_id)
);

COMMENT ON TABLE public.camera_devices IS 'Camera metadata synced from ExacqVision VMS, including network info, specs, and capabilities';
COMMENT ON COLUMN public.camera_devices.exacq_camera_id IS 'Unique camera identifier from ExacqVision system';
COMMENT ON COLUMN public.camera_devices.format IS 'Video encoding format: 6=MJPEG, 7=H.264, etc.';
COMMENT ON COLUMN public.camera_devices.stream_ids IS 'JSONB array of stream IDs for multi-sensor/multi-stream cameras';
COMMENT ON COLUMN public.camera_devices.category IS 'Camera classification: indoor, outdoor, entrance, parking, warehouse, etc.';

-- =====================================================
-- 2. Create camera_recordings table
-- =====================================================
-- Stores recording metadata and references to video clips

CREATE TABLE IF NOT EXISTS public.camera_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  camera_id UUID NOT NULL REFERENCES public.camera_devices(id) ON DELETE CASCADE,
  
  -- Recording content
  recording_url TEXT,                         -- URL to ExacqVision recording or downloaded clip
  thumbnail_url TEXT,                         -- Preview thumbnail URL
  
  -- Time range
  start_time TIMESTAMPTZ NOT NULL,            -- Recording start timestamp
  end_time TIMESTAMPTZ,                       -- Recording end timestamp
  duration_seconds FLOAT,                     -- Duration in seconds
  
  -- File information
  file_size_bytes BIGINT,                     -- File size in bytes
  
  -- Recording classification
  recording_type TEXT NOT NULL,               -- 'continuous', 'motion', 'manual', 'alarm'
  status TEXT DEFAULT 'available',            -- 'recording', 'available', 'archived', 'deleted'
  
  -- Additional data
  metadata JSONB,                             -- Flexible metadata storage
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Constraints
  CONSTRAINT valid_recording_type CHECK (recording_type IN ('continuous', 'motion', 'manual', 'alarm')),
  CONSTRAINT valid_status CHECK (status IN ('recording', 'available', 'archived', 'deleted'))
);

COMMENT ON TABLE public.camera_recordings IS 'Recording metadata and references to video clips from ExacqVision';
COMMENT ON COLUMN public.camera_recordings.recording_type IS 'Recording trigger type: continuous, motion-detected, manual export, or alarm-triggered';
COMMENT ON COLUMN public.camera_recordings.status IS 'Recording lifecycle status: recording (in progress), available, archived, or deleted';
COMMENT ON COLUMN public.camera_recordings.metadata IS 'JSONB for additional recording data like codec, bitrate, resolution';

-- =====================================================
-- 3. Create camera_events table
-- =====================================================
-- Stores motion detection, alarms, and system events

CREATE TABLE IF NOT EXISTS public.camera_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  camera_id UUID NOT NULL REFERENCES public.camera_devices(id) ON DELETE CASCADE,
  
  -- Event classification
  event_type TEXT NOT NULL,                   -- 'motion', 'alarm', 'tampering', 'connection_lost', 'connection_restored'
  severity TEXT DEFAULT 'info',               -- 'info', 'warning', 'critical'
  description TEXT,                           -- Human-readable event description
  
  -- Event media
  snapshot_url TEXT,                          -- Snapshot image at time of event
  
  -- Additional event data
  metadata JSONB,                             -- Additional event data from ExacqVision
  
  -- Acknowledgment tracking
  acknowledged BOOLEAN DEFAULT false,
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  
  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_event_type CHECK (event_type IN ('motion', 'alarm', 'tampering', 'connection_lost', 'connection_restored', 'analytics', 'system')),
  CONSTRAINT valid_severity CHECK (severity IN ('info', 'warning', 'critical'))
);

COMMENT ON TABLE public.camera_events IS 'Camera events including motion detection, alarms, and system status changes';
COMMENT ON COLUMN public.camera_events.event_type IS 'Event type: motion, alarm, tampering, connection_lost, connection_restored, analytics, system';
COMMENT ON COLUMN public.camera_events.severity IS 'Event severity level: info, warning, or critical';
COMMENT ON COLUMN public.camera_events.metadata IS 'JSONB for ExacqVision-specific event data like detection zones, analytics results';

-- =====================================================
-- 4. Create camera_user_preferences table
-- =====================================================
-- User viewing preferences and favorites

CREATE TABLE IF NOT EXISTS public.camera_user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Default viewing settings
  default_camera_id UUID REFERENCES public.camera_devices(id) ON DELETE SET NULL,
  preferred_quality INT DEFAULT 8,            -- Quality setting 1-10
  preferred_resolution TEXT DEFAULT '1920x1080',
  
  -- Layout preferences
  grid_layout TEXT DEFAULT '2x2',             -- Grid layout: '1x1', '2x2', '3x3', '4x4'
  
  -- Favorites
  favorite_cameras UUID[],                    -- Array of favorite camera IDs
  
  -- Alert preferences
  alert_preferences JSONB DEFAULT '{"motion": true, "alarm": true, "connection": true}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(user_id, organization_id),
  CONSTRAINT valid_quality CHECK (preferred_quality >= 1 AND preferred_quality <= 10),
  CONSTRAINT valid_grid_layout CHECK (grid_layout IN ('1x1', '2x2', '3x3', '4x4', '4x3', '6x4'))
);

COMMENT ON TABLE public.camera_user_preferences IS 'User-specific camera viewing preferences and favorites';
COMMENT ON COLUMN public.camera_user_preferences.preferred_quality IS 'Video quality preference from 1 (lowest) to 10 (highest)';
COMMENT ON COLUMN public.camera_user_preferences.grid_layout IS 'Default camera grid layout: 1x1, 2x2, 3x3, 4x4';
COMMENT ON COLUMN public.camera_user_preferences.favorite_cameras IS 'Array of camera UUIDs marked as favorites';
COMMENT ON COLUMN public.camera_user_preferences.alert_preferences IS 'JSONB notification preferences: {motion: bool, alarm: bool, connection: bool}';

-- =====================================================
-- 5. Create Performance Indexes
-- =====================================================

-- camera_devices indexes
CREATE INDEX IF NOT EXISTS idx_camera_devices_organization 
  ON public.camera_devices(organization_id);

CREATE INDEX IF NOT EXISTS idx_camera_devices_exacq_id 
  ON public.camera_devices(organization_id, exacq_camera_id);

CREATE INDEX IF NOT EXISTS idx_camera_devices_active 
  ON public.camera_devices(organization_id, is_active) 
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_camera_devices_category 
  ON public.camera_devices(organization_id, category);

CREATE INDEX IF NOT EXISTS idx_camera_devices_location 
  ON public.camera_devices(organization_id, location);

CREATE INDEX IF NOT EXISTS idx_camera_devices_last_seen 
  ON public.camera_devices(last_seen_at DESC);

-- camera_recordings indexes
CREATE INDEX IF NOT EXISTS idx_camera_recordings_organization 
  ON public.camera_recordings(organization_id);

CREATE INDEX IF NOT EXISTS idx_camera_recordings_camera 
  ON public.camera_recordings(camera_id);

CREATE INDEX IF NOT EXISTS idx_camera_recordings_camera_time 
  ON public.camera_recordings(camera_id, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_camera_recordings_org_time 
  ON public.camera_recordings(organization_id, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_camera_recordings_type 
  ON public.camera_recordings(recording_type);

CREATE INDEX IF NOT EXISTS idx_camera_recordings_status 
  ON public.camera_recordings(status) 
  WHERE status != 'deleted';

CREATE INDEX IF NOT EXISTS idx_camera_recordings_created_at 
  ON public.camera_recordings(created_at DESC);

-- camera_events indexes
CREATE INDEX IF NOT EXISTS idx_camera_events_organization 
  ON public.camera_events(organization_id);

CREATE INDEX IF NOT EXISTS idx_camera_events_camera 
  ON public.camera_events(camera_id);

CREATE INDEX IF NOT EXISTS idx_camera_events_camera_time 
  ON public.camera_events(camera_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_camera_events_org_time 
  ON public.camera_events(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_camera_events_type 
  ON public.camera_events(event_type);

CREATE INDEX IF NOT EXISTS idx_camera_events_severity 
  ON public.camera_events(severity) 
  WHERE severity IN ('warning', 'critical');

CREATE INDEX IF NOT EXISTS idx_camera_events_unacknowledged 
  ON public.camera_events(organization_id, acknowledged, created_at DESC) 
  WHERE acknowledged = false;

CREATE INDEX IF NOT EXISTS idx_camera_events_created_at 
  ON public.camera_events(created_at DESC);

-- camera_user_preferences indexes
CREATE INDEX IF NOT EXISTS idx_camera_user_preferences_user 
  ON public.camera_user_preferences(user_id);

CREATE INDEX IF NOT EXISTS idx_camera_user_preferences_org 
  ON public.camera_user_preferences(organization_id);

-- =====================================================
-- 6. Create Updated_at Trigger Functions
-- =====================================================

-- Trigger function for camera_devices
CREATE OR REPLACE FUNCTION update_camera_devices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for camera_user_preferences
CREATE OR REPLACE FUNCTION update_camera_user_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 7. Create Triggers
-- =====================================================

-- Trigger for camera_devices updated_at
DROP TRIGGER IF EXISTS camera_devices_updated_at ON public.camera_devices;
CREATE TRIGGER camera_devices_updated_at
  BEFORE UPDATE ON public.camera_devices
  FOR EACH ROW
  EXECUTE FUNCTION update_camera_devices_updated_at();

-- Trigger for camera_user_preferences updated_at
DROP TRIGGER IF EXISTS camera_user_preferences_updated_at ON public.camera_user_preferences;
CREATE TRIGGER camera_user_preferences_updated_at
  BEFORE UPDATE ON public.camera_user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_camera_user_preferences_updated_at();

-- =====================================================
-- 8. Enable Row Level Security
-- =====================================================

ALTER TABLE public.camera_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.camera_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.camera_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.camera_user_preferences ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 9. RLS Policies for camera_devices
-- =====================================================

-- Users can view cameras in their organization
CREATE POLICY "Users can view organization cameras"
  ON public.camera_devices
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Users can insert cameras for their organization
CREATE POLICY "Users can insert cameras"
  ON public.camera_devices
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Users can update cameras in their organization
CREATE POLICY "Users can update organization cameras"
  ON public.camera_devices
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Admins can delete cameras in their organization
CREATE POLICY "Admins can delete organization cameras"
  ON public.camera_devices
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
      AND up.organization_id = camera_devices.organization_id
      AND up.role IN ('superadmin', 'admin', 'manager')
    )
  );

-- =====================================================
-- 10. RLS Policies for camera_recordings
-- =====================================================

-- Users can view recordings in their organization
CREATE POLICY "Users can view organization recordings"
  ON public.camera_recordings
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Users can insert recordings for their organization
CREATE POLICY "Users can insert recordings"
  ON public.camera_recordings
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Users can update recordings in their organization
CREATE POLICY "Users can update organization recordings"
  ON public.camera_recordings
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Admins can delete recordings in their organization
CREATE POLICY "Admins can delete organization recordings"
  ON public.camera_recordings
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
      AND up.organization_id = camera_recordings.organization_id
      AND up.role IN ('superadmin', 'admin', 'manager')
    )
  );

-- =====================================================
-- 11. RLS Policies for camera_events
-- =====================================================

-- Users can view events in their organization
CREATE POLICY "Users can view organization events"
  ON public.camera_events
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Users can insert events for their organization
CREATE POLICY "Users can insert events"
  ON public.camera_events
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Users can update events in their organization (for acknowledgment)
CREATE POLICY "Users can update organization events"
  ON public.camera_events
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Admins can delete events in their organization
CREATE POLICY "Admins can delete organization events"
  ON public.camera_events
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
      AND up.organization_id = camera_events.organization_id
      AND up.role IN ('superadmin', 'admin', 'manager')
    )
  );

-- =====================================================
-- 12. RLS Policies for camera_user_preferences
-- =====================================================

-- Users can view their own preferences
CREATE POLICY "Users can view own preferences"
  ON public.camera_user_preferences
  FOR SELECT
  USING (user_id = auth.uid());

-- Users can insert their own preferences
CREATE POLICY "Users can insert own preferences"
  ON public.camera_user_preferences
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Users can update their own preferences
CREATE POLICY "Users can update own preferences"
  ON public.camera_user_preferences
  FOR UPDATE
  USING (user_id = auth.uid());

-- Users can delete their own preferences
CREATE POLICY "Users can delete own preferences"
  ON public.camera_user_preferences
  FOR DELETE
  USING (user_id = auth.uid());

-- =====================================================
-- 13. Helper Functions
-- =====================================================

-- Function to get camera statistics by organization
CREATE OR REPLACE FUNCTION public.get_camera_statistics(
  p_organization_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_total_cameras BIGINT;
  v_active_cameras BIGINT;
  v_ptz_cameras BIGINT;
  v_cameras_by_category JSON;
  v_cameras_by_location JSON;
  v_recent_events BIGINT;
  v_unacknowledged_events BIGINT;
BEGIN
  -- Get total camera count
  SELECT COUNT(*) INTO v_total_cameras
  FROM public.camera_devices
  WHERE organization_id = p_organization_id;
  
  -- Get active camera count
  SELECT COUNT(*) INTO v_active_cameras
  FROM public.camera_devices
  WHERE organization_id = p_organization_id
    AND is_active = true;
  
  -- Get PTZ camera count
  SELECT COUNT(*) INTO v_ptz_cameras
  FROM public.camera_devices
  WHERE organization_id = p_organization_id
    AND is_ptz = true;
  
  -- Get cameras by category
  SELECT COALESCE(json_object_agg(COALESCE(category, 'uncategorized'), count), '{}'::json)
  INTO v_cameras_by_category
  FROM (
    SELECT category, COUNT(*) as count
    FROM public.camera_devices
    WHERE organization_id = p_organization_id
    GROUP BY category
  ) t;
  
  -- Get cameras by location
  SELECT COALESCE(json_object_agg(COALESCE(location, 'unassigned'), count), '{}'::json)
  INTO v_cameras_by_location
  FROM (
    SELECT location, COUNT(*) as count
    FROM public.camera_devices
    WHERE organization_id = p_organization_id
    GROUP BY location
  ) t;
  
  -- Get recent events count (last 24 hours)
  SELECT COUNT(*) INTO v_recent_events
  FROM public.camera_events
  WHERE organization_id = p_organization_id
    AND created_at >= NOW() - INTERVAL '24 hours';
  
  -- Get unacknowledged events count
  SELECT COUNT(*) INTO v_unacknowledged_events
  FROM public.camera_events
  WHERE organization_id = p_organization_id
    AND acknowledged = false;
  
  RETURN json_build_object(
    'total_cameras', v_total_cameras,
    'active_cameras', v_active_cameras,
    'ptz_cameras', v_ptz_cameras,
    'cameras_by_category', v_cameras_by_category,
    'cameras_by_location', v_cameras_by_location,
    'recent_events_24h', v_recent_events,
    'unacknowledged_events', v_unacknowledged_events
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to acknowledge camera event
CREATE OR REPLACE FUNCTION public.acknowledge_camera_event(
  p_event_id UUID
)
RETURNS public.camera_events AS $$
DECLARE
  v_event public.camera_events;
BEGIN
  UPDATE public.camera_events
  SET 
    acknowledged = true,
    acknowledged_by = auth.uid(),
    acknowledged_at = NOW()
  WHERE id = p_event_id
    AND organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  RETURNING * INTO v_event;
  
  RETURN v_event;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to bulk acknowledge camera events
CREATE OR REPLACE FUNCTION public.bulk_acknowledge_camera_events(
  p_event_ids UUID[]
)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.camera_events
  SET 
    acknowledged = true,
    acknowledged_by = auth.uid(),
    acknowledged_at = NOW()
  WHERE id = ANY(p_event_ids)
    AND acknowledged = false
    AND organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    );
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get recent camera events with optional filters
CREATE OR REPLACE FUNCTION public.get_camera_events(
  p_organization_id UUID,
  p_camera_id UUID DEFAULT NULL,
  p_event_type TEXT DEFAULT NULL,
  p_severity TEXT DEFAULT NULL,
  p_acknowledged BOOLEAN DEFAULT NULL,
  p_hours_back INTEGER DEFAULT 24,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  camera_id UUID,
  camera_name TEXT,
  event_type TEXT,
  severity TEXT,
  description TEXT,
  snapshot_url TEXT,
  metadata JSONB,
  acknowledged BOOLEAN,
  acknowledged_by UUID,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ce.id,
    ce.camera_id,
    cd.name as camera_name,
    ce.event_type,
    ce.severity,
    ce.description,
    ce.snapshot_url,
    ce.metadata,
    ce.acknowledged,
    ce.acknowledged_by,
    ce.acknowledged_at,
    ce.created_at
  FROM public.camera_events ce
  INNER JOIN public.camera_devices cd ON cd.id = ce.camera_id
  WHERE ce.organization_id = p_organization_id
    AND ce.created_at >= NOW() - (p_hours_back || ' hours')::INTERVAL
    AND (p_camera_id IS NULL OR ce.camera_id = p_camera_id)
    AND (p_event_type IS NULL OR ce.event_type = p_event_type)
    AND (p_severity IS NULL OR ce.severity = p_severity)
    AND (p_acknowledged IS NULL OR ce.acknowledged = p_acknowledged)
  ORDER BY ce.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 14. Grant Permissions
-- =====================================================

GRANT SELECT, INSERT, UPDATE ON public.camera_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.camera_recordings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.camera_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.camera_user_preferences TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_camera_statistics(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_camera_event(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_acknowledge_camera_events(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_camera_events(UUID, UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, INTEGER) TO authenticated;

-- Service role permissions for sync operations
GRANT ALL ON public.camera_devices TO service_role;
GRANT ALL ON public.camera_recordings TO service_role;
GRANT ALL ON public.camera_events TO service_role;

-- =====================================================
-- End of Migration 160
-- =====================================================
