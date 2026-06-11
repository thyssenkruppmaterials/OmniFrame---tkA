---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# HotPartAlert & MaterialValidation Services

## Purpose
Two closely related services for warehouse material operations:
1. **MaterialValidationService** — Validates material numbers against LX03 and SQ01 warehouse data tables, provides autocomplete suggestions with stock information.
2. **HotPartAlertService** — Manages priority alert rules for inbound scanning. When scanned values match an active rule, RF operators receive immediate priority notifications.

## Pattern
Both are singletons. `materialValidationService` and `hotPartAlertService`.

## MaterialValidationService Key Functions
- `validateMaterialExists(material)` — Queries both `rr_lx03_data` and `rr_sq01_data` in parallel. Returns existence, source ('lx03'/'sq01'/'both'), stock info, and description.
- `getSuggestedMaterials(query, limit)` — Autocomplete with ILIKE search across both tables. Returns materials sorted by description presence, stock, and location count.
- `validateMaterialAtLocation(material, location)` — Checks specific material-at-location combination in both LX03 (storage_bin) and SQ01 (conf_cert_ref).

## HotPartAlertService Key Functions
- `fetchAlerts(activeOnly)` — Fetch all alerts, optionally active-only.
- `createAlert({ match_value, match_type, notes, priority })` — Create alert with org scoping.
- `updateAlert(id, updates)` / `toggleAlert(id, isActive)` / `deleteAlert(id)` — CRUD operations.
- `checkForAlerts(scanData)` — Server-side check via RPC `check_hot_part_alerts`. Substring matching.
- `checkForAlertsLocal(alerts, scanData)` — Client-side check against cached alerts for real-time validation. Case-insensitive substring matching, sorted by priority (critical > high > normal).

## Alert Match Types
- `material_number` — Match against material number field
- `so_line_rma_afa` — Match against SO/Line, RMA/AFA # field
- `tracking_number` — Match against tracking number field
- `any` — Match against any of the above fields

## Alert Priority Levels
- `critical` / `high` / `normal`

## Database Tables
- **`rr_lx03_data`** — LX03 warehouse data. Columns: material, storage_bin, total_stock, available_stock.
- **`rr_sq01_data`** — SQ01 quality data. Columns: material, material_description, conf_cert_ref, unrestricted, blocked.
- **`rr_hot_part_alerts`** — Alert rules. Columns: match_value, match_type, notes, is_active, priority, created_by, organization_id. *(Not yet in generated database.types.ts)*
- **`user_profiles`** — Auth context for organization scoping.

## RPC Functions
- `check_hot_part_alerts(p_material_number, p_so_line_rma_afa, p_tracking_number, p_organization_id)` — Server-side alert matching.

## Dependencies
- `./client` (supabase)
- `@/lib/utils/logger`

## Related
- [[Architecture]] — System overview
- [[InboundScanService - Supabase Service]] — Hot part alerts trigger during inbound scanning
- [[PutawayLogService - Supabase Service]] — Material validation used in putaway
- [[Supabase Client Infrastructure - Supabase Service]] — Client dependency
