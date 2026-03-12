/**
 * Work Service Module
 * Central export for all work service functionality
 *
 * This module provides TypeScript interfaces and clients for
 * communicating with the Rust work service (Port 8030)
 */

// Types
export type {
  ClaimResponse,
  CycleCountPriority,
  CycleCountTask,
  HeartbeatData,
  PushMode,
  PushWorkRequest,
  QueueStats,
  TaskResult,
  WorkServiceError,
  WorkerStatus,
  WorkerStatusType,
  WorkerWithTasks,
  WsEvent,
  WsEventType,
  WsHeartbeatMessage,
  WsOutgoingMessage,
  WsSubscribeMessage,
  WsUnsubscribeMessage,
} from './types'

// HTTP Client
export {
  getWorkServiceUrl,
  setWorkServiceOrganization,
  workServiceClient,
} from './client'

// WebSocket Client
export {
  WorkServiceWebSocket,
  workServiceWs,
  type ConnectionState,
  type ErrorHandler,
  type WsEventHandler,
} from './websocket'
