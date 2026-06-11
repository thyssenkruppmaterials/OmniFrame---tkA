---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database]
created: 2026-04-28
---
# Kit BOM Chains, Expedites, and INCORA Component

## Purpose / Context
User-driven enhancements to the Kitting Apps Settings, Kitting Data Manager, and Edit Kit Definition flows:

1. **Kit BOM Chains** — Link/chain several Kit BOM definitions together when they must be built in order or shipped together.
2. **Expedite Single Parts** — Add a single expedite line item to the kit build plan with delivery time priority of Critical / 24 Hours / 2-Day.
3. **INCORA Component type** — New Type dropdown option in the Edit Kit Definition BOM editor (alongside Material and INCORA Sub-Kit).

All three changes preserve the existing build flow (kanban → build → inspect → dock) and the existing BOM-coverage / Black Hat auto-flag automation.

## Details

### 1. Database (migrations 243 + 244)

**`243_add_kit_definition_chains.sql`** — adds:
- New table `kit_definition_chains` (org-scoped: `chain_name` UNIQUE per org, `link_type` CHECK in `build_order|ship_together|custom`, `status` CHECK in `active|archived`, audit cols, `updated_at` trigger using existing `update_kit_kanban_updated_at()`).
- Full RLS (select/insert/update/delete by org membership).
- New columns on `kit_definitions`: `chain_id` (UUID FK ON DELETE SET NULL) and `chain_sequence_order` (INTEGER), plus index `idx_kit_definitions_chain (chain_id, chain_sequence_order)`.
- Each kit definition belongs to **at most one chain** (1:N).

**`244_add_expedite_delivery_time.sql`** — adds to `RR_Kitting_DATA`:
- `part_expedite_delivery_time` TEXT — CHECK in `critical|24_hour|2_day`.
- `part_expedite_quantity` NUMERIC.
- `part_expedite_description` TEXT.
- Partial index `idx_rr_kitting_data_expedite_part` on rows with non-null `part_expedite_part_number`.
- Existing expedite columns (`part_expedite_part_number`, `_request_by_user`, `_request_create_date_time`, `_request_reason_code`, `_requested_by_date`) remain unchanged.

Both migrations were applied via Supabase MCP `apply_migration` against project `wncpqxwmbxjgxvrpcake` and verified in `information_schema.columns`.

### 2. Service layer changes

**`src/lib/supabase/kit-definitions.service.ts`**
- `BomComponentType` extended: `'material' | 'incora_sub_kit' | 'incora_component'`.
- `BomComponent.incoraReference` now meaningful for `incora_component` (hybrid: optional material # AND optional INCORA ref).
- `KitDefinitionRecord` gains `chain_id: string | null` and `chain_sequence_order: number | null`.
- `CreateKitDefinitionInput` / `UpdateKitDefinitionInput` gain `chainId?` and `chainSequenceOrder?`.
- `validateBom()` updated to accept `incora_component` rows (must have material # OR INCORA ref) and to dedupe across all rows.
- `create()` and `update()` persist the new chain columns.

**`src/lib/supabase/kit-definition-chains.service.ts`** (new) — full CRUD for `kit_definition_chains`:
- `KitDefinitionChainRecord`, `KitChainLinkType`, `KitChainStatus`, `KIT_CHAIN_LINK_TYPES` constant (Build in Order / Ship Together / Custom).
- `list()`, `listActive()`, `create()`, `update()`, `archive()`, `activate()`, `delete()`, `subscribeToChanges()`.
- Org scoping via `user_profiles.organization_id`.

**`src/lib/supabase/rr-kitting-data.service.ts`**
- New types `ExpediteDeliveryTime = 'critical' | '24_hour' | '2_day'` and `EXPEDITE_DELIVERY_TIMES` constant.
- `RRKittingDataRecord` extended with `part_expedite_description`, `part_expedite_quantity`, `part_expedite_delivery_time`.
- `formatBomCoverageLabel` and `recheckBomCoverage` updated to recognise `incora_component` (matched if material OR INCORA ref matches).
- New `addExpediteToKit({ kitPoNumber?, partNumber, description?, quantity?, deliveryTime, reasonCode?, requestedByDate? })` — two modes:
  - **Append to existing kit** when `kitPoNumber` matches a kit; inherits serial / build / kit_definition_id / kanban_task_id and resyncs kanban via `KitKanbanService.syncKitProgressFromData`.
  - **Stand-alone expedite** when no matching kit; creates its own serial number, kit build number `EXP-<serial>`, engine_program `EXPEDITE`, and a fresh kanban card via `KitKanbanService.createTask`.

### 3. UI changes

**`src/components/kitting/kit-bom-settings.tsx`**
- BOM Editor Type dropdown now offers **Material**, **INCORA Component**, **INCORA Sub-Kit** (in that order). The Material # / INCORA Ref column renders dual inputs for INCORA Component (material # + INCORA ref). Substitute parts are available for both Material and INCORA Component rows.
- New "Add INCORA Component" button next to "Add Material" / "Add INCORA Sub-Kit".
- Edit Kit Definition dialog adds a new `Linked Kit Chain` section with a chain Select + Sequence # input. "Manage Chains" button opens the new chain manager dialog inline.
- Definitions table gains a `Chain` column (chain name + `#sequence` badge).
- Settings header: new `Manage Chains` button next to `New Kit Definition`.
- New `KitChainManagerDialog` component — create / edit / archive / activate / delete chains; shows linked kit definition members per chain ordered by sequence.

**`src/components/ui/add-kit-build-plan-dialog.tsx`**
- BOM coverage logic handles `incora_component` (matched if material OR INCORA ref matches).
- BOM Pick List preview shows distinct "INCORA Component" vs "INCORA Sub-Kit" badges, and renders `material # (INCORA ref)` for hybrid components.
- INCORA reference auto-fill from BOM now also pulls from `incora_component` rows.
- Unmatched-component label rendering updated for `incora_component`.

**`src/components/ui/add-expedite-dialog.tsx`** (new)
- Dialog with: Attach to Kit PO Number (Select with stand-alone option), Part Number (required), Quantity, Description, Delivery Time (Select: Critical / 24 Hours / 2-Day, required), Reason Code (preset list), Requested By Date (optional calendar).
- Critical option visually flagged with red AlertCircle icon; 24h/2-Day use Clock icon.
- Form re-seeds whenever opened with a `defaultKitPoNumber`.

**`src/components/kitting-data-manager.tsx`**
- New `Add Expedites to Kit Build Plan` button (Zap icon) next to `Add to Kit Build Plan`.
- Builds `expediteKitPoOptions` from current grid data so the dialog dropdown only shows live kit POs.
- New `handleAddExpedite` calls `RRKittingDataService.addExpediteToKit` and toasts whether the expedite landed on an existing kit or was created stand-alone.

### 4. Behavioural notes
- An expedite that matches an existing Kit PO inherits the kit's serial, build number, kanban card, and BOM linkage so the new line shows up alongside the kit's TO lines on the Kanban board and in the kit production tracker.
- An expedite without a matching Kit PO produces a self-contained `RR_Kitting_DATA` row + new kanban card with engine program `EXPEDITE` so it can still be tracked.
- Linking a kit to a chain is purely metadata today — it does not yet drive kanban ordering or shipment grouping. Future work: build-order enforcement on the kanban board, ship-together grouping in dock-ready logic, multi-kit kanban swimlanes per chain.
- The new `incora_component` BOM type matches coverage if **either** the material number OR the INCORA reference is present in the kit's TO lines / `incora_items`. This allows mixed sourcing where the same part can be shipped as a raw component or via an INCORA reference.

### 5. Files touched
- `supabase/migrations/243_add_kit_definition_chains.sql` (new)
- `supabase/migrations/244_add_expedite_delivery_time.sql` (new)
- `src/lib/supabase/kit-definitions.service.ts`
- `src/lib/supabase/kit-definition-chains.service.ts` (new)
- `src/lib/supabase/rr-kitting-data.service.ts`
- `src/components/kitting/kit-bom-settings.tsx`
- `src/components/ui/add-kit-build-plan-dialog.tsx`
- `src/components/ui/add-expedite-dialog.tsx` (new)
- `src/components/kitting-data-manager.tsx`

### 6. Validation
- `npx tsc --noEmit -p tsconfig.app.json` clean after changes.
- `npx eslint` clean on all touched non-`components/ui` files (UI folder is project-ignored by ESLint config).
- Vite HMR successfully hot-reloaded all updates against the running dev server.
- Schema diff verified via Supabase MCP `execute_sql` queries against `information_schema.columns`.

## Related
- [[Kitting System - Feature Module]]
- [[KittingServices - Supabase Service]]
- [[Database-Schema-Overview]]
- [[Migration-History]]
