-- Migration: 089_extend_user_status_options.sql
-- Description: Extend user_profiles status options to support full HR workflow
-- Date: January 4, 2026
-- Author: OneBox AI Development Team

-- =====================================================
-- STEP 1: Add new columns for status tracking
-- =====================================================

-- Add termination tracking columns
ALTER TABLE public.user_profiles 
ADD COLUMN IF NOT EXISTS termination_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS termination_reason TEXT,
ADD COLUMN IF NOT EXISTS status_change_reason TEXT,
ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS status_changed_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS leave_start_date DATE,
ADD COLUMN IF NOT EXISTS leave_return_date DATE;

-- =====================================================
-- STEP 2: Create status history table for audit trail
-- =====================================================

CREATE TABLE IF NOT EXISTS public.user_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    previous_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    reason TEXT,
    effective_date TIMESTAMPTZ DEFAULT NOW(),
    changed_by UUID REFERENCES auth.users(id),
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_user_status_history_user_id ON public.user_status_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_status_history_new_status ON public.user_status_history(new_status);
CREATE INDEX IF NOT EXISTS idx_user_status_history_created_at ON public.user_status_history(created_at DESC);

-- =====================================================
-- STEP 3: Enable RLS on status history table
-- =====================================================

ALTER TABLE public.user_status_history ENABLE ROW LEVEL SECURITY;

-- Policy: Admins and superadmins can view all status history
CREATE POLICY "Admins can view all status history" ON public.user_status_history
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles up
            JOIN public.roles r ON up.role_id = r.id
            WHERE up.id = auth.uid()
            AND r.name IN ('superadmin', 'admin', 'manager')
        )
    );

-- Policy: Admins and superadmins can insert status history
CREATE POLICY "Admins can insert status history" ON public.user_status_history
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.user_profiles up
            JOIN public.roles r ON up.role_id = r.id
            WHERE up.id = auth.uid()
            AND r.name IN ('superadmin', 'admin', 'manager')
        )
    );

-- =====================================================
-- STEP 4: Create function to update user status with tracking
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_user_status_with_tracking(
    p_user_id UUID,
    p_new_status VARCHAR(50),
    p_reason TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_effective_date TIMESTAMPTZ DEFAULT NOW(),
    p_leave_return_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_previous_status VARCHAR(50);
    v_changed_by UUID;
    v_result JSONB;
BEGIN
    -- Get current user
    v_changed_by := auth.uid();
    
    -- Get previous status
    SELECT status INTO v_previous_status
    FROM public.user_profiles
    WHERE id = p_user_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'User not found'
        );
    END IF;
    
    -- Validate status transition
    -- Terminated users cannot be reactivated
    IF v_previous_status = 'terminated' AND p_new_status != 'terminated' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Cannot change status of terminated users. Please create a new user account.'
        );
    END IF;
    
    -- Update user profile
    UPDATE public.user_profiles
    SET 
        status = p_new_status,
        status_change_reason = p_reason,
        status_changed_at = p_effective_date,
        status_changed_by = v_changed_by,
        leave_start_date = CASE WHEN p_new_status = 'on_leave' THEN p_effective_date::DATE ELSE NULL END,
        leave_return_date = CASE WHEN p_new_status = 'on_leave' THEN p_leave_return_date ELSE NULL END,
        termination_date = CASE WHEN p_new_status = 'terminated' THEN p_effective_date ELSE termination_date END,
        termination_reason = CASE WHEN p_new_status = 'terminated' THEN p_reason ELSE termination_reason END,
        updated_at = NOW()
    WHERE id = p_user_id;
    
    -- Insert status history record
    INSERT INTO public.user_status_history (
        user_id,
        previous_status,
        new_status,
        reason,
        effective_date,
        changed_by,
        notes,
        metadata
    ) VALUES (
        p_user_id,
        v_previous_status,
        p_new_status,
        p_reason,
        p_effective_date,
        v_changed_by,
        p_notes,
        jsonb_build_object(
            'leave_return_date', p_leave_return_date,
            'ip_address', current_setting('request.headers', true)::json->>'x-forwarded-for'
        )
    );
    
    -- Return success
    RETURN jsonb_build_object(
        'success', true,
        'user_id', p_user_id,
        'previous_status', v_previous_status,
        'new_status', p_new_status,
        'changed_at', p_effective_date
    );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.update_user_status_with_tracking TO authenticated;

-- =====================================================
-- STEP 5: Create function to get user status statistics
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_user_status_statistics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_stats JSONB;
BEGIN
    SELECT jsonb_build_object(
        'total', COUNT(*),
        'active', COUNT(*) FILTER (WHERE status = 'active'),
        'inactive', COUNT(*) FILTER (WHERE status = 'inactive'),
        'invited', COUNT(*) FILTER (WHERE status = 'invited'),
        'suspended', COUNT(*) FILTER (WHERE status = 'suspended'),
        'terminated', COUNT(*) FILTER (WHERE status = 'terminated'),
        'on_leave', COUNT(*) FILTER (WHERE status = 'on_leave'),
        'admins', COUNT(*) FILTER (WHERE role IN ('admin', 'superadmin')),
        'new_this_month', COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE))
    ) INTO v_stats
    FROM public.user_profiles
    WHERE deleted_at IS NULL;
    
    RETURN v_stats;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_user_status_statistics TO authenticated;

-- =====================================================
-- STEP 6: Add comments for documentation
-- =====================================================

COMMENT ON COLUMN public.user_profiles.termination_date IS 'Date when the user was terminated';
COMMENT ON COLUMN public.user_profiles.termination_reason IS 'Reason for termination';
COMMENT ON COLUMN public.user_profiles.status_change_reason IS 'Reason for the most recent status change';
COMMENT ON COLUMN public.user_profiles.status_changed_at IS 'Timestamp of the most recent status change';
COMMENT ON COLUMN public.user_profiles.status_changed_by IS 'User ID of who made the most recent status change';
COMMENT ON COLUMN public.user_profiles.leave_start_date IS 'Start date of leave period';
COMMENT ON COLUMN public.user_profiles.leave_return_date IS 'Expected return date from leave';

COMMENT ON TABLE public.user_status_history IS 'Audit trail for all user status changes';
COMMENT ON FUNCTION public.update_user_status_with_tracking IS 'Update user status with full audit trail and validation';
COMMENT ON FUNCTION public.get_user_status_statistics IS 'Get aggregated user status statistics';

-- Migration complete
-- Status options now include: active, inactive, invited, suspended, terminated, on_leave
