-- ============================================================================
-- Shift Productivity Settings Table
-- Created: January 28, 2026
-- Purpose: Persist shift productivity settings per organization
-- ============================================================================

-- Create the settings table
CREATE TABLE IF NOT EXISTS shift_productivity_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- General Settings
  tracking_enabled BOOLEAN DEFAULT true,
  shift_duration VARCHAR(10) DEFAULT '8',
  break_tracking BOOLEAN DEFAULT true,
  auto_clock_out BOOLEAN DEFAULT false,
  timezone VARCHAR(50) DEFAULT 'America/New_York',
  
  -- KPI Thresholds
  enable_kpi_tracking BOOLEAN DEFAULT true,
  target_scans_per_hour INTEGER DEFAULT 30,
  target_putaways_per_hour INTEGER DEFAULT 15,
  target_picks_per_hour INTEGER DEFAULT 20,
  target_cycle_counts_per_hour INTEGER DEFAULT 5,
  quality_threshold INTEGER DEFAULT 95,
  accuracy_threshold INTEGER DEFAULT 98,
  
  -- Notification Settings
  enable_notifications BOOLEAN DEFAULT true,
  shift_start_reminder BOOLEAN DEFAULT true,
  shift_end_reminder BOOLEAN DEFAULT true,
  low_productivity_alert BOOLEAN DEFAULT true,
  target_missed_alert BOOLEAN DEFAULT true,
  team_milestone_notification BOOLEAN DEFAULT true,
  daily_summary BOOLEAN DEFAULT false,
  
  -- Team Settings
  enable_team_tracking BOOLEAN DEFAULT true,
  team_size INTEGER DEFAULT 10,
  shift_rotation VARCHAR(20) DEFAULT 'fixed',
  competitive_mode BOOLEAN DEFAULT false,
  team_goals_visible BOOLEAN DEFAULT true,
  individual_metrics_visible BOOLEAN DEFAULT true,
  cross_training_tracking BOOLEAN DEFAULT false,
  
  -- Advanced Settings
  data_retention_days INTEGER DEFAULT 90,
  auto_archive BOOLEAN DEFAULT true,
  export_format VARCHAR(10) DEFAULT 'csv',
  calculation_method VARCHAR(20) DEFAULT 'simple',
  enable_debug_mode BOOLEAN DEFAULT false,
  enable_advanced_analytics BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id)
);

-- Enable Row Level Security
ALTER TABLE shift_productivity_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their organization's settings
CREATE POLICY "Users can view their organization's settings"
  ON shift_productivity_settings FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

-- RLS Policy: Admins can manage their organization's settings
CREATE POLICY "Admins can manage their organization's settings"
  ON shift_productivity_settings FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles 
    WHERE id = auth.uid() AND role IN ('superadmin', 'admin', 'manager')
  ));

-- Trigger function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_shift_productivity_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS shift_productivity_settings_updated_at ON shift_productivity_settings;
CREATE TRIGGER shift_productivity_settings_updated_at
  BEFORE UPDATE ON shift_productivity_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_shift_productivity_settings_updated_at();

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_shift_productivity_settings_org_id 
  ON shift_productivity_settings(organization_id);

-- Grant permissions
GRANT SELECT ON shift_productivity_settings TO authenticated;
GRANT INSERT, UPDATE ON shift_productivity_settings TO authenticated;

COMMENT ON TABLE shift_productivity_settings IS 'Stores shift productivity settings per organization';
COMMENT ON COLUMN shift_productivity_settings.tracking_enabled IS 'Master toggle for productivity tracking';
COMMENT ON COLUMN shift_productivity_settings.shift_duration IS 'Default shift duration in hours (8, 10, or 12)';
COMMENT ON COLUMN shift_productivity_settings.enable_kpi_tracking IS 'Enable/disable KPI tracking against targets';
COMMENT ON COLUMN shift_productivity_settings.calculation_method IS 'Method for calculating productivity (simple, weighted, rolling)';
