-- Migration: Update session timeout configurations
-- Description: Relax idle timeout settings to reduce unexpected logouts
-- Date: 2026-01-30

-- Update auto_logout_timeout_minutes for all roles
UPDATE session_timeout_configs 
SET auto_logout_timeout_minutes = CASE role
    WHEN 'viewer' THEN 30
    WHEN 'cashier' THEN 30
    WHEN 'manager' THEN 45
    WHEN 'tka_associate' THEN 45
    WHEN 'admin' THEN 60
    WHEN 'superadmin' THEN 60
    ELSE auto_logout_timeout_minutes
END,
updated_at = NOW()
WHERE role IN ('viewer', 'cashier', 'manager', 'tka_associate', 'admin', 'superadmin');

-- Add comment for audit trail
COMMENT ON TABLE session_timeout_configs IS 'Configurable timeout settings per role - Updated 2026-01-30 to relax idle timeouts';
