import { logger } from '@/lib/utils/logger'

/**
 * Query Retry Utility
 * Implements exponential backoff retry logic for Supabase queries
 *
 * Author: Jai Singh
 * Date: October 29, 2025
 * Version: 1.0.0
 */

interface RetryConfig {
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffFactor?: number
  retryableErrors?: string[]
}

const DEFAULT_CONFIG: Required<RetryConfig> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
  retryableErrors: [
    'PGRST301', // JWT expired
    'PGRST504', // Gateway timeout
    '504', // Gateway timeout
    '503', // Service unavailable
    '502', // Bad gateway
    '408', // Request timeout
    'NetworkError',
    'FetchError',
  ],
}

/**
 * Sleep utility
 */
const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Check if error is retryable
 */
function isRetryableError(error: unknown, retryableErrors: string[]): boolean {
  if (!error) return false

  const err = error as Record<string, unknown>
  const errorMessage = (err.message as string) || String(error)
  const errorCode = (err.code as string) || (err.status as string)

  return retryableErrors.some(
    (retryableError) =>
      errorMessage.includes(retryableError) ||
      String(errorCode) === retryableError
  )
}

/**
 * Execute query with retry logic and exponential backoff
 *
 * @param queryFn - Async function to execute
 * @param config - Retry configuration
 * @returns Query result
 *
 * @example
 * const result = await withRetry(
 *   () => supabase.from('users').select('*'),
 *   { maxAttempts: 3 }
 * )
 */
export async function withRetry<T>(
  queryFn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config }

  let attempt = 0
  let lastError: unknown
  let delay = finalConfig.initialDelayMs

  while (attempt < finalConfig.maxAttempts) {
    try {
      attempt++

      // Execute query
      const result = await queryFn()

      // Success - return result
      return result
    } catch (error: unknown) {
      lastError = error

      // Log attempt
      logger.warn(
        `Query attempt ${attempt}/${finalConfig.maxAttempts} failed:`,
        (error instanceof Error ? error.message : String(error)) || error
      )

      // Check if we should retry
      const shouldRetry =
        attempt < finalConfig.maxAttempts &&
        isRetryableError(error, finalConfig.retryableErrors)

      if (!shouldRetry) {
        // Non-retryable error or max attempts reached
        throw error
      }

      // Wait before retrying (exponential backoff)
      logger.log(`Retrying in ${delay}ms...`)
      await sleep(delay)

      // Increase delay for next attempt
      delay = Math.min(
        delay * finalConfig.backoffFactor,
        finalConfig.maxDelayMs
      )
    }
  }

  // All retries exhausted
  throw lastError
}

/**
 * Retry decorator for class methods
 *
 * @example
 * class DataService {
 *   @retry({ maxAttempts: 3 })
 *   async fetchData() {
 *     return await supabase.from('data').select('*')
 *   }
 * }
 */
export function retry(config: RetryConfig = {}) {
  return function (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: unknown[]) {
      return withRetry(() => originalMethod.apply(this, args), config)
    }

    return descriptor
  }
}

/**
 * Create a retryable Supabase query builder
 *
 * @example
 * const query = retryableQuery(
 *   supabase.from('users').select('*'),
 *   { maxAttempts: 3 }
 * )
 * const { data, error } = await query
 */
export function retryableQuery<T>(
  queryBuilder: PromiseLike<T>,
  config: RetryConfig = {}
): Promise<T> {
  return withRetry(() => Promise.resolve(queryBuilder), config)
}

/**
 * Batch retry multiple queries
 *
 * @example
 * const results = await retryBatch([
 *   () => supabase.from('users').select('*'),
 *   () => supabase.from('posts').select('*')
 * ])
 */
export async function retryBatch<T>(
  queries: Array<() => Promise<T>>,
  config: RetryConfig = {}
): Promise<T[]> {
  return Promise.all(queries.map((query) => withRetry(query, config)))
}

/**
 * Helper to extract Supabase error information
 */
export function extractSupabaseError(error: unknown): {
  code: string | null
  message: string
  details: string | null
  hint: string | null
} {
  const err = error as Record<string, unknown>
  return {
    code: (err?.code as string) || null,
    message: (err?.message as string) || 'Unknown error',
    details: (err?.details as string) || null,
    hint: (err?.hint as string) || null,
  }
}
// Developer and Creator: Jai Singh
