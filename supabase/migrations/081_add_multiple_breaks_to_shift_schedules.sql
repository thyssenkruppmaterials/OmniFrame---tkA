-- =====================================================
-- Add Multiple Breaks Support to Shift Schedules
-- Migration: 081_add_multiple_breaks_to_shift_schedules.sql
-- Created: December 27, 2025
-- Purpose: Allow configurable multiple break periods per shift schedule
-- =====================================================

-- Add breaks JSONB column to store multiple break periods
ALTER TABLE public.shift_schedules 
ADD COLUMN IF NOT EXISTS breaks JSONB DEFAULT '[]';

-- Comment on the new column
COMMENT ON COLUMN public.shift_schedules.breaks IS 'Array of break periods: [{name: string, start_time: string, duration_minutes: number, is_paid: boolean}]';

-- Add description column for more context about the schedule
ALTER TABLE public.shift_schedules 
ADD COLUMN IF NOT EXISTS description TEXT;

-- Add color column for UI display
ALTER TABLE public.shift_schedules 
ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#3b82f6';

-- Create an index on is_active for faster queries
CREATE INDEX IF NOT EXISTS idx_shift_schedules_org_active 
ON public.shift_schedules(organization_id, is_active) 
WHERE is_active = true;

-- Function to get shift schedules with assigned user count
CREATE OR REPLACE FUNCTION get_shift_schedules_with_stats(p_organization_id UUID)
RETURNS TABLE (
    id UUID,
    schedule_name VARCHAR,
    schedule_code VARCHAR,
    schedule_type VARCHAR,
    shift_start_time TIME,
    shift_end_time TIME,
    break_duration_minutes INTEGER,
    breaks JSONB,
    operating_days JSONB,
    color VARCHAR,
    description TEXT,
    is_active BOOLEAN,
    assigned_count BIGINT
)
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ss.id,
        ss.schedule_name,
        ss.schedule_code,
        ss.schedule_type,
        ss.shift_start_time,
        ss.shift_end_time,
        ss.break_duration_minutes,
        COALESCE(ss.breaks, '[]'::jsonb) as breaks,
        ss.operating_days,
        COALESCE(ss.color, '#3b82f6') as color,
        ss.description,
        ss.is_active,
        COUNT(DISTINCT sa.user_id) as assigned_count
    FROM public.shift_schedules ss
    LEFT JOIN public.shift_assignments sa ON sa.organization_id = ss.organization_id 
        AND sa.status = 'active'
        AND sa.shift_schedule_id = ss.id
    WHERE ss.organization_id = p_organization_id
    GROUP BY ss.id, ss.schedule_name, ss.schedule_code, ss.schedule_type,
             ss.shift_start_time, ss.shift_end_time, ss.break_duration_minutes,
             ss.breaks, ss.operating_days, ss.color, ss.description, ss.is_active
    ORDER BY ss.schedule_name;
END;
$$ LANGUAGE plpgsql;

-- Grant execute on the function
GRANT EXECUTE ON FUNCTION get_shift_schedules_with_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_shift_schedules_with_stats(UUID) TO service_role;

-- Add shift_schedule_id to shift_assignments for direct linking
ALTER TABLE public.shift_assignments 
ADD COLUMN IF NOT EXISTS shift_schedule_id UUID REFERENCES public.shift_schedules(id) ON DELETE SET NULL;

-- Create index for the new column
CREATE INDEX IF NOT EXISTS idx_shift_assignments_schedule_id 
ON public.shift_assignments(shift_schedule_id);

-- Update existing break data if any schedules have break_start_time set
-- Convert old single break format to new array format
UPDATE public.shift_schedules
SET breaks = jsonb_build_array(
    jsonb_build_object(
        'name', 'Lunch Break',
        'start_time', break_start_time::text,
        'duration_minutes', COALESCE(break_duration_minutes, 30),
        'is_paid', false
    )
)
WHERE break_start_time IS NOT NULL 
  AND (breaks IS NULL OR breaks = '[]'::jsonb);
