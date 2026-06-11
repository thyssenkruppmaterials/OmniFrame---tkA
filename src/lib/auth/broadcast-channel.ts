// Created and developed by Jai Singh
import { logger } from '@/lib/utils/logger'

/**
 * Auth Broadcast Channel
 *
 * Provides explicit cross-tab communication for authentication events.
 * Supplements Supabase's built-in onAuthStateChange with additional
 * custom events for fine-grained session management.
 *
 * @date 2026-02-05
 */

type AuthBroadcastMessage =
  | { type: 'SESSION_EXPIRED'; userId: string }
  | { type: 'SESSION_EXTENDED'; userId: string; expiresAt: string }
  | { type: 'SIGNED_OUT'; userId: string }
  | { type: 'PERMISSIONS_UPDATED'; userId: string }
  | { type: 'SHOW_EXPIRY_WARNING'; timeRemaining: number }
  | { type: 'DISMISS_EXPIRY_WARNING' }

type AuthBroadcastListener = (message: AuthBroadcastMessage) => void

const CHANNEL_NAME = 'onebox-auth-channel'

class AuthBroadcastChannelManager {
  private channel: BroadcastChannel | null = null
  private listeners: Set<AuthBroadcastListener> = new Set()
  private isSupported: boolean

  constructor() {
    this.isSupported =
      typeof window !== 'undefined' && 'BroadcastChannel' in window
    if (this.isSupported) {
      this.initialize()
    }
  }

  private initialize() {
    try {
      this.channel = new BroadcastChannel(CHANNEL_NAME)
      this.channel.onmessage = (event: MessageEvent<AuthBroadcastMessage>) => {
        this.listeners.forEach((listener) => {
          try {
            listener(event.data)
          } catch (error) {
            logger.error('Error in auth broadcast listener:', error)
          }
        })
      }
    } catch (error) {
      logger.warn('BroadcastChannel not available:', error)
      this.isSupported = false
    }
  }

  broadcast(message: AuthBroadcastMessage) {
    if (!this.isSupported || !this.channel) return
    try {
      this.channel.postMessage(message)
    } catch (error) {
      logger.warn('Failed to broadcast auth message:', error)
    }
  }

  addListener(listener: AuthBroadcastListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  removeListener(listener: AuthBroadcastListener) {
    this.listeners.delete(listener)
  }

  destroy() {
    if (this.channel) {
      this.channel.close()
      this.channel = null
    }
    this.listeners.clear()
  }
}

// Singleton instance
export const authBroadcast = new AuthBroadcastChannelManager()
export type { AuthBroadcastMessage, AuthBroadcastListener }

// Created and developed by Jai Singh
