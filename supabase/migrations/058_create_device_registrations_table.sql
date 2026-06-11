-- =====================================================
-- Migration: Create Device Registrations Table
-- Version: 058
-- Description: Stores user-assigned device names for RF terminals and mobile devices
-- Date: October 30, 2025
-- =====================================================

-- Create device registrations table
CREATE TABLE IF NOT EXISTS public.device_registrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Device identification
  fingerprint_id VARCHAR(32) UNIQUE NOT NULL,  -- SHA-256 hash of device characteristics
  device_name VARCHAR(100) NOT NULL,           -- User-assigned name (e.g., "Warehouse Scanner 3")
  
  -- Device information
  device_type VARCHAR(20) NOT NULL,            -- 'iPhone', 'iPad', 'Android', 'Desktop'
  os_name VARCHAR(50),                         -- 'iOS', 'Android', 'Windows', etc.
  os_version VARCHAR(20),                      -- '17.1.2', etc.
  browser VARCHAR(50),                         -- 'Safari', 'Chrome', etc.
  
  -- Technical fingerprint details
  user_agent TEXT,                             -- Full user agent string
  screen_resolution VARCHAR(20),               -- '390x844'
  color_depth INTEGER,                         -- 24
  timezone VARCHAR(50),                        -- 'America/New_York'
  language VARCHAR(10),                        -- 'en-US'
  touch_points INTEGER,                        -- 5
  hardware_concurrency INTEGER,                -- 6
  
  -- Relationships
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Status and tracking
  is_active BOOLEAN DEFAULT true,
  first_registered TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  
  -- Audit fields
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add helpful comment
COMMENT ON TABLE public.device_registrations IS 'Stores user-assigned device names for RF terminals and mobile devices to enable device tracking in session management';

-- Add column comments
COMMENT ON COLUMN public.device_registrations.fingerprint_id IS 'Unique 32-character SHA-256 hash identifying this specific device';
COMMENT ON COLUMN public.device_registrations.device_name IS 'User-assigned name like "Warehouse Scanner 3" or "Jai''s iPhone"';
COMMENT ON COLUMN public.device_registrations.device_type IS 'Detected device type: iPhone, iPad, Android, or Desktop';

-- Create performance indexes
CREATE INDEX IF NOT EXISTS idx_device_registrations_fingerprint 
  ON public.device_registrations(fingerprint_id);

CREATE INDEX IF NOT EXISTS idx_device_registrations_user 
  ON public.device_registrations(user_id) 
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_device_registrations_organization 
  ON public.device_registrations(organization_id);

CREATE INDEX IF NOT EXISTS idx_device_registrations_active 
  ON public.device_registrations(is_active, last_seen DESC);

CREATE INDEX IF NOT EXISTS idx_device_registrations_device_type 
  ON public.device_registrations(device_type);

-- Add auto-update trigger for updated_at
CREATE OR REPLACE FUNCTION update_device_registrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER device_registrations_updated_at
  BEFORE UPDATE ON public.device_registrations
  FOR EACH ROW
  EXECUTE FUNCTION update_device_registrations_updated_at();

-- Create RLS policies
ALTER TABLE public.device_registrations ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own device registrations
CREATE POLICY "Users can view own device registrations"
  ON public.device_registrations
  FOR SELECT
  USING (
    user_id = auth.uid() 
    OR 
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Policy: Users can insert their own device registrations
CREATE POLICY "Users can insert own device registrations"
  ON public.device_registrations
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND
    organization_id IN (
      SELECT organization_id 
      FROM public.user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Policy: Users can update their own device registrations
CREATE POLICY "Users can update own device registrations"
  ON public.device_registrations
  FOR UPDATE
  USING (
    user_id = auth.uid()
  )
  WITH CHECK (
    user_id = auth.uid()
  );

-- Policy: Admins can view all device registrations in their organization
CREATE POLICY "Admins can view all organization device registrations"
  ON public.device_registrations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
      AND up.organization_id = device_registrations.organization_id
      AND up.role IN ('superadmin', 'admin', 'manager')
    )
  );

-- Create helper function to get or create device registration
CREATE OR REPLACE FUNCTION public.upsert_device_registration(
  p_fingerprint_id VARCHAR(32),
  p_device_name VARCHAR(100),
  p_device_type VARCHAR(20),
  p_os_name VARCHAR(50),
  p_os_version VARCHAR(20),
  p_browser VARCHAR(50),
  p_user_agent TEXT,
  p_screen_resolution VARCHAR(20),
  p_color_depth INTEGER,
  p_timezone VARCHAR(50),
  p_language VARCHAR(10),
  p_touch_points INTEGER,
  p_hardware_concurrency INTEGER,
  p_user_id UUID,
  p_organization_id UUID
)
RETURNS public.device_registrations AS $$
DECLARE
  v_device public.device_registrations;
BEGIN
  -- Try to update existing registration
  UPDATE public.device_registrations
  SET 
    device_name = p_device_name,
    user_id = p_user_id,
    last_seen = NOW(),
    updated_at = NOW()
  WHERE fingerprint_id = p_fingerprint_id
  RETURNING * INTO v_device;
  
  -- If no existing registration, insert new one
  IF v_device IS NULL THEN
    INSERT INTO public.device_registrations (
      fingerprint_id,
      device_name,
      device_type,
      os_name,
      os_version,
      browser,
      user_agent,
      screen_resolution,
      color_depth,
      timezone,
      language,
      touch_points,
      hardware_concurrency,
      user_id,
      organization_id
    ) VALUES (
      p_fingerprint_id,
      p_device_name,
      p_device_type,
      p_os_name,
      p_os_version,
      p_browser,
      p_user_agent,
      p_screen_resolution,
      p_color_depth,
      p_timezone,
      p_language,
      p_touch_points,
      p_hardware_concurrency,
      p_user_id,
      p_organization_id
    )
    RETURNING * INTO v_device;
  END IF;
  
  RETURN v_device;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.upsert_device_registration TO authenticated;

-- =====================================================
-- End of Migration 058
-- =====================================================

