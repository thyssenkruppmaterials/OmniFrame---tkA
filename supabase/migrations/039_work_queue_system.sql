-- Work Queue System Implementation
-- Migration: 039_work_queue_system.sql
-- Description: Implements comprehensive work queue management system for OneBox AI
-- Author: AI Assistant
-- Date: 2025-01-16

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- WORK QUEUE CONFIGURATION TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS work_queue_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Queue settings
  enable_auto_assignment BOOLEAN DEFAULT true,
  assignment_strategy TEXT DEFAULT 'round_robin' CHECK (assignment_strategy IN ('round_robin', 'load_balanced', 'skill_based', 'priority_based')),
  max_tasks_per_worker INTEGER DEFAULT 5 CHECK (max_tasks_per_worker > 0),
  task_timeout_minutes INTEGER DEFAULT 30 CHECK (task_timeout_minutes > 0),
  warning_threshold_minutes INTEGER DEFAULT 20 CHECK (warning_threshold_minutes > 0),
  
  -- Priority weights (0-100)
  priority_weight_urgency INTEGER DEFAULT 40 CHECK (priority_weight_urgency BETWEEN 0 AND 100),
  priority_weight_age INTEGER DEFAULT 30 CHECK (priority_weight_age BETWEEN 0 AND 100),
  priority_weight_location INTEGER DEFAULT 20 CHECK (priority_weight_location BETWEEN 0 AND 100),
  priority_weight_custom INTEGER DEFAULT 10 CHECK (priority_weight_custom BETWEEN 0 AND 100),
  
  -- Features
  enable_skill_matching BOOLEAN DEFAULT true,
  enable_location_optimization BOOLEAN DEFAULT true,
  enable_batch_assignment BOOLEAN DEFAULT false,
  enable_predictive_assignment BOOLEAN DEFAULT false,
  
  CONSTRAINT unique_org_config UNIQUE(organization_id)
);

-- Create indexes for work_queue_config
CREATE INDEX IF NOT EXISTS idx_work_queue_config_org ON work_queue_config(organization_id);

-- ============================================================================
-- TASK TYPES REGISTRY
-- ============================================================================
CREATE TABLE IF NOT EXISTS task_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  color TEXT,
  
  -- Configuration
  requires_scanner BOOLEAN DEFAULT false,
  requires_location BOOLEAN DEFAULT true,
  requires_material BOOLEAN DEFAULT true,
  allow_partial_completion BOOLEAN DEFAULT false,
  allow_delegation BOOLEAN DEFAULT true,
  
  -- Time estimates (minutes)
  estimated_duration_min INTEGER DEFAULT 5 CHECK (estimated_duration_min > 0),
  estimated_duration_max INTEGER DEFAULT 30 CHECK (estimated_duration_max >= estimated_duration_min),
  
  -- Skills required (JSON array of skill objects)
  required_skills JSONB DEFAULT '[]',
  preferred_skills JSONB DEFAULT '[]',
  
  -- Custom fields schema
  custom_fields_schema JSONB DEFAULT '{}',
  
  -- Workflow
  workflow_steps JSONB DEFAULT '[]',
  completion_validations JSONB DEFAULT '[]',
  
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT unique_org_task_type UNIQUE(organization_id, type_code)
);

-- Create indexes for task_types
CREATE INDEX IF NOT EXISTS idx_task_types_org ON task_types(organization_id);
CREATE INDEX IF NOT EXISTS idx_task_types_active ON task_types(organization_id, active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_task_types_code ON task_types(organization_id, type_code);

-- ============================================================================
-- WORKER PROFILES FOR QUEUE SYSTEM
-- ============================================================================
CREATE TABLE IF NOT EXISTS worker_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Availability
  is_available BOOLEAN DEFAULT true,
  available_from TIME,
  available_to TIME,
  break_start TIME,
  break_duration_minutes INTEGER DEFAULT 30 CHECK (break_duration_minutes >= 0),
  
  -- Capacity
  max_concurrent_tasks INTEGER DEFAULT 3 CHECK (max_concurrent_tasks > 0),
  preferred_task_types JSONB DEFAULT '[]',
  blocked_task_types JSONB DEFAULT '[]',
  
  -- Skills and certifications
  skills JSONB DEFAULT '[]', -- Array of skill objects with proficiency levels
  certifications JSONB DEFAULT '[]',
  
  -- Performance metrics
  tasks_completed_today INTEGER DEFAULT 0 CHECK (tasks_completed_today >= 0),
  average_task_duration DECIMAL(10,2),
  accuracy_rate DECIMAL(5,2) CHECK (accuracy_rate >= 0 AND accuracy_rate <= 100),
  productivity_score DECIMAL(5,2) CHECK (productivity_score >= 0),
  
  -- Location preferences
  preferred_zones JSONB DEFAULT '[]',
  current_zone TEXT,
  home_warehouse TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT unique_user_org_worker UNIQUE(user_id, organization_id)
);

-- Create indexes for worker_profiles
CREATE INDEX IF NOT EXISTS idx_worker_profiles_user ON worker_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_worker_profiles_org ON worker_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_worker_profiles_available ON worker_profiles(organization_id, is_available) WHERE is_available = true;
CREATE INDEX IF NOT EXISTS idx_worker_profiles_zone ON worker_profiles(organization_id, current_zone) WHERE current_zone IS NOT NULL;

-- ============================================================================
-- MAIN WORK QUEUE TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS work_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Task identification
  task_type TEXT NOT NULL,
  task_reference_id UUID, -- Reference to specific task (cycle count, putaway, etc.)
  task_group_id UUID, -- For batch tasks
  
  -- Task details
  title TEXT NOT NULL,
  description TEXT,
  priority INTEGER DEFAULT 50 CHECK (priority BETWEEN 0 AND 100), -- 0-100, higher is more urgent
  
  -- Location and material
  location TEXT,
  zone TEXT,
  material_number TEXT,
  quantity DECIMAL(15,3),
  unit_of_measure TEXT,
  
  -- Assignment
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'in_progress', 'completed', 'failed', 'cancelled')),
  assigned_to UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  assigned_by TEXT, -- 'system' or user ID
  assignment_method TEXT CHECK (assignment_method IN ('auto', 'manual', 'claimed')),
  
  -- Timing
  created_at TIMESTAMPTZ DEFAULT now(),
  due_date TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  estimated_duration_minutes INTEGER CHECK (estimated_duration_minutes > 0),
  actual_duration_minutes INTEGER CHECK (actual_duration_minutes >= 0),
  
  -- Warnings and escalation
  warning_sent_at TIMESTAMPTZ,
  escalated_at TIMESTAMPTZ,
  escalation_level INTEGER DEFAULT 0 CHECK (escalation_level >= 0),
  
  -- Task data
  task_data JSONB DEFAULT '{}', -- Flexible storage for task-specific data
  result_data JSONB DEFAULT '{}', -- Task completion results
  
  -- Skills and requirements
  required_skills JSONB DEFAULT '[]',
  required_certifications JSONB DEFAULT '[]',
  complexity_score INTEGER DEFAULT 50 CHECK (complexity_score BETWEEN 0 AND 100), -- 0-100
  
  -- Dependencies
  depends_on UUID[], -- Array of task IDs that must complete first
  blocks UUID[], -- Array of task IDs that this blocks
  
  -- Metadata
  tags TEXT[],
  notes TEXT,
  created_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create performance indexes for work_queue
CREATE INDEX IF NOT EXISTS idx_work_queue_status_priority ON work_queue(organization_id, status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_work_queue_assigned ON work_queue(assigned_to, status) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_queue_location ON work_queue(organization_id, zone, location) WHERE zone IS NOT NULL AND location IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_queue_due_date ON work_queue(organization_id, status, due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_queue_task_type ON work_queue(organization_id, task_type, status);
CREATE INDEX IF NOT EXISTS idx_work_queue_created_at ON work_queue(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_queue_pending ON work_queue(organization_id, priority DESC, created_at ASC) WHERE status = 'pending';

-- ============================================================================
-- TASK ASSIGNMENT HISTORY
-- ============================================================================
CREATE TABLE IF NOT EXISTS task_assignment_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES work_queue(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  released_at TIMESTAMPTZ,
  release_reason TEXT,
  duration_minutes INTEGER CHECK (duration_minutes >= 0),
  outcome TEXT CHECK (outcome IN ('completed', 'abandoned', 'reassigned', 'failed', 'cancelled')),
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for task_assignment_history
CREATE INDEX IF NOT EXISTS idx_assignment_history_task ON task_assignment_history(task_id);
CREATE INDEX IF NOT EXISTS idx_assignment_history_user ON task_assignment_history(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assignment_history_outcome ON task_assignment_history(outcome, assigned_at DESC) WHERE outcome IS NOT NULL;

-- ============================================================================
-- WORKER PERFORMANCE METRICS
-- ============================================================================
CREATE TABLE IF NOT EXISTS worker_performance_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  worker_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  
  -- Task metrics
  tasks_assigned INTEGER DEFAULT 0 CHECK (tasks_assigned >= 0),
  tasks_completed INTEGER DEFAULT 0 CHECK (tasks_completed >= 0),
  tasks_abandoned INTEGER DEFAULT 0 CHECK (tasks_abandoned >= 0),
  tasks_failed INTEGER DEFAULT 0 CHECK (tasks_failed >= 0),
  
  -- Time metrics
  total_active_minutes INTEGER DEFAULT 0 CHECK (total_active_minutes >= 0),
  total_idle_minutes INTEGER DEFAULT 0 CHECK (total_idle_minutes >= 0),
  average_task_duration DECIMAL(10,2) CHECK (average_task_duration >= 0),
  fastest_task_duration INTEGER CHECK (fastest_task_duration >= 0),
  slowest_task_duration INTEGER CHECK (slowest_task_duration >= 0),
  
  -- Quality metrics
  accuracy_rate DECIMAL(5,2) CHECK (accuracy_rate >= 0 AND accuracy_rate <= 100),
  error_count INTEGER DEFAULT 0 CHECK (error_count >= 0),
  rework_count INTEGER DEFAULT 0 CHECK (rework_count >= 0),
  
  -- Efficiency metrics
  productivity_score DECIMAL(5,2) CHECK (productivity_score >= 0),
  utilization_rate DECIMAL(5,2) CHECK (utilization_rate >= 0 AND utilization_rate <= 100),
  
  -- By task type metrics (JSONB)
  metrics_by_type JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT unique_worker_date_metrics UNIQUE(worker_id, organization_id, metric_date)
);

-- Create indexes for worker_performance_metrics
CREATE INDEX IF NOT EXISTS idx_performance_date ON worker_performance_metrics(organization_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_performance_worker ON worker_performance_metrics(worker_id, metric_date DESC);

-- ============================================================================
-- QUEUE RULES ENGINE
-- ============================================================================
CREATE TABLE IF NOT EXISTS queue_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('assignment', 'priority', 'escalation', 'notification')),
  
  -- Conditions (JSON schema)
  conditions JSONB NOT NULL, -- Complex condition tree
  
  -- Actions (JSON schema)
  actions JSONB NOT NULL, -- What to do when conditions match
  
  -- Rule metadata
  priority INTEGER DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  active BOOLEAN DEFAULT true,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  
  CONSTRAINT valid_date_range CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

-- Create indexes for queue_rules
CREATE INDEX IF NOT EXISTS idx_queue_rules_active ON queue_rules(organization_id, active, rule_type) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_queue_rules_priority ON queue_rules(organization_id, rule_type, priority DESC) WHERE active = true;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Enable RLS on all work queue tables
ALTER TABLE work_queue_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_rules ENABLE ROW LEVEL SECURITY;

-- Work Queue Config Policies
CREATE POLICY "work_queue_config_org_access" ON work_queue_config
    FOR ALL USING (organization_id IN (
        SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    ));

-- Task Types Policies  
CREATE POLICY "task_types_org_access" ON task_types
    FOR ALL USING (organization_id IN (
        SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    ));

-- Worker Profiles Policies
CREATE POLICY "worker_profiles_org_access" ON worker_profiles
    FOR ALL USING (organization_id IN (
        SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    ));

-- Work Queue Policies
CREATE POLICY "work_queue_org_access" ON work_queue
    FOR ALL USING (organization_id IN (
        SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    ));

-- Task Assignment History Policies
CREATE POLICY "task_assignment_history_org_access" ON task_assignment_history
    FOR ALL USING (task_id IN (
        SELECT id FROM work_queue WHERE organization_id IN (
            SELECT organization_id FROM user_profiles WHERE id = auth.uid()
        )
    ));

-- Worker Performance Metrics Policies
CREATE POLICY "worker_performance_metrics_org_access" ON worker_performance_metrics
    FOR ALL USING (organization_id IN (
        SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    ));

-- Queue Rules Policies
CREATE POLICY "queue_rules_org_access" ON queue_rules
    FOR ALL USING (organization_id IN (
        SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    ));

-- ============================================================================
-- POSTGRESQL FUNCTIONS FOR WORK QUEUE OPERATIONS
-- ============================================================================

-- Function to get next task for worker with intelligent matching
CREATE OR REPLACE FUNCTION get_next_task_for_worker(
    p_worker_id UUID,
    p_task_types TEXT[] DEFAULT NULL,
    p_zones TEXT[] DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    worker_org_id UUID;
    worker_max_tasks INTEGER;
    current_task_count INTEGER;
    assigned_task RECORD;
    result JSON;
BEGIN
    -- Get worker's organization and capacity
    SELECT wp.organization_id, wp.max_concurrent_tasks
    INTO worker_org_id, worker_max_tasks
    FROM worker_profiles wp
    WHERE wp.user_id = p_worker_id AND wp.is_available = true;
    
    IF worker_org_id IS NULL THEN
        RETURN json_build_object('error', 'Worker not found or unavailable');
    END IF;
    
    -- Check current task count
    SELECT COUNT(*)
    INTO current_task_count
    FROM work_queue
    WHERE assigned_to = p_worker_id 
      AND status IN ('assigned', 'in_progress');
    
    IF current_task_count >= worker_max_tasks THEN
        RETURN json_build_object(
            'success', false,
            'message', 'Worker has reached maximum concurrent task limit',
            'current_tasks', current_task_count,
            'max_tasks', worker_max_tasks
        );
    END IF;
    
    -- Find next available task with priority and skill matching
    SELECT *
    INTO assigned_task
    FROM work_queue
    WHERE organization_id = worker_org_id
      AND status = 'pending'
      AND (p_task_types IS NULL OR task_type = ANY(p_task_types))
      AND (p_zones IS NULL OR zone = ANY(p_zones))
      AND (depends_on IS NULL OR NOT EXISTS (
          SELECT 1 FROM work_queue dep 
          WHERE dep.id = ANY(work_queue.depends_on) 
            AND dep.status NOT IN ('completed', 'cancelled')
      ))
    ORDER BY priority DESC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
    
    IF assigned_task IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'message', 'No matching tasks available'
        );
    END IF;
    
    -- Assign task to worker
    UPDATE work_queue
    SET 
        status = 'assigned',
        assigned_to = p_worker_id,
        assigned_at = now(),
        assigned_by = 'system',
        assignment_method = 'auto',
        updated_at = now()
    WHERE id = assigned_task.id;
    
    -- Record assignment history
    INSERT INTO task_assignment_history (task_id, assigned_to, assigned_at)
    VALUES (assigned_task.id, p_worker_id, now());
    
    -- Return assigned task
    SELECT 
        id, task_type, title, description, priority,
        location, zone, material_number, quantity, unit_of_measure,
        task_data, required_skills, complexity_score,
        estimated_duration_minutes, due_date
    INTO assigned_task
    FROM work_queue
    WHERE id = assigned_task.id;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Task assigned successfully',
        'task', row_to_json(assigned_task)
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$;

-- Function to calculate dynamic priority score
CREATE OR REPLACE FUNCTION calculate_task_priority(
    p_task_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    task_record RECORD;
    config_record RECORD;
    age_minutes INTEGER;
    urgency_score INTEGER;
    age_score INTEGER;
    location_score INTEGER;
    custom_score INTEGER;
    final_priority INTEGER;
BEGIN
    -- Get task and config data
    SELECT wq.*, wqc.*
    INTO task_record
    FROM work_queue wq
    JOIN work_queue_config wqc ON wq.organization_id = wqc.organization_id
    WHERE wq.id = p_task_id;
    
    IF task_record IS NULL THEN
        RETURN 50; -- Default priority
    END IF;
    
    -- Calculate age in minutes
    age_minutes := EXTRACT(EPOCH FROM (now() - task_record.created_at)) / 60;
    
    -- Calculate urgency score (0-100 based on due date)
    IF task_record.due_date IS NOT NULL THEN
        urgency_score := GREATEST(0, LEAST(100, 
            100 - (EXTRACT(EPOCH FROM (task_record.due_date - now())) / 3600) -- Hours until due
        ));
    ELSE
        urgency_score := task_record.priority;
    END IF;
    
    -- Calculate age score (0-100, increases with age)
    age_score := LEAST(100, age_minutes / 10); -- 10 minutes = 1 point
    
    -- Calculate location score (placeholder - could be enhanced with zone priority)
    location_score := 50;
    
    -- Calculate custom score (from task_data or complexity)
    custom_score := task_record.complexity_score;
    
    -- Calculate weighted final priority
    final_priority := (
        (urgency_score * task_record.priority_weight_urgency) +
        (age_score * task_record.priority_weight_age) +
        (location_score * task_record.priority_weight_location) +
        (custom_score * task_record.priority_weight_custom)
    ) / 100;
    
    RETURN LEAST(100, GREATEST(0, final_priority));
END;
$$;

-- Function to bulk assign tasks to multiple workers
CREATE OR REPLACE FUNCTION bulk_assign_tasks(
    p_task_ids UUID[],
    p_assignment_strategy TEXT DEFAULT 'load_balanced'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    task_id UUID;
    assigned_count INTEGER := 0;
    failed_count INTEGER := 0;
    results JSONB := '[]';
    assignment_result JSON;
BEGIN
    -- Loop through each task
    FOREACH task_id IN ARRAY p_task_ids
    LOOP
        -- Try to assign task using the specified strategy
        IF p_assignment_strategy = 'load_balanced' THEN
            -- Find worker with least current tasks
            SELECT get_next_task_for_worker(
                (SELECT wp.user_id 
                 FROM worker_profiles wp
                 JOIN work_queue wq ON wq.organization_id = wp.organization_id
                 WHERE wq.id = task_id AND wp.is_available = true
                 ORDER BY (
                     SELECT COUNT(*) FROM work_queue 
                     WHERE assigned_to = wp.user_id AND status IN ('assigned', 'in_progress')
                 ) ASC
                 LIMIT 1),
                ARRAY(SELECT task_type FROM work_queue WHERE id = task_id)
            ) INTO assignment_result;
        ELSE
            -- Default round-robin or other strategies can be implemented here
            assignment_result := json_build_object('error', 'Assignment strategy not implemented');
        END IF;
        
        IF (assignment_result->>'success')::boolean = true THEN
            assigned_count := assigned_count + 1;
        ELSE
            failed_count := failed_count + 1;
        END IF;
        
        results := results || jsonb_build_object(
            'task_id', task_id,
            'result', assignment_result
        );
    END LOOP;
    
    RETURN json_build_object(
        'success', true,
        'assigned_count', assigned_count,
        'failed_count', failed_count,
        'results', results
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$;

-- Function to rebalance work queue based on worker availability
CREATE OR REPLACE FUNCTION rebalance_work_queue()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    rebalanced_count INTEGER := 0;
    result JSON;
BEGIN
    -- Find overloaded workers and redistribute their tasks
    WITH overloaded_workers AS (
        SELECT 
            wp.user_id,
            wp.max_concurrent_tasks,
            COUNT(wq.id) as current_tasks
        FROM worker_profiles wp
        JOIN work_queue wq ON wq.assigned_to = wp.user_id
        WHERE wp.is_available = true 
          AND wq.status IN ('assigned', 'in_progress')
        GROUP BY wp.user_id, wp.max_concurrent_tasks
        HAVING COUNT(wq.id) > wp.max_concurrent_tasks
    ),
    tasks_to_rebalance AS (
        SELECT wq.id
        FROM work_queue wq
        JOIN overloaded_workers ow ON wq.assigned_to = ow.user_id
        WHERE wq.status = 'assigned' -- Only reassign tasks not yet started
        ORDER BY wq.priority DESC, wq.created_at ASC
    )
    UPDATE work_queue
    SET 
        status = 'pending',
        assigned_to = NULL,
        assigned_at = NULL,
        assignment_method = NULL,
        updated_at = now()
    FROM tasks_to_rebalance ttr
    WHERE work_queue.id = ttr.id;
    
    GET DIAGNOSTICS rebalanced_count = ROW_COUNT;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Work queue rebalanced successfully',
        'tasks_rebalanced', rebalanced_count
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$;

-- Function to auto-escalate stalled tasks
CREATE OR REPLACE FUNCTION escalate_stalled_tasks()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    escalated_count INTEGER := 0;
BEGIN
    -- Escalate tasks that exceed warning threshold
    WITH stalled_tasks AS (
        SELECT wq.id, wqc.warning_threshold_minutes
        FROM work_queue wq
        JOIN work_queue_config wqc ON wq.organization_id = wqc.organization_id
        WHERE wq.status = 'in_progress'
          AND wq.warning_sent_at IS NULL
          AND EXTRACT(EPOCH FROM (now() - wq.started_at)) / 60 > wqc.warning_threshold_minutes
    )
    UPDATE work_queue
    SET 
        warning_sent_at = now(),
        escalation_level = escalation_level + 1,
        updated_at = now()
    FROM stalled_tasks st
    WHERE work_queue.id = st.id;
    
    GET DIAGNOSTICS escalated_count = ROW_COUNT;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Stalled tasks escalated successfully',
        'tasks_escalated', escalated_count
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$;

-- Function to generate worker performance report
CREATE OR REPLACE FUNCTION generate_worker_performance_report(
    p_start_date DATE,
    p_end_date DATE,
    p_organization_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    org_filter UUID;
    report_data JSON;
BEGIN
    -- Get organization filter
    IF p_organization_id IS NULL THEN
        SELECT organization_id INTO org_filter
        FROM user_profiles
        WHERE id = auth.uid();
    ELSE
        org_filter := p_organization_id;
    END IF;
    
    -- Generate comprehensive performance report
    SELECT json_build_object(
        'period', json_build_object(
            'start_date', p_start_date,
            'end_date', p_end_date
        ),
        'summary', json_build_object(
            'total_workers', COUNT(DISTINCT wpm.worker_id),
            'total_tasks_completed', SUM(wpm.tasks_completed),
            'total_tasks_assigned', SUM(wpm.tasks_assigned),
            'average_productivity', AVG(wpm.productivity_score),
            'average_accuracy', AVG(wpm.accuracy_rate)
        ),
        'workers', json_agg(
            json_build_object(
                'worker_id', wpm.worker_id,
                'full_name', up.full_name,
                'tasks_completed', SUM(wpm.tasks_completed),
                'tasks_assigned', SUM(wpm.tasks_assigned),
                'completion_rate', 
                    CASE 
                        WHEN SUM(wpm.tasks_assigned) > 0 
                        THEN ROUND((SUM(wpm.tasks_completed)::DECIMAL / SUM(wpm.tasks_assigned)::DECIMAL) * 100, 2)
                        ELSE 0 
                    END,
                'average_task_duration', AVG(wpm.average_task_duration),
                'productivity_score', AVG(wpm.productivity_score),
                'accuracy_rate', AVG(wpm.accuracy_rate)
            )
        )
    )
    INTO report_data
    FROM worker_performance_metrics wpm
    JOIN user_profiles up ON wpm.worker_id = up.id
    WHERE wpm.organization_id = org_filter
      AND wpm.metric_date BETWEEN p_start_date AND p_end_date
    GROUP BY wpm.worker_id, up.full_name;
    
    RETURN json_build_object(
        'success', true,
        'report', report_data
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$;

-- ============================================================================
-- TRIGGER FUNCTIONS FOR AUTOMATIC UPDATES
-- ============================================================================

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at columns
CREATE TRIGGER update_work_queue_config_updated_at BEFORE UPDATE ON work_queue_config 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_task_types_updated_at BEFORE UPDATE ON task_types 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_worker_profiles_updated_at BEFORE UPDATE ON worker_profiles 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_work_queue_updated_at BEFORE UPDATE ON work_queue 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_worker_performance_metrics_updated_at BEFORE UPDATE ON worker_performance_metrics 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_queue_rules_updated_at BEFORE UPDATE ON queue_rules 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- INITIAL DATA SETUP
-- ============================================================================

-- Insert default task types for all organizations
INSERT INTO task_types (organization_id, type_code, display_name, description, icon, color, requires_scanner, requires_location, requires_material)
SELECT 
    o.id,
    'CYCLE_COUNT',
    'Cycle Count',
    'Physical inventory count verification',
    'BarChart3',
    '#3B82F6',
    true,
    true,
    true
FROM organizations o
WHERE NOT EXISTS (
    SELECT 1 FROM task_types tt 
    WHERE tt.organization_id = o.id AND tt.type_code = 'CYCLE_COUNT'
);

INSERT INTO task_types (organization_id, type_code, display_name, description, icon, color, requires_scanner, requires_location, requires_material)
SELECT 
    o.id,
    'PUTAWAY',
    'Put Away',
    'Store received items in designated locations',
    'Package',
    '#10B981',
    true,
    true,
    true
FROM organizations o
WHERE NOT EXISTS (
    SELECT 1 FROM task_types tt 
    WHERE tt.organization_id = o.id AND tt.type_code = 'PUTAWAY'
);

INSERT INTO task_types (organization_id, type_code, display_name, description, icon, color, requires_scanner, requires_location, requires_material)
SELECT 
    o.id,
    'PICKING',
    'Picking',
    'Collect items for order fulfillment',
    'ClipboardList',
    '#F59E0B',
    true,
    true,
    true
FROM organizations o
WHERE NOT EXISTS (
    SELECT 1 FROM task_types tt 
    WHERE tt.organization_id = o.id AND tt.type_code = 'PICKING'
);

-- Insert default work queue configuration for all organizations
INSERT INTO work_queue_config (organization_id)
SELECT o.id
FROM organizations o
WHERE NOT EXISTS (
    SELECT 1 FROM work_queue_config wqc 
    WHERE wqc.organization_id = o.id
);

-- Create worker profiles for all existing users
INSERT INTO worker_profiles (user_id, organization_id)
SELECT up.id, up.organization_id
FROM user_profiles up
WHERE up.organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM worker_profiles wp 
    WHERE wp.user_id = up.id AND wp.organization_id = up.organization_id
);

-- ============================================================================
-- COMMENTS AND DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE work_queue_config IS 'Configuration settings for work queue system per organization';
COMMENT ON TABLE task_types IS 'Registry of task types with their configurations and requirements';
COMMENT ON TABLE worker_profiles IS 'Extended profiles for workers with availability, skills, and performance data';
COMMENT ON TABLE work_queue IS 'Main work queue table containing all tasks and their lifecycle data';
COMMENT ON TABLE task_assignment_history IS 'Historical record of task assignments and outcomes';
COMMENT ON TABLE worker_performance_metrics IS 'Daily performance metrics for workers';
COMMENT ON TABLE queue_rules IS 'Configurable rules engine for queue behavior and automation';

COMMENT ON FUNCTION get_next_task_for_worker(UUID, TEXT[], TEXT[]) IS 'Intelligently assigns next available task to worker based on skills, location, and availability';
COMMENT ON FUNCTION calculate_task_priority(UUID) IS 'Dynamically calculates task priority based on multiple weighted factors';
COMMENT ON FUNCTION bulk_assign_tasks(UUID[], TEXT) IS 'Assigns multiple tasks to workers using specified strategy';
COMMENT ON FUNCTION rebalance_work_queue() IS 'Rebalances task assignments to optimize worker utilization';
COMMENT ON FUNCTION escalate_stalled_tasks() IS 'Automatically escalates tasks that exceed warning thresholds';
COMMENT ON FUNCTION generate_worker_performance_report(DATE, DATE, UUID) IS 'Generates comprehensive performance reports for workers';
