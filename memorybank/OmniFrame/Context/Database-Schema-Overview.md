---
tags: [type/context, status/active, domain/database]
created: 2026-04-10
---
# Database Schema Overview

Comprehensive overview of the OmniFrame database schema, hosted on **Supabase (PostgreSQL)**. The schema has grown through 213+ sequential migrations from a small RBAC core into a full warehouse management system.

## Core Architecture

- **Multi-tenant**: Every operational table includes `organization_id UUID NOT NULL REFERENCES organizations(id)`
- **Auth integration**: User identity via Supabase Auth (`auth.users`), extended by `user_profiles`
- **Row Level Security (RLS)**: Enabled on every table — org-scoped access is enforced at the database level
- **UUID primary keys**: All tables use `UUID PRIMARY KEY DEFAULT gen_random_uuid()` or `uuid_generate_v4()`
- **Soft-delete pattern**: `user_profiles` uses `deleted_at` column; most operational tables do not soft-delete
- **Timestamping**: `created_at TIMESTAMPTZ DEFAULT now()` and `updated_at TIMESTAMPTZ DEFAULT now()` on all tables, with `BEFORE UPDATE` triggers to auto-set `updated_at`

---

## Table Domains

### 1. Identity & Organization

| Table | Purpose |
|-------|--------|
| `organizations` | Multi-tenant org container. Has `slug`, `name`, `default_role_id` |
| `user_profiles` | Extends `auth.users`. Stores `email`, `username`, `first_name`, `last_name`, `status`, `role_id`, `organization_id`, `email_verified`, `two_factor_enabled`, `last_seen`, `full_name`, `deleted_at` |

### 2. RBAC & Permissions

| Table | Purpose |
|-------|--------|
| `roles` | Table-based roles with hierarchy. Columns: `name`, `display_name`, `description`, `parent_role_id`, `priority`, `max_users`, `features JSONB`, `metadata JSONB`, `is_system`, `is_active`. System roles: superadmin, admin, manager, cashier, viewer |
| `permissions` | Fine-grained permissions with `resource`, `action`, `name`, `description`, `is_active`, `category_id`, `is_critical`, `requires_2fa`, `risk_level` (low/medium/high/critical), `scope` (application/system/organization/user), `metadata JSONB` |
| `role_permissions` | Maps roles to permissions (many-to-many) |
| `user_permissions` | Direct user-level permission overrides with `granted`, `expires_at`, `metadata JSONB` |
| `permission_categories` | Groups permissions for UI (user_management, role_management, content_management, etc.) |
| `permission_dependencies` | Defines requires/implies/conflicts/suggests relationships between permissions |
| `permission_tags` / `permission_tag_assignments` | Flexible tagging system for permissions (high-risk, destructive, admin-only, etc.) |
| `role_navigation_permissions` | Controls which navigation items are visible per role |
| `navigation_items` | Defines app navigation structure |
| `tab_definitions` | Page-level tab definitions with `page_resource`, `tab_id`, `tab_label`, `display_order` |
| `role_tab_permissions` | Maps roles to tab access (granted boolean per tab per role) |
| `conditional_permissions` | Dynamic permission rules (migration 031) |

### 3. Audit & Session Security

| Table | Purpose |
|-------|--------|
| `audit_logs` | General audit trail. Uses `audit_action` enum. Logs resource CRUD operations |
| `rbac_audit_logs` | Detailed RBAC change tracking: `actor_id`, `action`, `target_type`, `target_id`, `old_value JSONB`, `new_value JSONB`, `changes JSONB`, `severity`, `ip_address INET` |
| `permission_usage_logs` | Tracks every permission check: `user_id`, `permission_id`, `resource`, `action`, `granted`, `check_method`, `response_time_ms` |
| `enhanced_user_sessions` | Session tracking: `session_token_hash`, `ip_address`, `device_fingerprint`, `login_method`, `mfa_verified`, `expires_at`, `revoked_at` |
| `user_sessions` / `active_sessions` | Simpler session tracking tables |
| `failed_auth_attempts` | Tracks failed logins by `email`, `ip_address`, `attempt_type`, `failure_reason` |
| `permission_cache_events` | Cache invalidation tracking |

### 4. Security Monitoring

| Table | Purpose |
|-------|--------|
| `security_events` | Threat events: `login_anomaly`, `permission_escalation`, `data_access`, `failed_login`, `suspicious_activity` |
| `threat_indicators` | Known threat patterns |
| `compliance_reports` | GDPR/SOX/HIPAA compliance reports |
| `data_processing_activities` | Data processing audit trail |
| `session_restrictions` | Per-user session restrictions (ip_whitelist, geo_restriction, device_limit, time_restriction) |

### 5. Inbound / Receiving

| Table | Purpose |
|-------|--------|
| `rr_inbound_scans` | RF barcode scans for inbound receiving. Fields: `barcode`, `scanned_at`, `scanned_by`, `scan_location`, `notes`, `organization_id` |
| `deliveries` | Delivery tracking with `is_deleted`, `dispositions`, SAP delivery data |
| `putback_tickets` | Excess quantity returns: `putback_number` (Putback-00001), `material_number`, `quantity_returned`, `status` (open/completed/cancelled) |
| `inbound_cart_*` | Cart-based stow/putaway tracking tables |

### 6. Outbound / Shipping

| Table | Purpose |
|-------|--------|
| Outbound tables | Shipping and transfer order data (migration 002+, enhanced through 047-101) |
| `sap_transaction_logs` | Logs SAP GUI transactions (VL02N Post Goods Issue) triggered from OneBox. Fields: `delivery_id`, `transaction_code`, `action`, `status` (success/error/skipped/pending), `sap_message` |

### 7. Kitting / Assembly

| Table | Purpose |
|-------|--------|
| `kit_definitions` | Master kit definitions: `kit_number`, `kit_name`, `kit_type`, `kit_category`, `required_components JSONB`, `assembly_instructions`, `estimated_assembly_time_minutes`, `status` (draft/active/obsolete/archived) |
| `kit_kanban_columns` | Configurable kanban stages: `column_name`, `sort_order`, `max_tasks_limit`, `requires_quality_check`. Defaults: Planning, In Progress, Quality Check, Completed |
| `kit_kanban_tasks` | Individual assembly tasks: `task_number`, `kit_definition_id`, `column_id`, `priority`, `quantity_to_assemble`, `components_status JSONB`, `assigned_to`, `work_queue_id`, `quality_check_required` |
| `kit_kanban_task_history` | Full audit trail of task movements and changes |
| `kitting_dropdown_options` | Configurable dropdown values for kitting forms (migration 211) |

### 8. Cycle Count / Inventory

| Table | Purpose |
|-------|--------|
| `rr_cyclecount_data` | Core cycle count table: `count_number` (CC-YYYYMMDD-XXXX), `material_number`, `location`, `warehouse`, `system_quantity`, `counted_quantity`, `variance_quantity`, `status` (pending/in_progress/completed/variance_review/approved/cancelled), `requires_recount`, `approved_by`, `serial_numbers TEXT[]`, `resolved_location_key`, `resolved_zone`, `resolved_aisle`, `resolved_sequence`, `warehouse_location_mapping_id` |
| `cycle_count_location_resolution_rules` | Regex-based rules to normalize raw location strings into canonical bin keys, zone, aisle, sequence |
| `cycle_count_path_rules` | Path strategies for ordering cycle count tasks: `serpentine_zone`, `directional`, `alternating_aisles` |
| `cycle_count_operator_deferred_counts` | Per-operator skip/defer queue for deferred counts |
| `recount_history` | Recount tracking (migration 044) |

### 9. Work Queue System

| Table | Purpose |
|-------|--------|
| `work_queue_config` | Per-org queue settings: `assignment_strategy` (round_robin/load_balanced/skill_based/priority_based), `max_tasks_per_worker`, `task_timeout_minutes`, priority weights |
| `task_types` | Registry of task types (CYCLE_COUNT, PUTAWAY, PICKING) with skill requirements and time estimates |
| `worker_profiles` | Extended worker data: `skills JSONB`, `certifications JSONB`, `max_concurrent_tasks`, `accuracy_rate`, `productivity_score`, `current_zone` |
| `work_queue` | Main task queue: `task_type`, `priority` (0-100), `status`, `assigned_to`, `location`, `zone`, `material_number`, `depends_on UUID[]`, `blocks UUID[]`, `complexity_score` |
| `task_assignment_history` | Full assignment tracking |
| `worker_performance_metrics` | Daily performance metrics per worker |
| `queue_rules` | Rules engine for assignment, priority, escalation, notification |

### 10. SAP Integration (LX03)

| Table | Purpose |
|-------|--------|
| `rr_lx03_data` | SAP warehouse bin data: `storage_bin`, `warehouse`, `material`, `total_stock`. Used for empty bin functions and inventory analytics |

### 11. Warehouse Map

| Table | Purpose |
|-------|--------|
| `warehouse_map_settings` | Per-org feature flags: `enabled`, `read_only_mode`, `live_updates_enabled`, `fallback_mode` |
| `warehouse_maps` | Top-level maps per warehouse_code: `scale_factor`, `grid_settings JSONB`, `canvas_settings JSONB`, `building_outline JSONB`, `active_revision_id` |
| `warehouse_map_revisions` | Versioned snapshots for publish/rollback: `version_number`, `status` (draft/published/archived/rolled_back), `snapshot_json` |
| `warehouse_map_background_assets` | Uploaded floor-plan images |
| `warehouse_zones` | Polygonal zones on the map: `zone_type`, `polygon JSONB`, `color`, `floor_level` |
| `warehouse_racks` | Rack/shelving units: `position_x`, `position_y`, `rotation`, `width`, `height`, `rows`, `columns`, `aisle` |
| `warehouse_location_mappings` | Links SAP storage bins to rack cells: `storage_bin`, `rack_row`, `rack_column`, `operational_status` (active/maintenance/shutdown/reserved/blocked) |
| `warehouse_location_status_log` | Status change audit trail |
| `warehouse_auto_map_runs` | Auto-map job runs that propose bin-to-rack assignments |

### 12. Mobile Device Management (MDM)

| Table | Purpose |
|-------|--------|
| `mdm_devices` | Apple device registry: `serial_number`, `udid`, `model`, `os_version`, `supervised`, `dep_enrolled`, `enrollment_type`, `assigned_user_id`, `battery_level`, `health_score`, `status` (Online/Offline/Pending/Lost/Wiped/Retired) |
| `mdm_device_groups` | Static and smart device groups with `smart_filter JSONB`, supports parent groups |
| `mdm_group_memberships` | Many-to-many device and group |
| `mdm_commands` | MDM command dispatch (migration 190) |
| `mdm_events` | MDM event log (migration 190) |
| `mdm_profiles` | MDM profile management (migration 192) |
| `mdm_apps` | App management (migration 192) |
| `mdm_compliance_*` | Device compliance tracking (migration 192) |
| `mdm_workflows` / `mdm_incidents` | Workflow and incident management (migration 193) |

### 13. Other Feature Tables

| Table | Purpose |
|-------|--------|
| `shift_schedules` | Shift management with multiple breaks (migration 081) |
| `overtime_*` | Overtime management and tracking (migration 086) |
| `standard_work_checklists` | Standard work checklist system (migration 094) |
| `device_registrations` | Device registration for RF terminals (migration 058) |
| `drone_scans` | Drone scan system (migration 102) |
| `hot_part_alerts` | Hot part alert system (migration 172) |
| `time_adjustment_requests` | Time adjustment workflow (migrations 176-180) |
| `organizational_tree` | Organizational hierarchy with area supervisors |

---

## Key Relationships Diagram (Simplified)

```
organizations (1) ---+--- (*) user_profiles --- (1) roles
                     +--- (*) all operational tables
                     +--- (*) work_queue
                     +--- (*) kit_definitions
                     +--- (*) rr_cyclecount_data
                     +--- (*) warehouse_maps
                     +--- (*) mdm_devices

roles (1) ---+--- (*) role_permissions --- (*) permissions
             +--- (*) role_tab_permissions --- (*) tab_definitions
             +--- (*) role_navigation_permissions --- (*) navigation_items

warehouse_maps (1) ---+--- (*) warehouse_zones
                      +--- (*) warehouse_racks --- (*) warehouse_location_mappings
                      +--- (*) warehouse_map_revisions

kit_definitions (1) --- (*) kit_kanban_tasks --- (1) kit_kanban_columns
```

## Related
- [[Supabase-Configuration]]
- [[Migration-History]]
- [[Database-Patterns]]
- [[ADR-Auth-Architecture]]
- [[SingletonAuthManager - Authentication Core]]
- [[AuthService - Unified Authentication]]