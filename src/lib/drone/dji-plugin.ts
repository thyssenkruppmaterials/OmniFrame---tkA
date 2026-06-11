// Created and developed by Jai Singh
/**
 * DJI Drone Plugin Interface
 *
 * TypeScript interface for the native DJI drone Capacitor plugin.
 * This provides type-safe access to drone operations for warehouse scanning.
 */
import { registerPlugin } from '@capacitor/core'

// ==================== Types ====================

export interface GPSData {
  lat: number
  lng: number
  alt: number
  accuracy?: number
  timestamp?: number
}

export interface BatteryStatus {
  percentage: number
  voltage: number
  temperature: number
}

export interface AttitudeData {
  pitch: number
  roll: number
  yaw: number
}

export interface VelocityData {
  x: number
  y: number
  z: number
}

export interface TelemetryData {
  connected: boolean
  timestamp: string
  gps?: GPSData
  battery?: BatteryStatus
  attitude?: AttitudeData
  velocity?: VelocityData
  altitude?: number
  heading?: number
  isFlying?: boolean
  flightMode?: string
  simulated?: boolean
}

export interface DroneInfo {
  model: string
  serialNumber: string
  firmwareVersion: string
  sdkVersion: string
  simulated?: boolean
}

export interface Waypoint {
  lat: number
  lng: number
  alt?: number
  action?: 'takePhoto' | 'hover' | 'rotate'
  dwellTime?: number // seconds to hover at waypoint
}

export interface MissionConfig {
  name?: string
  waypoints: Waypoint[]
  autoTakeoff?: boolean
  autoLand?: boolean
  speed?: number // m/s
}

export interface MissionStatus {
  missionId: string
  status:
    | 'planned'
    | 'starting'
    | 'in_progress'
    | 'paused'
    | 'completed'
    | 'stopped'
    | 'failed'
  progress: number // 0-1
  currentWaypoint: number
  totalWaypoints: number
  isActive: boolean
  error?: string
}

export interface PhotoCaptureResult {
  success: boolean
  imagePath: string
  imageName: string
  gps: GPSData
  capturedAt: string
  simulated?: boolean
}

export interface ConnectionResult {
  connected: boolean
  message: string
  droneModel?: string
}

export interface MissionStartResult {
  success: boolean
  missionId: string
  missionName: string
  waypointCount: number
  status: string
  message: string
}

// ==================== Plugin Interface ====================

export interface DJIDronePlugin {
  /**
   * Connect to a DJI drone.
   * Must be called before any other drone operations.
   */
  connect(): Promise<ConnectionResult>

  /**
   * Disconnect from the drone.
   */
  disconnect(): Promise<{ disconnected: boolean; message: string }>

  /**
   * Get current connection status.
   */
  getConnectionStatus(): Promise<{ connected: boolean; sdkRegistered: boolean }>

  /**
   * Capture a photo with the drone camera.
   * Returns the image path and GPS coordinates.
   */
  capturePhoto(): Promise<PhotoCaptureResult>

  /**
   * Get current telemetry data from the drone.
   * Includes GPS, battery, attitude, velocity, etc.
   */
  getTelemetry(): Promise<TelemetryData>

  /**
   * Get information about the connected drone.
   */
  getDroneInfo(): Promise<DroneInfo>

  /**
   * Start a waypoint mission.
   * The drone will fly to each waypoint and optionally take photos.
   */
  startMission(options: MissionConfig): Promise<MissionStartResult>

  /**
   * Stop the current mission.
   * The drone will hover in place or return to home depending on configuration.
   */
  stopMission(): Promise<{
    success: boolean
    missionId: string
    status: string
    message: string
  }>

  /**
   * Get the status of a mission.
   * If no missionId is provided, returns status of current mission.
   */
  getMissionStatus(options?: { missionId?: string }): Promise<MissionStatus>
}

// ==================== Plugin Registration ====================

/**
 * Registered DJI Drone plugin instance.
 *
 * Usage:
 * ```typescript
 * import { DJIDrone } from '@/lib/drone/dji-plugin'
 *
 * // Connect to drone
 * const result = await DJIDrone.connect()
 *
 * // Capture photo
 * const photo = await DJIDrone.capturePhoto()
 *
 * // Get telemetry
 * const telemetry = await DJIDrone.getTelemetry()
 * ```
 */
export const DJIDrone = registerPlugin<DJIDronePlugin>('DJIDrone', {
  web: () => import('./dji-plugin-web').then((m) => new m.DJIDroneWeb()),
})

// ==================== Helper Functions ====================

/**
 * Check if the plugin is available (native platform).
 */
export function isDJIPluginAvailable(): boolean {
  return typeof DJIDrone !== 'undefined'
}

/**
 * Create a simple grid mission pattern for warehouse scanning.
 *
 * @param startLat Starting latitude
 * @param startLng Starting longitude
 * @param rows Number of rows in the grid
 * @param cols Number of columns in the grid
 * @param spacingMeters Distance between waypoints in meters
 * @param altitude Flight altitude in meters
 */
export function createGridMission(
  startLat: number,
  startLng: number,
  rows: number,
  cols: number,
  spacingMeters: number,
  altitude: number
): Waypoint[] {
  const waypoints: Waypoint[] = []

  // Approximate meters to degrees conversion
  const metersPerDegreeLat = 111320
  const metersPerDegreeLng = 111320 * Math.cos((startLat * Math.PI) / 180)

  const latSpacing = spacingMeters / metersPerDegreeLat
  const lngSpacing = spacingMeters / metersPerDegreeLng

  for (let row = 0; row < rows; row++) {
    // Alternate direction for efficiency (snake pattern)
    const colStart = row % 2 === 0 ? 0 : cols - 1
    const colEnd = row % 2 === 0 ? cols : -1
    const colStep = row % 2 === 0 ? 1 : -1

    for (let col = colStart; col !== colEnd; col += colStep) {
      waypoints.push({
        lat: startLat + row * latSpacing,
        lng: startLng + col * lngSpacing,
        alt: altitude,
        action: 'takePhoto',
        dwellTime: 2, // 2 seconds to stabilize and capture
      })
    }
  }

  return waypoints
}

/**
 * Create a simple aisle-following mission.
 *
 * @param aislePath Array of GPS coordinates defining the aisle
 * @param altitude Flight altitude in meters
 * @param photoInterval Take a photo every N waypoints
 */
export function createAisleMission(
  aislePath: { lat: number; lng: number }[],
  altitude: number,
  photoInterval: number = 1
): Waypoint[] {
  return aislePath.map((point, index) => ({
    lat: point.lat,
    lng: point.lng,
    alt: altitude,
    action: index % photoInterval === 0 ? 'takePhoto' : 'hover',
    dwellTime: index % photoInterval === 0 ? 2 : 0,
  }))
}

// Created and developed by Jai Singh
