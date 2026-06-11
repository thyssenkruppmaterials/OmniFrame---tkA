---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# Kitting System

## Purpose
Complete kit assembly management system for warehouse operations. Manages the full lifecycle of kit production: from BOM (Bill of Materials) configuration and build plan scheduling through Kanban-based assembly tracking, component picking, kit building, inspection, and production progress monitoring. Integrates with the RF Interface for floor-level kit picking and assembly.

## Tabs (entrypoint: `kitting-management.tsx`)
1. **Kit Assembly Board** — `KitKanbanBoard` (drag-and-drop kanban over `kit_kanban_columns` / `kit_kanban_tasks`).
2. **Build Kit** — `BuildKitForm` + `useBuildKitTool` driving line-level mutations on `RR_Kitting_DATA`.
3. **Inspect Kit** — `InspectKitForm` + `useInspectKitTool` for QC inspection of kitted lines.
4. **Kitting Data Manager** — `KittingDataManager` grid + Add to Kit Build Plan + **Add Expedites to Kit Build Plan** + append TOs.
5. **Kit Cart Viewer** — `KitCartViewer` (Nefab PFC Trace API).
6. **Settings** — `KitBomSettings` (Definitions sub-tab + Dropdowns sub-tab) and chain management.

## Key Components
- **KitKanbanBoard** (`kit-kanban-board.tsx`) — Database-integrated drag-and-drop Kanban board for managing kit assembly tasks. Uses Framer Motion with spring physics for fluid drag animations. Cards display kit serial numbers, PO numbers, the human-readable kit number (`Kit {kit_number}`, enriched from `RR_Kitting_DATA` by serial — see [[Kit-Number-On-Kanban-Card]]), component progress (picked/total), and assignee info. Integrates with `KitKanbanService` and `RRKittingDataService` for real-time data. Includes `KitBuildSheet` viewer, `KitProductionTrackerDialog`, and `StartKitConfirmDialog`.
- **KitProductionTracker** (`kit-production-tracker.tsx`) — Production progress tracker with animated progress bars, component status tables, and comment threads. Shows picked vs total components, flags/issues, and worker assignments. Uses `RRKittingDataService` for data.
- **KitBuildSheet** (`kit-build-sheet.tsx`) — Build sheet viewer showing kit BOM details and assembly instructions. Encodes the kit serial as a QR and each TO number as a scannable Code 128 barcode (`jsbarcode`, lazy-loaded) — see [[Scannable-TO-Barcodes-On-Build-Sheet]].
- **BuildKitForm** (`build-kit-form.tsx`) — Form for initiating new kit builds.
- **InspectKitForm** (`inspect-kit-form.tsx`) — Quality inspection form for completed kits.
- **KittingDataManager** (`kitting-data-manager.tsx`) — Tabbed grid for kit build plans (**Open Work** = drag-to-reorder priority; **Completed** = read-only `kit_build_status = 'completed'`, see [[Kit-Build-Plan-Completed-Tab]]) with add-plan dialog, **add-expedite dialog**, append-TOs, CSV export. Columns ordered Priority · Date Added · Due · Serial · PO · Kit# · Status · **Ship Short** · **Messages** (per-user unread Kit-Note indicator, `kit_note_reads` + `kit_notes_unread_serials` RPC) · Flags — see [[Kit-Build-Plans-Grid-Reorder-ShipShort-Unread]].
- **KittingOptionManager** (`kitting-option-manager.tsx`) — Configuration management for kitting options and settings.
- **KitBomSettings** (`kit-bom-settings.tsx`) — BOM (Bill of Materials) configuration for kit definitions, plus the embedded **KitChainManagerDialog** for managing kit-definition chains.
- **AddKitBuildPlanDialog** (`add-kit-build-plan-dialog.tsx`) — Dialog for creating new kit build plans with TO import + BOM coverage check.
- **AddExpediteDialog** (`add-expedite-dialog.tsx`) — Dialog for adding a single expedite line item with delivery time priority (Critical / 24 Hours / 2-Day).
- **StartKitConfirmDialog** (`start-kit-confirm-dialog.tsx`) — Confirmation dialog before starting kit assembly process.

## Hooks
- Data operations via `KitKanbanService` (from `@/lib/supabase/kit-kanban.service`) — Kanban column and task CRUD
- Data operations via `RRKittingDataService` (from `@/lib/supabase/rr-kitting-data.service`) — Kit production data, component tracking, comments, expedites
- BOM master data via `KitDefinitionsService` (from `@/lib/supabase/kit-definitions.service`)
- Kit chains via `KitDefinitionChainsService` (from `@/lib/supabase/kit-definition-chains.service`)
- Configurable dropdowns via `useKittingOptions()` (`kitting-options.service`)

## BOM Component Types
The BOM editor (`KitBomSettings` → `BomEditor`) supports three component types:
- **Material** — standard SAP material number with optional approved substitute deviations.
- **INCORA Component** — hybrid row with both an optional material # and an INCORA reference; coverage matches if either appears in the kit's TO lines or `incora_items`.
- **INCORA Sub-Kit** — sub-assembly identified solely by INCORA reference; coverage matches against the kit's `incora_items`.

## Kit Chains (Settings tab)
Kit definitions can be linked into **chains** for multi-kit workflows:
- `kit_definition_chains` table (org-scoped: `chain_name`, `link_type` = `build_order` / `ship_together` / `custom`, status, audit cols).
- Each `kit_definitions` row belongs to at most one chain via `chain_id` + `chain_sequence_order`.
- Managed in the Settings tab via the `Manage Chains` button (opens `KitChainManagerDialog`).
- Selected per-kit in the Edit Kit Definition dialog under `Linked Kit Chain`.

## Expedites (Kitting Data Manager)
The `Add Expedites to Kit Build Plan` button opens `AddExpediteDialog`, which calls `RRKittingDataService.addExpediteToKit`.
- Two modes: **append to existing kit** (inherits serial / build / kanban) OR **stand-alone expedite** (creates its own kit serial + kanban card with engine program `EXPEDITE`).
- Expedite columns on `RR_Kitting_DATA`: `part_expedite_part_number`, `_description`, `_quantity`, `_delivery_time` (CHECK `critical|24_hour|2_day`), `_request_reason_code`, `_request_by_user`, `_request_create_date_time`, `_requested_by_date`.

## State Management
- Kanban board uses local state with database-backed columns and tasks
- `KitTask` internal type with priority, assignee, component progress (componentsTotal, componentsCompleted), and kit identifiers (kitSerialNumber, kitBuildNumber, kitPoNumber)
- Animated card transitions via Framer Motion `AnimatePresence`
- Comment threads with real-time updates
- RF Interface sub-modules (`RFBuildKitForm`, `RFInspectKitForm`, `RFKittingPickingForm`) handle floor-level operations

## Routes
- Kitting management accessible from main application navigation (`/_authenticated/apps/kitting`).
- RF Interface provides mobile kitting apps: Kit Picking, Build Kit, Inspect Kit

## Related
- [[Architecture]]
- [[RF Interface - Feature Module]]
- [[KittingServices - Supabase Service]]
- [[Kit-BOM-Chains-Expedites-And-INCORA-Component]]


## Resolved Issues

### Multi-Kit Per PO Cross-Linking (resolved 2026-05-12)

When two or more `RR_Kitting_DATA` kit serials shared the same
`kit_po_number` (first observed with C47E/4 Gear Box 1 + 2 on PO
`2010102615`), the service-layer code paths cross-linked them because they
keyed by `kit_po_number` alone. Symptoms: shared `In Progress` flip,
kanban progress card aggregated across both kits, Black Hat on one kit
blocked the other, RF picking merged floor/rack lists.

Fixed by `supabase/migrations/303_kit_build_flags_serial_scope.sql` plus
service-layer rescoping: every kit-level operation (picking-status flip,
kanban sync, BOM coverage recheck, Black Hat insert/clear) is now keyed
by `kit_serial_number`. The RF Kit Picking form gained an in-app picker
(`kit_select` step) for the case where one Kit PO covers multiple active
kits. PO-scoped variants are kept as deprecated wrappers that fan out
per-serial. See [[Fix-Kit-Build-Cross-Linked-Parts]] (Resolution section)
for the full file-by-file changelog and [[Kit-Serial-Scoping]] for the
forward-looking convention.
