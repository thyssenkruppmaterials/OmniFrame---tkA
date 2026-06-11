-- =====================================================
-- Standard Work Scheduling Enhancement
-- Migration: 098_standard_work_scheduling.sql
-- Created: January 6, 2026
-- Purpose: Add scheduling capabilities for daily/weekly/monthly task tracking
--          with due dates, streaks, and progress tracking
-- =====================================================

-- ===== 1. ADD SCHEDULING FIELDS TO TEMPLATES =====

-- Add schedule configuration to templates
ALTER TABLE public.standard_work_templates
ADD COLUMN IF NOT EXISTS schedule_config JSONB DEFAULT '{}'::jsonb;

-- Add due time for daily deadlines (e.g., "17:00:00" for 5 PM)
ALTER TABLE public.standard_work_templates
ADD COLUMN IF NOT EXISTS due_time TIME DEFAULT NULL;

-- Add grace period in minutes before task is marked overdue
ALTER TABLE public.standard_work_templates
ADD COLUMN IF NOT EXISTS grace_period_minutes INTEGER DEFAULT 60;

-- Add notification settings
ALTER TABLE public.standard_work_templates
ADD COLUMN IF NOT EXISTS notification_settings JSONB DEFAULT '{"remind_before_minutes": 30, "notify_on_overdue": true}'::jsonb;

COMMENT ON COLUMN public.standard_work_templates.schedule_config IS 'Flexible scheduling config: {days_of_week: [1,3,5], days_of_month: [1,15], end_of_month: boolean}';
COMMENT ON COLUMN public.standard_work_templates.due_time IS 'Time of day when the task is due (for daily/scheduled tasks)';
COMMENT ON COLUMN public.standard_work_templates.grace_period_minutes IS 'Minutes after due_time before task is marked overdue';

-- ===== 2. ADD TRACKING FIELDS TO SUBMISSIONS =====

-- Add due_at for deadline tracking
ALTER TABLE public.standard_work_submissions
ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ DEFAULT NULL;

-- Add is_overdue flag
ALTER TABLE public.standard_work_submissions
ADD COLUMN IF NOT EXISTS is_overdue BOOLEAN DEFAULT false;

-- Add on_time flag (completed before due_at)
ALTER TABLE public.standard_work_submissions
ADD COLUMN IF NOT EXISTS completed_on_time BOOLEAN DEFAULT NULL;

-- Add schedule_date (the date this submission was scheduled for, different from shift_date)
ALTER TABLE public.standard_work_submissions
ADD COLUMN IF NOT EXISTS schedule_date DATE DEFAULT NULL;

COMMENT ON COLUMN public.standard_work_submissions.due_at IS 'When this submission is due (calculated from template schedule)';
COMMENT ON COLUMN public.standard_work_submissions.is_overdue IS 'Whether this submission is past its due date';
COMMENT ON COLUMN public.standard_work_submissions.completed_on_time IS 'Whether this submission was completed before due_at';
COMMENT ON COLUMN public.standard_work_submissions.schedule_date IS 'The date this task was scheduled for';

-- ===== 3. CREATE USER STREAKS TABLE =====

CREATE TABLE IF NOT EXISTS public.standard_work_user_streaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    template_id UUID REFERENCES public.standard_work_templates(id) ON DELETE CASCADE,
    
    -- Current streak info
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_completion_date DATE,
    streak_started_date DATE,
    
    -- Stats
    total_completions INTEGER DEFAULT 0,
    total_on_time INTEGER DEFAULT 0,
    total_late INTEGER DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- Unique constraint: one streak record per user per template (null template = overall)
    UNIQUE(organization_id, user_id, template_id)
);

-- Index for overall user streaks (template_id is NULL)
CREATE INDEX IF NOT EXISTS idx_sw_user_streaks_overall 
ON public.standard_work_user_streaks(organization_id, user_id) 
WHERE template_id IS NULL;

-- Index for template-specific streaks
CREATE INDEX IF NOT EXISTS idx_sw_user_streaks_template 
ON public.standard_work_user_streaks(user_id, template_id) 
WHERE template_id IS NOT NULL;

COMMENT ON TABLE public.standard_work_user_streaks IS 'Tracks user completion streaks for standard work checklists';

-- Enable RLS
ALTER TABLE public.standard_work_user_streaks ENABLE ROW LEVEL SECURITY;

-- RLS Policies for streaks
CREATE POLICY "Users can view their own streaks" ON public.standard_work_user_streaks
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can view streaks in their organization" ON public.standard_work_user_streaks
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "System can manage streaks" ON public.standard_work_user_streaks
    FOR ALL USING (true);

-- ===== 4. CREATE SCHEDULED TASKS VIEW =====

-- View for getting scheduled tasks with calculated due dates
CREATE OR REPLACE VIEW public.standard_work_scheduled_tasks AS
SELECT 
    t.id AS template_id,
    t.organization_id,
    t.template_name,
    t.template_code,
    t.description,
    t.frequency,
    t.schedule_config,
    t.due_time,
    t.grace_period_minutes,
    t.estimated_duration_minutes,
    t.working_area_id,
    t.color,
    t.icon,
    t.status,
    wa.area_name AS working_area_name,
    wa.area_code AS working_area_code,
    (SELECT COUNT(*) FROM public.standard_work_items WHERE template_id = t.id AND is_active = true) AS items_count
FROM public.standard_work_templates t
LEFT JOIN public.working_areas wa ON t.working_area_id = wa.id
WHERE t.is_active = true AND t.status = 'active';

-- ===== 5. FUNCTION TO CHECK IF TASK IS DUE TODAY =====

CREATE OR REPLACE FUNCTION is_task_due_on_date(
    p_frequency VARCHAR,
    p_schedule_config JSONB,
    p_check_date DATE
) RETURNS BOOLEAN AS $$
DECLARE
    v_day_of_week INTEGER;
    v_day_of_month INTEGER;
    v_days_array INTEGER[];
    v_month_days_array INTEGER[];
    v_last_day INTEGER;
BEGIN
    -- Daily tasks are always due
    IF p_frequency = 'daily' THEN
        RETURN TRUE;
    END IF;
    
    -- Weekly tasks: check day of week (0 = Sunday, 1 = Monday, etc.)
    IF p_frequency = 'weekly' THEN
        v_day_of_week := EXTRACT(DOW FROM p_check_date)::INTEGER;
        
        -- Get days_of_week from config, default to all weekdays [1,2,3,4,5]
        IF p_schedule_config ? 'days_of_week' THEN
            SELECT ARRAY(SELECT jsonb_array_elements_text(p_schedule_config->'days_of_week')::INTEGER)
            INTO v_days_array;
            RETURN v_day_of_week = ANY(v_days_array);
        END IF;
        
        -- Default: weekdays only
        RETURN v_day_of_week BETWEEN 1 AND 5;
    END IF;
    
    -- Monthly tasks: check day of month
    IF p_frequency = 'monthly' THEN
        v_day_of_month := EXTRACT(DAY FROM p_check_date)::INTEGER;
        v_last_day := EXTRACT(DAY FROM (DATE_TRUNC('month', p_check_date) + INTERVAL '1 month - 1 day'))::INTEGER;
        
        -- Check if end_of_month flag is set
        IF (p_schedule_config->>'end_of_month')::BOOLEAN = TRUE AND v_day_of_month = v_last_day THEN
            RETURN TRUE;
        END IF;
        
        -- Get days_of_month from config
        IF p_schedule_config ? 'days_of_month' THEN
            SELECT ARRAY(SELECT jsonb_array_elements_text(p_schedule_config->'days_of_month')::INTEGER)
            INTO v_month_days_array;
            RETURN v_day_of_month = ANY(v_month_days_array);
        END IF;
        
        -- Default: 1st of month
        RETURN v_day_of_month = 1;
    END IF;
    
    -- Shift-based tasks are always due during shifts
    IF p_frequency IN ('shift_start', 'shift_end') THEN
        RETURN TRUE;
    END IF;
    
    -- As-needed tasks are never automatically due
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ===== 6. FUNCTION TO GET SCHEDULED TASKS FOR A USER =====

CREATE OR REPLACE FUNCTION get_scheduled_tasks_for_date(
    p_organization_id UUID,
    p_user_id UUID,
    p_date DATE DEFAULT CURRENT_DATE,
    p_working_area_id UUID DEFAULT NULL
) RETURNS TABLE (
    template_id UUID,
    template_name VARCHAR,
    template_code VARCHAR,
    description TEXT,
    frequency VARCHAR,
    due_time TIME,
    due_at TIMESTAMPTZ,
    grace_period_minutes INTEGER,
    estimated_duration_minutes INTEGER,
    working_area_id UUID,
    working_area_name VARCHAR,
    color VARCHAR,
    items_count BIGINT,
    submission_id UUID,
    submission_status VARCHAR,
    completion_percentage NUMERIC,
    is_overdue BOOLEAN,
    is_completed BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.id AS template_id,
        t.template_name,
        t.template_code,
        t.description,
        t.frequency,
        t.due_time,
        CASE 
            WHEN t.due_time IS NOT NULL THEN 
                (p_date + t.due_time)::TIMESTAMPTZ AT TIME ZONE 'America/New_York'
            ELSE 
                (p_date + TIME '23:59:59')::TIMESTAMPTZ AT TIME ZONE 'America/New_York'
        END AS due_at,
        t.grace_period_minutes,
        t.estimated_duration_minutes,
        t.working_area_id,
        wa.area_name AS working_area_name,
        t.color,
        (SELECT COUNT(*) FROM public.standard_work_items WHERE template_id = t.id AND is_active = true) AS items_count,
        s.id AS submission_id,
        s.status AS submission_status,
        COALESCE(s.completion_percentage, 0) AS completion_percentage,
        COALESCE(s.is_overdue, FALSE) AS is_overdue,
        s.status = 'submitted' AS is_completed
    FROM public.standard_work_templates t
    LEFT JOIN public.working_areas wa ON t.working_area_id = wa.id
    LEFT JOIN public.standard_work_submissions s ON 
        s.template_id = t.id 
        AND s.shift_date = p_date 
        AND s.submitted_by = p_user_id
        AND (p_working_area_id IS NULL OR s.working_area_id = p_working_area_id)
    WHERE 
        t.organization_id = p_organization_id
        AND t.is_active = true 
        AND t.status = 'active'
        AND is_task_due_on_date(t.frequency, t.schedule_config, p_date)
        AND (p_working_area_id IS NULL OR t.working_area_id = p_working_area_id OR t.working_area_id IS NULL)
    ORDER BY 
        CASE WHEN s.status = 'submitted' THEN 3 ELSE 0 END,
        COALESCE(s.is_overdue, FALSE) DESC,
        t.due_time ASC NULLS LAST,
        t.template_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== 7. FUNCTION TO GET USER PROGRESS STATS =====

CREATE OR REPLACE FUNCTION get_user_standard_work_stats(
    p_organization_id UUID,
    p_user_id UUID,
    p_days INTEGER DEFAULT 30
) RETURNS JSON AS $$
DECLARE
    v_result JSON;
    v_start_date DATE;
BEGIN
    v_start_date := CURRENT_DATE - p_days;
    
    SELECT json_build_object(
        'total_assigned', (
            SELECT COUNT(DISTINCT t.id)
            FROM public.standard_work_templates t
            WHERE t.organization_id = p_organization_id
            AND t.is_active = true AND t.status = 'active'
        ),
        'completed_today', (
            SELECT COUNT(*)
            FROM public.standard_work_submissions s
            WHERE s.organization_id = p_organization_id
            AND s.submitted_by = p_user_id
            AND s.shift_date = CURRENT_DATE
            AND s.status = 'submitted'
        ),
        'due_today', (
            SELECT COUNT(*)
            FROM public.standard_work_templates t
            WHERE t.organization_id = p_organization_id
            AND t.is_active = true AND t.status = 'active'
            AND is_task_due_on_date(t.frequency, t.schedule_config, CURRENT_DATE)
        ),
        'overdue_count', (
            SELECT COUNT(*)
            FROM public.standard_work_submissions s
            JOIN public.standard_work_templates t ON s.template_id = t.id
            WHERE s.organization_id = p_organization_id
            AND s.submitted_by = p_user_id
            AND s.status NOT IN ('submitted', 'approved')
            AND s.shift_date < CURRENT_DATE
        ),
        'this_week_completed', (
            SELECT COUNT(*)
            FROM public.standard_work_submissions s
            WHERE s.organization_id = p_organization_id
            AND s.submitted_by = p_user_id
            AND s.shift_date >= DATE_TRUNC('week', CURRENT_DATE)
            AND s.status = 'submitted'
        ),
        'this_week_total', (
            SELECT SUM(
                CASE WHEN is_task_due_on_date(t.frequency, t.schedule_config, d.date) THEN 1 ELSE 0 END
            )
            FROM public.standard_work_templates t
            CROSS JOIN (
                SELECT generate_series(
                    DATE_TRUNC('week', CURRENT_DATE)::DATE,
                    CURRENT_DATE,
                    '1 day'::INTERVAL
                )::DATE AS date
            ) d
            WHERE t.organization_id = p_organization_id
            AND t.is_active = true AND t.status = 'active'
        ),
        'this_month_completed', (
            SELECT COUNT(*)
            FROM public.standard_work_submissions s
            WHERE s.organization_id = p_organization_id
            AND s.submitted_by = p_user_id
            AND s.shift_date >= DATE_TRUNC('month', CURRENT_DATE)
            AND s.status = 'submitted'
        ),
        'this_month_total', (
            SELECT SUM(
                CASE WHEN is_task_due_on_date(t.frequency, t.schedule_config, d.date) THEN 1 ELSE 0 END
            )
            FROM public.standard_work_templates t
            CROSS JOIN (
                SELECT generate_series(
                    DATE_TRUNC('month', CURRENT_DATE)::DATE,
                    CURRENT_DATE,
                    '1 day'::INTERVAL
                )::DATE AS date
            ) d
            WHERE t.organization_id = p_organization_id
            AND t.is_active = true AND t.status = 'active'
        ),
        'on_time_rate', (
            SELECT COALESCE(
                ROUND(
                    (COUNT(*) FILTER (WHERE s.completed_on_time = true)::NUMERIC / 
                    NULLIF(COUNT(*) FILTER (WHERE s.status = 'submitted'), 0)) * 100, 
                1), 0)
            FROM public.standard_work_submissions s
            WHERE s.organization_id = p_organization_id
            AND s.submitted_by = p_user_id
            AND s.shift_date >= v_start_date
        ),
        'current_streak', (
            SELECT COALESCE(current_streak, 0)
            FROM public.standard_work_user_streaks
            WHERE organization_id = p_organization_id
            AND user_id = p_user_id
            AND template_id IS NULL
            LIMIT 1
        ),
        'longest_streak', (
            SELECT COALESCE(longest_streak, 0)
            FROM public.standard_work_user_streaks
            WHERE organization_id = p_organization_id
            AND user_id = p_user_id
            AND template_id IS NULL
            LIMIT 1
        )
    ) INTO v_result;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== 8. FUNCTION TO UPDATE USER STREAK =====

CREATE OR REPLACE FUNCTION update_user_streak(
    p_organization_id UUID,
    p_user_id UUID,
    p_template_id UUID DEFAULT NULL,
    p_completion_date DATE DEFAULT CURRENT_DATE,
    p_was_on_time BOOLEAN DEFAULT TRUE
) RETURNS void AS $$
DECLARE
    v_streak_record standard_work_user_streaks%ROWTYPE;
    v_days_since_last INTEGER;
BEGIN
    -- Get or create streak record
    SELECT * INTO v_streak_record
    FROM public.standard_work_user_streaks
    WHERE organization_id = p_organization_id
    AND user_id = p_user_id
    AND (template_id = p_template_id OR (template_id IS NULL AND p_template_id IS NULL));
    
    IF NOT FOUND THEN
        -- Create new streak record
        INSERT INTO public.standard_work_user_streaks (
            organization_id, user_id, template_id,
            current_streak, longest_streak, last_completion_date, streak_started_date,
            total_completions, total_on_time, total_late
        ) VALUES (
            p_organization_id, p_user_id, p_template_id,
            1, 1, p_completion_date, p_completion_date,
            1, 
            CASE WHEN p_was_on_time THEN 1 ELSE 0 END,
            CASE WHEN p_was_on_time THEN 0 ELSE 1 END
        );
    ELSE
        -- Calculate days since last completion
        v_days_since_last := p_completion_date - v_streak_record.last_completion_date;
        
        -- Update streak
        IF v_days_since_last = 1 OR (v_days_since_last = 0 AND v_streak_record.last_completion_date = p_completion_date) THEN
            -- Continue streak (consecutive day or same day)
            UPDATE public.standard_work_user_streaks
            SET 
                current_streak = CASE 
                    WHEN v_days_since_last = 1 THEN current_streak + 1 
                    ELSE current_streak 
                END,
                longest_streak = GREATEST(longest_streak, 
                    CASE WHEN v_days_since_last = 1 THEN current_streak + 1 ELSE current_streak END
                ),
                last_completion_date = p_completion_date,
                total_completions = total_completions + CASE WHEN v_days_since_last > 0 THEN 1 ELSE 0 END,
                total_on_time = total_on_time + CASE WHEN p_was_on_time AND v_days_since_last > 0 THEN 1 ELSE 0 END,
                total_late = total_late + CASE WHEN NOT p_was_on_time AND v_days_since_last > 0 THEN 1 ELSE 0 END,
                updated_at = now()
            WHERE id = v_streak_record.id;
        ELSIF v_days_since_last > 1 THEN
            -- Streak broken, start new streak
            UPDATE public.standard_work_user_streaks
            SET 
                current_streak = 1,
                streak_started_date = p_completion_date,
                last_completion_date = p_completion_date,
                total_completions = total_completions + 1,
                total_on_time = total_on_time + CASE WHEN p_was_on_time THEN 1 ELSE 0 END,
                total_late = total_late + CASE WHEN NOT p_was_on_time THEN 1 ELSE 0 END,
                updated_at = now()
            WHERE id = v_streak_record.id;
        END IF;
    END IF;
    
    -- Also update overall streak (template_id = NULL) if this is template-specific
    IF p_template_id IS NOT NULL THEN
        PERFORM update_user_streak(p_organization_id, p_user_id, NULL, p_completion_date, p_was_on_time);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== 9. TRIGGER TO UPDATE STREAK ON SUBMISSION =====

CREATE OR REPLACE FUNCTION trigger_update_streak_on_submission()
RETURNS TRIGGER AS $$
BEGIN
    -- Only update streak when status changes to 'submitted'
    IF NEW.status = 'submitted' AND (OLD.status IS NULL OR OLD.status != 'submitted') THEN
        -- Determine if completed on time
        NEW.completed_on_time := CASE 
            WHEN NEW.due_at IS NULL THEN TRUE
            WHEN NEW.submitted_at <= NEW.due_at THEN TRUE
            ELSE FALSE
        END;
        
        -- Update streak
        PERFORM update_user_streak(
            NEW.organization_id,
            NEW.submitted_by,
            NEW.template_id,
            NEW.shift_date,
            NEW.completed_on_time
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_streak_on_submit ON public.standard_work_submissions;
CREATE TRIGGER trigger_streak_on_submit
    BEFORE UPDATE ON public.standard_work_submissions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_streak_on_submission();

-- ===== 10. TRIGGER TO CHECK OVERDUE STATUS =====

CREATE OR REPLACE FUNCTION trigger_check_overdue_status()
RETURNS TRIGGER AS $$
BEGIN
    -- Calculate if submission is overdue
    IF NEW.due_at IS NOT NULL AND NEW.status NOT IN ('submitted', 'approved') THEN
        NEW.is_overdue := NOW() > (NEW.due_at + (
            SELECT COALESCE(t.grace_period_minutes, 60) * INTERVAL '1 minute'
            FROM public.standard_work_templates t
            WHERE t.id = NEW.template_id
        ));
    ELSE
        NEW.is_overdue := FALSE;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_check_overdue ON public.standard_work_submissions;
CREATE TRIGGER trigger_check_overdue
    BEFORE INSERT OR UPDATE ON public.standard_work_submissions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_check_overdue_status();

-- ===== 11. GRANT PERMISSIONS =====

GRANT EXECUTE ON FUNCTION is_task_due_on_date(VARCHAR, JSONB, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_scheduled_tasks_for_date(UUID, UUID, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_standard_work_stats(UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_streak(UUID, UUID, UUID, DATE, BOOLEAN) TO authenticated;

-- ===== 12. CREATE INDEXES FOR NEW COLUMNS =====

CREATE INDEX IF NOT EXISTS idx_sw_submissions_due_at 
ON public.standard_work_submissions(due_at) 
WHERE due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sw_submissions_is_overdue 
ON public.standard_work_submissions(organization_id, is_overdue) 
WHERE is_overdue = true;

CREATE INDEX IF NOT EXISTS idx_sw_submissions_schedule_date 
ON public.standard_work_submissions(organization_id, schedule_date, submitted_by);

CREATE INDEX IF NOT EXISTS idx_sw_templates_schedule 
ON public.standard_work_templates(organization_id, frequency, status) 
WHERE is_active = true;
