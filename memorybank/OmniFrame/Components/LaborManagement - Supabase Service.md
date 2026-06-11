---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# Labor Management Service

## Purpose
Comprehensive service for managing the organizational structure that underpins shift productivity: working areas, shift positions (with hierarchy), shift assignments, organizational hierarchy relationships, shift schedules (with break configurations), and labor standards. This is the foundational configuration layer consumed by the Team Performance Service.

## Key Functions

### LaborManagementService (singleton class)

#### Working Areas
- `getWorkingAreas(orgId)` / `createWorkingArea(area)` / `updateWorkingArea(id, updates)` / `deleteWorkingArea(id)`
- `getWorkingAreaStatistics(orgId)` → calls RPC `get_working_area_statistics`

#### Shift Positions
- `getShiftPositions(orgId)` / `createShiftPosition(pos)` / `updateShiftPosition(id, updates)` / `deleteShiftPosition(id)`
- `getPositionHierarchy(orgId)` → calls RPC `get_position_hierarchy`
- `getPositionStatistics(orgId)` → calls RPC `get_position_statistics`

#### Shift Assignments
- `getShiftAssignments(orgId)` → assignments with joined user, position, area, supervisor, team lead names
- `createShiftAssignment(assignment)` / `updateShiftAssignment(id, updates)` / `deleteShiftAssignment(id)`
- `getUserCurrentPosition(userId)` → calls RPC `get_user_current_position`
- `getActiveAssociates(orgId)` → active primary position assignments with full detail
- `getAssignmentsByDepartment(orgId)` / `getAssignmentsByArea(orgId)` → grouped maps
- `reassignAssociateToArea(userId, orgId, newAreaId, expectedUpdatedAt, reassignedBy, reason?)` → RPC with optimistic locking, capacity validation, audit logging

#### Organizational Hierarchy
- `getOrganizationalTree(orgId, rootUserId?)` → RPC `get_organizational_tree`
- `createHierarchyRelationship(hierarchy)` / `updateHierarchyRelationship(id, updates)` / `deleteHierarchyRelationship(id)`

#### Shift Schedules
- `getShiftSchedules(orgId)` / `createShiftSchedule(schedule)` / `updateShiftSchedule(id, updates)` / `deleteShiftSchedule(id)`

#### Labor Standards
- `getLaborStandards(orgId)` / `createLaborStandard(standard)` / `updateLaborStandard(id, updates)` / `deleteLaborStandard(id)`
- `getLaborStandardsByTaskType(orgId, taskType)` / `getActiveLaborStandardsWithDetails(orgId)`

#### Bulk & Search
- `bulkCreatePositions(positions)` / `bulkCreateAssignments(assignments)`
- `searchUsers(orgId, searchTerm)` / `getAvailableUsers(orgId)` / `getDistinctDepartments(orgId)`

## Database Tables
- `working_areas` — warehouse areas (area_code, area_name, area_type, capacity, certifications, operating hours)
- `shift_positions` — position definitions (title, type, level, department, skills, pay_grade, is_supervisory)
- `shift_assignments` — user-to-position-to-area mappings (shift_pattern, schedule_id, supervisor, team_lead)
- `organizational_hierarchy` — supervisor/subordinate relationships (relationship_type, level_difference)
- `shift_schedules` — shift timing definitions (start/end time, breaks[] array, operating_days, headcount)
- `labor_standards` — task-type targets (standard_type, task_type, target_value, unit_of_measure, thresholds)
- `user_profiles` — user info for search and display

## Database RPCs
- `get_working_area_statistics(p_organization_id)`
- `get_position_hierarchy(p_organization_id)` / `get_position_statistics(p_organization_id)`
- `get_user_current_position(p_user_id)`
- `get_organizational_tree(p_organization_id, p_root_user_id)`
- `reassign_associate_to_area(p_user_id, p_organization_id, p_new_area_id, p_expected_updated_at, p_reassigned_by, p_reason)`

## Key Interfaces
- `WorkingArea` — area with capacity, certifications, operating hours
- `ShiftPosition` — position with hierarchy, skills, department
- `ShiftAssignment` / `ShiftAssignmentWithDetails` — user assignment with joined names
- `OrganizationalHierarchy` — supervisor relationship with delegation authority
- `ShiftSchedule` — schedule with breaks array (`BreakPeriod[]`)
- `LaborStandard` — productivity target with thresholds

## Related
- [[Architecture]]
- [[TeamPerformance - Supabase Service]]
- [[ProductivityAndSettings - Supabase Service]]
- [[StandardWorkAndOperations - Supabase Service]]