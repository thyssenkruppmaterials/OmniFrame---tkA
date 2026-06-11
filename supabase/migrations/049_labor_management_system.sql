-- =====================================================
-- Labor Management System for Shift Productivity
-- Migration: 049_labor_management_system.sql
-- Created: October 19, 2025
-- Purpose: Create comprehensive shift hierarchy and labor management framework
-- =====================================================

-- ===== 1. WORKING AREAS TABLE =====
-- Define physical or logical work zones/areas
CREATE TABLE IF NOT EXISTS public.working_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Area identification
    area_code VARCHAR(50) NOT NULL,
    area_name VARCHAR(200) NOT NULL,
    area_type VARCHAR(100) DEFAULT 'warehouse_zone', -- warehouse_zone, shipping_dock, receiving_dock, quality_lab, office, etc.
    
    -- Area attributes
    description TEXT,
    location_details JSONB DEFAULT '{}', -- floor, building, zone details
    capacity INTEGER, -- max workers
    is_active BOOLEAN DEFAULT true,
    requires_certification BOOLEAN DEFAULT false,
    required_certifications JSONB DEFAULT '[]',
    
    -- Supervision
    primary_supervisor_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    backup_supervisor_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    
    -- Scheduling
    operating_hours JSONB DEFAULT '{"start": "06:00", "end": "22:00"}',
    operating_days JSONB DEFAULT '[1,2,3,4,5,6,7]', -- 1=Monday, 7=Sunday
    
    -- Audit
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(organization_id, area_code)
);

COMMENT ON TABLE public.working_areas IS 'Physical or logical work zones/areas within warehouse operations';

-- ===== 2. SHIFT POSITIONS TABLE =====
-- Define organizational positions and roles
CREATE TABLE IF NOT EXISTS public.shift_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Position identification
    position_code VARCHAR(50) NOT NULL,
    position_title VARCHAR(200) NOT NULL,
    position_type VARCHAR(100) DEFAULT 'operational', -- leadership, operational, administrative, quality, specialist
    position_level INTEGER DEFAULT 1, -- 1=entry, 2=intermediate, 3=senior, 4=lead, 5=management, 6=director
    
    -- Position details
    description TEXT,
    responsibilities TEXT,
    required_skills JSONB DEFAULT '[]',
    required_certifications JSONB DEFAULT '[]',
    pay_grade VARCHAR(50),
    
    -- Position relationships
    reports_to_position_id UUID REFERENCES public.shift_positions(id) ON DELETE SET NULL,
    department VARCHAR(100),
    
    -- Capacity and requirements
    headcount_budget INTEGER DEFAULT 1,
    is_supervisory BOOLEAN DEFAULT false,
    requires_background_check BOOLEAN DEFAULT false,
    minimum_experience_years NUMERIC(4,2),
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    effective_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    
    -- Audit
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(organization_id, position_code)
);

COMMENT ON TABLE public.shift_positions IS 'Organizational positions defining roles, hierarchy, and responsibilities';

-- ===== 3. SHIFT_ASSIGNMENTS TABLE =====
-- Assign users to positions, areas, and shifts
CREATE TABLE IF NOT EXISTS public.shift_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Assignment identification
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    position_id UUID NOT NULL REFERENCES public.shift_positions(id) ON DELETE RESTRICT,
    working_area_id UUID REFERENCES public.working_areas(id) ON DELETE SET NULL,
    
    -- Assignment details
    assignment_type VARCHAR(50) DEFAULT 'permanent', -- permanent, temporary, seasonal, contractor
    shift_pattern VARCHAR(50) DEFAULT 'fixed', -- fixed, rotating, flexible, on_call
    shift_schedule JSONB DEFAULT '{"days": [1,2,3,4,5], "start_time": "08:00", "end_time": "17:00"}',
    
    -- Direct supervisor assignment
    direct_supervisor_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    team_lead_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    
    -- Assignment status and dates
    status VARCHAR(50) DEFAULT 'active', -- active, inactive, on_leave, transferred, terminated
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE,
    is_primary_position BOOLEAN DEFAULT true,
    
    -- Performance tracking
    productivity_target NUMERIC(5,2), -- Expected productivity percentage
    quality_target NUMERIC(5,2), -- Expected quality percentage
    
    -- Notes and metadata
    assignment_notes TEXT,
    custom_attributes JSONB DEFAULT '{}',
    
    -- Audit
    assigned_by UUID REFERENCES public.user_profiles(id),
    assigned_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(user_id, position_id, start_date)
);

COMMENT ON TABLE public.shift_assignments IS 'Assignment of users to positions, working areas, and shifts with hierarchy tracking';

-- ===== 4. ORGANIZATIONAL_HIERARCHY TABLE =====
-- Track complete organizational reporting structure
CREATE TABLE IF NOT EXISTS public.organizational_hierarchy (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Hierarchy relationship
    subordinate_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    supervisor_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    
    -- Relationship details
    relationship_type VARCHAR(50) DEFAULT 'direct', -- direct, dotted_line, matrix, temporary
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    
    -- Hierarchy metadata
    level_difference INTEGER DEFAULT 1, -- How many levels apart (1=direct report, 2=skip level, etc.)
    delegation_authority JSONB DEFAULT '[]', -- What can be delegated
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    -- Audit
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(subordinate_id, supervisor_id, effective_from),
    CHECK (subordinate_id != supervisor_id) -- Prevent self-reporting
);

COMMENT ON TABLE public.organizational_hierarchy IS 'Complete organizational reporting structure and hierarchy relationships';

-- ===== 5. SHIFT_SCHEDULES TABLE =====
-- Define shift templates and schedules
CREATE TABLE IF NOT EXISTS public.shift_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Schedule identification
    schedule_name VARCHAR(200) NOT NULL,
    schedule_code VARCHAR(50),
    schedule_type VARCHAR(50) DEFAULT 'standard', -- standard, rotating, flex, on_call, split
    
    -- Timing
    shift_start_time TIME NOT NULL,
    shift_end_time TIME NOT NULL,
    break_duration_minutes INTEGER DEFAULT 30,
    break_start_time TIME,
    
    -- Days configuration
    operating_days JSONB DEFAULT '[1,2,3,4,5]', -- Array of days: 1=Monday, 7=Sunday
    
    -- Capacity
    min_headcount INTEGER DEFAULT 1,
    max_headcount INTEGER,
    target_headcount INTEGER,
    
    -- Applicable positions/areas
    applicable_positions JSONB DEFAULT '[]', -- Array of position IDs or codes
    applicable_areas JSONB DEFAULT '[]', -- Array of working area IDs or codes
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    effective_from DATE DEFAULT CURRENT_DATE,
    effective_to DATE,
    
    -- Audit
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(organization_id, schedule_code)
);

COMMENT ON TABLE public.shift_schedules IS 'Shift schedule templates defining work timing and patterns';

-- ===== 6. LABOR_STANDARDS TABLE =====
-- Define productivity and quality standards per position/area
CREATE TABLE IF NOT EXISTS public.labor_standards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Standard identification
    standard_name VARCHAR(200) NOT NULL,
    standard_type VARCHAR(50) DEFAULT 'productivity', -- productivity, quality, safety, accuracy
    
    -- Scope
    position_id UUID REFERENCES public.shift_positions(id) ON DELETE CASCADE,
    working_area_id UUID REFERENCES public.working_areas(id) ON DELETE CASCADE,
    task_type VARCHAR(100), -- scan, putaway, pick, pack, count, etc.
    
    -- Standard metrics
    target_value NUMERIC(10,2) NOT NULL,
    unit_of_measure VARCHAR(50) NOT NULL, -- units_per_hour, accuracy_percentage, error_rate, etc.
    
    -- Thresholds
    minimum_acceptable NUMERIC(10,2),
    maximum_acceptable NUMERIC(10,2),
    excellent_threshold NUMERIC(10,2),
    
    -- Time-based applicability
    applies_to_shifts JSONB DEFAULT '[]', -- Array of shift schedule IDs
    applies_to_days JSONB DEFAULT '[1,2,3,4,5,6,7]',
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    effective_from DATE DEFAULT CURRENT_DATE,
    effective_to DATE,
    
    -- Audit
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.labor_standards IS 'Productivity and quality standards per position/area/task type';

-- ===== INDEXES FOR PERFORMANCE =====

-- Working Areas indexes
CREATE INDEX IF NOT EXISTS idx_working_areas_organization_id ON public.working_areas(organization_id);
CREATE INDEX IF NOT EXISTS idx_working_areas_area_code ON public.working_areas(area_code);
CREATE INDEX IF NOT EXISTS idx_working_areas_area_type ON public.working_areas(area_type);
CREATE INDEX IF NOT EXISTS idx_working_areas_supervisor ON public.working_areas(primary_supervisor_id);
CREATE INDEX IF NOT EXISTS idx_working_areas_active ON public.working_areas(is_active) WHERE is_active = true;

-- Shift Positions indexes
CREATE INDEX IF NOT EXISTS idx_shift_positions_organization_id ON public.shift_positions(organization_id);
CREATE INDEX IF NOT EXISTS idx_shift_positions_code ON public.shift_positions(position_code);
CREATE INDEX IF NOT EXISTS idx_shift_positions_type ON public.shift_positions(position_type);
CREATE INDEX IF NOT EXISTS idx_shift_positions_level ON public.shift_positions(position_level);
CREATE INDEX IF NOT EXISTS idx_shift_positions_reports_to ON public.shift_positions(reports_to_position_id);
CREATE INDEX IF NOT EXISTS idx_shift_positions_department ON public.shift_positions(department);
CREATE INDEX IF NOT EXISTS idx_shift_positions_active ON public.shift_positions(is_active) WHERE is_active = true;

-- Shift Assignments indexes
CREATE INDEX IF NOT EXISTS idx_shift_assignments_organization_id ON public.shift_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_user_id ON public.shift_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_position_id ON public.shift_assignments(position_id);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_area_id ON public.shift_assignments(working_area_id);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_supervisor ON public.shift_assignments(direct_supervisor_id);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_team_lead ON public.shift_assignments(team_lead_id);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_status ON public.shift_assignments(status);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_active ON public.shift_assignments(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_shift_assignments_dates ON public.shift_assignments(start_date, end_date);

-- Organizational Hierarchy indexes
CREATE INDEX IF NOT EXISTS idx_org_hierarchy_organization_id ON public.organizational_hierarchy(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_hierarchy_subordinate ON public.organizational_hierarchy(subordinate_id);
CREATE INDEX IF NOT EXISTS idx_org_hierarchy_supervisor ON public.organizational_hierarchy(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_org_hierarchy_active ON public.organizational_hierarchy(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_org_hierarchy_dates ON public.organizational_hierarchy(effective_from, effective_to);

-- Shift Schedules indexes
CREATE INDEX IF NOT EXISTS idx_shift_schedules_organization_id ON public.shift_schedules(organization_id);
CREATE INDEX IF NOT EXISTS idx_shift_schedules_code ON public.shift_schedules(schedule_code);
CREATE INDEX IF NOT EXISTS idx_shift_schedules_type ON public.shift_schedules(schedule_type);
CREATE INDEX IF NOT EXISTS idx_shift_schedules_active ON public.shift_schedules(is_active) WHERE is_active = true;

-- Labor Standards indexes
CREATE INDEX IF NOT EXISTS idx_labor_standards_organization_id ON public.labor_standards(organization_id);
CREATE INDEX IF NOT EXISTS idx_labor_standards_position ON public.labor_standards(position_id);
CREATE INDEX IF NOT EXISTS idx_labor_standards_area ON public.labor_standards(working_area_id);
CREATE INDEX IF NOT EXISTS idx_labor_standards_type ON public.labor_standards(standard_type);
CREATE INDEX IF NOT EXISTS idx_labor_standards_task_type ON public.labor_standards(task_type);
CREATE INDEX IF NOT EXISTS idx_labor_standards_active ON public.labor_standards(is_active) WHERE is_active = true;

-- ===== ROW LEVEL SECURITY (RLS) POLICIES =====

-- Enable RLS
ALTER TABLE public.working_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizational_hierarchy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labor_standards ENABLE ROW LEVEL SECURITY;

-- Working Areas RLS
CREATE POLICY "Users can view working areas in their organization"
    ON public.working_areas FOR SELECT
    USING (organization_id = get_user_organization_id());

CREATE POLICY "Admins can manage working areas"
    ON public.working_areas FOR ALL
    USING (
        organization_id = get_user_organization_id() 
        AND get_user_role() IN ('superadmin', 'admin', 'manager')
    );

-- Shift Positions RLS
CREATE POLICY "Users can view positions in their organization"
    ON public.shift_positions FOR SELECT
    USING (organization_id = get_user_organization_id());

CREATE POLICY "Admins can manage positions"
    ON public.shift_positions FOR ALL
    USING (
        organization_id = get_user_organization_id() 
        AND get_user_role() IN ('superadmin', 'admin', 'manager')
    );

-- Shift Assignments RLS
CREATE POLICY "Users can view assignments in their organization"
    ON public.shift_assignments FOR SELECT
    USING (organization_id = get_user_organization_id());

CREATE POLICY "Users can view their own assignments"
    ON public.shift_assignments FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Admins can manage assignments"
    ON public.shift_assignments FOR ALL
    USING (
        organization_id = get_user_organization_id() 
        AND get_user_role() IN ('superadmin', 'admin', 'manager')
    );

-- Organizational Hierarchy RLS
CREATE POLICY "Users can view hierarchy in their organization"
    ON public.organizational_hierarchy FOR SELECT
    USING (organization_id = get_user_organization_id());

CREATE POLICY "Admins can manage hierarchy"
    ON public.organizational_hierarchy FOR ALL
    USING (
        organization_id = get_user_organization_id() 
        AND get_user_role() IN ('superadmin', 'admin', 'manager')
    );

-- Shift Schedules RLS
CREATE POLICY "Users can view schedules in their organization"
    ON public.shift_schedules FOR SELECT
    USING (organization_id = get_user_organization_id());

CREATE POLICY "Admins can manage schedules"
    ON public.shift_schedules FOR ALL
    USING (
        organization_id = get_user_organization_id() 
        AND get_user_role() IN ('superadmin', 'admin', 'manager')
    );

-- Labor Standards RLS
CREATE POLICY "Users can view standards in their organization"
    ON public.labor_standards FOR SELECT
    USING (organization_id = get_user_organization_id());

CREATE POLICY "Admins can manage standards"
    ON public.labor_standards FOR ALL
    USING (
        organization_id = get_user_organization_id() 
        AND get_user_role() IN ('superadmin', 'admin', 'manager')
    );

-- ===== HELPER FUNCTIONS =====

-- Function: Get user's current position
CREATE OR REPLACE FUNCTION get_user_current_position(p_user_id UUID)
RETURNS TABLE (
    position_id UUID,
    position_title VARCHAR,
    position_code VARCHAR,
    position_level INTEGER,
    working_area_id UUID,
    area_name VARCHAR,
    supervisor_id UUID,
    supervisor_name VARCHAR
) 
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sa.position_id,
        sp.position_title,
        sp.position_code,
        sp.position_level,
        sa.working_area_id,
        wa.area_name,
        sa.direct_supervisor_id,
        up.full_name
    FROM public.shift_assignments sa
    LEFT JOIN public.shift_positions sp ON sa.position_id = sp.id
    LEFT JOIN public.working_areas wa ON sa.working_area_id = wa.id
    LEFT JOIN public.user_profiles up ON sa.direct_supervisor_id = up.id
    WHERE sa.user_id = p_user_id
        AND sa.status = 'active'
        AND sa.is_primary_position = true
        AND (sa.end_date IS NULL OR sa.end_date > CURRENT_DATE)
    ORDER BY sa.created_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function: Get organizational hierarchy tree
CREATE OR REPLACE FUNCTION get_organizational_tree(p_organization_id UUID, p_root_user_id UUID DEFAULT NULL)
RETURNS TABLE (
    user_id UUID,
    full_name VARCHAR,
    email VARCHAR,
    position_title VARCHAR,
    level_in_tree INTEGER,
    supervisor_id UUID,
    path TEXT[]
) 
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE hierarchy_tree AS (
        -- Base case: Start with root (if specified) or top-level employees
        SELECT 
            sa.user_id,
            up.full_name,
            up.email,
            sp.position_title,
            1 as level_in_tree,
            sa.direct_supervisor_id as supervisor_id,
            ARRAY[up.full_name] as path
        FROM public.shift_assignments sa
        JOIN public.user_profiles up ON sa.user_id = up.id
        LEFT JOIN public.shift_positions sp ON sa.position_id = sp.id
        WHERE sa.organization_id = p_organization_id
            AND sa.status = 'active'
            AND sa.is_primary_position = true
            AND (p_root_user_id IS NULL OR sa.user_id = p_root_user_id)
            AND (p_root_user_id IS NOT NULL OR sa.direct_supervisor_id IS NULL)
        
        UNION ALL
        
        -- Recursive case: Find direct reports
        SELECT 
            sa.user_id,
            up.full_name,
            up.email,
            sp.position_title,
            ht.level_in_tree + 1,
            sa.direct_supervisor_id,
            ht.path || up.full_name
        FROM public.shift_assignments sa
        JOIN public.user_profiles up ON sa.user_id = up.id
        LEFT JOIN public.shift_positions sp ON sa.position_id = sp.id
        JOIN hierarchy_tree ht ON sa.direct_supervisor_id = ht.user_id
        WHERE sa.organization_id = p_organization_id
            AND sa.status = 'active'
            AND sa.is_primary_position = true
    )
    SELECT * FROM hierarchy_tree
    ORDER BY level_in_tree, full_name;
END;
$$ LANGUAGE plpgsql;

-- Function: Get position hierarchy
CREATE OR REPLACE FUNCTION get_position_hierarchy(p_organization_id UUID)
RETURNS TABLE (
    position_id UUID,
    position_code VARCHAR,
    position_title VARCHAR,
    position_level INTEGER,
    reports_to_position_id UUID,
    reports_to_title VARCHAR,
    current_headcount BIGINT
) 
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sp.id as position_id,
        sp.position_code,
        sp.position_title,
        sp.position_level,
        sp.reports_to_position_id,
        parent.position_title as reports_to_title,
        COUNT(DISTINCT sa.user_id) as current_headcount
    FROM public.shift_positions sp
    LEFT JOIN public.shift_positions parent ON sp.reports_to_position_id = parent.id
    LEFT JOIN public.shift_assignments sa ON sp.id = sa.position_id 
        AND sa.status = 'active' 
        AND (sa.end_date IS NULL OR sa.end_date > CURRENT_DATE)
    WHERE sp.organization_id = p_organization_id
        AND sp.is_active = true
    GROUP BY sp.id, sp.position_code, sp.position_title, sp.position_level, 
             sp.reports_to_position_id, parent.position_title
    ORDER BY sp.position_level, sp.position_title;
END;
$$ LANGUAGE plpgsql;

-- Function: Get working area statistics
CREATE OR REPLACE FUNCTION get_working_area_statistics(p_organization_id UUID)
RETURNS JSONB
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'totalAreas', COUNT(*),
        'activeAreas', COUNT(*) FILTER (WHERE is_active = true),
        'totalCapacity', SUM(capacity),
        'areasRequiringCertification', COUNT(*) FILTER (WHERE requires_certification = true),
        'areasByType', (
            SELECT jsonb_object_agg(area_type, count)
            FROM (
                SELECT area_type, COUNT(*) as count
                FROM public.working_areas
                WHERE organization_id = p_organization_id
                GROUP BY area_type
            ) area_counts
        ),
        'totalAssignedWorkers', (
            SELECT COUNT(DISTINCT user_id)
            FROM public.shift_assignments sa
            WHERE sa.organization_id = p_organization_id
                AND sa.working_area_id IS NOT NULL
                AND sa.status = 'active'
        )
    ) INTO result
    FROM public.working_areas
    WHERE organization_id = p_organization_id;
    
    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- Function: Get position statistics
CREATE OR REPLACE FUNCTION get_position_statistics(p_organization_id UUID)
RETURNS JSONB
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'totalPositions', COUNT(*),
        'activePositions', COUNT(*) FILTER (WHERE is_active = true),
        'supervisoryPositions', COUNT(*) FILTER (WHERE is_supervisory = true),
        'totalHeadcountBudget', SUM(headcount_budget),
        'actualHeadcount', (
            SELECT COUNT(DISTINCT user_id)
            FROM public.shift_assignments
            WHERE organization_id = p_organization_id
                AND status = 'active'
        ),
        'positionsByType', (
            SELECT jsonb_object_agg(position_type, count)
            FROM (
                SELECT position_type, COUNT(*) as count
                FROM public.shift_positions
                WHERE organization_id = p_organization_id
                GROUP BY position_type
            ) type_counts
        ),
        'positionsByLevel', (
            SELECT jsonb_object_agg(position_level::text, count)
            FROM (
                SELECT position_level, COUNT(*) as count
                FROM public.shift_positions
                WHERE organization_id = p_organization_id
                GROUP BY position_level
            ) level_counts
        )
    ) INTO result
    FROM public.shift_positions
    WHERE organization_id = p_organization_id;
    
    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- ===== TRIGGERS =====

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_working_areas_updated_at BEFORE UPDATE ON public.working_areas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shift_positions_updated_at BEFORE UPDATE ON public.shift_positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shift_assignments_updated_at BEFORE UPDATE ON public.shift_assignments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_organizational_hierarchy_updated_at BEFORE UPDATE ON public.organizational_hierarchy
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shift_schedules_updated_at BEFORE UPDATE ON public.shift_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_labor_standards_updated_at BEFORE UPDATE ON public.labor_standards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===== GRANT PERMISSIONS =====
GRANT SELECT ON public.working_areas TO authenticated;
GRANT SELECT ON public.shift_positions TO authenticated;
GRANT SELECT ON public.shift_assignments TO authenticated;
GRANT SELECT ON public.organizational_hierarchy TO authenticated;
GRANT SELECT ON public.shift_schedules TO authenticated;
GRANT SELECT ON public.labor_standards TO authenticated;

GRANT ALL ON public.working_areas TO service_role;
GRANT ALL ON public.shift_positions TO service_role;
GRANT ALL ON public.shift_assignments TO service_role;
GRANT ALL ON public.organizational_hierarchy TO service_role;
GRANT ALL ON public.shift_schedules TO service_role;
GRANT ALL ON public.labor_standards TO service_role;

-- ===== SAMPLE DATA FOR TESTING =====
-- Insert sample positions (organization-agnostic structure)
-- Users should customize these for their specific needs

COMMENT ON COLUMN public.shift_positions.position_type IS 'Types: leadership, operational, administrative, quality, specialist, support';
COMMENT ON COLUMN public.shift_positions.position_level IS 'Levels: 1=Entry, 2=Intermediate, 3=Senior, 4=Lead, 5=Management, 6=Director';
COMMENT ON COLUMN public.working_areas.area_type IS 'Types: warehouse_zone, shipping_dock, receiving_dock, quality_lab, office, yard, staging';
COMMENT ON COLUMN public.shift_assignments.assignment_type IS 'Types: permanent, temporary, seasonal, contractor, intern';
COMMENT ON COLUMN public.shift_assignments.shift_pattern IS 'Patterns: fixed, rotating, flexible, on_call, split';
COMMENT ON COLUMN public.shift_assignments.status IS 'Status: active, inactive, on_leave, transferred, terminated';
COMMENT ON COLUMN public.organizational_hierarchy.relationship_type IS 'Types: direct, dotted_line, matrix, temporary, project';

-- Migration complete
-- Ready for labor management system implementation

