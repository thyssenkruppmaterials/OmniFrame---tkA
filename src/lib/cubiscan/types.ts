// Created and developed by Jai Singh
/**
 * CubiScan Integration Types
 *
 * Defines the contract between the local Windows bridge service
 * and the OmniFrame web application. The bridge sends heartbeats and
 * measurement payloads over HTTP to the FastAPI backend, which
 * normalizes and stores them in Supabase.
 */

// ---------------------------------------------------------------------------
// Bridge -> Backend payloads
// ---------------------------------------------------------------------------

export interface CubiScanHeartbeat {
  device_id: string
  device_name: string
  model: string
  firmware_version: string
  connection_method: 'serial' | 'usb' | 'tcp' | 'ethernet'
  endpoint_config: string
  station_id?: string
  operator_id?: string
  organization_id: string
  timestamp: string
}

export interface CubiScanMeasurementPayload {
  device_id: string
  organization_id: string
  idempotency_key: string
  measured_at: string
  barcode_raw: string
  length: number
  width: number
  height: number
  weight: number
  dimension_unit: 'cm' | 'in'
  weight_unit: 'kg' | 'lb'
  stability_score: number
  raw_payload: Record<string, unknown>
  parser_version: string
  material_number?: string
  reference_type?: string
  reference_id?: string
  operator_id?: string
  station_id?: string
}

export interface CubiScanBridgeError {
  device_id: string
  organization_id: string
  error_code: string
  error_message: string
  raw_payload?: Record<string, unknown>
  timestamp: string
}

export interface CubiScanDeviceStateChange {
  device_id: string
  organization_id: string
  previous_state: DeviceConnectionState
  new_state: DeviceConnectionState
  reason?: string
  timestamp: string
}

// ---------------------------------------------------------------------------
// Device & session state
// ---------------------------------------------------------------------------

export type DeviceConnectionState =
  | 'online'
  | 'offline'
  | 'measuring'
  | 'error'
  | 'calibrating'
  | 'stale'

export type SessionStatus = 'active' | 'stale' | 'ended'

export interface CubiScanDevice {
  id: string
  organization_id: string
  device_id: string
  device_name: string
  model: string
  firmware_version: string
  connection_method: 'serial' | 'usb' | 'tcp' | 'ethernet'
  endpoint_config: string
  calibration_metadata: Record<string, unknown> | null
  health_score: number | null
  last_heartbeat_at: string | null
  connection_state: DeviceConnectionState
  station_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CubiScanDeviceSession {
  id: string
  device_id: string
  operator_id: string | null
  started_at: string
  last_heartbeat_at: string | null
  ended_at: string | null
  status: SessionStatus
  measurements_count: number
  errors_count: number
  created_at: string
}

// ---------------------------------------------------------------------------
// Measurement state
// ---------------------------------------------------------------------------

export type MeasurementStatus =
  | 'received'
  | 'parsed'
  | 'parse_failed'
  | 'validated'
  | 'mismatch'
  | 'superseded'

export type ReconciliationStatus =
  | 'pending'
  | 'approved'
  | 'applied'
  | 'rejected'
  | 'quarantined'
  | 'overridden'

export interface CubiScanMeasurement {
  id: string
  organization_id: string
  device_id: string
  session_id: string | null
  ingest_event_id: string | null
  measured_at: string
  barcode_raw: string
  barcode_normalized: string | null
  material_number: string | null
  material_description: string | null
  reference_type: string | null
  reference_id: string | null
  length: number
  width: number
  height: number
  weight: number
  dimensional_weight: number | null
  volume: number | null
  dimension_unit: 'cm' | 'in'
  weight_unit: 'kg' | 'lb'
  dim_factor: number
  stability_score: number | null
  measurement_status: MeasurementStatus
  reconciliation_status: ReconciliationStatus
  superseded_by_measurement_id: string | null
  operator_id: string | null
  operator_name: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type ReconciliationActionType =
  | 'approve'
  | 'reject'
  | 'apply'
  | 'quarantine'
  | 'override'
  | 'reprocess'

export interface CubiScanReconciliationAction {
  id: string
  measurement_id: string
  action_type: ReconciliationActionType
  previous_status: ReconciliationStatus
  new_status: ReconciliationStatus
  target_table: string | null
  target_id: string | null
  payload: Record<string, unknown> | null
  actor_id: string
  actor_name: string | null
  reason: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface CubiScanStatistics {
  total_measurements: number
  today_measurements: number
  live_devices: number
  needs_review: number
  failed_ingests: number
  stale_devices: number
  avg_length: number | null
  avg_width: number | null
  avg_height: number | null
  avg_weight: number | null
  scans_last_15_min: number
}

// ---------------------------------------------------------------------------
// Search / filter
// ---------------------------------------------------------------------------

export interface CubiScanSearchParams {
  page: number
  pageSize: number
  search?: string
  measurement_status?: MeasurementStatus
  reconciliation_status?: ReconciliationStatus
  device_id?: string
  date_from?: string
  date_to?: string
}

export interface CubiScanPaginatedResult {
  data: CubiScanMeasurement[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ---------------------------------------------------------------------------
// Quick views
// ---------------------------------------------------------------------------

export type CubiScanQuickView =
  | 'all'
  | 'needs_review'
  | 'failed'
  | 'stale_devices'

// Created and developed by Jai Singh
