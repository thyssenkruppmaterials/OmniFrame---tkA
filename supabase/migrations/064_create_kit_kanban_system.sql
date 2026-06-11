-- ============================================================================
-- KIT KANBAN SYSTEM MIGRATION
-- ============================================================================
-- Migration: 064_create_kit_kanban_system.sql
-- Created: November 11, 2025
-- Description: Creates comprehensive kit kanban board system for managing
--              kit assembly workflows with drag-and-drop task management
-- Dependencies: Requires user_profiles, organizations, work_queue tables
-- ============================================================================

-- ============================================================================
-- KIT DEFINITIONS TABLE
-- ============================================================================
-- Stores master kit definitions including bill of materials
CREATE TABLE IF NOT EXISTS kit_definitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Kit identification
  kit_number VARCHAR(100) NOT NULL,
  kit_name VARCHAR(255) NOT NULL,
  kit_description TEXT,
  kit_version VARCHAR(50) DEFAULT '1.0',
  
  -- Kit classification
  kit_type VARCHAR(50), -- 'standard', 'custom', 'promotional', 'emergency', 'sample'
  kit_category VARCHAR(100), -- 'medical', 'industrial', 'promotional', 'maintenance'
  
  -- Bill of materials
  required_components JSONB DEFAULT '[]', -- Array of component objects
  total_components_count INTEGER DEFAULT 0,
  
  -- Assembly instructions
  assembly_instructions TEXT,
  work_instructions_url TEXT,
  estimated_assembly_time_minutes INTEGER,
  
  -- Status and lifecycle
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('draft', 'active', 'obsolete', 'archived')),
  effective_date TIMESTAMPTZ,
  obsolete_date TIMESTAMPTZ,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  
  -- Constraints
  UNIQUE(organization_id, kit_number),
  CHECK (total_components_count >= 0)
);

-- ============================================================================
-- KIT KANBAN COLUMNS TABLE
-- ============================================================================
-- Defines the columns/stages in the kanban board
CREATE TABLE IF NOT EXISTS kit_kanban_columns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Column identification
  column_name VARCHAR(100) NOT NULL,
  column_display_name VARCHAR(255) NOT NULL,
  column_description TEXT,
  
  -- Visual styling
  column_color VARCHAR(20) DEFAULT '#6B7280', -- Hex color code
  column_icon VARCHAR(50), -- Icon identifier
  
  -- Ordering and behavior
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  is_start_column BOOLEAN DEFAULT false,
  is_end_column BOOLEAN DEFAULT false,
  
  -- Column rules
  max_tasks_limit INTEGER, -- NULL means unlimited
  auto_assign_on_enter BOOLEAN DEFAULT false,
  requires_quality_check BOOLEAN DEFAULT false,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Constraints
  UNIQUE(organization_id, column_name),
  CHECK (sort_order >= 0)
);

-- ============================================================================
-- KIT KANBAN TASKS TABLE
-- ============================================================================
-- Individual kit assembly tasks in the kanban board
CREATE TABLE IF NOT EXISTS kit_kanban_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Task identification
  task_number VARCHAR(100) UNIQUE NOT NULL,
  task_title VARCHAR(255) NOT NULL,
  task_description TEXT,
  
  -- Kit reference
  kit_definition_id UUID REFERENCES kit_definitions(id) ON DELETE SET NULL,
  kit_number VARCHAR(100),
  kit_batch_number VARCHAR(100), -- For batch production
  
  -- Kanban positioning
  column_id UUID NOT NULL REFERENCES kit_kanban_columns(id) ON DELETE RESTRICT,
  position_in_column INTEGER DEFAULT 0,
  
  -- Task details
  priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  quantity_to_assemble INTEGER NOT NULL DEFAULT 1,
  quantity_completed INTEGER DEFAULT 0,
  
  -- Component tracking
  components_required INTEGER DEFAULT 0,
  components_ready INTEGER DEFAULT 0,
  components_status JSONB DEFAULT '[]', -- Array of component readiness
  
  -- Assignment
  assigned_to UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  
  -- Timing
  due_date TIMESTAMPTZ,
  estimated_completion_time_minutes INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  actual_completion_time_minutes INTEGER,
  
  -- Status tracking
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'in_progress', 'blocked', 'on_hold', 'quality_check', 'completed', 'cancelled')),
  blocked_reason TEXT,
  on_hold_reason TEXT,
  
  -- Work queue integration
  work_queue_id UUID REFERENCES work_queue(id) ON DELETE SET NULL,
  
  -- Quality and notes
  quality_check_required BOOLEAN DEFAULT false,
  quality_check_completed BOOLEAN DEFAULT false,
  quality_checked_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  quality_checked_at TIMESTAMPTZ,
  quality_notes TEXT,
  
  -- Task data and results
  task_data JSONB DEFAULT '{}', -- Flexible storage for task-specific data
  result_data JSONB DEFAULT '{}', -- Task completion results
  notes TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  
  -- Constraints
  CHECK (quantity_completed <= quantity_to_assemble),
  CHECK (components_ready <= components_required),
  CHECK (position_in_column >= 0)
);

-- ============================================================================
-- KIT KANBAN TASK HISTORY TABLE
-- ============================================================================
-- Tracks all movements and changes to tasks
CREATE TABLE IF NOT EXISTS kit_kanban_task_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Task reference
  task_id UUID NOT NULL REFERENCES kit_kanban_tasks(id) ON DELETE CASCADE,
  
  -- Change tracking
  action VARCHAR(50) NOT NULL, -- 'created', 'moved', 'assigned', 'updated', 'completed', 'cancelled'
  from_column_id UUID REFERENCES kit_kanban_columns(id) ON DELETE SET NULL,
  to_column_id UUID REFERENCES kit_kanban_columns(id) ON DELETE SET NULL,
  
  -- Before and after state
  previous_state JSONB, -- Snapshot of relevant fields before change
  new_state JSONB, -- Snapshot of relevant fields after change
  
  -- Who and when
  changed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ DEFAULT now(),
  
  -- Additional context
  change_reason TEXT,
  notes TEXT
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Kit Definitions indexes
CREATE INDEX idx_kit_definitions_organization ON kit_definitions(organization_id);
CREATE INDEX idx_kit_definitions_kit_number ON kit_definitions(kit_number);
CREATE INDEX idx_kit_definitions_status ON kit_definitions(status);
CREATE INDEX idx_kit_definitions_kit_type ON kit_definitions(kit_type);

-- Kanban Columns indexes
CREATE INDEX idx_kit_kanban_columns_organization ON kit_kanban_columns(organization_id);
CREATE INDEX idx_kit_kanban_columns_sort_order ON kit_kanban_columns(organization_id, sort_order);
CREATE INDEX idx_kit_kanban_columns_active ON kit_kanban_columns(organization_id, is_active);

-- Kanban Tasks indexes
CREATE INDEX idx_kit_kanban_tasks_organization ON kit_kanban_tasks(organization_id);
CREATE INDEX idx_kit_kanban_tasks_column ON kit_kanban_tasks(column_id, position_in_column);
CREATE INDEX idx_kit_kanban_tasks_assigned ON kit_kanban_tasks(assigned_to, status);
CREATE INDEX idx_kit_kanban_tasks_status ON kit_kanban_tasks(status);
CREATE INDEX idx_kit_kanban_tasks_priority ON kit_kanban_tasks(priority);
CREATE INDEX idx_kit_kanban_tasks_due_date ON kit_kanban_tasks(due_date);
CREATE INDEX idx_kit_kanban_tasks_kit_definition ON kit_kanban_tasks(kit_definition_id);
CREATE INDEX idx_kit_kanban_tasks_work_queue ON kit_kanban_tasks(work_queue_id);

-- Task History indexes
CREATE INDEX idx_kit_kanban_task_history_task ON kit_kanban_task_history(task_id, changed_at DESC);
CREATE INDEX idx_kit_kanban_task_history_organization ON kit_kanban_task_history(organization_id);
CREATE INDEX idx_kit_kanban_task_history_changed_by ON kit_kanban_task_history(changed_by);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE kit_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kit_kanban_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE kit_kanban_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE kit_kanban_task_history ENABLE ROW LEVEL SECURITY;

-- Kit Definitions Policies
CREATE POLICY "Users can view kit definitions from their organization"
  ON kit_definitions FOR SELECT
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert kit definitions to their organization"
  ON kit_definitions FOR INSERT
  WITH CHECK (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update kit definitions in their organization"
  ON kit_definitions FOR UPDATE
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- Kanban Columns Policies
CREATE POLICY "Users can view kanban columns from their organization"
  ON kit_kanban_columns FOR SELECT
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage kanban columns"
  ON kit_kanban_columns FOR ALL
  USING (
    organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'superadmin')
    )
  );

-- Kanban Tasks Policies
CREATE POLICY "Users can view kanban tasks from their organization"
  ON kit_kanban_tasks FOR SELECT
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can create kanban tasks in their organization"
  ON kit_kanban_tasks FOR INSERT
  WITH CHECK (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update kanban tasks in their organization"
  ON kit_kanban_tasks FOR UPDATE
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete kanban tasks in their organization"
  ON kit_kanban_tasks FOR DELETE
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- Task History Policies
CREATE POLICY "Users can view task history from their organization"
  ON kit_kanban_task_history FOR SELECT
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert task history in their organization"
  ON kit_kanban_task_history FOR INSERT
  WITH CHECK (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- ============================================================================
-- FUNCTIONS AND TRIGGERS
-- ============================================================================

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_kit_kanban_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER kit_definitions_updated_at
  BEFORE UPDATE ON kit_definitions
  FOR EACH ROW
  EXECUTE FUNCTION update_kit_kanban_updated_at();

CREATE TRIGGER kit_kanban_columns_updated_at
  BEFORE UPDATE ON kit_kanban_columns
  FOR EACH ROW
  EXECUTE FUNCTION update_kit_kanban_updated_at();

CREATE TRIGGER kit_kanban_tasks_updated_at
  BEFORE UPDATE ON kit_kanban_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_kit_kanban_updated_at();

-- Function to automatically log task movements
CREATE OR REPLACE FUNCTION log_kit_kanban_task_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log if column changed or status changed
  IF (TG_OP = 'UPDATE' AND (OLD.column_id != NEW.column_id OR OLD.status != NEW.status)) THEN
    INSERT INTO kit_kanban_task_history (
      organization_id,
      task_id,
      action,
      from_column_id,
      to_column_id,
      previous_state,
      new_state,
      changed_by
    ) VALUES (
      NEW.organization_id,
      NEW.id,
      CASE 
        WHEN OLD.column_id != NEW.column_id THEN 'moved'
        WHEN OLD.status != NEW.status THEN 'updated'
        ELSE 'updated'
      END,
      OLD.column_id,
      NEW.column_id,
      jsonb_build_object(
        'status', OLD.status,
        'assigned_to', OLD.assigned_to,
        'priority', OLD.priority,
        'components_ready', OLD.components_ready
      ),
      jsonb_build_object(
        'status', NEW.status,
        'assigned_to', NEW.assigned_to,
        'priority', NEW.priority,
        'components_ready', NEW.components_ready
      ),
      NEW.updated_by
    );
  ELSIF (TG_OP = 'INSERT') THEN
    INSERT INTO kit_kanban_task_history (
      organization_id,
      task_id,
      action,
      to_column_id,
      new_state,
      changed_by
    ) VALUES (
      NEW.organization_id,
      NEW.id,
      'created',
      NEW.column_id,
      jsonb_build_object(
        'status', NEW.status,
        'assigned_to', NEW.assigned_to,
        'priority', NEW.priority
      ),
      NEW.created_by
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for task change logging
CREATE TRIGGER kit_kanban_tasks_change_log
  AFTER INSERT OR UPDATE ON kit_kanban_tasks
  FOR EACH ROW
  EXECUTE FUNCTION log_kit_kanban_task_change();

-- ============================================================================
-- SEED DEFAULT KANBAN COLUMNS
-- ============================================================================
-- Insert default kanban columns for each organization
-- Note: This will be organization-specific; adjust as needed

DO $$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM organizations LOOP
    -- Only insert if columns don't already exist for this organization
    IF NOT EXISTS (SELECT 1 FROM kit_kanban_columns WHERE organization_id = org_record.id) THEN
      INSERT INTO kit_kanban_columns (organization_id, column_name, column_display_name, column_description, column_color, sort_order, is_start_column) 
      VALUES (org_record.id, 'planning', 'Planning', 'Kits in planning stage', '#6B7280', 1, true);
      
      INSERT INTO kit_kanban_columns (organization_id, column_name, column_display_name, column_description, column_color, sort_order) 
      VALUES (org_record.id, 'in_progress', 'In Progress', 'Kits currently being assembled', '#F59E0B', 2);
      
      INSERT INTO kit_kanban_columns (organization_id, column_name, column_display_name, column_description, column_color, sort_order, requires_quality_check) 
      VALUES (org_record.id, 'quality_check', 'Quality Check', 'Kits awaiting quality inspection', '#3B82F6', 3, true);
      
      INSERT INTO kit_kanban_columns (organization_id, column_name, column_display_name, column_description, column_color, sort_order, is_end_column) 
      VALUES (org_record.id, 'completed', 'Completed', 'Completed and approved kits', '#10B981', 4, true);
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE kit_definitions IS 'Master kit definitions including bill of materials and assembly instructions';
COMMENT ON TABLE kit_kanban_columns IS 'Configurable kanban board columns/stages for kit assembly workflow';
COMMENT ON TABLE kit_kanban_tasks IS 'Individual kit assembly tasks tracked in the kanban board';
COMMENT ON TABLE kit_kanban_task_history IS 'Complete audit trail of all task movements and changes';

COMMENT ON COLUMN kit_definitions.required_components IS 'JSONB array of component objects with material_number, quantity, description';
COMMENT ON COLUMN kit_kanban_tasks.components_status IS 'JSONB array tracking individual component readiness';
COMMENT ON COLUMN kit_kanban_tasks.work_queue_id IS 'Optional link to work_queue for integration with task assignment system';

