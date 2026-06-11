---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# Rust Core — Frontend Client

## Purpose
TypeScript client library (`src/lib/rust-core/`) that provides the frontend application with a typed interface to the Rust Core Service backend. Implements a singleton pattern, automatic Supabase session token resolution, and Rust-first + Supabase-fallback service pattern for gradual migration. Also provides specialized service classes for SmartSheet, LX03 SAP data, delivery status, outbound TO data, SQ01 data, material master data, putaway logs, and inbound scans.

## Key Files

| File | Role |
|------|------|
| `client.ts` | `RustCoreClient` class — singleton HTTP client with auto-token resolution, typed methods for health, auth, warehouse, cache, and generic query execution |
| `config.ts` | Configuration: `RUST_CORE_ENABLED` feature flag, `RUST_CORE_URL`, `SUPPORTED_RUST_QUERIES` set |
| `index.ts` | Module barrel — re-exports all clients, services, types, and `createRustCoreClient()` |
| `lx03-data.service.ts` | `RustLX03DataService` — LX03 SAP data with Rust-first, Supabase-fallback pattern (singleton) |
| `smartsheet.service.ts` | `RustSmartsheetService` — SmartSheet operations (sheets, rows, cells, attachments, discussions, comments, dashboard stats); `HybridSmartsheetService` with Rust→Python fallback |
| `delivery-status.service.ts` | `RustDeliveryStatusService` — Delivery status operations |
| `outbound-to-data.service.ts` | `RustOutboundTODataService` — Outbound TO data CRUD |
| `sq01-data.service.ts` | `RustSQ01DataService` — SQ01 quality notifications |
| `material-master-data.service.ts` | `RustMaterialMasterDataService` — Material master data |
| `inbound-scan.service.ts` | Inbound scan operations |
| `putaway-log.service.ts` | Putaway log operations |

## Client Architecture

### RustCoreClient (client.ts)
- Singleton pattern via `getRustCoreClient()` / `initRustCoreClient()`
- Auto-resolves auth token: checks manually set token first, then fetches from `supabase.auth.getSession()`
- Configurable timeout (default 30s)
- Only sets Content-Type on requests with body (avoids unnecessary CORS preflights on GET)
- Methods: `healthCheck()`, `detailedHealth()`, `validateToken()`, `getPermissions()`, `getInboundScans()`, `getInboundScanByBarcode()`, `createInboundScan()`, `getTransferOrders()`, `getTransferOrder()`, `updateTransferOrderStatus()`, `getWarehouseStats()`, `searchMaterials()`, `cacheGet/Set/Delete()`, `executeQuery()`

### Rust-First Service Pattern
Used by `RustLX03DataService`, `RustSmartsheetService`, etc.:
1. Check `RUST_CORE_ENABLED` flag
2. Attempt Rust service call
3. On failure, fall back to Supabase or Python API
4. Log performance metrics (fetch time in ms)

### HybridSmartsheetService
Wraps `RustSmartsheetService` with Python API fallback:
- `importOutboundData()` tries Rust first, falls back to Python
- Response includes `source: 'rust' | 'python'` and `execution_time_ms`
- `healthCheck()` checks both Rust and Python services

## Exported Types
- `CoreConfig`, `InboundScan`, `TransferOrder`, `WarehouseStats`, `MaterialMaster`
- `ValidationResult`, `HealthResponse`, `QueryResponse`, `InboundScanResponse`, `TransferOrderResponse`
- `LX03Data`, `LX03Statistics`
- `SheetData`, `RowData`, `CellData`, `ColumnData`, `SheetResponse`, `SheetListResponse`
- `SmartsheetHealthResponse`, `SheetStatistics`, `OutboundImportData`
- `AttachmentData`, `DiscussionData`, `CommentData` and more

## Configuration
- `VITE_RUST_CORE_ENABLED` — feature flag for gradual migration (`'true'` to enable)
- `VITE_RUST_CORE_URL` — Rust core service URL (defaults to Railway production URL)
- `SUPPORTED_RUST_QUERIES` — set of query names supported by the Rust backend (warehouse_stats, inbound_statistics, dashboard_stats, material_search, lx03_data, lx03_statistics, user_permissions)

## Related
- [[Architecture]]
- [[RustService - Core Service]]
- [[RustService - rust-ai-service]]
- [[RustService - Dashboard Service]]
- [[RustService - MDM Service]]
- [[RustService - Streaming Service]]
- [[RustService - Work Service]]