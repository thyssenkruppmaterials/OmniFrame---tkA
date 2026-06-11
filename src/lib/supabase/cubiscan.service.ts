// Created and developed by Jai Singh
/**
 * CubiScan Service
 * Thin client over the FastAPI backend for search, detail, statistics,
 * device listing, export, and reconciliation actions.
 */
import type {
  CubiScanSearchParams,
  CubiScanPaginatedResult,
  CubiScanMeasurement,
  CubiScanStatistics,
  CubiScanDevice,
  CubiScanReconciliationAction,
  ReconciliationActionType,
} from '@/lib/cubiscan/types'

const API_BASE = import.meta.env.VITE_API_URL || ''

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { supabase } = await import('@/lib/supabase/client')
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token ?? ''

  const res = await fetch(`${API_BASE}/api/cubiscan${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? body.error ?? `CubiScan API ${res.status}`)
  }

  return res.json() as Promise<T>
}

interface APIResponse<T = unknown> {
  success: boolean
  data: T
  error?: string
}

interface PaginatedAPIResponse {
  success: boolean
  data: CubiScanMeasurement[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export class CubiScanService {
  private static instance: CubiScanService

  private constructor() {}

  static getInstance(): CubiScanService {
    if (!CubiScanService.instance) {
      CubiScanService.instance = new CubiScanService()
    }
    return CubiScanService.instance
  }

  async searchMeasurements(
    params: CubiScanSearchParams
  ): Promise<CubiScanPaginatedResult> {
    const qs = new URLSearchParams()
    qs.set('page', String(params.page))
    qs.set('page_size', String(params.pageSize))
    if (params.search) qs.set('search', params.search)
    if (params.measurement_status)
      qs.set('measurement_status', params.measurement_status)
    if (params.reconciliation_status)
      qs.set('reconciliation_status', params.reconciliation_status)
    if (params.device_id) qs.set('device_id', params.device_id)
    if (params.date_from) qs.set('date_from', params.date_from)
    if (params.date_to) qs.set('date_to', params.date_to)

    const result = await apiFetch<PaginatedAPIResponse>(
      `/measurements?${qs.toString()}`
    )

    return {
      data: result.data,
      total: result.total,
      page: result.page,
      pageSize: result.page_size,
      totalPages: result.total_pages,
    }
  }

  async getMeasurement(id: string): Promise<CubiScanMeasurement> {
    const result = await apiFetch<APIResponse<CubiScanMeasurement>>(
      `/measurements/${id}`
    )
    return result.data
  }

  async getStatistics(): Promise<CubiScanStatistics> {
    return apiFetch<CubiScanStatistics>('/statistics')
  }

  async listDevices(): Promise<CubiScanDevice[]> {
    const result = await apiFetch<APIResponse<CubiScanDevice[]>>('/devices')
    return result.data
  }

  async exportMeasurements(
    filters: Partial<CubiScanSearchParams>
  ): Promise<CubiScanMeasurement[]> {
    const qs = new URLSearchParams()
    if (filters.measurement_status)
      qs.set('measurement_status', filters.measurement_status)
    if (filters.reconciliation_status)
      qs.set('reconciliation_status', filters.reconciliation_status)
    if (filters.date_from) qs.set('date_from', filters.date_from)
    if (filters.date_to) qs.set('date_to', filters.date_to)

    const result = await apiFetch<APIResponse<CubiScanMeasurement[]>>(
      `/export?${qs.toString()}`
    )
    return result.data
  }

  async reconcile(
    measurementId: string,
    actionType: ReconciliationActionType,
    reason?: string
  ): Promise<void> {
    await apiFetch(`/measurements/${measurementId}/reconcile`, {
      method: 'POST',
      body: JSON.stringify({ action_type: actionType, reason }),
    })
  }

  async getMeasurementActions(
    measurementId: string
  ): Promise<CubiScanReconciliationAction[]> {
    const result = await apiFetch<APIResponse<CubiScanReconciliationAction[]>>(
      `/measurements/${measurementId}/actions`
    )
    return result.data
  }
}

export const cubiscanService = CubiScanService.getInstance()

// Created and developed by Jai Singh
