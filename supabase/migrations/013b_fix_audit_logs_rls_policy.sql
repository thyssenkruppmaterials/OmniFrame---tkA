-- Fix RLS policy for audit_logs table to allow INSERT operations
-- Migration: 013_fix_audit_logs_rls_policy.sql
-- Issue: audit_logs table had RLS enabled but no INSERT policy, causing audit triggers to fail

-- Create INSERT policy for audit_logs table
-- This allows authenticated users to insert audit logs for their own organization
CREATE POLICY IF NOT EXISTS "Allow insert audit logs for same organization" ON audit_logs 
FOR INSERT 
TO public 
WITH CHECK (organization_id = get_user_organization_id());

-- Verify the policy was created
-- This policy allows the audit trigger functions to successfully insert audit records
-- while maintaining organization-based data isolation

COMMENT ON POLICY "Allow insert audit logs for same organization" ON audit_logs IS 
  'Allows authenticated users to insert audit logs for their own organization. Required for audit trigger functions to work properly.';
