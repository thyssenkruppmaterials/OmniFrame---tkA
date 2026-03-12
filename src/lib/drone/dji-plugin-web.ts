/**
 * DJI Drone Plugin - Web Implementation
 *
 * This provides a mock/simulated implementation for web browsers
 * to enable development and testing without actual drone hardware.
 */
import { WebPlugin } from '@capacitor/core'
import { logger } from '@/lib/utils/logger'
import type {
  DJIDronePlugin,
  ConnectionResult,
  PhotoCaptureResult,
  TelemetryData,
  DroneInfo,
  MissionConfig,
  MissionStartResult,
  MissionStatus,
} from './dji-plugin'

export class DJIDroneWeb extends WebPlugin implements DJIDronePlugin {
  private isConnected: boolean = false
  private currentMissionId: string | null = null
  private missionProgress: number = 0
  private missionInterval: ReturnType<typeof setInterval> | null = null

  async connect(): Promise<ConnectionResult> {
    // Simulate connection delay
    await this.delay(1000)

    this.isConnected = true

    return {
      connected: true,
      message: 'Connected to simulated drone (Web Mode)',
      droneModel: 'Web Simulator',
    }
  }

  async disconnect(): Promise<{ disconnected: boolean; message: string }> {
    this.isConnected = false
    this.stopMissionSimulation()

    return {
      disconnected: true,
      message: 'Disconnected from simulated drone',
    }
  }

  async getConnectionStatus(): Promise<{
    connected: boolean
    sdkRegistered: boolean
  }> {
    return {
      connected: this.isConnected,
      sdkRegistered: true,
    }
  }

  async capturePhoto(): Promise<PhotoCaptureResult> {
    if (!this.isConnected) {
      throw new Error('Not connected to drone')
    }

    // Simulate capture delay
    await this.delay(500)

    // Get browser geolocation if available
    let gps = { lat: 0, lng: 0, alt: 0, accuracy: 0, timestamp: Date.now() }

    try {
      const position = await this.getCurrentPosition()
      gps = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        alt: position.coords.altitude || 0,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      logger.warn('Geolocation not available, using default coordinates')
      // Default to a warehouse location for simulation
      gps = {
        lat: 40.7128,
        lng: -74.006,
        alt: 10,
        accuracy: 5,
        timestamp: Date.now(),
      }
    }

    const timestamp = Date.now()
    const imageName = `drone_capture_${timestamp}.jpg`

    return {
      success: true,
      imagePath: `/simulated/images/${imageName}`,
      imageName,
      gps,
      capturedAt: new Date().toISOString(),
      simulated: true,
    }
  }

  async getTelemetry(): Promise<TelemetryData> {
    if (!this.isConnected) {
      throw new Error('Not connected to drone')
    }

    let gps = undefined

    try {
      const position = await this.getCurrentPosition()
      gps = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        alt: position.coords.altitude || 10,
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // Use simulated location
      gps = {
        lat: 40.7128 + (Math.random() - 0.5) * 0.001,
        lng: -74.006 + (Math.random() - 0.5) * 0.001,
        alt: 10 + Math.random() * 5,
      }
    }

    return {
      connected: this.isConnected,
      timestamp: new Date().toISOString(),
      gps,
      battery: {
        percentage: 85 - Math.floor(Math.random() * 5),
        voltage: 15.2 + (Math.random() - 0.5) * 0.2,
        temperature: 25 + Math.floor(Math.random() * 5),
      },
      attitude: {
        pitch: (Math.random() - 0.5) * 5,
        roll: (Math.random() - 0.5) * 5,
        yaw: Math.random() * 360,
      },
      velocity: {
        x: (Math.random() - 0.5) * 2,
        y: (Math.random() - 0.5) * 2,
        z: (Math.random() - 0.5) * 0.5,
      },
      altitude: gps.alt,
      heading: Math.random() * 360,
      isFlying: this.currentMissionId !== null,
      flightMode: 'P-GPS',
      simulated: true,
    }
  }

  async getDroneInfo(): Promise<DroneInfo> {
    if (!this.isConnected) {
      throw new Error('Not connected to drone')
    }

    return {
      model: 'Web Simulator',
      serialNumber: 'WEB-SIM-001',
      firmwareVersion: '1.0.0',
      sdkVersion: 'N/A (Web)',
      simulated: true,
    }
  }

  async startMission(options: MissionConfig): Promise<MissionStartResult> {
    if (!this.isConnected) {
      throw new Error('Not connected to drone')
    }

    if (!options.waypoints || options.waypoints.length === 0) {
      throw new Error('No waypoints provided')
    }

    const missionId = `web-mission-${Date.now()}`
    this.currentMissionId = missionId
    this.missionProgress = 0

    // Simulate mission progress
    this.startMissionSimulation(options.waypoints.length)

    return {
      success: true,
      missionId,
      missionName: options.name || 'Web Simulated Mission',
      waypointCount: options.waypoints.length,
      status: 'started',
      message: 'Mission started (simulated)',
    }
  }

  async stopMission(): Promise<{
    success: boolean
    missionId: string
    status: string
    message: string
  }> {
    if (!this.currentMissionId) {
      throw new Error('No active mission')
    }

    const missionId = this.currentMissionId
    this.stopMissionSimulation()

    return {
      success: true,
      missionId,
      status: 'stopped',
      message: 'Mission stopped',
    }
  }

  async getMissionStatus(options?: {
    missionId?: string
  }): Promise<MissionStatus> {
    const missionId = options?.missionId || this.currentMissionId

    if (!missionId) {
      return {
        missionId: '',
        status: 'planned',
        progress: 0,
        currentWaypoint: 0,
        totalWaypoints: 0,
        isActive: false,
      }
    }

    const isActive = this.currentMissionId === missionId

    return {
      missionId,
      status: isActive ? 'in_progress' : 'completed',
      progress: isActive ? this.missionProgress : 1,
      currentWaypoint: Math.floor(this.missionProgress * 10),
      totalWaypoints: 10,
      isActive,
    }
  }

  // ==================== Private Helpers ====================

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private getCurrentPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not available'))
        return
      }

      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0,
      })
    })
  }

  private startMissionSimulation(waypointCount: number): void {
    this.stopMissionSimulation()

    const progressIncrement = 1 / (waypointCount * 10) // 10 steps per waypoint

    this.missionInterval = setInterval(() => {
      this.missionProgress += progressIncrement

      if (this.missionProgress >= 1) {
        this.missionProgress = 1
        this.stopMissionSimulation()
        this.currentMissionId = null
      }
    }, 500)
  }

  private stopMissionSimulation(): void {
    if (this.missionInterval) {
      clearInterval(this.missionInterval)
      this.missionInterval = null
    }
    this.currentMissionId = null
    this.missionProgress = 0
  }
}
