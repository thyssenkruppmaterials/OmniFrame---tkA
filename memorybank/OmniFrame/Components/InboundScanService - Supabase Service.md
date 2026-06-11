---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# InboundScanService

## Purpose
Manages inbound scan operations for receiving dock — CRUD, search, statistics, clipboard import, CSV export, and paginated fetching. Supports optional Rust core delegation when `VITE_RUST_CORE_ENABLED=true`.

## Pattern
Singleton via `InboundScanService.getInstance()`. Exported as `inboundScanService`.

## Key Functions
- `fetchInboundScans()` — Fetches ALL scans using controlled sequential chunking (1000/chunk, 5 concurrent, 100ms delay). Bypasses Supabase 1000-row limit.
- `fetchInboundScansPaginated({ page, pageSize, search })` — Server-side pagination with search filter. Target < 300ms.
- `searchInboundScans(query)` — Full database search across material_number, tka_batch_number, tracking_number, so_line_rma_afa, notes, scan_location. *(deprecated)*
- `fetchStatistics()` — Calls RPC `get_inbound_scan_statistics`; falls back to client-side calculation.
- `fetchScansForLastDays(days)` — Paginated fetch for reports/analytics (default 30 days).
- `createScan(scanData)` — Insert single scan record.
- `updateScan(id, updates)` — Update existing scan by ID.
- `deleteScan(id)` — Delete scan by ID.
- `importFromClipboard()` — AsyncGenerator for batch clipboard import (TSV parsing, flexible header matching, 500/batch).
- `filterScans(scans, searchQuery)` — Client-side filter for already-loaded data.
- `exportToCSV(scans)` — Generates CSV string with date/time/material/priority columns.
- `fetchAllForExport(search?)` — Fetches complete dataset for export with optional search filter.

## Database Tables
- **`rr_inbound_scans`** — Primary table. Columns include: material_number, tka_batch_number, tracking_number, so_line_rma_afa, quantity, hot_truck, notes, scan_location, scanned_at, scanned_by, barcode.
- **`user_profiles`** — Joined via `rr_inbound_scans_scanned_by_fkey` for full_name/email.

## RPC Functions
- `get_inbound_scan_statistics` — Server-side statistics calculation.

## Types Exported
- `InboundScanData` — `Tables<'rr_inbound_scans'>`
- `InboundScansWithUser` — Scans with joined user profile
- `InboundScanStatistics` — Stats interface (totalScans, todayScans, uniqueMaterials, etc.)
- `ImportProgress` — Progress tracking for clipboard import

## Dependencies
- `./client` (supabase)
- `./database.types` (Tables)
- `@/lib/rust-core` (RUST_CORE_ENABLED)
- `@/lib/rust-core/inbound-scan.service` (rustInboundScanService)
- `@/lib/utils/logger`
- `@/lib/utils/timezone` (getTodayEST, getStartOfTodayEST, getEndOfTodayEST, getDaysAgoEST)

## Related
- [[Architecture]] — System overview
- [[Supabase Client Infrastructure - Supabase Service]] — Client dependency
- [[HotPartAlert and MaterialValidation - Supabase Service]] — Material validation for scans
- [[PutawayLogService - Supabase Service]] — Related warehouse operation
