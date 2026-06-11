-- Push Mode and Worker Heartbeats System
-- Migration: 090_add_push_mode_and_heartbeats.sql
-- Description: Adds push mode support to cycle counts and creates worker heartbeat tracking for real-time workforce management
-- Date: 2026-02-01

-- =====================================================
-- SECTION 1: ALTER rr_cyclecount_data for Push Mode
-- =====================================================

-- Add push mode columns to cycle count data
ALTER TABLE public.rr_cyclecount_data 
ADD COLUMN IF NOT EXISTS push_mode VARCHAR(10) DEFAULT 'pull',
ADD COLUMN IF NOT EXISTS pushed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS push_acknowledged BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS push_acknowledged_at TIMESTAMPTZ;

-- Add constraint to validate push_mode values
ALTER TABLE public.rr_cyclecount_data 
ADD CONSTRAINT rr_cyclecount_data_push_mode_check 
CHECK (push_mode IN ('pull', 'push'));

-- Add foreign key constraint for pushed_by
ALTER TABLE public.rr_cyclecount_data 
ADD CONSTRAINT rr_cyclecount_data_pushed_by_fkey 
FOREIGN KEY (pushed_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- Add comments for new columns
COMMENT ON COLUMN rr_cyclecount_data.push_mode IS 'Work assignment mode: pull (user selects) or push (supervisor assigns)';
COMMENT ON COLUMN rr_cyclecount_data.pushed_by IS 'User ID of supervisor/manager who pushed this count to a worker';
COMMENT ON COLUMN rr_cyclecount_data.pushed_at IS 'Timestamp when the count was pushed to the worker';
COMMENT ON COLUMN rr_cyclecount_data.push_acknowledged IS 'Whether the worker acknowledged receiving the pushed count';
COMMENT ON COLUMN rr_cyclecount_data.push_acknowledged_at IS 'Timestamp when the worker acknowledged the pushed count';

-- =====================================================
-- SECTION 2: CREATE worker_heartbeats Table
-- =====================================================

-- Create worker heartbeats table for real-time worker tracking
CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
  user_id UUID PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_task_id UUID,
  current_task_type VARCHAR(50),
  current_zone VARCHAR(50),
  current_location VARCHAR(100),
  device_info JSONB,
  status VARCHAR(20) DEFAULT 'online',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Constraints
  CONSTRAINT worker_heartbeats_status_check 
    CHECK (status IN ('online', 'offline', 'busy', 'break', 'idle'))
);

-- Add comments for worker_heartbeats table
COMMENT ON TABLE worker_heartbeats IS 'Real-time worker presence and activity tracking for workforce management';
COMMENT ON COLUMN worker_heartbeats.user_id IS 'Primary key - one heartbeat record per worker';
COMMENT ON COLUMN worker_heartbeats.organization_id IS 'Organization the worker belongs to for multi-tenant isolation';
COMMENT ON COLUMN worker_heartbeats.last_heartbeat IS 'Timestamp of most recent heartbeat from worker device';
COMMENT ON COLUMN worker_heartbeats.current_task_id IS 'ID of the task currently being worked on (if any)';
COMMENT ON COLUMN worker_heartbeats.current_task_type IS 'Type of current task: cycle_count, putaway, pick, etc.';
COMMENT ON COLUMN worker_heartbeats.current_zone IS 'Current warehouse zone the worker is in';
COMMENT ON COLUMN worker_heartbeats.current_location IS 'Current specific location within the warehouse';
COMMENT ON COLUMN worker_heartbeats.device_info IS 'JSON object with device details: type, model, app_version, etc.';
COMMENT ON COLUMN worker_heartbeats.status IS 'Worker availability status: online, offline, busy, break, idle';

-- =====================================================
-- SECTION 3: CREATE Indexes
-- =====================================================

-- Index for finding active workers in an organization
CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_org_status 
ON public.worker_heartbeats(organization_id, status);

-- Index for finding workers by last heartbeat (for stale detection)
CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_last_heartbeat 
ON public.worker_heartbeats(last_heartbeat DESC);

-- Index for finding workers by zone
CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_zone 
ON public.worker_heartbeats(organization_id, current_zone) 
WHERE current_zone IS NOT NULL;

-- Partial index for push mode cycle counts (optimize push-related queries)
CREATE INDEX IF NOT EXISTS idx_cyclecount_push_mode 
ON public.rr_cyclecount_data(organization_id, assigned_to, push_mode) 
WHERE push_mode = 'push';

-- Index for unacknowledged pushed counts
CREATE INDEX IF NOT EXISTS idx_cyclecount_push_unacknowledged 
ON public.rr_cyclecount_data(organization_id, assigned_to, pushed_at) 
WHERE push_mode = 'push' AND push_acknowledged = FALSE;

-- Index for pushed_by queries
CREATE INDEX IF NOT EXISTS idx_cyclecount_pushed_by 
ON public.rr_cyclecount_data(pushed_by, pushed_at DESC) 
WHERE pushed_by IS NOT NULL;

-- =====================================================
-- SECTION 4: Enable RLS on worker_heartbeats
-- =====================================================

-- Enable Row Level Security
ALTER TABLE worker_heartbeats ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view workers in their organization
CREATE POLICY "Users can view workers in their organization" ON worker_heartbeats
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Policy: Users can insert their own heartbeat
CREATE POLICY "Users can insert their own heartbeat" ON worker_heartbeats
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id IN (
      SELECT organization_id 
      FROM user_profiles 
      WHERE id = auth.uid()
    )
  );

-- Policy: Users can update their own heartbeat
CREATE POLICY "Users can update their own heartbeat" ON worker_heartbeats
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Policy: Users can delete their own heartbeat (for cleanup)
CREATE POLICY "Users can delete their own heartbeat" ON worker_heartbeats
  FOR DELETE
  USING (user_id = auth.uid());

-- =====================================================
-- SECTION 5: RPC Functions
-- =====================================================

-- Function: Get pushed counts for a user
CREATE OR REPLACE FUNCTION get_user_pushed_counts(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  user_org_id UUID;
  current_user_id UUID;
  current_user_org_id UUID;
BEGIN
  -- Get current user
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not authenticated'
    );
  END IF;
  
  -- Get current user's organization
  SELECT organization_id INTO current_user_org_id
  FROM user_profiles
  WHERE id = current_user_id;
  
  -- Get target user's organization
  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = p_user_id;
  
  IF user_org_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Target user not found'
    );
  END IF;
  
  -- Verify same organization
  IF user_org_id != current_user_org_id THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot view counts from different organization'
    );
  END IF;
  
  -- Get pushed counts for the user
  SELECT json_build_object(
    'success', true,
    'counts', COALESCE((
      SELECT json_agg(
        json_build_object(
          'id', cc.id,
          'count_number', cc.count_number,
          'material_number', cc.material_number,
          'material_description', cc.material_description,
          'location', cc.location,
          'warehouse', cc.warehouse,
          'system_quantity', cc.system_quantity,
          'priority', cc.priority,
          'count_type', cc.count_type,
          'pushed_at', cc.pushed_at,
          'pushed_by', cc.pushed_by,
          'pushed_by_name', (SELECT full_name FROM user_profiles WHERE id = cc.pushed_by),
          'push_acknowledged', cc.push_acknowledged,
          'push_acknowledged_at', cc.push_acknowledged_at,
          'status', cc.status
        )
        ORDER BY cc.pushed_at DESC
      )
      FROM rr_cyclecount_data cc
      WHERE cc.assigned_to = p_user_id
        AND cc.push_mode = 'push'
        AND cc.status IN ('pending', 'in_progress')
    ), '[]'::json),
    'total_pushed', (
      SELECT COUNT(*)
      FROM rr_cyclecount_data
      WHERE assigned_to = p_user_id
        AND push_mode = 'push'
        AND status IN ('pending', 'in_progress')
    ),
    'unacknowledged', (
      SELECT COUNT(*)
      FROM rr_cyclecount_data
      WHERE assigned_to = p_user_id
        AND push_mode = 'push'
        AND push_acknowledged = FALSE
        AND status IN ('pending', 'in_progress')
    )
  ) INTO result;
  
  RETURN result;
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- Function: Push cycle count to user
CREATE OR REPLACE FUNCTION push_cycle_count_to_user(
  p_count_id UUID,
  p_user_id UUID,
  p_pushed_by UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  count_record RECORD;
  target_user_record RECORD;
  pusher_record RECORD;
  current_user_id UUID;
BEGIN
  -- Get current user
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not authenticated'
    );
  END IF;
  
  -- Get the cycle count
  SELECT * INTO count_record
  FROM rr_cyclecount_data
  WHERE id = p_count_id
  FOR UPDATE SKIP LOCKED;
  
  IF count_record IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cycle count not found or locked by another process'
    );
  END IF;
  
  -- Verify count is in a pushable state
  IF count_record.status NOT IN ('pending') THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot push count with status: ' || count_record.status
    );
  END IF;
  
  -- Verify count is not already assigned to someone else
  IF count_record.assigned_to IS NOT NULL AND count_record.assigned_to != p_user_id THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Count is already assigned to another user'
    );
  END IF;
  
  -- Get target user details
  SELECT * INTO target_user_record
  FROM user_profiles
  WHERE id = p_user_id;
  
  IF target_user_record IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Target user not found'
    );
  END IF;
  
  -- Get pusher details
  SELECT up.*, r.name as role_name INTO pusher_record
  FROM user_profiles up
  LEFT JOIN roles r ON up.role_id = r.id
  WHERE up.id = p_pushed_by;
  
  IF pusher_record IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Pusher user not found'
    );
  END IF;
  
  -- Verify all users are in the same organization
  IF count_record.organization_id != target_user_record.organization_id 
     OR count_record.organization_id != pusher_record.organization_id THEN
    RETURN json_build_object(
      'success', false,
      'error', 'All parties must be in the same organization'
    );
  END IF;
  
  -- Verify pusher has permission (admin, manager, supervisor, or team_lead)
  IF pusher_record.role_name NOT IN ('admin', 'manager', 'supervisor', 'team_lead', 'area_supervisor') THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Insufficient permissions to push counts to workers'
    );
  END IF;
  
  -- Perform the push assignment
  UPDATE rr_cyclecount_data
  SET 
    assigned_to = p_user_id,
    assigned_at = now(),
    counter_name = target_user_record.full_name,
    push_mode = 'push',
    pushed_by = p_pushed_by,
    pushed_at = now(),
    push_acknowledged = FALSE,
    push_acknowledged_at = NULL,
    updated_at = now()
  WHERE id = p_count_id;
  
  -- Log the push action
  INSERT INTO audit_logs (
    user_id,
    organization_id,
    action,
    resource_type,
    resource_id,
    changes
  ) VALUES (
    p_pushed_by,
    count_record.organization_id,
    'assign'::audit_action,
    'cycle_count_push',
    p_count_id::TEXT,
    jsonb_build_object(
      'action', 'push_to_worker',
      'count_number', count_record.count_number,
      'pushed_to', p_user_id,
      'pushed_to_name', target_user_record.full_name,
      'pushed_by', p_pushed_by,
      'pushed_by_name', pusher_record.full_name
    )
  );
  
  RETURN json_build_object(
    'success', true,
    'message', 'Count successfully pushed to worker',
    'count_number', count_record.count_number,
    'material_number', count_record.material_number,
    'location', count_record.location,
    'assigned_to_name', target_user_record.full_name
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- Function: Acknowledge pushed count
CREATE OR REPLACE FUNCTION acknowledge_pushed_count(
  p_count_id UUID,
  p_user_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  count_record RECORD;
  current_user_id UUID;
BEGIN
  -- Get current user
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not authenticated'
    );
  END IF;
  
  -- Verify the requesting user matches p_user_id (can only acknowledge own counts)
  IF current_user_id != p_user_id THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Can only acknowledge counts assigned to yourself'
    );
  END IF;
  
  -- Get the cycle count
  SELECT * INTO count_record
  FROM rr_cyclecount_data
  WHERE id = p_count_id
    AND assigned_to = p_user_id
    AND push_mode = 'push';
  
  IF count_record IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Pushed count not found or not assigned to you'
    );
  END IF;
  
  -- Check if already acknowledged
  IF count_record.push_acknowledged = TRUE THEN
    RETURN json_build_object(
      'success', true,
      'message', 'Count was already acknowledged',
      'acknowledged_at', count_record.push_acknowledged_at
    );
  END IF;
  
  -- Acknowledge the pushed count
  UPDATE rr_cyclecount_data
  SET 
    push_acknowledged = TRUE,
    push_acknowledged_at = now(),
    status = CASE 
      WHEN status = 'pending' THEN 'in_progress'
      ELSE status
    END,
    updated_at = now()
  WHERE id = p_count_id;
  
  -- Log the acknowledgment
  INSERT INTO audit_logs (
    user_id,
    organization_id,
    action,
    resource_type,
    resource_id,
    changes
  ) VALUES (
    p_user_id,
    count_record.organization_id,
    'update'::audit_action,
    'cycle_count_acknowledgment',
    p_count_id::TEXT,
    jsonb_build_object(
      'action', 'push_acknowledged',
      'count_number', count_record.count_number,
      'acknowledged_by', p_user_id,
      'pushed_by', count_record.pushed_by
    )
  );
  
  RETURN json_build_object(
    'success', true,
    'message', 'Count acknowledged successfully',
    'count_number', count_record.count_number,
    'material_number', count_record.material_number,
    'location', count_record.location,
    'acknowledged_at', now()
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- Function: Upsert worker heartbeat
CREATE OR REPLACE FUNCTION upsert_worker_heartbeat(
  p_user_id UUID,
  p_organization_id UUID,
  p_current_task_id UUID DEFAULT NULL,
  p_current_task_type VARCHAR(50) DEFAULT NULL,
  p_current_zone VARCHAR(50) DEFAULT NULL,
  p_current_location VARCHAR(100) DEFAULT NULL,
  p_device_info JSONB DEFAULT NULL,
  p_status VARCHAR(20) DEFAULT 'online'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id UUID;
  user_org_id UUID;
BEGIN
  -- Get current user
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not authenticated'
    );
  END IF;
  
  -- Verify the user can only update their own heartbeat
  IF current_user_id != p_user_id THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Can only update your own heartbeat'
    );
  END IF;
  
  -- Verify organization membership
  SELECT organization_id INTO user_org_id
  FROM user_profiles
  WHERE id = p_user_id;
  
  IF user_org_id IS NULL OR user_org_id != p_organization_id THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Organization mismatch'
    );
  END IF;
  
  -- Validate status
  IF p_status NOT IN ('online', 'offline', 'busy', 'break', 'idle') THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Invalid status value'
    );
  END IF;
  
  -- Upsert the heartbeat
  INSERT INTO worker_heartbeats (
    user_id,
    organization_id,
    last_heartbeat,
    current_task_id,
    current_task_type,
    current_zone,
    current_location,
    device_info,
    status,
    created_at,
    updated_at
  ) VALUES (
    p_user_id,
    p_organization_id,
    now(),
    p_current_task_id,
    p_current_task_type,
    p_current_zone,
    p_current_location,
    p_device_info,
    p_status,
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    last_heartbeat = now(),
    current_task_id = EXCLUDED.current_task_id,
    current_task_type = EXCLUDED.current_task_type,
    current_zone = EXCLUDED.current_zone,
    current_location = EXCLUDED.current_location,
    device_info = COALESCE(EXCLUDED.device_info, worker_heartbeats.device_info),
    status = EXCLUDED.status,
    updated_at = now();
  
  RETURN json_build_object(
    'success', true,
    'message', 'Heartbeat updated',
    'timestamp', now()
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- Function: Get active workers with user info
CREATE OR REPLACE FUNCTION get_active_workers(
  p_org_id UUID,
  p_stale_threshold_minutes INTEGER DEFAULT 5
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  current_user_id UUID;
  current_user_org_id UUID;
  stale_threshold TIMESTAMPTZ;
BEGIN
  -- Get current user
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not authenticated'
    );
  END IF;
  
  -- Get current user's organization
  SELECT organization_id INTO current_user_org_id
  FROM user_profiles
  WHERE id = current_user_id;
  
  -- Verify same organization
  IF current_user_org_id != p_org_id THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot view workers from different organization'
    );
  END IF;
  
  -- Calculate stale threshold
  stale_threshold := now() - (p_stale_threshold_minutes || ' minutes')::INTERVAL;
  
  -- Get active workers
  SELECT json_build_object(
    'success', true,
    'workers', COALESCE((
      SELECT json_agg(
        json_build_object(
          'user_id', wh.user_id,
          'full_name', up.full_name,
          'email', up.email,
          'role', r.name,
          'avatar_url', up.avatar_url,
          'last_heartbeat', wh.last_heartbeat,
          'seconds_since_heartbeat', EXTRACT(EPOCH FROM (now() - wh.last_heartbeat)),
          'is_stale', wh.last_heartbeat < stale_threshold,
          'current_task_id', wh.current_task_id,
          'current_task_type', wh.current_task_type,
          'current_zone', wh.current_zone,
          'current_location', wh.current_location,
          'device_info', wh.device_info,
          'status', wh.status
        )
        ORDER BY 
          CASE wh.status 
            WHEN 'busy' THEN 1 
            WHEN 'online' THEN 2 
            WHEN 'idle' THEN 3 
            WHEN 'break' THEN 4 
            WHEN 'offline' THEN 5 
          END,
          wh.last_heartbeat DESC
      )
      FROM worker_heartbeats wh
      JOIN user_profiles up ON wh.user_id = up.id
      LEFT JOIN roles r ON up.role_id = r.id
      WHERE wh.organization_id = p_org_id
    ), '[]'::json),
    'summary', json_build_object(
      'total', (SELECT COUNT(*) FROM worker_heartbeats WHERE organization_id = p_org_id),
      'online', (SELECT COUNT(*) FROM worker_heartbeats WHERE organization_id = p_org_id AND status = 'online' AND last_heartbeat >= stale_threshold),
      'busy', (SELECT COUNT(*) FROM worker_heartbeats WHERE organization_id = p_org_id AND status = 'busy' AND last_heartbeat >= stale_threshold),
      'idle', (SELECT COUNT(*) FROM worker_heartbeats WHERE organization_id = p_org_id AND status = 'idle' AND last_heartbeat >= stale_threshold),
      'on_break', (SELECT COUNT(*) FROM worker_heartbeats WHERE organization_id = p_org_id AND status = 'break' AND last_heartbeat >= stale_threshold),
      'offline', (SELECT COUNT(*) FROM worker_heartbeats WHERE organization_id = p_org_id AND (status = 'offline' OR last_heartbeat < stale_threshold)),
      'stale', (SELECT COUNT(*) FROM worker_heartbeats WHERE organization_id = p_org_id AND last_heartbeat < stale_threshold)
    ),
    'stale_threshold_minutes', p_stale_threshold_minutes,
    'timestamp', now()
  ) INTO result;
  
  RETURN result;
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- Function: Get workers by zone
CREATE OR REPLACE FUNCTION get_workers_by_zone(
  p_org_id UUID,
  p_zone VARCHAR(50) DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  current_user_id UUID;
  current_user_org_id UUID;
BEGIN
  -- Get current user
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not authenticated'
    );
  END IF;
  
  -- Get current user's organization
  SELECT organization_id INTO current_user_org_id
  FROM user_profiles
  WHERE id = current_user_id;
  
  -- Verify same organization
  IF current_user_org_id != p_org_id THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot view workers from different organization'
    );
  END IF;
  
  -- Get workers grouped by zone
  SELECT json_build_object(
    'success', true,
    'zones', COALESCE((
      SELECT json_agg(
        json_build_object(
          'zone', zone_data.current_zone,
          'worker_count', zone_data.worker_count,
          'workers', zone_data.workers
        )
      )
      FROM (
        SELECT 
          COALESCE(wh.current_zone, 'unassigned') as current_zone,
          COUNT(*) as worker_count,
          json_agg(
            json_build_object(
              'user_id', wh.user_id,
              'full_name', up.full_name,
              'status', wh.status,
              'current_location', wh.current_location,
              'current_task_type', wh.current_task_type
            )
          ) as workers
        FROM worker_heartbeats wh
        JOIN user_profiles up ON wh.user_id = up.id
        WHERE wh.organization_id = p_org_id
          AND wh.last_heartbeat >= (now() - INTERVAL '5 minutes')
          AND (p_zone IS NULL OR wh.current_zone = p_zone)
        GROUP BY COALESCE(wh.current_zone, 'unassigned')
        ORDER BY worker_count DESC
      ) zone_data
    ), '[]'::json),
    'timestamp', now()
  ) INTO result;
  
  RETURN result;
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- =====================================================
-- SECTION 6: Update Trigger for worker_heartbeats
-- =====================================================

-- Create trigger to automatically update updated_at
CREATE OR REPLACE FUNCTION update_worker_heartbeats_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER worker_heartbeats_updated_at_trigger
  BEFORE UPDATE ON worker_heartbeats
  FOR EACH ROW
  EXECUTE FUNCTION update_worker_heartbeats_updated_at();

-- =====================================================
-- SECTION 7: Function Comments
-- =====================================================

COMMENT ON FUNCTION get_user_pushed_counts(UUID) IS 'Returns all pushed cycle counts assigned to a specific user';
COMMENT ON FUNCTION push_cycle_count_to_user(UUID, UUID, UUID) IS 'Pushes a cycle count to a specific worker (supervisor/manager action)';
COMMENT ON FUNCTION acknowledge_pushed_count(UUID, UUID) IS 'Worker acknowledges receipt of a pushed cycle count';
COMMENT ON FUNCTION upsert_worker_heartbeat(UUID, UUID, UUID, VARCHAR, VARCHAR, VARCHAR, JSONB, VARCHAR) IS 'Updates or inserts a worker heartbeat with current status and location';
COMMENT ON FUNCTION get_active_workers(UUID, INTEGER) IS 'Returns all active workers in an organization with their current status';
COMMENT ON FUNCTION get_workers_by_zone(UUID, VARCHAR) IS 'Returns workers grouped by warehouse zone';
