// Created and developed by Jai Singh
/**
 * Rust Core Configuration Constants
 *
 * This file contains configuration constants that are shared across
 * rust-core services. It's separated to avoid circular dependencies.
 */

// Feature flag for gradual migration
export const RUST_CORE_ENABLED =
  import.meta.env.VITE_RUST_CORE_ENABLED === 'true'

// Base URL for Rust core service
// Default to Railway production URL for development convenience
export const RUST_CORE_URL =
  import.meta.env.VITE_RUST_CORE_URL ||
  'https://rust-core-service-production.up.railway.app'

/**
 * Query types currently supported by the Rust core service.
 * Queries not in this set will skip the Rust attempt and go
 * directly to the Supabase fallback, avoiding unnecessary 400s.
 */
export const SUPPORTED_RUST_QUERIES = new Set([
  'warehouse_stats',
  'inbound_statistics',
  'dashboard_stats',
  'material_search',
  'lx03_data',
  'lx03_statistics',
  'user_permissions',
])

// Created and developed by Jai Singh
