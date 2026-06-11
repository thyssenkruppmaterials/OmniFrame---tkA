-- ============================================================================
-- Migration 191: MDM Device Locations, Telemetry, and Geofences
-- Description: Location tracking (time-series), geofencing, health samples,
--              and telemetry session management.
-- ============================================================================

-- =====================================================
-- 1. mdm_device_locations (time-series)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_device_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.mdm_devices(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  altitude DOUBLE PRECISION,
  horizontal_accuracy DOUBLE PRECISION,
  vertical_accuracy DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  timestamp TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL DEFAULT 'agent'
    CHECK (source IN ('mdm', 'agent', 'gps', 'wifi', 'cell', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdm_locations_device_ts
  ON public.mdm_device_locations (device_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mdm_locations_org_device_ts
  ON public.mdm_device_locations (organization_id, device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mdm_locations_org_ts
  ON public.mdm_device_locations (organization_id, timestamp DESC);

-- =====================================================
-- 2. mdm_location_rollups_hourly
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_location_rollups_hourly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.mdm_devices(id) ON DELETE CASCADE,
  hour_start TIMESTAMPTZ NOT NULL,
  sample_count INT NOT NULL DEFAULT 0,
  avg_latitude DOUBLE PRECISION,
  avg_longitude DOUBLE PRECISION,
  max_speed DOUBLE PRECISION,
  total_distance_meters DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT mdm_location_rollups_unique UNIQUE (device_id, hour_start)
);

CREATE INDEX IF NOT EXISTS idx_mdm_rollups_device_hour
  ON public.mdm_location_rollups_hourly (device_id, hour_start DESC);

-- =====================================================
-- 3. mdm_device_health_samples
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_device_health_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.mdm_devices(id) ON DELETE CASCADE,
  metrics JSONB NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdm_health_device_ts
  ON public.mdm_device_health_samples (device_id, timestamp DESC);

-- =====================================================
-- 4. mdm_telemetry_sessions
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_telemetry_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.mdm_devices(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  agent_version TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'stale', 'ended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdm_telemetry_sessions_device
  ON public.mdm_telemetry_sessions (device_id, status);

-- =====================================================
-- 5. mdm_agent_events
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_agent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.mdm_devices(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdm_agent_events_device_ts
  ON public.mdm_agent_events (device_id, timestamp DESC);

-- =====================================================
-- 6. mdm_geofences
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  geometry_type TEXT NOT NULL DEFAULT 'circle'
    CHECK (geometry_type IN ('circle', 'polygon')),
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION,
  radius_meters DOUBLE PRECISION,
  polygon_coordinates JSONB,
  alert_type TEXT NOT NULL DEFAULT 'both'
    CHECK (alert_type IN ('enter', 'exit', 'both')),
  trigger_actions JSONB,
  active_schedule JSONB,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.user_profiles(id),

  CONSTRAINT mdm_geofences_org_name UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_mdm_geofences_org
  ON public.mdm_geofences (organization_id);
CREATE INDEX IF NOT EXISTS idx_mdm_geofences_enabled
  ON public.mdm_geofences (organization_id, enabled) WHERE enabled = true;

-- =====================================================
-- 7. mdm_geofence_events
-- =====================================================

CREATE TABLE IF NOT EXISTS public.mdm_geofence_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  geofence_id UUID NOT NULL REFERENCES public.mdm_geofences(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.mdm_devices(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('enter', 'exit')),
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actions_executed JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdm_geofence_events_org
  ON public.mdm_geofence_events (organization_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_mdm_geofence_events_device
  ON public.mdm_geofence_events (device_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_mdm_geofence_events_geofence
  ON public.mdm_geofence_events (geofence_id, triggered_at DESC);

-- =====================================================
-- 8. RLS
-- =====================================================

ALTER TABLE public.mdm_device_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_location_rollups_hourly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_device_health_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_telemetry_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_geofences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdm_geofence_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view locations in their org" ON public.mdm_device_locations FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can view rollups in their org" ON public.mdm_location_rollups_hourly FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can view health samples for their devices" ON public.mdm_device_health_samples FOR SELECT TO authenticated
  USING (device_id IN (SELECT id FROM public.mdm_devices WHERE organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())));

CREATE POLICY "Users can view telemetry sessions for their devices" ON public.mdm_telemetry_sessions FOR SELECT TO authenticated
  USING (device_id IN (SELECT id FROM public.mdm_devices WHERE organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())));

CREATE POLICY "Users can view agent events for their devices" ON public.mdm_agent_events FOR SELECT TO authenticated
  USING (device_id IN (SELECT id FROM public.mdm_devices WHERE organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())));

CREATE POLICY "Users can view geofences in their org" ON public.mdm_geofences FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage geofences" ON public.mdm_geofences FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up JOIN public.roles r ON up.role_id = r.id WHERE up.id = auth.uid() AND r.name IN ('superadmin','admin') AND up.organization_id = mdm_geofences.organization_id));

CREATE POLICY "Users can view geofence events in their org" ON public.mdm_geofence_events FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

-- Service role full access
CREATE POLICY "svc locations" ON public.mdm_device_locations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc rollups" ON public.mdm_location_rollups_hourly FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc health" ON public.mdm_device_health_samples FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc telemetry" ON public.mdm_telemetry_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc agent events" ON public.mdm_agent_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc geofences" ON public.mdm_geofences FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc geofence events" ON public.mdm_geofence_events FOR ALL TO service_role USING (true) WITH CHECK (true);
