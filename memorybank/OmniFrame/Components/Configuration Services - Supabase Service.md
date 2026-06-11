---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# Configuration Services (Workflow, Worker, Area, Position Options)

## Purpose
Grouped configuration services for organizational settings:
1. **WorkflowConfigService** — CRUD for cycle count workflow configurations with versioning and step management.
2. **WorkerManagementService** — Worker capacity and availability tracking (currently simplified/simulated).
3. **AreaOptionsService** — Configurable area types and department options per organization.
4. **PositionOptionsService** — Configurable position types and levels per organization.

## Patterns
- `WorkflowConfigService` — Singleton via `getInstance()`. Exported as `workflowConfigService`.
- `WorkerManagementService` — Class instance. Exported as `workerManagementService`.
- `AreaOptionsService` — Singleton via `getInstance()`. Exported as `areaOptionsService`.
- `PositionOptionsService` — Singleton via `getInstance()`. Exported as `positionOptionsService`.

---

## WorkflowConfigService

### Key Functions
- `fetchConfigs()` — Fetch all workflow configs for org.
- `getConfigForCountType(countType)` — Single config by count type.
- `upsertConfig(config)` — Upsert with auto-incrementing version.
- `resetToDefault(countType)` — Delete config so seed recreates it.
- `getSnapshotForTask(countType)` — Returns `WorkflowConfigSnapshot` with config_id, version, steps, and review thresholds for stamping onto count rows.

### Workflow Step Types
`confirm`, `location_scan`, `quantity_entry`, `empty_location_verification`, `photo_capture`, `serial_number`, `barcode_label_scan`, `condition_assessment`, `notes`, `review`, `supervisor_signoff`

### Database Table
- **`cycle_count_workflow_configs`** — Columns: organization_id, count_type, version, display_name, description, is_active, steps (JSONB), updated_by. Unique on `organization_id,count_type`.

---

## WorkerManagementService

### Key Functions
- `getWorkerCapacity(workerId?)` — Returns simulated capacity data (current_tasks, max_concurrent_tasks, utilization_percentage).
- `getWorkerProfile()` — Returns simulated worker profile.
- `getAvailableWorkers()` — Returns empty array (placeholder).

*Note: This service is simplified/stubbed to prevent build errors while database types are being updated. Returns simulated data.*

---

## AreaOptionsService

### Key Functions
- `getAreaTypes(orgId)` / `getActiveAreaTypes(orgId)` — Fetch area types.
- `createAreaType(typeData)` / `updateAreaType(id, updates)` / `deleteAreaType(id)` — CRUD.
- `reorderAreaTypes(orgId, orderedIds)` — Update display_order sequentially.
- `getDepartments(orgId)` / `getActiveDepartments(orgId)` — Fetch departments.
- `createDepartment(deptData)` / `updateDepartment(id, updates)` / `deleteDepartment(id)` — CRUD.
- `reorderDepartments(orgId, orderedIds)` — Update display_order.
- `seedDefaults(orgId)` — RPC `seed_area_and_department_options`.

### Database Tables
- **`area_type_options`** — Columns: type_value, type_label, description, display_order, is_active, color_code, icon_name, organization_id, created_by.
- **`department_options`** — Columns: department_value, department_label, description, display_order, is_active, color_code, icon_name, organization_id, created_by.

---

## PositionOptionsService

### Key Functions
- `getPositionTypes(orgId)` / `getActivePositionTypes(orgId)` — Fetch position types.
- `createPositionType(typeData)` / `updatePositionType(id, updates)` / `deletePositionType(id)` — CRUD.
- `reorderPositionTypes(orgId, orderedIds)` — Update display_order.
- `getPositionLevels(orgId)` / `getActivePositionLevels(orgId)` — Fetch position levels.
- `createPositionLevel(levelData)` / `updatePositionLevel(id, updates)` / `deletePositionLevel(id)` — CRUD.
- `reorderPositionLevels(orgId, orderedIds)` — Update display_order.
- `seedDefaults(orgId)` — RPC `seed_position_options`.

### Database Tables
- **`position_type_options`** — Columns: type_value, type_label, description, display_order, is_active, color_code, icon_name, organization_id, created_by.
- **`position_level_options`** — Columns: level_value, level_label, description, display_order, is_active, color_code, organization_id, created_by.

## RPC Functions
- `seed_area_and_department_options(p_organization_id)` — Seed defaults for areas/departments.
- `seed_position_options(p_organization_id)` — Seed defaults for positions.

## Dependencies
- `./client` (supabase)
- `@/lib/utils/logger`

## Related
- [[Architecture]] — System overview
- [[Supabase Client Infrastructure - Supabase Service]] — Client dependency
- [[PutawayLogService - Supabase Service]] — Workflow configs used in cycle counts


## 2026-04-19 — New Workflow creation UI
- `src/components/count-settings.tsx` now exposes a "+ New" button that calls `WorkflowConfigService.upsertConfig` to insert a config for any `count_type_enum` value without an existing row. See [[Add-New-Count-Workflow-Button]]. New enum values still require a DB migration before they appear in the UI picker.


## 2026-04-19 — Enum removed; count_type is TEXT
- Migration 217 converted `count_type` on both `rr_cyclecount_data` and `cycle_count_workflow_configs` to `TEXT` with a slug-shaped CHECK constraint. `count_type_enum` is dropped.
- `get_count_type_display_name(TEXT)` now resolves via workflow_configs → built-in labels → prettified slug, with `SET search_path = public, pg_temp`.
- Frontend: [[Add-New-Count-Workflow-Button]], [[ADR-Count-Type-Enum-To-Text]].
- New shared hook: `src/hooks/use-count-type-options.ts` (`useCountTypeOptions`, `resolveCountTypeLabel`, `BUILT_IN_COUNT_TYPE_OPTIONS`). Replaces local `COUNT_TYPE_OPTIONS` constants in `manual-counts-search.tsx` and `add-counts-from-lx03-modal.tsx`.


## 2026-04-19 — RF counter now consumes workflow snapshots
Migration 218 adds `trigger_stamp_workflow` on `rr_cyclecount_data` BEFORE INSERT. It populates `workflow_config_id`, `workflow_config_version`, `workflow_snapshot`, `review_threshold_pct`, `review_threshold_abs` from the matching active `cycle_count_workflow_configs` row when the caller doesn't pass them. `workflowConfigService.getSnapshotForTask()` — previously dead code — is now the live-lookup fallback consumed by the new `useTaskWorkflow` hook. See [[Wire-Cycle-Count-Workflow-To-RF-Counter]] and [[ADR-Workflow-Snapshot-Stamping-Strategy]].


## 2026-04-19 (update) — Rust passthrough + extra-step routing
The Rust work service now returns `workflow_config_id`, `workflow_config_version`, `workflow_snapshot`, `workflow_result`, `evidence_photo_urls`, `review_threshold_pct`, `review_threshold_abs` as part of every `CycleCountTask`. `useTaskWorkflow` uses this synchronously — the secondary Supabase query is now a fallback only. `src/hooks/use-extra-workflow-steps.ts` drives `barcode_label_scan` / `serial_number` / `condition_assessment` / `notes` steps in the RF unified component, persisting per-step results to `rr_cyclecount_data.workflow_result`. See [[Wire-Extra-Workflow-Steps-And-Rust-Passthrough]].


## 2026-04-19 (closeout) — Multi-photo, draft hydration, dead code cleanup
`src/lib/supabase/cycle-count-photos.service.ts` gained `uploadCycleCountEvidencePhotos` (batch, atomic merge into `evidence_photo_urls`). `src/hooks/use-extra-workflow-steps.ts` now accepts `initialResults` so resumed counts skip completed extras. Draft persistence restores sub-step position. `serial_number` results also mirror into the existing `rr_cyclecount_data.serial_numbers` column. Deleted unused `rf-cycle-count-out-form.tsx`. All 11 `WorkflowStepType` values are now wired in the RF UI. See [[Close-Out-RF-Workflow-Future-Work]].


## 2026-04-19 — Part Number Verification step
New workflow step type `part_number_verification` added. Migration 219 introduces `scanned_material_number`, `location_reported_empty`, and a STORED generated `part_variance` column on `rr_cyclecount_data`. RF step component lives at `src/components/ui/rf-steps/rf-step-part-number-verification.tsx` with scan / QWERTY manual entry / location-empty paths. Dashboard shows Part Check badge (match / variance / empty / unverified) with column filter. See [[Part-Number-Verification-Workflow-Step]].


## 2026-04-19 (v2) — Part Verification multi-part + short-circuit
Migration 220 adds `scanned_parts JSONB` with `jsonb_typeof = 'array'` CHECK constraint. The step now completes the task on match/variance/empty (no separate `quantity_entry` required); quantity is captured per-found-part inside the step itself. Dashboard badge simplified to show just the found part number. See [[Part-Number-Verification-Workflow-Step]].


## 2026-04-19 — Found Part Transfer workflow
New count type `found_part_transfer` + step type of the same name. Migration 222 adds `transfer_source_location` + `transfer_source_quantity` to `rr_cyclecount_data`. `counted_quantity` stores the final consolidated count at the destination. Seeded workflow config for every org: `[confirm, location_scan, found_part_transfer, notes]`. See [[Found-Part-Transfer-Workflow]].
