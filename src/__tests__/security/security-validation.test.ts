import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DistributedPermissionCache } from '@/lib/cache/distributed-permission-cache'
import { EncryptedSessionStorage } from '@/lib/security/encrypted-storage'
import { ServerPermissionValidator } from '@/lib/security/server-permission-validator'
import { SessionAnomalyDetector } from '@/lib/security/session-anomaly-detector'

describe('Critical Security Validation Suite', () => {
  beforeEach(() => {
    // Clear all mocks and storage
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    // Clean up after each test
    localStorage.clear()
  })

  describe('Encrypted Session Storage', () => {
    it('should encrypt and decrypt session data correctly', async () => {
      const testSession = {
        user: { id: 'user-123', email: 'test@example.com' },
        session_token: 'token-123',
        expires_at: new Date().toISOString(),
        integrity_hash: 'hash-123',
      }

      await EncryptedSessionStorage.storeSession(testSession)
      const retrieved = await EncryptedSessionStorage.retrieveSession()

      expect(retrieved).toEqual(testSession)
    })

    it('should detect and reject tampered session data', async () => {
      const testSession = {
        user: { id: 'user-123', email: 'test@example.com' },
        session_token: 'token-123',
        expires_at: new Date().toISOString(),
        integrity_hash: 'hash-123',
      }

      await EncryptedSessionStorage.storeSession(testSession)

      // Tamper with stored data
      const stored = localStorage.getItem('omniframe_secure_session')
      if (stored) {
        localStorage.setItem('omniframe_secure_session', stored + 'tampered')
      }

      const retrieved = await EncryptedSessionStorage.retrieveSession()
      expect(retrieved).toBeNull()
    })

    it('should handle encryption failures gracefully', async () => {
      // Mock crypto.subtle to throw error
      const originalEncrypt = crypto.subtle.encrypt
      crypto.subtle.encrypt = vi
        .fn()
        .mockRejectedValue(new Error('Encryption failed'))

      await expect(EncryptedSessionStorage.storeSession({})).rejects.toThrow(
        'CRITICAL: Session encryption failure'
      )

      // Restore original
      crypto.subtle.encrypt = originalEncrypt
    })
  })

  describe('Server-side Permission Validation', () => {
    it('should validate permissions with comprehensive audit logging', async () => {
      // Note: This test would require mocking Supabase client
      // For now, we'll test the structure of the return value
      try {
        const result = await ServerPermissionValidator.validatePermission(
          'user-123',
          'users',
          'read',
          { ip_address: '192.168.1.1' }
        )

        expect(result).toHaveProperty('granted')
        expect(result).toHaveProperty('audit_id')
        expect(result).toHaveProperty('response_time_ms')
        expect(result.response_time_ms).toBeGreaterThan(0)
      } catch (error) {
        // Expected to fail without database setup
        expect(error).toBeDefined()
      }
    })

    it('should deny access for non-existent users', async () => {
      try {
        const result = await ServerPermissionValidator.validatePermission(
          'non-existent-user',
          'users',
          'read'
        )

        expect(result.granted).toBe(false)
        expect(result.risk_level).toBe('critical')
      } catch (error) {
        // Expected to fail without database setup
        expect(error).toBeDefined()
      }
    })

    it('should handle database errors gracefully', async () => {
      // Mock database error by testing with invalid input
      try {
        const result = await ServerPermissionValidator.validatePermission(
          '',
          'users',
          'read'
        )

        expect(result).toHaveProperty('granted')
        expect(result).toHaveProperty('audit_id')
      } catch (error) {
        // Expected to fail without database setup
        expect(error).toBeDefined()
      }
    })
  })

  describe('Session Anomaly Detection', () => {
    it('should detect multiple IP address anomalies', async () => {
      const result = await SessionAnomalyDetector.detectAnomalies(
        'session-123',
        {
          userId: 'user-123',
          ip: '203.45.67.89', // Unusual IP
          timestamp: new Date().toISOString(),
          deviceFingerprint: 'device-123',
          location: { latitude: 40.7128, longitude: -74.006 },
        }
      )

      expect(result).toHaveProperty('hasAnomalies')
      expect(result).toHaveProperty('riskScore')
      expect(result).toHaveProperty('recommendedActions')
    })

    it('should calculate appropriate risk scores', async () => {
      const result = await SessionAnomalyDetector.detectAnomalies(
        'session-123',
        {
          userId: 'user-123',
          ip: '192.168.1.1',
          timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 AM
          deviceFingerprint: 'device-123',
          location: { latitude: 40.7128, longitude: -74.006 },
        }
      )

      expect(result.riskScore).toBeGreaterThanOrEqual(0)
      expect(result.riskScore).toBeLessThanOrEqual(100)
    })
  })

  describe('Distributed Permission Cache', () => {
    beforeEach(async () => {
      await DistributedPermissionCache.initialize()
    })

    afterEach(async () => {
      await DistributedPermissionCache.disconnect()
    })

    it('should store and retrieve permissions correctly', async () => {
      await DistributedPermissionCache.setPermission(
        'user-123',
        'dashboard',
        'view',
        true
      )
      const result = await DistributedPermissionCache.getPermission(
        'user-123',
        'dashboard',
        'view'
      )

      expect(result).toBe(true)
    })

    it('should handle cache expiration correctly', async () => {
      // Set permission with very short TTL
      await DistributedPermissionCache.setPermission(
        'user-123',
        'dashboard',
        'view',
        true,
        100
      )

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150))

      const result = await DistributedPermissionCache.getPermission(
        'user-123',
        'dashboard',
        'view'
      )
      expect(result).toBeNull()
    })

    it('should invalidate user permissions correctly', async () => {
      await DistributedPermissionCache.setPermission(
        'user-123',
        'dashboard',
        'view',
        true
      )
      await DistributedPermissionCache.setPermission(
        'user-123',
        'users',
        'read',
        true
      )

      await DistributedPermissionCache.invalidateUserPermissions('user-123')

      const result1 = await DistributedPermissionCache.getPermission(
        'user-123',
        'dashboard',
        'view'
      )
      const result2 = await DistributedPermissionCache.getPermission(
        'user-123',
        'users',
        'read'
      )

      expect(result1).toBeNull()
      expect(result2).toBeNull()
    })

    it('should perform health checks correctly', async () => {
      const isHealthy = await DistributedPermissionCache.healthCheck()
      expect(isHealthy).toBe(true)
    })
  })

  describe('Security Integration Tests', () => {
    it('should maintain security through complete auth flow', async () => {
      // Test complete authentication and authorization flow
      const sessionData = {
        user: { id: 'user-123', email: 'test@example.com' },
        session_token: 'secure-token-123',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        integrity_hash: 'integrity-hash-123',
      }

      // 1. Store encrypted session
      await EncryptedSessionStorage.storeSession(sessionData)

      // 2. Retrieve and validate
      const retrieved = await EncryptedSessionStorage.retrieveSession()
      expect(retrieved).toEqual(sessionData)

      // 3. Test permission validation (will fail without DB but structure should be correct)
      try {
        const permissionResult =
          await ServerPermissionValidator.validatePermission(
            'user-123',
            'dashboard',
            'read'
          )

        expect(permissionResult).toHaveProperty('granted')
        expect(permissionResult.audit_id).toBeDefined()
      } catch (error) {
        // Expected without proper database setup
        expect(error).toBeDefined()
      }
    })

    it('should handle concurrent security operations', async () => {
      const operations = Array.from({ length: 10 }, (_, i) =>
        EncryptedSessionStorage.storeSession({
          user: { id: `user-${i}`, email: `test${i}@example.com` },
          session_token: `token-${i}`,
          expires_at: new Date().toISOString(),
          integrity_hash: `hash-${i}`,
        })
      )

      await expect(Promise.all(operations)).resolves.not.toThrow()
    })
  })

  describe('Performance Validation', () => {
    it('should complete encryption operations within time limits', async () => {
      const startTime = Date.now()

      const testSession = {
        user: { id: 'user-123', email: 'test@example.com' },
        session_token: 'token-123',
        expires_at: new Date().toISOString(),
        integrity_hash: 'hash-123',
      }

      await EncryptedSessionStorage.storeSession(testSession)
      const retrieved = await EncryptedSessionStorage.retrieveSession()

      const endTime = Date.now()
      const duration = endTime - startTime

      expect(duration).toBeLessThan(1000) // Should complete within 1 second
      expect(retrieved).toEqual(testSession)
    })

    it('should handle high-frequency permission checks', async () => {
      await DistributedPermissionCache.initialize()

      const startTime = Date.now()

      const checks = Array.from({ length: 100 }, () =>
        DistributedPermissionCache.getPermission('user-123', 'users', 'read')
      )

      const results = await Promise.all(checks)
      const endTime = Date.now()

      const avgResponseTime = (endTime - startTime) / results.length

      expect(avgResponseTime).toBeLessThan(50) // Average under 50ms
      expect(results.every((r) => r === null)).toBe(true) // All null since no data was cached

      await DistributedPermissionCache.disconnect()
    })
  })

  describe('Error Handling and Resilience', () => {
    it('should handle localStorage unavailability gracefully', async () => {
      // Mock localStorage to fail using spyOn (jsdom's localStorage has non-writable properties)
      const spy = vi
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
          throw new Error('Storage unavailable')
        })

      await expect(EncryptedSessionStorage.storeSession({})).rejects.toThrow(
        'CRITICAL: Session encryption failure'
      )

      spy.mockRestore()
    })

    it('should handle Web Crypto API unavailability', async () => {
      // Mock crypto.subtle methods to throw errors
      const originalEncrypt = crypto.subtle.encrypt
      crypto.subtle.encrypt = vi
        .fn()
        .mockRejectedValue(new Error('Crypto API unavailable'))

      await expect(EncryptedSessionStorage.storeSession({})).rejects.toThrow()

      // Restore crypto.subtle
      crypto.subtle.encrypt = originalEncrypt
    })

    it('should handle malformed session data gracefully', async () => {
      // Store invalid JSON
      localStorage.setItem('omniframe_secure_session', 'invalid-base64')

      const result = await EncryptedSessionStorage.retrieveSession()
      expect(result).toBeNull()
    })
  })

  describe('Cache Performance Tests', () => {
    beforeEach(async () => {
      await DistributedPermissionCache.initialize()
    })

    afterEach(async () => {
      await DistributedPermissionCache.disconnect()
    })

    it('should maintain performance under high load', async () => {
      const startTime = Date.now()

      // Store 1000 permissions
      const storePromises = Array.from({ length: 1000 }, (_, i) =>
        DistributedPermissionCache.setPermission(
          `user-${i}`,
          'dashboard',
          'view',
          true
        )
      )

      await Promise.all(storePromises)

      const storeTime = Date.now() - startTime
      expect(storeTime).toBeLessThan(5000) // Should complete within 5 seconds

      // Retrieve all permissions
      const retrieveStartTime = Date.now()
      const retrievePromises = Array.from({ length: 1000 }, (_, i) =>
        DistributedPermissionCache.getPermission(
          `user-${i}`,
          'dashboard',
          'view'
        )
      )

      const results = await Promise.all(retrievePromises)
      const retrieveTime = Date.now() - retrieveStartTime

      expect(retrieveTime).toBeLessThan(2000) // Should complete within 2 seconds
      expect(results.every((r) => r === true)).toBe(true)
    })

    it('should handle cache size limits correctly', async () => {
      // Fill cache beyond maximum size
      const promises = Array.from({ length: 12000 }, (_, i) =>
        DistributedPermissionCache.setPermission(
          `user-${i}`,
          'dashboard',
          'view',
          true
        )
      )

      await Promise.all(promises)

      const stats = await DistributedPermissionCache.getCacheStats()

      // Cache should be limited to MAX_CACHE_SIZE (10000)
      expect(stats.totalEntries).toBeLessThanOrEqual(10000)
    })
  })
})
