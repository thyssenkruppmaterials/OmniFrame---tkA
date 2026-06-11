---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# PutawayLogService

## Purpose
Manages RF putaway operation records — CRUD, search, statistics, clipboard import, CSV export. Tracks warehouse putaway operations including MCA (Material Control Area) workflow, TO confirmation status, and driver performance metrics.

## Pattern
Singleton via `PutawayLogService.getInstance()`. Exported as `putawayLogService`. Supports Rust core delegation.

## Key Functions
- `fetchPutawayOperations()` — Fetch ALL operations with user profile joins (confirmed_by, mca_processed_by). Controlled chunking (1000/chunk, 5 concurrent). Re-sorts after parallel fetch.
- `searchPutawayOperations(query)` — Database search across material_number, to_number, to_location, shelf_location, putaway_driver, warehouse, to_status, mca_reason. *(deprecated)*
- `fetchStatistics()` — Calls RPC `get_putaway_log_statistics`; falls back to client-side calculation with EST timezone.
- `createPutawayOperation(operationData)` — Insert single operation.
- `updatePutawayOperation(id, updates)` — Update by ID.
- `deletePutawayOperation(id)` — Delete by ID.
- `importFromClipboard()` — AsyncGenerator for batch clipboard import with flexible header matching.
- `filterPutawayOperations(operations, searchQuery)` — Client-side filter including stow cart fields.
- `exportToCSV(operations)` — CSV generation.
- `isUsingRust()` — Check if Rust service is active.

## Statistics Tracked
- Total/today putaways (EST timezone)
- Unique materials and drivers
- Average putaways per driver (today)
- MCA pending count (from Jan 14, 2026 onwards, excluding "MCA Confirmed" and "MCA Processed")
- Pending TO confirms (from Jan 1, 2026 onwards, excluding "TO Confirmed"/"MCA Confirmed"/"MCA Processed")
- Status breakdown and warehouse distribution

## Database Tables
- **`rf_putaway_operations`** — Primary table. Columns: material_number, to_number, to_location, shelf_location, putaway_driver, warehouse, to_status, is_mca_workflow, mca_reason, putaway_date, putaway_time, confirmed_by, mca_processed_by, stow_cart_number, created_by, created_at.
- **`user_profiles`** — Joined via `confirmed_by` and `mca_processed_by` FKs for user names.

## RPC Functions
- `get_putaway_log_statistics` — Server-side statistics.

## Types Exported
- `PutawayOperationData` — `Tables<'rf_putaway_operations'>`
- `PutawayOperationsWithUser` — Operations with joined user profiles
- `PutawayLogStatistics` — Stats interface
- `ImportProgress` — Progress tracking

## Dependencies
- `./client` (supabase), `./database.types`
- `@/lib/rust-core` (RUST_CORE_ENABLED)
- `@/lib/rust-core/putaway-log.service`
- `@/lib/utils/logger`, `@/lib/utils/timezone`

## Related
- [[Architecture]] — System overview
- [[Supabase Client Infrastructure - Supabase Service]] — Client dependency
- [[InboundScanService - Supabase Service]] — Related receiving operation
- [[HotPartAlert and MaterialValidation - Supabase Service]] — Material validation
