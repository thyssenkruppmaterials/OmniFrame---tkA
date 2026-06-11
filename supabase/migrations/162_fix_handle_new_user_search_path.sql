-- Migration: Fix handle_new_user function search_path
-- Date: January 31, 2026
-- Issue: Sign-up was failing with "relation 'roles' does not exist" error
-- Root Cause: The handle_new_user() function had SECURITY DEFINER but no explicit
--             search_path, causing foreign key constraints to fail finding the roles table
-- Fix: Add SET search_path = public to the function definition

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    org_id UUID;
    org_default_role_id UUID;
BEGIN
    -- Get the default organization (j.AI OneBox)
    SELECT id INTO org_id
    FROM public.organizations
    WHERE name = 'j.AI OneBox'
    LIMIT 1;
    
    -- Get default role ID from organization
    SELECT default_role_id INTO org_default_role_id
    FROM public.organizations
    WHERE id = org_id;
    
    -- Fallback to viewer role if no default set
    IF org_default_role_id IS NULL THEN
        SELECT id INTO org_default_role_id
        FROM public.roles
        WHERE name = 'viewer'
        LIMIT 1;
    END IF;
    
    -- Create user profile with explicit schema references
    INSERT INTO public.user_profiles (
        id,
        email,
        first_name,
        last_name,
        role,
        role_id,
        organization_id,
        status,
        created_at,
        updated_at
    ) VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
        'viewer'::public.user_role,
        org_default_role_id,
        org_id,
        'active'::public.user_status,
        NOW(),
        NOW()
    );
    
    RETURN NEW;
END;
$$;

-- Add comment documenting the fix
COMMENT ON FUNCTION public.handle_new_user() IS 
'Creates a user_profiles record when a new user signs up via Supabase Auth.
Fixed Jan 31, 2026: Added SET search_path = public to fix sign-up failures.';
