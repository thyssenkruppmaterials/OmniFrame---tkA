/**
 * Database Connection Pool Service
 * Enterprise-grade database connection management with read replica load balancing
 * Designed for high-performance RBAC operations at scale
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  singletonAuthManager as _singletonAuthManager,
  type PostgrestResponse,
} from '@/lib/auth/singleton-auth-manager'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/utils/logger'

// Re-export for backward compatibility
export type { PostgrestResponse }

// ---------------------------------------------------------------------------
// Environment-safe accessor for SingletonAuthManager
//
// In browser contexts the singleton is available immediately. In Node.js /
// vitest integration tests the singleton is null (window is unavailable).
// `getAuthManager()` returns null when unavailable, and
// `getAuthManagerOrThrow()` throws for call sites that require it.
// ---------------------------------------------------------------------------

function getAuthManager() {
  return _singletonAuthManager ?? null
}

function getAuthManagerOrThrow() {
  const mgr = getAuthManager()
  if (!mgr) {
    throw new Error(
      'SingletonAuthManager is not available in this environment. ' +
        'Database operations require a browser environment with Supabase configured.'
    )
  }
  return mgr
}

// Types
interface ConnectionConfig {
  url: string
  anonKey: string
  serviceKey?: string
  maxConnections: number
  connectionTimeoutMs: number
  idleTimeoutMs: number
  healthCheckIntervalMs: number
  retryAttempts: number
  retryDelayMs: number
}

interface PoolMetrics {
  totalConnections: number
  activeConnections: number
  idleConnections: number
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  averageResponseTime: number
  peakConnectionsUsed: number
  lastHealthCheck: number
  healthChecksPassed: number
  healthChecksFailed: number
}

interface ReadReplicaConfig extends ConnectionConfig {
  region: string
  priority: number
  healthStatus: 'healthy' | 'degraded' | 'unhealthy'
  lastHealthCheck: number
}

export class DatabaseConnectionPool {
  private static instance: DatabaseConnectionPool

  // REDESIGNED: All operations now redirect to SingletonAuthManager
  // This eliminates multiple GoTrueClient instances while maintaining backward compatibility

  // Legacy metrics for compatibility (now powered by singleton)
  private metrics: PoolMetrics
  private config: ConnectionConfig
  private isInitialized = false
  private client!: SupabaseClient<Database>
  private activeConnections = new Set<string>()
  private healthCheckInterval?: NodeJS.Timeout

  /**
   * When non-null the pool operates in test mode: all queries execute against
   * this client directly, bypassing SingletonAuthManager (which is
   * browser-only and unavailable in Node / Vitest).
   */
  private testClient: SupabaseClient<Database> | null = null

  private constructor() {
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      peakConnectionsUsed: 0,
      lastHealthCheck: 0,
      healthChecksPassed: 0,
      healthChecksFailed: 0,
    }

    this.config = {
      url: '',
      anonKey: '',
      maxConnections: 50,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 30000,
      healthCheckIntervalMs: 30000,
      retryAttempts: 3,
      retryDelayMs: 1000,
    }
  }

  static getInstance(): DatabaseConnectionPool {
    if (!DatabaseConnectionPool.instance) {
      DatabaseConnectionPool.instance = new DatabaseConnectionPool()
    }
    return DatabaseConnectionPool.instance
  }

  /**
   * Initialize connection pool with single client configuration
   */
  async initialize(): Promise<void> {
    try {
      logger.log('🚀 Initializing single Supabase client...')

      // Get Supabase configuration from environment
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error(
          'Missing Supabase configuration. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY'
        )
      }

      this.config = {
        url: supabaseUrl,
        anonKey: supabaseAnonKey,
        serviceKey: undefined, // SECURITY: service role key is backend-only
        maxConnections: 50,
        connectionTimeoutMs: 2000,
        idleTimeoutMs: 30000,
        healthCheckIntervalMs: 30000,
        retryAttempts: 3,
        retryDelayMs: 1000,
      }

      // REDESIGNED: Use singleton client to eliminate multiple GoTrueClient instances
      this.client = getAuthManagerOrThrow().getSupabaseClient()
      logger.log(
        '🔗 DatabaseConnectionPool now using SingletonAuthManager client'
      )

      // Test connection
      await this.testConnection()

      // Start health monitoring
      this.startHealthMonitoring()

      this.isInitialized = true
      this.metrics.totalConnections = 1 // Single client architecture

      logger.log('✅ Single Supabase client initialized successfully')
      logger.log(
        '📊 Using single client architecture to prevent auth state corruption'
      )
    } catch (error) {
      logger.error('❌ Failed to initialize Supabase client:', error)
      throw new Error(
        `Client initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Initialize the pool for integration testing.
   *
   * Accepts an externally-created SupabaseClient and marks the pool as ready
   * without touching SingletonAuthManager (which is unavailable in Node).
   * Health monitoring and connection tests are skipped in test mode.
   *
   * Call {@link resetForTesting} in afterAll to clean up.
   */
  initializeForTesting(client: SupabaseClient): void {
    this.testClient = client as SupabaseClient<Database>
    this.client = this.testClient
    this.isInitialized = true
    this.metrics.totalConnections = 1
    logger.log('🧪 DatabaseConnectionPool initialised in test mode')
  }

  /**
   * Tear down test-mode state so the singleton is clean for the next suite.
   */
  resetForTesting(): void {
    this.testClient = null
    this.isInitialized = false
    this.activeConnections.clear()
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = undefined
    }
  }

  /**
   * Get client connection (unified for read/write operations)
   */
  getReadConnection(): SupabaseClient<Database> {
    if (!this.isInitialized) {
      logger.warn('Client not initialized')
    }
    return this.client
  }

  /**
   * Get client connection (unified for read/write operations)
   */
  getWriteConnection(): SupabaseClient<Database> {
    if (!this.isInitialized) {
      logger.warn('Client not initialized')
    }
    return this.client
  }

  /**
   * Get client connection (unified for admin operations via RLS)
   */
  getAdminConnection(): SupabaseClient<Database> {
    if (!this.isInitialized) {
      logger.warn('Client not initialized')
    }
    return this.client
  }

  /**
   * Execute read query - REDESIGNED to use SingletonAuthManager
   * Maintains full backward compatibility while eliminating multiple client issues
   */
  async executeRead<T>(
    query: (client: SupabaseClient<Database>) => Promise<PostgrestResponse<T>>,
    options: { retries?: number; timeout?: number } = {}
  ): Promise<PostgrestResponse<T>> {
    this.metrics.totalRequests++
    const startTime = Date.now()

    try {
      // In test mode execute against the injected client directly,
      // bypassing the browser-only SingletonAuthManager.
      const result = this.testClient
        ? await query(this.testClient)
        : await getAuthManagerOrThrow().executeRead(query, options)

      this.metrics.successfulRequests++
      this.updateResponseTimeMetrics(Date.now() - startTime)

      return result
    } catch (error) {
      this.metrics.failedRequests++
      return {
        data: null,
        error: {
          message: error instanceof Error ? error.message : 'Read query failed',
          details: error instanceof Error ? error.stack : undefined,
        },
      }
    }
  }

  /**
   * Execute write query - REDESIGNED to use SingletonAuthManager
   * Maintains full backward compatibility while eliminating multiple client issues
   */
  async executeWrite<T>(
    query: (client: SupabaseClient<Database>) => Promise<PostgrestResponse<T>>,
    options: { retries?: number; timeout?: number } = {}
  ): Promise<PostgrestResponse<T>> {
    this.metrics.totalRequests++
    const startTime = Date.now()

    try {
      const result = this.testClient
        ? await query(this.testClient)
        : await getAuthManagerOrThrow().executeWrite(query, options)

      this.metrics.successfulRequests++
      this.updateResponseTimeMetrics(Date.now() - startTime)

      return result
    } catch (error) {
      this.metrics.failedRequests++
      return {
        data: null,
        error: {
          message:
            error instanceof Error ? error.message : 'Write query failed',
          details: error instanceof Error ? error.stack : undefined,
        },
      }
    }
  }

  /**
   * Execute admin query - REDESIGNED to use SingletonAuthManager
   * Maintains full backward compatibility while eliminating multiple client issues
   */
  async executeAdmin<T>(
    query: (client: SupabaseClient<Database>) => Promise<PostgrestResponse<T>>,
    options: { retries?: number; timeout?: number } = {}
  ): Promise<PostgrestResponse<T>> {
    this.metrics.totalRequests++
    const startTime = Date.now()

    try {
      const result = this.testClient
        ? await query(this.testClient)
        : await getAuthManagerOrThrow().executeAdmin(query, options)

      this.metrics.successfulRequests++
      this.updateResponseTimeMetrics(Date.now() - startTime)

      return result
    } catch (error) {
      this.metrics.failedRequests++
      return {
        data: null,
        error: {
          message:
            error instanceof Error ? error.message : 'Admin query failed',
          details: error instanceof Error ? error.stack : undefined,
        },
      }
    }
  }

  /**
   * Batch query execution for high performance
   */
  async executeBatch<T>(
    queries: Array<{
      query: (client: SupabaseClient<Database>) => Promise<PostgrestResponse<T>>
      type: 'read' | 'write' | 'admin'
    }>,
    options: {
      parallel?: boolean
      maxConcurrency?: number
    } = {}
  ): Promise<PostgrestResponse<T>[]> {
    const { parallel = false, maxConcurrency = 10 } = options

    if (!parallel) {
      // Execute queries sequentially
      const results: PostgrestResponse<T>[] = []
      for (const { query, type } of queries) {
        const result = await this.executeQuery(query, type)
        results.push(result)
      }
      return results
    }

    // Execute queries in parallel with concurrency control
    const chunks = this.chunkArray(queries, maxConcurrency)
    const allResults: PostgrestResponse<T>[] = []

    for (const chunk of chunks) {
      const chunkPromises = chunk.map(({ query, type }) =>
        this.executeQuery(query, type)
      )
      const chunkResults = await Promise.all(chunkPromises)
      allResults.push(...chunkResults)
    }

    return allResults
  }

  /**
   * Get connection pool metrics
   */
  getMetrics(): PoolMetrics {
    return {
      ...this.metrics,
      activeConnections: this.activeConnections.size,
      idleConnections:
        this.metrics.totalConnections - this.activeConnections.size,
    }
  }

  /**
   * Health check for single client connection
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'critical'
    message: string
    details: Record<string, unknown>
  }> {
    try {
      // Check single client connection
      const isHealthy = await this.checkConnectionHealth(this.client, 'client')

      if (isHealthy) {
        this.metrics.healthChecksPassed++
        return {
          status: 'healthy',
          message: 'Database client connection healthy',
          details: { passed: 1, failed: 0, metrics: this.getMetrics() },
        }
      } else {
        this.metrics.healthChecksFailed++
        return {
          status: 'critical',
          message: 'Database client connection failing',
          details: { passed: 0, failed: 1, metrics: this.getMetrics() },
        }
      }
    } catch (error) {
      this.metrics.healthChecksFailed++
      return {
        status: 'critical',
        message: 'Database health check failed',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      }
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    try {
      logger.log('🔄 Shutting down Supabase client...')

      // Stop health monitoring
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval)
      }

      // Wait for active connections to complete
      const maxWaitTime = 10000 // 10 seconds
      const startTime = Date.now()

      while (
        this.activeConnections.size > 0 &&
        Date.now() - startTime < maxWaitTime
      ) {
        logger.log(
          `Waiting for ${this.activeConnections.size} active operations to complete...`
        )
        await this.delay(100)
      }

      // Force close remaining operations
      this.activeConnections.clear()

      this.isInitialized = false
      logger.log('✅ Supabase client shut down gracefully')
    } catch (error) {
      logger.error('Client shutdown error:', error)
    }
  }

  private async testConnection(): Promise<void> {
    try {
      // Test single client connection
      const { error } = await this.client
        .from('user_profiles')
        .select('id')
        .limit(1)
      if (error) {
        throw new Error(`Client connection test failed: ${error.message}`)
      }

      logger.log('✅ Supabase client connection test completed')
    } catch (error) {
      throw new Error(
        `Client connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  private async checkConnectionHealth(
    client: SupabaseClient<Database>,
    name: string
  ): Promise<boolean> {
    try {
      const start = Date.now()
      const { error } = await client.from('user_profiles').select('id').limit(1)
      const latency = Date.now() - start

      if (error) {
        logger.warn(`Health check failed for ${name}:`, error.message)
        return false
      }

      if (latency > 5000) {
        // 5 second threshold
        logger.warn(`High latency detected for ${name}: ${latency}ms`)
        return false
      }

      return true
    } catch (error) {
      logger.error(`Health check error for ${name}:`, error)
      return false
    }
  }

  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        this.metrics.lastHealthCheck = Date.now()
        const health = await this.healthCheck()

        if (health.status === 'critical') {
          logger.error(
            '🚨 Database pool health check critical:',
            health.message
          )
        } else if (health.status === 'degraded') {
          logger.warn('⚠️ Database pool health check degraded:', health.message)
        }
      } catch (error) {
        logger.error('Health monitoring error:', error)
      }
    }, this.config.healthCheckIntervalMs)
  }

  private async executeQuery<T>(
    query: (client: SupabaseClient<Database>) => Promise<PostgrestResponse<T>>,
    type: 'read' | 'write' | 'admin'
  ): Promise<PostgrestResponse<T>> {
    switch (type) {
      case 'read':
        return this.executeRead(query)
      case 'write':
        return this.executeWrite(query)
      case 'admin':
        return this.executeAdmin(query)
      default:
        throw new Error(`Invalid query type: ${type}`)
    }
  }

  // Metrics updated inline where needed

  private updateResponseTimeMetrics(responseTime: number): void {
    this.metrics.averageResponseTime =
      (this.metrics.averageResponseTime + responseTime) / 2
  }

  // Timeout handling built into query execution

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize))
    }
    return chunks
  }
}

// Export singleton instance
export const databaseConnectionPool = DatabaseConnectionPool.getInstance()

// Export types
export type { ConnectionConfig, PoolMetrics, ReadReplicaConfig }
