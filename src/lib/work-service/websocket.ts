// Created and developed by Jai Singh
/**
 * Work Service WebSocket Client
 * Handles real-time communication with the Rust work service
 * Implements automatic reconnection with exponential backoff
 * Features graceful degradation when service is unavailable
 */
import { logger } from '@/lib/utils/logger'
import type { HeartbeatData, WsEvent, WsOutgoingMessage } from './types'

// WebSocket URL (defaults to localhost for development)
const WS_URL =
  import.meta.env.VITE_WORK_SERVICE_WS_URL || 'ws://localhost:8030/ws'

/**
 * Event handler type for WebSocket events
 */
export type WsEventHandler = (event: WsEvent) => void

/**
 * Connection state for external monitoring
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'unavailable'

/**
 * Error handler type for connection errors
 */
export type ErrorHandler = (error: Error, context: string) => void

/**
 * Work Service WebSocket Client Class
 * Manages WebSocket connection lifecycle and event distribution
 */
export class WorkServiceWebSocket {
  private socket: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private baseReconnectDelay = 1000 // 1 second
  private maxReconnectDelay = 30000 // 30 seconds
  private eventHandlers: Set<WsEventHandler> = new Set()
  private organizationId: string | null = null
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private connectionState: ConnectionState = 'disconnected'
  private stateChangeCallbacks: Set<(state: ConnectionState) => void> =
    new Set()
  private errorHandlers: Set<ErrorHandler> = new Set()
  private lastError: Error | null = null
  private serviceAvailable = true // Track if service appears to be available
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private lastPongTime: number = 0

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState
  }

  /**
   * Get the last error that occurred
   */
  getLastError(): Error | null {
    return this.lastError
  }

  /**
   * Check if the work service appears to be available
   */
  isServiceAvailable(): boolean {
    return this.serviceAvailable
  }

  /**
   * Subscribe to connection state changes
   */
  onStateChange(callback: (state: ConnectionState) => void): () => void {
    this.stateChangeCallbacks.add(callback)
    return () => this.stateChangeCallbacks.delete(callback)
  }

  /**
   * Subscribe to error events
   */
  onError(callback: ErrorHandler): () => void {
    this.errorHandlers.add(callback)
    return () => this.errorHandlers.delete(callback)
  }

  /**
   * Update connection state and notify subscribers
   */
  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state
      this.stateChangeCallbacks.forEach((cb) => cb(state))
    }
  }

  /**
   * Handle and notify error
   */
  private handleError(error: Error, context: string): void {
    this.lastError = error
    logger.error(`[WorkServiceWS] Error (${context}):`, error.message)
    this.errorHandlers.forEach((handler) => {
      try {
        handler(error, context)
      } catch (e) {
        logger.error('[WorkServiceWS] Error in error handler:', e)
      }
    })
  }

  /**
   * Connect to the work service WebSocket
   * @param organizationId - Organization ID to subscribe to
   * @param onEvent - Event handler for incoming messages
   */
  connect(organizationId: string, onEvent: WsEventHandler): void {
    this.organizationId = organizationId
    this.eventHandlers.add(onEvent)

    // Don't create a new connection if already connected
    if (this.socket?.readyState === WebSocket.OPEN) {
      logger.log('[WorkServiceWS] Already connected')
      return
    }

    // Don't create multiple connecting sockets
    if (this.socket?.readyState === WebSocket.CONNECTING) {
      logger.log('[WorkServiceWS] Connection in progress')
      return
    }

    // If service is marked as unavailable after max retries, don't attempt
    if (this.connectionState === 'unavailable') {
      logger.warn(
        '[WorkServiceWS] Service unavailable, skipping connection attempt'
      )
      return
    }

    this.setConnectionState('connecting')
    this.createConnection()
  }

  /**
   * Create the WebSocket connection
   */
  private createConnection(): void {
    if (!this.organizationId) {
      const error = new Error('No organization ID set')
      this.handleError(error, 'createConnection')
      return
    }

    logger.log(`[WorkServiceWS] Connecting to ${WS_URL}...`)

    try {
      this.socket = new WebSocket(WS_URL)
      this.setupSocketHandlers()
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error('Failed to create WebSocket')
      this.handleError(err, 'createConnection')
      this.setConnectionState('disconnected')
      this.attemptReconnect()
    }
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupSocketHandlers(): void {
    if (!this.socket) return

    this.socket.onopen = () => {
      logger.log('[WorkServiceWS] Connected')
      this.reconnectAttempts = 0
      this.serviceAvailable = true
      this.lastError = null
      this.setConnectionState('connected')

      // Subscribe to organization events
      if (this.organizationId) {
        this.send({
          type: 'Subscribe',
          organization_id: this.organizationId,
        })
      }

      // Start ping interval to detect connection health
      this.startPingInterval()
    }

    this.socket.onmessage = (event) => {
      try {
        const wsEvent = JSON.parse(event.data) as WsEvent

        // Track pong for connection health
        if (wsEvent.type === 'Heartbeat') {
          this.lastPongTime = Date.now()
        }

        logger.log('[WorkServiceWS] Received:', wsEvent.type)
        this.eventHandlers.forEach((handler) => {
          try {
            handler(wsEvent)
          } catch (e) {
            logger.error('[WorkServiceWS] Error in event handler:', e)
          }
        })
      } catch (e) {
        const error =
          e instanceof Error ? e : new Error('Failed to parse message')
        this.handleError(error, 'onmessage')
      }
    }

    this.socket.onclose = (event) => {
      logger.log(
        `[WorkServiceWS] Disconnected (code: ${event.code}, reason: ${event.reason || 'none'})`
      )
      this.stopPingInterval()
      this.setConnectionState('disconnected')

      // Clean close codes (1000, 1001) indicate intentional disconnect
      const isCleanClose = event.code === 1000 || event.code === 1001

      // Only attempt reconnect if we still have handlers and it wasn't a clean close
      if (!isCleanClose && this.eventHandlers.size > 0 && this.organizationId) {
        this.attemptReconnect()
      }
    }

    this.socket.onerror = (_event) => {
      // WebSocket error events don't provide much detail
      const error = new Error('WebSocket connection error')
      this.handleError(error, 'onerror')
    }
  }

  /**
   * Start ping interval to detect connection health
   */
  private startPingInterval(): void {
    this.stopPingInterval()
    this.lastPongTime = Date.now()

    // Ping every 25 seconds (less than typical 30s timeout)
    this.pingInterval = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        // Check if we've received a response recently
        const timeSinceLastPong = Date.now() - this.lastPongTime
        if (timeSinceLastPong > 60000) {
          // No response in 60 seconds, connection might be dead
          logger.warn(
            '[WorkServiceWS] Connection appears stale, reconnecting...'
          )
          this.socket.close()
          return
        }

        // Send a heartbeat as a ping
        this.sendHeartbeat({ status: 'ping' })
      }
    }, 25000)
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.warn(
        '[WorkServiceWS] Max reconnect attempts reached, marking service as unavailable'
      )
      this.serviceAvailable = false
      this.setConnectionState('unavailable')
      this.handleError(
        new Error('Work service unavailable after max reconnect attempts'),
        'attemptReconnect'
      )
      return
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }

    // Exponential backoff with jitter
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts) +
        Math.random() * 1000,
      this.maxReconnectDelay
    )

    this.reconnectAttempts++
    this.setConnectionState('reconnecting')

    logger.log(
      `[WorkServiceWS] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
    )

    this.reconnectTimeout = setTimeout(() => {
      this.createConnection()
    }, delay)
  }

  /**
   * Send a message through the WebSocket
   */
  private send(message: WsOutgoingMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message))
    } else {
      logger.warn('[WorkServiceWS] Cannot send - socket not open')
    }
  }

  /**
   * Disconnect from the WebSocket
   */
  disconnect(): void {
    logger.log('[WorkServiceWS] Disconnecting...')

    // Stop ping interval
    this.stopPingInterval()

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.socket) {
      // Send unsubscribe message before closing
      if (this.socket.readyState === WebSocket.OPEN) {
        this.send({ type: 'Unsubscribe' })
      }
      this.socket.close(1000, 'Client disconnect')
      this.socket = null
    }

    this.eventHandlers.clear()
    this.errorHandlers.clear()
    this.stateChangeCallbacks.clear()
    this.organizationId = null
    this.reconnectAttempts = 0
    this.lastError = null
    this.setConnectionState('disconnected')
  }

  /**
   * Send a heartbeat through WebSocket
   * Alternative to HTTP heartbeat for lower latency
   * Fails silently if service is unavailable (graceful degradation)
   */
  sendHeartbeat(data: HeartbeatData): void {
    // Don't log warnings if service is known to be unavailable
    if (!this.serviceAvailable) {
      return
    }

    if (this.socket?.readyState === WebSocket.OPEN) {
      this.send({
        type: 'Heartbeat',
        ...data,
      })
    } else if (
      this.connectionState !== 'connecting' &&
      this.connectionState !== 'reconnecting'
    ) {
      // Only warn if we're not in the process of connecting
      logger.debug('[WorkServiceWS] Cannot send heartbeat - socket not open')
    }
  }

  /**
   * Remove a specific event handler
   */
  removeHandler(handler: WsEventHandler): void {
    this.eventHandlers.delete(handler)

    // If no more handlers, disconnect
    if (this.eventHandlers.size === 0) {
      logger.log('[WorkServiceWS] No more handlers, disconnecting...')
      this.disconnect()
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  /**
   * Force reconnection (useful for testing or manual recovery)
   */
  reconnect(): void {
    logger.log('[WorkServiceWS] Forcing reconnection...')
    this.reconnectAttempts = 0
    this.serviceAvailable = true // Reset availability on manual reconnect
    this.lastError = null

    this.stopPingInterval()

    if (this.socket) {
      this.socket.close()
      this.socket = null
    }

    if (this.organizationId && this.eventHandlers.size > 0) {
      this.setConnectionState('connecting')
      this.createConnection()
    }
  }

  /**
   * Retry connection after service was marked unavailable
   * Call this after some time to check if service is back
   */
  retryAfterUnavailable(): void {
    if (this.connectionState !== 'unavailable') {
      logger.log(
        '[WorkServiceWS] Service is not marked unavailable, use reconnect() instead'
      )
      return
    }

    logger.log('[WorkServiceWS] Retrying after service unavailable...')
    this.serviceAvailable = true
    this.reconnectAttempts = 0
    this.lastError = null
    this.setConnectionState('connecting')
    this.createConnection()
  }

  /**
   * Get connection info for debugging
   */
  getConnectionInfo(): {
    state: ConnectionState
    reconnectAttempts: number
    maxReconnectAttempts: number
    serviceAvailable: boolean
    hasHandlers: boolean
    organizationId: string | null
    lastError: string | null
  } {
    return {
      state: this.connectionState,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      serviceAvailable: this.serviceAvailable,
      hasHandlers: this.eventHandlers.size > 0,
      organizationId: this.organizationId,
      lastError: this.lastError?.message || null,
    }
  }
}

/**
 * Singleton instance for global WebSocket connection
 * Use this for app-wide real-time updates
 */
export const workServiceWs = new WorkServiceWebSocket()

// Created and developed by Jai Singh
