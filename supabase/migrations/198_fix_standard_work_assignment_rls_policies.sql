-- =====================================================
-- Fix Standard Work Template Assignments RLS Policies
-- Migration: 198_fix_standard_work_assignment_rls_policies.sql
-- Created: March 10, 2026
-- Purpose: Expand INSERT/UPDATE/DELETE RLS policies to include
--          supervisors, leaders, and branch coordinators so they
--          can assign standard work checklists to team members.
--          Previously only superadmin, admin, manager had write access.
-- =====================================================

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "swta_insert_admin" ON public.standard_work_template_assignments;
DROP POLICY IF EXISTS "swta_update_admin" ON public.standard_work_template_assignments;
DROP POLICY IF EXISTS "swta_delete_admin" ON public.standard_work_template_assignments;

-- Recreate INSERT policy with expanded roles
CREATE POLICY "swta_insert_admin" ON public.standard_work_template_assignments
    FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT up.organization_id
            FROM user_profiles up
            JOIN roles r ON up.role_id = r.id
            WHERE up.id = auth.uid()
            AND r.name IN (
                'superadmin', 'admin', 'manager',
                'tka_supervisors', 'tka_leaders', 'tka_branchcoordinator'
            )
        )
    );

-- Recreate UPDATE policy with expanded roles
CREATE POLICY "swta_update_admin" ON public.standard_work_template_assignments
    FOR UPDATE
    USING (
        organization_id IN (
            SELECT up.organization_id
            FROM user_profiles up
            JOIN roles r ON up.role_id = r.id
            WHERE up.id = auth.uid()
            AND r.name IN (
                'superadmin', 'admin', 'manager',
                'tka_supervisors', 'tka_leaders', 'tka_branchcoordinator'
            )
        )
    );

-- Recreate DELETE policy with expanded roles
CREATE POLICY "swta_delete_admin" ON public.standard_work_template_assignments
    FOR DELETE
    USING (
        organization_id IN (
            SELECT up.organization_id
            FROM user_profiles up
            JOIN roles r ON up.role_id = r.id
            WHERE up.id = auth.uid()
            AND r.name IN (
                'superadmin', 'admin', 'manager',
                'tka_supervisors', 'tka_leaders', 'tka_branchcoordinator'
            )
        )
    );
