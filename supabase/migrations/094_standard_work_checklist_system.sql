-- =====================================================
-- Standard Work Checklist System
-- Migration: 094_standard_work_checklist_system.sql
-- Created: January 4, 2026
-- Purpose: Create comprehensive standard work checklist system with templates,
--          items, submissions, and responses tied to labor management areas
-- =====================================================

-- ===== 1. STANDARD WORK TEMPLATES TABLE =====
-- Define checklist templates linked to working areas
CREATE TABLE IF NOT EXISTS public.standard_work_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Template identification
    template_name VARCHAR(200) NOT NULL,
    template_code VARCHAR(50),
    description TEXT,
    
    -- Area linkage (from labor management)
    working_area_id UUID REFERENCES public.working_areas(id) ON DELETE SET NULL,
    
    -- Template configuration
    frequency VARCHAR(50) DEFAULT 'daily', -- daily, weekly, monthly, shift_start, shift_end, as_needed
    estimated_duration_minutes INTEGER DEFAULT 15,
    
    -- Status and versioning
    status VARCHAR(50) DEFAULT 'draft', -- draft, active, archived, deprecated
    version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    
    -- Display settings
    display_order INTEGER DEFAULT 0,
    icon VARCHAR(50) DEFAULT 'IconChecklist',
    color VARCHAR(20) DEFAULT '#3b82f6',
    
    -- Instructions and notes
    instructions TEXT,
    completion_notes TEXT,
    
    -- Audit
    created_by UUID REFERENCES public.user_profiles(id),
    updated_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(organization_id, template_code)
);

COMMENT ON TABLE public.standard_work_templates IS 'Checklist templates for standard work procedures linked to working areas';

-- ===== 2. STANDARD WORK ITEMS TABLE =====
-- Define individual checklist items within templates
CREATE TABLE IF NOT EXISTS public.standard_work_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES public.standard_work_templates(id) ON DELETE CASCADE,
    
    -- Item identification
    item_title VARCHAR(500) NOT NULL,
    item_description TEXT,
    
    -- Item type configuration
    item_type VARCHAR(50) DEFAULT 'checkbox', -- checkbox, text, number, select, multi_select, date, time, photo, signature
    
    -- Item positioning
    section_name VARCHAR(200), -- Group items into sections
    display_order INTEGER DEFAULT 0,
    
    -- Validation rules
    is_required BOOLEAN DEFAULT false,
    validation_rules JSONB DEFAULT '{}', -- min, max, pattern, options for select, etc.
    
    -- For select/multi_select types
    options JSONB DEFAULT '[]', -- Array of {value, label} objects
    
    -- Conditional display
    conditional_display JSONB DEFAULT NULL, -- {depends_on: item_id, condition: 'equals', value: 'yes'}
    
    -- Help and guidance
    help_text TEXT,
    placeholder TEXT,
    
    -- Default values
    default_value TEXT,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    -- Audit
    created_by UUID REFERENCES public.user_profiles(id),
    updated_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.standard_work_items IS 'Individual checklist items within standard work templates';

-- ===== 3. STANDARD WORK SUBMISSIONS TABLE =====
-- Track completed checklist submissions
CREATE TABLE IF NOT EXISTS public.standard_work_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Submission identification
    submission_number VARCHAR(100) UNIQUE,
    
    -- Template and area reference
    template_id UUID NOT NULL REFERENCES public.standard_work_templates(id) ON DELETE RESTRICT,
    working_area_id UUID REFERENCES public.working_areas(id) ON DELETE SET NULL,
    
    -- Supervisor/submitter tracking
    submitted_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    submitter_name VARCHAR(200), -- Denormalized for historical record
    submitter_position VARCHAR(200), -- Denormalized for historical record
    
    -- Submission status
    status VARCHAR(50) DEFAULT 'draft', -- draft, in_progress, submitted, reviewed, approved, rejected
    
    -- Timing
    started_at TIMESTAMPTZ DEFAULT now(),
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    
    -- Review tracking
    reviewed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    reviewer_notes TEXT,
    
    -- Completion metrics
    total_items INTEGER DEFAULT 0,
    completed_items INTEGER DEFAULT 0,
    required_items INTEGER DEFAULT 0,
    required_completed INTEGER DEFAULT 0,
    completion_percentage NUMERIC(5,2) DEFAULT 0,
    
    -- Shift context
    shift_date DATE DEFAULT CURRENT_DATE,
    shift_type VARCHAR(50), -- morning, afternoon, night, etc.
    
    -- Notes and attachments
    submission_notes TEXT,
    attachments JSONB DEFAULT '[]', -- Array of {filename, url, type}
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.standard_work_submissions IS 'Completed standard work checklist submissions with full tracking';

-- ===== 4. STANDARD WORK RESPONSES TABLE =====
-- Store individual item responses within submissions
CREATE TABLE IF NOT EXISTS public.standard_work_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Submission and item reference
    submission_id UUID NOT NULL REFERENCES public.standard_work_submissions(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES public.standard_work_items(id) ON DELETE RESTRICT,
    
    -- Response data
    response_value TEXT, -- The actual response value
    response_type VARCHAR(50), -- Matches item_type for validation
    
    -- For checkbox items
    is_checked BOOLEAN DEFAULT false,
    
    -- For numeric items
    numeric_value NUMERIC(15,4),
    
    -- For date/time items
    date_value DATE,
    time_value TIME,
    
    -- For photo/signature items
    file_url TEXT,
    file_metadata JSONB DEFAULT '{}',
    
    -- Response metadata
    responded_at TIMESTAMPTZ DEFAULT now(),
    response_duration_seconds INTEGER, -- How long it took to answer
    
    -- Comments and notes
    item_notes TEXT, -- Notes specific to this item response
    
    -- Validation status
    is_valid BOOLEAN DEFAULT true,
    validation_errors JSONB DEFAULT '[]',
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(submission_id, item_id)
);

COMMENT ON TABLE public.standard_work_responses IS 'Individual item responses within standard work submissions';

-- ===== 5. STANDARD WORK AUDIT LOG TABLE =====
-- Track all changes to standard work data
CREATE TABLE IF NOT EXISTS public.standard_work_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- What was changed
    entity_type VARCHAR(50) NOT NULL, -- template, item, submission, response
    entity_id UUID NOT NULL,
    
    -- Change details
    action VARCHAR(50) NOT NULL, -- created, updated, deleted, submitted, reviewed, approved, rejected
    changes JSONB DEFAULT '{}', -- Before/after values
    
    -- Who and when
    performed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    performed_at TIMESTAMPTZ DEFAULT now(),
    
    -- Context
    ip_address VARCHAR(45),
    user_agent TEXT,
    notes TEXT
);

COMMENT ON TABLE public.standard_work_audit_log IS 'Audit trail for all standard work checklist activities';

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Template indexes
CREATE INDEX idx_sw_templates_organization ON public.standard_work_templates(organization_id);
CREATE INDEX idx_sw_templates_area ON public.standard_work_templates(working_area_id) WHERE working_area_id IS NOT NULL;
CREATE INDEX idx_sw_templates_status ON public.standard_work_templates(organization_id, status) WHERE is_active = true;
CREATE INDEX idx_sw_templates_active ON public.standard_work_templates(organization_id, is_active);

-- Item indexes
CREATE INDEX idx_sw_items_template ON public.standard_work_items(template_id);
CREATE INDEX idx_sw_items_organization ON public.standard_work_items(organization_id);
CREATE INDEX idx_sw_items_order ON public.standard_work_items(template_id, display_order);
CREATE INDEX idx_sw_items_section ON public.standard_work_items(template_id, section_name) WHERE section_name IS NOT NULL;

-- Submission indexes
CREATE INDEX idx_sw_submissions_organization ON public.standard_work_submissions(organization_id);
CREATE INDEX idx_sw_submissions_template ON public.standard_work_submissions(template_id);
CREATE INDEX idx_sw_submissions_area ON public.standard_work_submissions(working_area_id) WHERE working_area_id IS NOT NULL;
CREATE INDEX idx_sw_submissions_submitted_by ON public.standard_work_submissions(submitted_by);
CREATE INDEX idx_sw_submissions_status ON public.standard_work_submissions(organization_id, status);
CREATE INDEX idx_sw_submissions_date ON public.standard_work_submissions(organization_id, shift_date DESC);
CREATE INDEX idx_sw_submissions_submitted_at ON public.standard_work_submissions(organization_id, submitted_at DESC) WHERE submitted_at IS NOT NULL;

-- Response indexes
CREATE INDEX idx_sw_responses_submission ON public.standard_work_responses(submission_id);
CREATE INDEX idx_sw_responses_item ON public.standard_work_responses(item_id);
CREATE INDEX idx_sw_responses_organization ON public.standard_work_responses(organization_id);

-- Audit log indexes
CREATE INDEX idx_sw_audit_organization ON public.standard_work_audit_log(organization_id);
CREATE INDEX idx_sw_audit_entity ON public.standard_work_audit_log(entity_type, entity_id);
CREATE INDEX idx_sw_audit_performed_at ON public.standard_work_audit_log(organization_id, performed_at DESC);

-- =====================================================
-- ROW LEVEL SECURITY POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.standard_work_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standard_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standard_work_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standard_work_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standard_work_audit_log ENABLE ROW LEVEL SECURITY;

-- Templates policies
CREATE POLICY "Users can view templates in their organization" ON public.standard_work_templates
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "Managers can manage templates in their organization" ON public.standard_work_templates
    FOR ALL USING (
        organization_id IN (
            SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
        )
    );

-- Items policies
CREATE POLICY "Users can view items in their organization" ON public.standard_work_items
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "Managers can manage items in their organization" ON public.standard_work_items
    FOR ALL USING (
        organization_id IN (
            SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
        )
    );

-- Submissions policies
CREATE POLICY "Users can view submissions in their organization" ON public.standard_work_submissions
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "Users can create submissions in their organization" ON public.standard_work_submissions
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "Users can update their own submissions" ON public.standard_work_submissions
    FOR UPDATE USING (
        submitted_by = auth.uid() OR
        organization_id IN (
            SELECT organization_id FROM public.user_profiles 
            WHERE id = auth.uid() AND role IN ('superadmin', 'admin', 'manager')
        )
    );

-- Responses policies
CREATE POLICY "Users can view responses in their organization" ON public.standard_work_responses
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "Users can manage responses for their submissions" ON public.standard_work_responses
    FOR ALL USING (
        organization_id IN (
            SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
        )
    );

-- Audit log policies
CREATE POLICY "Users can view audit logs in their organization" ON public.standard_work_audit_log
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "System can insert audit logs" ON public.standard_work_audit_log
    FOR INSERT WITH CHECK (true);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to generate submission number
CREATE OR REPLACE FUNCTION generate_submission_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.submission_number IS NULL THEN
        NEW.submission_number := 'SW-' || TO_CHAR(NOW() AT TIME ZONE 'America/New_York', 'YYYYMMDD') || '-' || 
            LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for submission number generation
DROP TRIGGER IF EXISTS trigger_generate_submission_number ON public.standard_work_submissions;
CREATE TRIGGER trigger_generate_submission_number
    BEFORE INSERT ON public.standard_work_submissions
    FOR EACH ROW
    EXECUTE FUNCTION generate_submission_number();

-- Function to update completion metrics
CREATE OR REPLACE FUNCTION update_submission_completion_metrics()
RETURNS TRIGGER AS $$
DECLARE
    v_total INTEGER;
    v_completed INTEGER;
    v_required INTEGER;
    v_required_completed INTEGER;
BEGIN
    -- Count totals from items
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE is_required = true)
    INTO v_total, v_required
    FROM public.standard_work_items
    WHERE template_id = (SELECT template_id FROM public.standard_work_submissions WHERE id = COALESCE(NEW.submission_id, OLD.submission_id))
    AND is_active = true;
    
    -- Count completed responses
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE i.is_required = true)
    INTO v_completed, v_required_completed
    FROM public.standard_work_responses r
    JOIN public.standard_work_items i ON r.item_id = i.id
    WHERE r.submission_id = COALESCE(NEW.submission_id, OLD.submission_id)
    AND (r.is_checked = true OR r.response_value IS NOT NULL OR r.numeric_value IS NOT NULL);
    
    -- Update submission
    UPDATE public.standard_work_submissions
    SET 
        total_items = v_total,
        completed_items = COALESCE(v_completed, 0),
        required_items = v_required,
        required_completed = COALESCE(v_required_completed, 0),
        completion_percentage = CASE WHEN v_total > 0 THEN ROUND((COALESCE(v_completed, 0)::NUMERIC / v_total) * 100, 2) ELSE 0 END,
        updated_at = now()
    WHERE id = COALESCE(NEW.submission_id, OLD.submission_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger for completion metrics
DROP TRIGGER IF EXISTS trigger_update_completion_metrics ON public.standard_work_responses;
CREATE TRIGGER trigger_update_completion_metrics
    AFTER INSERT OR UPDATE OR DELETE ON public.standard_work_responses
    FOR EACH ROW
    EXECUTE FUNCTION update_submission_completion_metrics();

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_standard_work_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for timestamp updates
DROP TRIGGER IF EXISTS trigger_sw_templates_updated ON public.standard_work_templates;
CREATE TRIGGER trigger_sw_templates_updated
    BEFORE UPDATE ON public.standard_work_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_standard_work_timestamp();

DROP TRIGGER IF EXISTS trigger_sw_items_updated ON public.standard_work_items;
CREATE TRIGGER trigger_sw_items_updated
    BEFORE UPDATE ON public.standard_work_items
    FOR EACH ROW
    EXECUTE FUNCTION update_standard_work_timestamp();

DROP TRIGGER IF EXISTS trigger_sw_submissions_updated ON public.standard_work_submissions;
CREATE TRIGGER trigger_sw_submissions_updated
    BEFORE UPDATE ON public.standard_work_submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_standard_work_timestamp();

DROP TRIGGER IF EXISTS trigger_sw_responses_updated ON public.standard_work_responses;
CREATE TRIGGER trigger_sw_responses_updated
    BEFORE UPDATE ON public.standard_work_responses
    FOR EACH ROW
    EXECUTE FUNCTION update_standard_work_timestamp();

-- =====================================================
-- RPC FUNCTIONS FOR STATISTICS AND ANALYTICS
-- =====================================================

-- Function to get standard work statistics
CREATE OR REPLACE FUNCTION get_standard_work_statistics(
    p_organization_id UUID,
    p_start_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
    p_end_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSON AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_build_object(
        'total_templates', (SELECT COUNT(*) FROM public.standard_work_templates WHERE organization_id = p_organization_id AND is_active = true),
        'active_templates', (SELECT COUNT(*) FROM public.standard_work_templates WHERE organization_id = p_organization_id AND status = 'active'),
        'total_submissions', (SELECT COUNT(*) FROM public.standard_work_submissions WHERE organization_id = p_organization_id AND shift_date BETWEEN p_start_date AND p_end_date),
        'submitted_count', (SELECT COUNT(*) FROM public.standard_work_submissions WHERE organization_id = p_organization_id AND status = 'submitted' AND shift_date BETWEEN p_start_date AND p_end_date),
        'draft_count', (SELECT COUNT(*) FROM public.standard_work_submissions WHERE organization_id = p_organization_id AND status = 'draft' AND shift_date BETWEEN p_start_date AND p_end_date),
        'avg_completion_rate', (SELECT COALESCE(ROUND(AVG(completion_percentage), 2), 0) FROM public.standard_work_submissions WHERE organization_id = p_organization_id AND shift_date BETWEEN p_start_date AND p_end_date),
        'submissions_by_area', (
            SELECT COALESCE(json_agg(json_build_object(
                'area_id', wa.id,
                'area_name', wa.area_name,
                'submission_count', COUNT(sws.id)
            )), '[]'::json)
            FROM public.working_areas wa
            LEFT JOIN public.standard_work_submissions sws ON wa.id = sws.working_area_id 
                AND sws.shift_date BETWEEN p_start_date AND p_end_date
            WHERE wa.organization_id = p_organization_id AND wa.is_active = true
            GROUP BY wa.id, wa.area_name
        ),
        'submissions_by_date', (
            SELECT COALESCE(json_agg(json_build_object(
                'date', shift_date,
                'count', COUNT(*)
            ) ORDER BY shift_date), '[]'::json)
            FROM public.standard_work_submissions
            WHERE organization_id = p_organization_id AND shift_date BETWEEN p_start_date AND p_end_date
            GROUP BY shift_date
        )
    ) INTO v_result;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get submission details with all responses
CREATE OR REPLACE FUNCTION get_submission_with_responses(p_submission_id UUID)
RETURNS JSON AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_build_object(
        'submission', row_to_json(sws.*),
        'template', row_to_json(swt.*),
        'area', row_to_json(wa.*),
        'submitter', json_build_object(
            'id', up.id,
            'full_name', up.full_name,
            'email', up.email
        ),
        'responses', (
            SELECT COALESCE(json_agg(json_build_object(
                'response', row_to_json(r.*),
                'item', row_to_json(i.*)
            ) ORDER BY i.display_order), '[]'::json)
            FROM public.standard_work_responses r
            JOIN public.standard_work_items i ON r.item_id = i.id
            WHERE r.submission_id = p_submission_id
        )
    ) INTO v_result
    FROM public.standard_work_submissions sws
    JOIN public.standard_work_templates swt ON sws.template_id = swt.id
    LEFT JOIN public.working_areas wa ON sws.working_area_id = wa.id
    LEFT JOIN public.user_profiles up ON sws.submitted_by = up.id
    WHERE sws.id = p_submission_id;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_standard_work_statistics(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_submission_with_responses(UUID) TO authenticated;
