---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# DeliveryStatusService

## Purpose
Manages the delivery status tracking system — the master list of all deliveries with their SAP data, outbound status enrichment, disposition management, deletion detection, and comprehensive import from Excel/clipboard. This is the second-largest Supabase service.

## Pattern
Singleton via `DeliveryStatusService.getInstance()`. Exported as `deliveryStatusService`. Uses direct Supabase auth for user/org lookup. Supports Rust core delegation.

## Key Functions

### Data Fetching
- `fetchDeliveryStatusData(limit, offset, openOnly, includeDeleted)` — Fetches delivery data with disposition join, status enrichment from `outbound_to_data`, and business rule application. Uses chunking for datasets > 10000.
- `searchDeliveryData(query, limit, includeDeleted)` — Full-text search across 18+ text columns with status enrichment.
- `getDeliveriesPGIForDate(targetDate)` — Count deliveries with Post Goods Issue for specific date (OE + IRNA shipping points only).

### Business Rules
- `applyBusinessRules(delivery)` — If delivery has `actual_goods_movement_date`, status becomes 'completed'. Calculates `days_open` for open deliveries using creation date/time.

### Import Pipeline
- `parseClipboardData()` — TSV parsing from clipboard.
- `validateHeaders(headers)` — Flexible validation against 26 expected columns with alias support.
- `transformRowToDatabase(headers, row)` — Maps Excel columns including special handling for combined "Shipping point/Receiving Point" column.
- `importFromClipboard(progressCallback)` — Full chunked import pipeline (500/chunk) with upsert mode and progress tracking.
- `bulkInsertDeliveryDataChunked(dataArray, progressCallback)` — Upsert on `delivery,organization_id` constraint. Updates existing records, preserves dispositions.

### Disposition Management
- `getDispositions(organizationId)` — Fetch all dispositions.
- `createDisposition(disposition)` / `updateDisposition(id, updates)` / `deleteDisposition(id)` — CRUD for dispositions.
- `updateDeliveryDisposition(deliveryId, dispositionId)` — Assign disposition to delivery.
- `ensureRequiredDispositions(organizationId)` — Auto-create DCMA (orange) and WAWF (purple) dispositions.
- `autoAssignDispositions()` — Auto-assign DCMA to LiftFan JPO Depot, WAWF to deliveries with WAWF in External ID 1.

### Deletion Detection
- `detectAndMarkDeletedDeliveries(importedDeliveryNumbers)` — Marks deliveries missing from import as `is_deleted=true`, reactivates returned ones. *Note: Automatic detection disabled November 25, 2025 by user request.*

### Statistics
- `getStatistics()` — Total/today deliveries, status breakdown, unique customers/TOs, TKA non-controllable counts (LiftFan, WAWF). Filters out "Deleted" dispositions.

### Other
- `subscribeToChanges(callback)` — Realtime on `delivery_status_changes` channel.
- `clearAllDeliveryData(showToast)` — Delete all delivery records.

## Database Tables
- **`rr_all_deliveries`** — Primary table. 26+ columns including delivery, customer_name, shipping_point, delivery_priority, delivery_creation_date, actual_goods_movement_date, transfer_order_number, shipment_number, external_identification_1, is_deleted, dispositions (FK).
- **`outbound_to_data`** — Joined for status enrichment (delivery, status, packed_by/at, shipped_by/at).
- **`delivery_dispositions`** — Disposition lookup table (id, name, color, organization_id).
- **`user_profiles`** — Auth context.

## Shipping Points (OE + IRNA)
PDCE, NMP1, NME1, KY01, DCSP, IRNA

## Dependencies
- `./client` (supabase), `./database.types`
- `@/lib/rust-core/delivery-status.service`
- `@/lib/utils/logger`, `@/lib/utils/timezone`
- `sonner` (toast notifications)

## Related
- [[Architecture]] — System overview
- [[Supabase Client Infrastructure - Supabase Service]] — Client dependency
- [[OutboundTODataService - Supabase Service]] — Shares outbound_to_data table, delivery status enrichment
