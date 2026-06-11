-- Migration: Add 'extend' and 'session_warning' to session_activities event_type constraint
-- Date: 2026-02-05

-- Drop the existing constraint on event_type
ALTER TABLE session_activities DROP CONSTRAINT IF EXISTS session_activities_event_type_check;

-- Re-create with expanded event types including 'extend' and 'session_warning'
ALTER TABLE session_activities ADD CONSTRAINT session_activities_event_type_check
  CHECK (event_type IN (
    'login',
    'logout',
    'timeout',
    'forced_logout',
    'refresh',
    'extend',
    'session_warning',
    'update_timeout_config',
    'create_timeout_config',
    'delete_timeout_config',
    'resolve_security_alert',
    'export_session_data'
  ));
