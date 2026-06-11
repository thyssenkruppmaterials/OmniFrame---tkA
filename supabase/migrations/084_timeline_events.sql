-- =====================================================
-- Timeline Events System for Shift Productivity
-- Migration: 084_timeline_events.sql
-- Created: January 2, 2026
-- Purpose: Create timeline events for activity timeline visualization
--          Includes predefined event types and custom events/meetings
-- =====================================================

-- ===== 1. EVENT CATEGORIES TABLE =====
-- Predefined event categories that can be customized per organization
CREATE TABLE IF NOT EXISTS public.timeline_event_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Category identification
    category_name VARCHAR(200) NOT NULL,
    category_code VARCHAR(50) NOT NULL,
    
    -- Display settings
    color VARCHAR(50) DEFAULT '#6B7280', -- hex color for timeline display
    icon VARCHAR(50) DEFAULT 'calendar', -- icon name for UI
    description TEXT,
    
    -- Category behavior
    is_paid_time BOOLEAN DEFAULT false, -- Whether this counts as paid time (like breaks)
    is_productive_time BOOLEAN DEFAULT false, -- Whether this counts as productive time
    is_recurring_allowed BOOLEAN DEFAULT true, -- Can events in this category be recurring
    default_duration_minutes INTEGER DEFAULT 30,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_system BOOLEAN DEFAULT false, -- System categories cannot be deleted
    display_order INTEGER DEFAULT 0,
    
    -- Audit
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(organization_id, category_code)
);

COMMENT ON TABLE public.timeline_event_categories IS 'Predefined event categories for timeline events (meetings, downtime, training, etc.)';

-- ===== 2. TIMELINE EVENTS TABLE =====
-- Individual events that appear on the activity timeline
CREATE TABLE IF NOT EXISTS public.timeline_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Event identification
    event_name VARCHAR(300) NOT NULL,
    category_id UUID NOT NULL REFERENCES public.timeline_event_categories(id) ON DELETE RESTRICT,
    
    -- Event timing
    event_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    duration_minutes INTEGER GENERATED ALWAYS AS (
        EXTRACT(HOUR FROM end_time - start_time) * 60 + 
        EXTRACT(MINUTE FROM end_time - start_time)
    ) STORED,
    
    -- Event scope
    scope_type VARCHAR(50) DEFAULT 'all', -- 'all', 'area', 'shift', 'user'
    working_area_id UUID REFERENCES public.working_areas(id) ON DELETE SET NULL,
    shift_schedule_id UUID REFERENCES public.shift_schedules(id) ON DELETE SET NULL,
    assigned_user_ids UUID[] DEFAULT '{}', -- Array of specific user IDs if scope is 'user'
    
    -- Event details
    description TEXT,
    location VARCHAR(200),
    notes TEXT,
    
    -- Recurring settings (NULL if not recurring)
    is_recurring BOOLEAN DEFAULT false,
    recurrence_pattern VARCHAR(50), -- 'daily', 'weekly', 'monthly', 'custom'
    recurrence_days INTEGER[] DEFAULT '{}', -- Days of week (1=Monday, 7=Sunday) for weekly
    recurrence_end_date DATE,
    parent_event_id UUID REFERENCES public.timeline_events(id) ON DELETE CASCADE, -- For recurring instances
    
    -- Status and metadata
    status VARCHAR(50) DEFAULT 'scheduled', -- 'scheduled', 'in_progress', 'completed', 'cancelled'
    is_mandatory BOOLEAN DEFAULT false,
    requires_acknowledgment BOOLEAN DEFAULT false,
    custom_attributes JSONB DEFAULT '{}',
    
    -- Audit
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- Constraint: end_time must be after start_time
    CONSTRAINT valid_event_times CHECK (end_time > start_time)
);

COMMENT ON TABLE public.timeline_events IS 'Timeline events for activity visualization (meetings, planned downtime, training, etc.)';

-- ===== 3. EVENT ACKNOWLEDGMENTS TABLE =====
-- Track user acknowledgments of events
CREATE TABLE IF NOT EXISTS public.timeline_event_acknowledgments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.timeline_events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    
    acknowledged_at TIMESTAMPTZ DEFAULT now(),
    notes TEXT,
    
    UNIQUE(event_id, user_id)
);

COMMENT ON TABLE public.timeline_event_acknowledgments IS 'User acknowledgments for timeline events';

-- ===== INDEXES FOR PERFORMANCE =====

-- Event Categories indexes
CREATE INDEX IF NOT EXISTS idx_event_categories_org ON public.timeline_event_categories(organization_id);
CREATE INDEX IF NOT EXISTS idx_event_categories_code ON public.timeline_event_categories(category_code);
CREATE INDEX IF NOT EXISTS idx_event_categories_active ON public.timeline_event_categories(is_active) WHERE is_active = true;

-- Timeline Events indexes
CREATE INDEX IF NOT EXISTS idx_timeline_events_org ON public.timeline_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_date ON public.timeline_events(event_date);
CREATE INDEX IF NOT EXISTS idx_timeline_events_category ON public.timeline_events(category_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_area ON public.timeline_events(working_area_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_shift ON public.timeline_events(shift_schedule_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_status ON public.timeline_events(status);
CREATE INDEX IF NOT EXISTS idx_timeline_events_recurring ON public.timeline_events(is_recurring) WHERE is_recurring = true;
CREATE INDEX IF NOT EXISTS idx_timeline_events_date_time ON public.timeline_events(event_date, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_timeline_events_scope ON public.timeline_events(scope_type);

-- Event Acknowledgments indexes
CREATE INDEX IF NOT EXISTS idx_event_ack_event ON public.timeline_event_acknowledgments(event_id);
CREATE INDEX IF NOT EXISTS idx_event_ack_user ON public.timeline_event_acknowledgments(user_id);

-- ===== ROW LEVEL SECURITY (RLS) =====

ALTER TABLE public.timeline_event_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_event_acknowledgments ENABLE ROW LEVEL SECURITY;

-- Event Categories RLS
CREATE POLICY "Users can view event categories in their organization"
    ON public.timeline_event_categories FOR SELECT
    USING (organization_id = get_user_organization_id());

CREATE POLICY "Admins can manage event categories"
    ON public.timeline_event_categories FOR ALL
    USING (
        organization_id = get_user_organization_id() 
        AND get_user_role() IN ('superadmin', 'admin', 'manager')
    );

-- Timeline Events RLS
CREATE POLICY "Users can view events in their organization"
    ON public.timeline_events FOR SELECT
    USING (organization_id = get_user_organization_id());

CREATE POLICY "Admins can manage events"
    ON public.timeline_events FOR ALL
    USING (
        organization_id = get_user_organization_id() 
        AND get_user_role() IN ('superadmin', 'admin', 'manager')
    );

-- Event Acknowledgments RLS
CREATE POLICY "Users can view their acknowledgments"
    ON public.timeline_event_acknowledgments FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can acknowledge events"
    ON public.timeline_event_acknowledgments FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- ===== TRIGGERS =====

CREATE TRIGGER update_timeline_event_categories_updated_at 
    BEFORE UPDATE ON public.timeline_event_categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_timeline_events_updated_at 
    BEFORE UPDATE ON public.timeline_events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===== HELPER FUNCTIONS =====

-- Function: Get events for a specific date and organization
CREATE OR REPLACE FUNCTION get_timeline_events_for_date(
    p_organization_id UUID,
    p_date DATE,
    p_area_id UUID DEFAULT NULL,
    p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
    event_id UUID,
    event_name VARCHAR,
    category_name VARCHAR,
    category_code VARCHAR,
    color VARCHAR,
    icon VARCHAR,
    start_time TIME,
    end_time TIME,
    duration_minutes INTEGER,
    is_paid_time BOOLEAN,
    is_productive_time BOOLEAN,
    scope_type VARCHAR,
    description TEXT,
    location VARCHAR,
    is_mandatory BOOLEAN,
    status VARCHAR
)
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        te.id as event_id,
        te.event_name,
        tec.category_name,
        tec.category_code,
        tec.color,
        tec.icon,
        te.start_time,
        te.end_time,
        te.duration_minutes,
        tec.is_paid_time,
        tec.is_productive_time,
        te.scope_type,
        te.description,
        te.location,
        te.is_mandatory,
        te.status
    FROM public.timeline_events te
    JOIN public.timeline_event_categories tec ON te.category_id = tec.id
    WHERE te.organization_id = p_organization_id
        AND te.event_date = p_date
        AND te.status != 'cancelled'
        AND (
            te.scope_type = 'all'
            OR (te.scope_type = 'area' AND te.working_area_id = p_area_id)
            OR (te.scope_type = 'user' AND p_user_id = ANY(te.assigned_user_ids))
        )
    ORDER BY te.start_time;
END;
$$ LANGUAGE plpgsql;

-- Function: Create recurring event instances
CREATE OR REPLACE FUNCTION create_recurring_event_instances(
    p_parent_event_id UUID,
    p_end_date DATE DEFAULT NULL
)
RETURNS INTEGER
SECURITY DEFINER
AS $$
DECLARE
    v_parent_event RECORD;
    v_current_date DATE;
    v_day_of_week INTEGER;
    v_count INTEGER := 0;
    v_end_date DATE;
BEGIN
    -- Get parent event
    SELECT * INTO v_parent_event 
    FROM public.timeline_events 
    WHERE id = p_parent_event_id AND is_recurring = true;
    
    IF NOT FOUND THEN
        RETURN 0;
    END IF;
    
    -- Determine end date
    v_end_date := COALESCE(p_end_date, v_parent_event.recurrence_end_date, v_parent_event.event_date + INTERVAL '3 months');
    
    -- Start from day after original event
    v_current_date := v_parent_event.event_date + INTERVAL '1 day';
    
    WHILE v_current_date <= v_end_date LOOP
        v_day_of_week := EXTRACT(ISODOW FROM v_current_date)::INTEGER;
        
        -- Check if this day matches recurrence pattern
        IF v_parent_event.recurrence_pattern = 'daily' OR 
           (v_parent_event.recurrence_pattern = 'weekly' AND v_day_of_week = ANY(v_parent_event.recurrence_days)) THEN
            
            -- Insert instance if not exists
            INSERT INTO public.timeline_events (
                organization_id, event_name, category_id, event_date, start_time, end_time,
                scope_type, working_area_id, shift_schedule_id, assigned_user_ids,
                description, location, notes, is_recurring, parent_event_id,
                is_mandatory, requires_acknowledgment, created_by
            )
            SELECT 
                v_parent_event.organization_id, v_parent_event.event_name, v_parent_event.category_id,
                v_current_date, v_parent_event.start_time, v_parent_event.end_time,
                v_parent_event.scope_type, v_parent_event.working_area_id, v_parent_event.shift_schedule_id,
                v_parent_event.assigned_user_ids, v_parent_event.description, v_parent_event.location,
                v_parent_event.notes, false, p_parent_event_id,
                v_parent_event.is_mandatory, v_parent_event.requires_acknowledgment, v_parent_event.created_by
            WHERE NOT EXISTS (
                SELECT 1 FROM public.timeline_events 
                WHERE parent_event_id = p_parent_event_id AND event_date = v_current_date
            );
            
            IF FOUND THEN
                v_count := v_count + 1;
            END IF;
        END IF;
        
        v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ===== SEED DEFAULT CATEGORIES =====
-- These will be created for each organization when needed

-- Function to initialize default categories for an organization
CREATE OR REPLACE FUNCTION initialize_timeline_event_categories(p_organization_id UUID)
RETURNS VOID
SECURITY DEFINER
AS $$
BEGIN
    -- Only insert if no categories exist for this organization
    IF NOT EXISTS (SELECT 1 FROM public.timeline_event_categories WHERE organization_id = p_organization_id) THEN
        INSERT INTO public.timeline_event_categories 
            (organization_id, category_name, category_code, color, icon, description, is_paid_time, is_productive_time, is_system, display_order)
        VALUES
            -- Planned Downtime
            (p_organization_id, 'Planned Downtime', 'planned_downtime', '#EF4444', 'alert-circle', 'Scheduled equipment maintenance or system downtime', false, false, true, 1),
            -- Team Meetings
            (p_organization_id, 'Team Meeting', 'team_meeting', '#8B5CF6', 'users', 'Team meetings and huddles', true, false, true, 2),
            -- Training
            (p_organization_id, 'Training', 'training', '#10B981', 'book-open', 'Training sessions and skill development', true, true, true, 3),
            -- Safety Briefing
            (p_organization_id, 'Safety Briefing', 'safety_briefing', '#F59E0B', 'shield', 'Safety meetings and briefings', true, false, true, 4),
            -- Break Extension
            (p_organization_id, 'Extended Break', 'extended_break', '#6B7280', 'coffee', 'Extended break periods', true, false, true, 5),
            -- Quality Audit
            (p_organization_id, 'Quality Audit', 'quality_audit', '#3B82F6', 'clipboard-check', 'Quality audit and inspection periods', true, true, true, 6),
            -- Inventory Count
            (p_organization_id, 'Inventory Count', 'inventory_count', '#EC4899', 'package', 'Scheduled inventory counting periods', true, true, true, 7),
            -- Shift Handover
            (p_organization_id, 'Shift Handover', 'shift_handover', '#14B8A6', 'repeat', 'Shift transition and handover period', true, false, true, 8),
            -- Company Event
            (p_organization_id, 'Company Event', 'company_event', '#8B5CF6', 'calendar', 'Company-wide events and announcements', true, false, true, 9),
            -- Custom Event
            (p_organization_id, 'Custom Event', 'custom', '#64748B', 'plus-circle', 'Custom events not fitting other categories', false, false, true, 99);
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ===== GRANT PERMISSIONS =====
GRANT SELECT ON public.timeline_event_categories TO authenticated;
GRANT SELECT ON public.timeline_events TO authenticated;
GRANT SELECT, INSERT ON public.timeline_event_acknowledgments TO authenticated;

GRANT ALL ON public.timeline_event_categories TO service_role;
GRANT ALL ON public.timeline_events TO service_role;
GRANT ALL ON public.timeline_event_acknowledgments TO service_role;

-- Grant execute on functions
GRANT EXECUTE ON FUNCTION get_timeline_events_for_date TO authenticated;
GRANT EXECUTE ON FUNCTION initialize_timeline_event_categories TO service_role;
GRANT EXECUTE ON FUNCTION create_recurring_event_instances TO service_role;

-- Migration complete
-- Timeline events system ready for implementation
