---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# Kitting Services

## Purpose
A suite of services that power the full kit build lifecycle: definition management, kit chain grouping, kanban board visualization, RF-based picking operations, expedite request management, and configurable dropdown options. These services collaborate to track kits from planning through picking, kitting, inspection, and dock readiness.

## Services

### RRKittingDataService (`rr-kitting-data.service.ts`)
**The core kit build plan data manager** — a ~4100-line service handling CRUD operations on the `RR_Kitting_DATA` table.

Key areas:
- Kit build plan record management (create, read, update, delete)
- Transfer order line tracking (picked, kitted, inspected, on-dock timestamps)
- Kit priority management with change tracking
- Kit flag system (purple/orange/red/black hat flags via `kit_build_flags` table)
- Kit serial number and build number management
- Excel import integration for transfer order data
- Status lifecycle: `pending` → `printed` → `in_progress` → `completed`
- Integration with `KitKanbanService.syncKitProgressFromData()` for board sync
- BOM coverage automation (`recheckBomCoverage`) honoring `material`, `incora_sub_kit`, and `incora_component` types
- **Expedite line management** (`addExpediteToKit`) — single-line expedite added to existing kit or as stand-alone plan; uses new `part_expedite_delivery_time` column (`critical | 24_hour | 2_day`)

### KitDefinitionsService (`kit-definitions.service.ts`)
**Kit BOM master data**.
- `BomComponentType = 'material' | 'incora_sub_kit' | 'incora_component'` (INCORA Component is a hybrid row with both an optional material # and an INCORA reference).
- `KitDefinitionRecord` includes `chain_id` + `chain_sequence_order` for kit-chain membership.
- Methods: `list`, `listActive`, `getById`, `create`, `update`, `archive`, `activate`, `subscribeToChanges` over `kit_definitions`.
- BOM is stored as JSONB in `kit_definitions.required_components`; `validateBom` enforces uniqueness and per-row required fields per component type.

### KitDefinitionChainsService (`kit-definition-chains.service.ts`)
**Kit chains — groupings of kit definitions** built in order or shipped together.
- `KitDefinitionChainRecord` over `kit_definition_chains` (org-scoped, `chain_name` UNIQUE per org, `link_type` in `build_order|ship_together|custom`, `status` in `active|archived`).
- `KIT_CHAIN_LINK_TYPES` constant for UI dropdowns.
- Methods: `list`, `listActive`, `create`, `update`, `archive`, `activate`, `delete`, `subscribeToChanges`.
- A kit definition belongs to at most one chain (1:N) via `kit_definitions.chain_id` + `chain_sequence_order`.

### KitKanbanService (`kit-kanban.service.ts`)
**Kanban board management** for kit build workflow visualization.

Static class methods:
- `ensureDefaultColumns()` → creates 4 default columns: Planning, In Progress, Quality Check, Completed
- `getColumns()` / `getTasks()` / `getTasksByColumn()` → board data retrieval
- `createTask(input)` → creates kanban card from kit build plan
- `moveTask(taskId, targetColumnId, newPosition)` → drag-and-drop column moves
- `updateTaskProgress(taskId, updates)` → picked/kitted line counts, current step, worker info
- `updateTaskPriority(kitBuildPlanId, newPriority)` / `updateTaskPriorityBySerialNumber(serial, priority)`
- `startKit(taskId)` → moves task to In Progress, sets step to 'picking'
- `syncKitProgressFromData(kitPoNumber)` → reconciles kanban card with `RR_Kitting_DATA` actual progress
- `createMissingKanbanTasks()` → backfill utility for existing kit plans without kanban cards
- `syncAllInProgressTasks()` → batch reconciliation on board load
- `subscribeToChanges(callback)` → Supabase realtime subscription with delta payloads
- Black Hat flag batch-fetch for visual indicators on kanban cards

### RFKittingPickingService (`rf-kitting-picking.service.ts`)
**RF terminal picking workflow** for kit PO items.

Workflow: Scan Kit PO → Select Pick Type (Floor/Rack) → Pick items (location → part → quantity) → Repeat.

- `verifyKitForPicking(kitPoNumber)` → validates kit status, checks Black Hat blocking, separates items by bin type (Floor: K/S bins, Rack: R bins)
- `getNextPickItem(kitPoNumber, pickType)` → returns first unpicked item sorted by bin
- `validateLocation(scanned, expected)` / `validateMaterial(scanned, expected)` / `validateQuantity(picked, expected)` — scan validation with epsilon comparison
- `markLinePicked(itemId, pickedQty, visuallyVerified?)` → updates `kit_to_line_picked_by_user` + syncs kanban
- `updateKitStatusToInProgress(kitPoNumber)` → auto-transitions status on first pick
- `checkAndUpdateKitPickingStatus(kitPoNumber)` → checks if all floor/rack picks are complete
- `reportMissingPart(itemId, kitPoNumber, photoBase64, notes?)` → uploads to `missing-part-photos` bucket, adds purple hat flag, syncs kanban
- `cleanScannedPartNumber(scannedValue)` — strips barcode label prefixes like `P/N R`, `PN:`, `PART NO.`
- `isPotentialKitPoNumber(inputValue)` / `validateKitPoNumber(kitPoNumber)` — format validators

### KittingOptionsService (`kitting-options.service.ts`)
**Configurable dropdown options** for kitting UI forms.

Singleton managing 5 option groups:
- `engine_program` — used in kit definitions and build plans
- `kit_type` — used in kit definition metadata
- `kit_container_type` — kit-level container types shown on build sheets
- `bom_line_container_type` — part-level container types within finished kits
- `charge_code` — used in kit definitions and build sheets

Methods: `listOptions(orgId, groups?)`, `createOption(input)`, `updateOption(id, updates)`, `deleteOption(id)`, `seedDefaults(orgId)` (calls RPC `seed_kitting_dropdown_options`).

## Database Tables
- `RR_Kitting_DATA` — kit build plan lines with transfer order data, pick/kit/inspect/dock timestamps, priority, flags, expedite metadata
- `kit_definitions` — kit BOM master data (`required_components` JSONB), kit-cart color, container type, charge code, **chain_id + chain_sequence_order**
- `kit_definition_chains` — chain master data (chain_name, link_type, status, audit cols)
- `kit_kanban_columns` — kanban board column definitions (shared globally)
- `kit_kanban_tasks` — kanban task cards linked to kit build plans
- `kit_build_flags` — flag system (purple=inventory, orange, red, black=missing BOM)
- `kitting_dropdown_options` — configurable dropdown values per organization
- `user_profiles` — joined for picker name display

## Storage Buckets
- `missing-part-photos` — photos of empty bins for missing part reports

## Database RPCs
- `seed_kitting_dropdown_options(p_organization_id)`

## Key Interfaces
- `RRKittingDataRecord` — comprehensive kit line record (~85 fields incl. expedite metadata)
- `KanbanColumn` / `KanbanTask` / `KitKanbanTask` — kanban board data structures
- `KittingPickItem` / `KittingPickData` — RF picking workflow types
- `KittingDropdownOption` — configurable dropdown option
- `KitDefinitionRecord` — kit BOM master record (now includes `chain_id`, `chain_sequence_order`)
- `KitDefinitionChainRecord` — chain master record
- `BomComponent` — BOM line (`material | incora_sub_kit | incora_component`)
- `ExpediteDeliveryTime` / `EXPEDITE_DELIVERY_TIMES` — expedite priority enum + UI metadata

## Migrations of note
- `064_create_kit_kanban_system.sql` — kit_definitions, kanban tables, history.
- `075` / `076` / `101` — RR_Kitting_DATA flag/INCORA columns.
- `197` / `208` / `209` / `211` / `212` — BOM linkage, kit defaults, container type, dropdown options table, charge code.
- `243_add_kit_definition_chains.sql` — kit_definition_chains table + chain columns on kit_definitions.
- `244_add_expedite_delivery_time.sql` — expedite delivery time + qty + description columns on RR_Kitting_DATA.

## Related
- [[Architecture]]
- [[RFPickingService - Supabase Service]]
- [[RFCycleCountServices - Supabase Service]]
- [[LaborManagement - Supabase Service]]
- [[Kitting System - Feature Module]]
- [[Kit-BOM-Chains-Expedites-And-INCORA-Component]]
