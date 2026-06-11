// Created and developed by Jai Singh
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

const API_BASE_URL = (() => {
  if (typeof window !== 'undefined') {
    const currentOrigin = window.location.origin
    if (currentOrigin === 'http://localhost:5173') {
      return 'http://localhost:8000'
    }
    return currentOrigin
  }
  return import.meta.env.VITE_API_URL || 'http://localhost:8000'
})()

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`
    } else {
      const {
        data: { session: refreshed },
      } = await supabase.auth.refreshSession()
      if (refreshed?.access_token) {
        headers['Authorization'] = `Bearer ${refreshed.access_token}`
      }
    }
  } catch {
    logger.error('[railway-monitoring] Failed to retrieve auth token')
  }
  return headers
}

// ---- Types -----------------------------------------------------------------

export interface RailwayServiceInfo {
  id: string
  name: string
  icon: string | null
  latestDeployment: {
    id: string
    status: string
    created_at: string
  } | null
  region: string | null
  numReplicas: number | null
}

export interface RailwayOverview {
  projectId: string
  projectName: string
  environmentId: string
  environmentName: string
  services: RailwayServiceInfo[]
}

export interface NormalizedLog {
  timestamp: string
  severity: 'info' | 'warn' | 'error' | 'debug'
  message: string
  service_id: string
  service_name: string
  deployment_id: string
  kind: 'runtime' | 'build' | 'http'
  http_status: number | null
  request_id: string
  method: string
  path: string
  dedup_key: string
}

export interface RuntimeLogsResponse {
  logs: NormalizedLog[]
  count: number
}

export interface DeploymentInfo {
  id: string
  status: string
  createdAt: string
  url: string
}

export interface DeploymentsResponse {
  deployments: DeploymentInfo[]
  count: number
}

export interface DeploymentLogsResponse {
  logs: NormalizedLog[]
  count: number
  kind: string
}

export type LogKind = 'runtime' | 'build' | 'http'

// ---- API -------------------------------------------------------------------

export class RailwayMonitoringService {
  static async getOverview(): Promise<RailwayOverview> {
    const headers = await getAuthHeaders()
    const response = await fetch(`${API_BASE_URL}/api/admin/railway/overview`, {
      headers,
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed' }))
      throw new Error(err.detail || `HTTP ${response.status}`)
    }
    return response.json()
  }

  static async getRuntimeLogs(params: {
    serviceId?: string
    filter?: string
    limit?: number
  }): Promise<RuntimeLogsResponse> {
    const headers = await getAuthHeaders()
    const url = new URL(`${API_BASE_URL}/api/admin/railway/runtime-logs`)
    if (params.serviceId) url.searchParams.set('serviceId', params.serviceId)
    if (params.filter) url.searchParams.set('filter', params.filter)
    if (params.limit) url.searchParams.set('limit', String(params.limit))

    const response = await fetch(url.toString(), { headers })
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed' }))
      throw new Error(err.detail || `HTTP ${response.status}`)
    }
    return response.json()
  }

  static async getDeployments(params: {
    serviceId: string
    limit?: number
  }): Promise<DeploymentsResponse> {
    const headers = await getAuthHeaders()
    const url = new URL(`${API_BASE_URL}/api/admin/railway/deployments`)
    url.searchParams.set('serviceId', params.serviceId)
    if (params.limit) url.searchParams.set('limit', String(params.limit))

    const response = await fetch(url.toString(), { headers })
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed' }))
      throw new Error(err.detail || `HTTP ${response.status}`)
    }
    return response.json()
  }

  static async getDeploymentLogs(params: {
    deploymentId: string
    kind?: LogKind
    limit?: number
  }): Promise<DeploymentLogsResponse> {
    const headers = await getAuthHeaders()
    const url = new URL(`${API_BASE_URL}/api/admin/railway/deployment-logs`)
    url.searchParams.set('deploymentId', params.deploymentId)
    if (params.kind) url.searchParams.set('kind', params.kind)
    if (params.limit) url.searchParams.set('limit', String(params.limit))

    const response = await fetch(url.toString(), { headers })
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed' }))
      throw new Error(err.detail || `HTTP ${response.status}`)
    }
    return response.json()
  }
}

// Created and developed by Jai Singh
