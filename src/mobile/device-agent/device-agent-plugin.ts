import { registerPlugin } from '@capacitor/core'

export interface DeviceAgentPlugin {
  startTelemetry(options: TelemetryConfig): Promise<{ status: string }>
  stopTelemetry(): Promise<{ status: string }>
  getAgentStatus(): Promise<AgentStatus>
  sendHeartbeat(): Promise<{ status: string }>
  reportLocation(): Promise<LocationReport>
  getDeviceHealth(): Promise<DeviceHealthReport>
  setConfig(options: Partial<TelemetryConfig>): Promise<{ status: string }>
}

export interface TelemetryConfig {
  serverUrl: string
  enrollmentToken: string
  deviceId: string
  heartbeatIntervalSeconds: number
  locationUpdateIntervalSeconds: number
  healthReportIntervalSeconds: number
  backgroundLocationEnabled: boolean
  significantChangeOnly: boolean
}

export interface AgentStatus {
  isRunning: boolean
  lastHeartbeat: string | null
  lastLocationUpdate: string | null
  lastHealthReport: string | null
  agentVersion: string
  queuedEvents: number
  consecutiveFailures: number
}

export interface LocationReport {
  latitude: number
  longitude: number
  altitude: number | null
  horizontalAccuracy: number
  verticalAccuracy: number | null
  speed: number | null
  heading: number | null
  timestamp: string
}

export interface DeviceHealthReport {
  batteryLevel: number
  batteryState: 'charging' | 'discharging' | 'full' | 'unknown'
  totalDiskBytes: number
  freeDiskBytes: number
  memoryUsedBytes: number
  networkType: 'wifi' | 'cellular' | 'none' | 'unknown'
  carrierName: string | null
  isRoaming: boolean
  osVersion: string
  modelName: string
}

const DeviceAgent = registerPlugin<DeviceAgentPlugin>('DeviceAgent')

export default DeviceAgent
