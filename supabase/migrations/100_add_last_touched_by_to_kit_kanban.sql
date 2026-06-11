-- Migration: Add last_touched_by_name to kit_kanban_tasks
-- Date: 2026-01-10
-- Description: Adds tracking for the last person who worked on a kit task

-- Add last_touched_by_name column to kit_kanban_tasks table
ALTER TABLE kit_kanban_tasks
ADD COLUMN IF NOT EXISTS last_touched_by_name VARCHAR(255);

-- Add last_touched_by_id column for reference
ALTER TABLE kit_kanban_tasks
ADD COLUMN IF NOT EXISTS last_touched_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add last_touched_at timestamp
ALTER TABLE kit_kanban_tasks
ADD COLUMN IF NOT EXISTS last_touched_at TIMESTAMPTZ;

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_kit_kanban_tasks_last_touched_by 
ON kit_kanban_tasks(last_touched_by_id);

-- Create a function to update last_touched_by when task is modified
CREATE OR REPLACE FUNCTION update_kit_kanban_last_touched()
RETURNS TRIGGER AS $$
DECLARE
  user_name VARCHAR(255);
BEGIN
  -- Get the current user's name
  SELECT COALESCE(full_name, first_name || ' ' || last_name, email)
  INTO user_name
  FROM user_profiles
  WHERE id = auth.uid();

  -- Update last touched fields
  NEW.last_touched_by_id = auth.uid();
  NEW.last_touched_by_name = user_name;
  NEW.last_touched_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically update last_touched fields
DROP TRIGGER IF EXISTS kit_kanban_tasks_update_last_touched ON kit_kanban_tasks;
CREATE TRIGGER kit_kanban_tasks_update_last_touched
  BEFORE UPDATE ON kit_kanban_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_kit_kanban_last_touched();

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 100: Added last_touched_by tracking to kit_kanban_tasks';
END $$;
