---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# OutboundTODataService

## Purpose
The largest Supabase service — manages the entire outbound delivery lifecycle including transfer order data, wave scanning, picking, packing, shipping, final packing, WAWF processing, and putback tickets. Contains sub-domains for Pack Tool, Shipper Tool, Final Pack Tool, WAWF Shipping, and Putback Tool.

## Pattern
Singleton via `OutboundTODataService.getInstance()`. Exported as `outboundTODataService`. Uses `singletonAuthManager` for auth state. Supports Rust core delegation.

## Key Functions

### Core Data Operations
- `fetchOutboundData(limit, offset)` — Paginated fetch with delivery priority enrichment from `rr_all_deliveries`. Falls back to direct profile query if org missing.
- `insertOutboundData(data)` — Single record insert with org/user context.
- `bulkInsertOutboundData(dataArray)` — Bulk insert with unique constraint handling (code 23505). Falls back to row-by-row on conflict.
- `deleteOutboundData(id)` — Delete by ID.
- `updateOutboundData(id, updates)` — Update single record.
- `searchByDeliveryOrTO(identifier)` — Search by delivery or transfer_order_number.
- `searchOutboundData(query, limit)` — Full-text search with status keyword detection (e.g., "packed", "waved").
- `subscribeToChanges(callback)` — Realtime subscription on `outbound_to_data_changes` channel.

### Clipboard Import
- `parseClipboardData()` — Parse TSV from clipboard (Excel format).
- `validateHeaders(headers)` — Validate against 19 expected columns.
- `transformRowToDatabase(headers, row)` — Map Excel columns to DB fields.
- `importFromClipboard()` — Full import pipeline with toast notifications.

### Status Workflow
- `updateStatus(id, status)` — Update record status; tracks `waved_by`/`waved_at` when status becomes 'processing'.
- `verifyDeliveryForWave(deliveryNumber)` — Check delivery exists and all rows pending.
- `updateDeliveryStatus(deliveryNumber, status)` — Bulk update all rows for a delivery.

### Pack Tool
- `verifyDelivery(deliveryId)` — Verify delivery is picked and ready for packing.
- `getDeliveryTONumbers(deliveryId)` — Get unique TO numbers for multi-line deliveries.
- `validateTONumber(deliveryId, toNumber)` — Validate TO belongs to delivery.
- `updatePackingInfo(deliveryId, packingData)` — Record dimensions/weight.
- `completePacking(deliveryId)` — Set status to 'packed', record label_printed_at.
- `getPackToolStats()` — Dashboard stats.

### Shipper Tool
- `verifyDeliveryForShipping(deliveryId)` — Verify delivery is packed.
- `updateShippingInfo(deliveryId, shippingData)` — Set shipper_type (domestic/international/wawf).
- `completeShipping(deliveryId)` — Set status to 'shipped'.
- `getShipperToolStats()` — Stats by shipper type.

### WAWF Shipping
- `verifyDeliveryForWAWF(deliveryId)` — Verify eligible for WAWF (packed or intermediate WAWF status).
- `updateWAWFStatus(deliveryId, wawfStatus)` — Set wawf_status (ready_for_nefab, staged_to_nefab).
- `completeWAWFShipping(deliveryId)` — Set wawf_status to 'complete_tka_process' and status to 'shipped'.

### Final Pack Tool
- `verifyDeliveryForFinalPack(deliveryId)` — Verify packed or shipped.
- `updateFinalPackInfo(deliveryId, finalPackData)` — Record tracking, 8130-3 compliance.
- `completeFinalPacking(deliveryId)` — Set status to 'final_packed'.
- `getFinalPackToolStats()` — Dashboard stats.

### Putback Tool
- `validateDeliveryForPutback(deliveryId)` — No status filter, groups materials.
- `generatePutbackNumber()` — Timestamp-based number generation.
- `createPutbackTicket(putbackData)` — Create ticket in `putback_tickets` table.
- `getPutbackTickets()` — Fetch all org tickets.
- `updatePutbackTicketStatus(ticketId, status)` — Update with processed_by/at.

### Statistics
- `getStatistics()` — Comprehensive stats: status breakdown, picks/packing/shipped available, critical deliveries, today counts. Uses EST timezone.
- `fetchCriticalDeliveries()` — Priority 10/12/13, not final_packed, after 2025-11-12.
- `fetchByStatuses(statuses, cutoffDate)` — Filter by status with date cutoff (default 2026-01-01).

### User Preferences
- `saveColumnOrder(columnOrder)` / `getColumnOrder()` — Persist column order in `user_profiles.outbound_column_order`.

## Database Tables
- **`outbound_to_data`** — Primary table. Columns: delivery, transfer_order_number, material, status (enum: outbound_status), packed_by/at, shipped_by/at, final_packed_by/at, waved_by/at, picked_by/at, shipper_type, wawf_status, package dimensions, tracking_number, etc.
- **`rr_all_deliveries`** — Delivery priority lookups.
- **`putback_tickets`** — Putback ticket management.
- **`user_profiles`** — Auth context and column order preferences.

## Outbound Status Enum Flow
`pending` → `processing` (waved) → `picked`/`picked_short`/`picked_bulk` → `packed` → `shipped` → `final_packed` → `completed`

Branch: `packed` → `on_hold` | `cancelled` | `error` | `putback`

## Dependencies
- `./client` (supabase), `./database.types`
- `@/lib/auth/singleton-auth-manager` (singletonAuthManager)
- `@/lib/rust-core/outbound-to-data.service`
- `@/lib/utils/logger`, `@/lib/utils/timezone`
- `sonner` (toast notifications)

## Related
- [[Architecture]] — System overview
- [[Supabase Client Infrastructure - Supabase Service]] — Client dependency
- [[DeliveryStatusService - Supabase Service]] — Shares `rr_all_deliveries` and `outbound_to_data` tables
- [[InboundScanService - Supabase Service]] — Inbound counterpart
