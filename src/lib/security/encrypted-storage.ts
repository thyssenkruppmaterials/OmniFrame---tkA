import { logger } from '@/lib/utils/logger'

export class EncryptedSessionStorage {
  private static readonly STORAGE_KEY = 'omniframe_secure_session'
  private static readonly ENCRYPTION_KEY = 'omniframe_session_key_v1'

  static async storeSession(
    sessionData: Record<string, unknown>
  ): Promise<void> {
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16))
      const key = await this.deriveKey(this.ENCRYPTION_KEY, salt)

      const iv = crypto.getRandomValues(new Uint8Array(12))
      const data = JSON.stringify(sessionData)

      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(data)
      )

      const combined = new Uint8Array(
        salt.length + iv.length + encrypted.byteLength
      )
      combined.set(salt, 0)
      combined.set(iv, salt.length)
      combined.set(new Uint8Array(encrypted), salt.length + iv.length)

      localStorage.setItem(
        this.STORAGE_KEY,
        btoa(String.fromCharCode(...combined))
      )
    } catch (error) {
      logger.error('Session encryption failed:', error)
      throw new Error('CRITICAL: Session encryption failure')
    }
  }

  static async retrieveSession(): Promise<Record<string, unknown> | null> {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY)
      if (!stored) return null

      const combined = new Uint8Array(
        atob(stored)
          .split('')
          .map((c) => c.charCodeAt(0))
      )
      const salt = combined.slice(0, 16)
      const iv = combined.slice(16, 28)
      const encrypted = combined.slice(28)

      const key = await this.deriveKey(this.ENCRYPTION_KEY, salt)

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encrypted
      )

      const sessionData = JSON.parse(new TextDecoder().decode(decrypted))

      // Validate session integrity
      if (!this.validateSessionIntegrity(sessionData)) {
        await this.clearSession()
        return null
      }

      return sessionData
    } catch (error) {
      logger.error('Session decryption failed:', error)
      await this.clearSession()
      return null
    }
  }

  private static async deriveKey(
    password: string,
    salt: Uint8Array
  ): Promise<CryptoKey> {
    const encoder = new TextEncoder()
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    )

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as BufferSource,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  }

  private static validateSessionIntegrity(
    sessionData: Record<string, unknown>
  ): boolean {
    // Validate required session fields
    const required = ['user', 'session_token', 'expires_at', 'integrity_hash']
    return required.every((field) => field in sessionData)
  }

  static async clearSession(): Promise<void> {
    localStorage.removeItem(this.STORAGE_KEY)
    // Log security event
    await this.logSecurityEvent(
      'session_cleared',
      'Session cleared due to security validation failure'
    )
  }

  private static async logSecurityEvent(
    event: string,
    details: string
  ): Promise<void> {
    try {
      logger.warn(`SECURITY EVENT: ${event} - ${details}`)
      // TODO: Implement comprehensive audit logging
    } catch (error) {
      logger.error('Failed to log security event:', error)
    }
  }
}
// Developer and Creator: Jai Singh
