// Created and developed by Jai Singh
import { useState, useCallback, useEffect, useRef } from 'react'
import DeviceAgent from './device-agent-plugin'
import type { AgentStatus, TelemetryConfig } from './device-agent-plugin'

const MDM_SERVICE_URL =
  import.meta.env.VITE_MDM_SERVICE_URL || 'http://localhost:8040'

const DEFAULT_CONFIG: Partial<TelemetryConfig> = {
  serverUrl: MDM_SERVICE_URL,
  heartbeatIntervalSeconds: 300,
  locationUpdateIntervalSeconds: 600,
  healthReportIntervalSeconds: 1800,
  backgroundLocationEnabled: false,
  significantChangeOnly: true,
}

export function useDeviceAgent() {
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [isAvailable, setIsAvailable] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const checkAvailability = useCallback(async () => {
    try {
      const result = await DeviceAgent.getAgentStatus()
      setStatus(result)
      setIsAvailable(true)
    } catch {
      setIsAvailable(false)
    }
  }, [])

  const startAgent = useCallback(async (config: Partial<TelemetryConfig>) => {
    const fullConfig = { ...DEFAULT_CONFIG, ...config } as TelemetryConfig
    return DeviceAgent.startTelemetry(fullConfig)
  }, [])

  const stopAgent = useCallback(async () => {
    return DeviceAgent.stopTelemetry()
  }, [])

  useEffect(() => {
    checkAvailability()
    pollRef.current = setInterval(checkAvailability, 30_000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [checkAvailability])

  return {
    status,
    isAvailable,
    startAgent,
    stopAgent,
    refresh: checkAvailability,
  }
}

// Created and developed by Jai Singh
