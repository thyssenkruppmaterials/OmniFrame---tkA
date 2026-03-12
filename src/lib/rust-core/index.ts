/**
 * OmniFrame Rust Core Service Integration
 * Build trigger: 2026-01-11T20:10:00Z - Enable RUST_CORE for production
 *
 * This module provides a TypeScript client for the high-performance
 * Rust core service, offering:
 *
 * - JWT validation with cryptographic verification
 * - Redis caching with connection pooling
 * - Optimized database queries
 *
 * @example
 * ```typescript
 * import { initRustCoreClient, getRustCoreClient } from '@/lib/rust-core';
 *
 * // Initialize once at app startup
 * initRustCoreClient({
 *   baseUrl: import.meta.env.VITE_RUST_CORE_URL || 'https://your-rust-core-service.up.railway.app',
 *   token: userSession?.access_token,
 * });
 *
 * // Use anywhere in the app
 * const client = getRustCoreClient();
 * const stats = await client.getWarehouseStats();
 * ```
 */
import { initRustCoreClient as initClient } from './client'
import { RUST_CORE_URL as configUrl } from './config'

export {
  RustCoreClient,
  getRustCoreClient,
  initRustCoreClient,
  type CoreConfig,
  type InboundScan,
  type TransferOrder,
  type WarehouseStats,
  type MaterialMaster,
  type ValidationResult,
  type HealthResponse,
  type QueryResponse,
  type InboundScanResponse,
  type TransferOrderResponse,
} from './client'

// Rust-enabled services for outbound applications
export {
  RustDeliveryStatusService,
  rustDeliveryStatusService,
  type DeliveryStatusData,
  type DeliveryStatusStatistics,
} from './delivery-status.service'

export {
  RustOutboundTODataService,
  rustOutboundTODataService,
  type OutboundTOData,
  type OutboundTODataInsert,
  type OutboundTODataUpdate,
  type OutboundStatistics,
  type PackToolStats,
  type FinalPackToolStats,
  type ShipperToolStats,
  type PutbackStats,
} from './outbound-to-data.service'

// Note: Putaway log types are exported directly from ./putaway-log.service
// to avoid circular dependency issues

// Rust-enabled services for data manager applications
export {
  RustLX03DataService,
  rustLX03DataService,
  type LX03Data,
  type LX03Statistics,
} from './lx03-data.service'

export {
  RustSQ01DataService,
  rustSQ01DataService,
  type SQ01Data,
  type SQ01Statistics,
} from './sq01-data.service'

export {
  RustMaterialMasterDataService,
  rustMaterialMasterDataService,
  type MaterialMasterData as RustMaterialMasterData,
  type MaterialMasterStatistics,
} from './material-master-data.service'

// SmartSheet high-performance service
export {
  rustSmartsheetService,
  hybridSmartsheetService,
  HybridSmartsheetService,
  type SmartsheetHealthResponse,
  type SheetSummary,
  type SheetListResponse,
  type ColumnData,
  type CellData,
  type RowData,
  type SheetData,
  type SheetResponse,
  type OutboundImportData,
  type OutboundImportResponse,
  type SheetStatistics,
} from './smartsheet.service'

// Feature flag for gradual migration (re-exported from config to maintain backward compatibility)
export { RUST_CORE_ENABLED, RUST_CORE_URL } from './config'

// Environment-based client initialization
export function createRustCoreClient() {
  return initClient({ baseUrl: configUrl })
}
// Developer and Creator: Jai Singh
