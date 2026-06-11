-- =====================================================
-- Position Type and Level Options Configuration
-- Migration: 053_position_type_level_options.sql
-- Created: October 25, 2025
-- Purpose: Allow dynamic management of position types and levels per organization
-- =====================================================

-- ===== 1. POSITION TYPE OPTIONS TABLE =====
CREATE TABLE IF NOT EXISTS public.position_type_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Type configuration
    type_value VARCHAR(100) NOT NULL, -- Unique type identifier (e.g., 'leadership', 'operational')
    type_label VARCHAR(200) NOT NULL, -- Display name (e.g., 'Leadership', 'Operational')
    description TEXT,
    
    -- Display and behavior
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    color_code VARCHAR(7), -- Hex color for UI display (e.g., '#3b82f6')
    icon_name VARCHAR(50), -- Optional icon identifier
    
    -- Audit
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(organization_id, type_value)
);

COMMENT ON TABLE public.position_type_options IS 'Configurable position types that can be customized per organization';

-- ===== 2. POSITION LEVEL OPTIONS TABLE =====
CREATE TABLE IF NOT EXISTS public.position_level_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Level configuration
    level_value INTEGER NOT NULL CHECK (level_value BETWEEN 1 AND 20), -- Numeric level (e.g., 1, 2, 3...)
    level_label VARCHAR(200) NOT NULL, -- Display name (e.g., 'L1 - Entry', 'L2 - Intermediate')
    description TEXT,
    
    -- Display and behavior
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    color_code VARCHAR(7), -- Hex color for UI display
    
    -- Audit
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(organization_id, level_value)
);

COMMENT ON TABLE public.position_level_options IS 'Configurable position levels that can be customized per organization';

-- ===== 3. INDEXES FOR PERFORMANCE =====
CREATE INDEX IF NOT EXISTS idx_position_type_options_org ON public.position_type_options(organization_id);
CREATE INDEX IF NOT EXISTS idx_position_type_options_active ON public.position_type_options(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_position_type_options_order ON public.position_type_options(organization_id, display_order);

CREATE INDEX IF NOT EXISTS idx_position_level_options_org ON public.position_level_options(organization_id);
CREATE INDEX IF NOT EXISTS idx_position_level_options_active ON public.position_level_options(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_position_level_options_order ON public.position_level_options(organization_id, display_order);

-- ===== 4. ROW LEVEL SECURITY POLICIES =====
ALTER TABLE public.position_type_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.position_level_options ENABLE ROW LEVEL SECURITY;

-- Position Type Options Policies
CREATE POLICY "Users can view their organization's position type options"
    ON public.position_type_options FOR SELECT
    USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can insert position type options"
    ON public.position_type_options FOR INSERT
    WITH CHECK (
        organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
        AND (
            (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('superadmin', 'admin', 'manager')
            OR has_permission('manage', 'shift_productivity')
        )
    );

CREATE POLICY "Admins can update position type options"
    ON public.position_type_options FOR UPDATE
    USING (
        organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
        AND (
            (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('superadmin', 'admin', 'manager')
            OR has_permission('manage', 'shift_productivity')
        )
    );

CREATE POLICY "Admins can delete position type options"
    ON public.position_type_options FOR DELETE
    USING (
        organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
        AND (
            (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('superadmin', 'admin', 'manager')
            OR has_permission('manage', 'shift_productivity')
        )
    );

-- Position Level Options Policies
CREATE POLICY "Users can view their organization's position level options"
    ON public.position_level_options FOR SELECT
    USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can insert position level options"
    ON public.position_level_options FOR INSERT
    WITH CHECK (
        organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
        AND (
            (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('superadmin', 'admin', 'manager')
            OR has_permission('manage', 'shift_productivity')
        )
    );

CREATE POLICY "Admins can update position level options"
    ON public.position_level_options FOR UPDATE
    USING (
        organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
        AND (
            (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('superadmin', 'admin', 'manager')
            OR has_permission('manage', 'shift_productivity')
        )
    );

CREATE POLICY "Admins can delete position level options"
    ON public.position_level_options FOR DELETE
    USING (
        organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
        AND (
            (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('superadmin', 'admin', 'manager')
            OR has_permission('manage', 'shift_productivity')
        )
    );

-- ===== 5. DEFAULT DATA SEEDING FUNCTION =====
-- Function to seed default position types and levels for a new organization
CREATE OR REPLACE FUNCTION seed_position_options(p_organization_id UUID)
RETURNS void AS $$
BEGIN
    -- Seed default position types if none exist
    IF NOT EXISTS (
        SELECT 1 FROM public.position_type_options 
        WHERE organization_id = p_organization_id
    ) THEN
        INSERT INTO public.position_type_options (organization_id, type_value, type_label, description, display_order, color_code)
        VALUES 
            (p_organization_id, 'leadership', 'Leadership', 'Strategic leadership and executive positions', 1, '#3b82f6'),
            (p_organization_id, 'operational', 'Operational', 'Front-line operational and warehouse positions', 2, '#10b981'),
            (p_organization_id, 'administrative', 'Administrative', 'Administrative and support positions', 3, '#8b5cf6'),
            (p_organization_id, 'quality', 'Quality', 'Quality control and assurance positions', 4, '#f59e0b'),
            (p_organization_id, 'specialist', 'Specialist', 'Technical specialists and subject matter experts', 5, '#ec4899'),
            (p_organization_id, 'support', 'Support', 'Support and service positions', 6, '#6b7280');
    END IF;

    -- Seed default position levels if none exist
    IF NOT EXISTS (
        SELECT 1 FROM public.position_level_options 
        WHERE organization_id = p_organization_id
    ) THEN
        INSERT INTO public.position_level_options (organization_id, level_value, level_label, description, display_order, color_code)
        VALUES 
            (p_organization_id, 1, 'L1 - Entry', 'Entry level positions with minimal experience', 1, '#94a3b8'),
            (p_organization_id, 2, 'L2 - Intermediate', 'Intermediate positions with some experience', 2, '#64748b'),
            (p_organization_id, 3, 'L3 - Senior', 'Senior positions with significant experience', 3, '#475569'),
            (p_organization_id, 4, 'L4 - Lead', 'Lead positions with team coordination duties', 4, '#334155'),
            (p_organization_id, 5, 'L5 - Manager', 'Management positions with supervisory responsibilities', 5, '#1e293b'),
            (p_organization_id, 6, 'L6 - Director', 'Director level positions with strategic oversight', 6, '#0f172a');
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION seed_position_options IS 'Seeds default position types and levels for a new organization';

-- ===== 6. AUTO-TRIGGER FOR UPDATED_AT =====
CREATE OR REPLACE TRIGGER update_position_type_options_updated_at
    BEFORE UPDATE ON public.position_type_options
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_position_level_options_updated_at
    BEFORE UPDATE ON public.position_level_options
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ===== 7. SEED DEFAULT OPTIONS FOR EXISTING ORGANIZATIONS =====
-- Seed default options for all existing organizations
DO $$
DECLARE
    org_record RECORD;
BEGIN
    FOR org_record IN SELECT id FROM public.organizations LOOP
        PERFORM seed_position_options(org_record.id);
    END LOOP;
END $$;

