// Created and developed by Jai Singh
import { logger } from '@/lib/utils/logger';

/**
 * Integration test preflight checks.
 *
 * Verifies that required infrastructure (Redis, database, etc.) is available
 * before running integration tests. When infra is absent, tests are skipped
 * with a clear reason instead of producing misleading assertion failures.
 *
 * NOTE: Database availability is checked via a direct Supabase REST call
 * instead of importing `connection-pool.ts`, which depends on
 * SingletonAuthManager (browser-only) and always throws in Node/Vitest.
 */

// ---------------------------------------------------------------------------
// Integration Mode
// ---------------------------------------------------------------------------

/**
 * The two modes for running integration tests:
 *   - `deterministic` — uses in-memory test doubles only (no live infra).
 *     This is the default and recommended mode for CI.
 *   - `infra` — runs the full integration suite against live Redis + Supabase.
 *     Tests are skipped gracefully if infrastructure is unreachable.
 */
export type IntegrationMode = 'deterministic' | 'infra'

/**
 * Read the INTEGRATION_MODE env variable and return a validated mode.
 * Falls back to `'deterministic'` when the variable is unset or unrecognised.
 */
export function getIntegrationMode(): IntegrationMode {
  const raw = process.env.INTEGRATION_MODE?.toLowerCase()
  if (raw === 'infra') return 'infra'
  return 'deterministic'
}

// ---------------------------------------------------------------------------
// Preflight Result
// ---------------------------------------------------------------------------

export interface PreflightResult {
  redis: boolean
  database: boolean
  allPassed: boolean
  summary: string
}

export async function integrationPreflight(): Promise<PreflightResult> {
  const results: PreflightResult = {
    redis: false,
    database: false,
    allPassed: false,
    summary: '',
  }

  // Check Redis availability
  try {
    const { distributedCacheService } = await import(
      '../../../src/lib/cache/redis-cache-service'
    )
    await distributedCacheService.initialize()
    results.redis = distributedCacheService.isAvailable ?? false
  } catch {
    results.redis = false
  }

  // Check database availability via direct REST probe.
  // Avoids importing connection-pool.ts which depends on the
  // browser-only SingletonAuthManager and throws in Node environments.
  try {
    const supabaseUrl =
      process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
    const supabaseKey =
      process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY
    if (supabaseUrl && supabaseKey) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      const response = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'HEAD',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        signal: controller.signal,
      })
      clearTimeout(timer)
      results.database = response.ok
    }
  } catch {
    results.database = false
  }

  results.allPassed = results.redis && results.database
  results.summary = [
    `Redis: ${results.redis ? 'AVAILABLE' : 'UNAVAILABLE'}`,
    `Database: ${results.database ? 'AVAILABLE' : 'UNAVAILABLE'}`,
  ].join(' | ')

  return results
}

/**
 * Use in describe blocks to conditionally skip when infra is absent.
 * Returns a describe function that skips the suite with a banner message.
 */
export function describeIfInfra(
  available: boolean,
  reason: string
): typeof describe {
  if (available) return describe
  logger.log(`⏭️  SKIPPED: ${reason}`)
  return describe.skip as typeof describe
}

// ---------------------------------------------------------------------------
// Execution Summary Reporting
// ---------------------------------------------------------------------------

/**
 * Structured summary data reported at the end of the integration run.
 *
 * Unlike the previous implementation this does NOT carry manually-counted test
 * totals.  Vitest's own reporters handle pass/fail/skip counts; the summary
 * here captures the runtime state that is invisible to those reporters.
 */
export interface IntegrationSummary {
  /** Whether infrastructure preflight checks passed */
  infraAvailable: boolean
  /** Whether service initialization succeeded (only attempted when infra is available) */
  servicesInitialized: boolean
  /** Active integration mode for this run */
  mode: IntegrationMode
  /** Policy for handling missing infrastructure */
  policy: 'skip' | 'fail'
}

/**
 * Build and log a structured execution summary.
 *
 * When `REQUIRE_INTEGRATION_INFRA=true` and infrastructure is unavailable in
 * `infra` mode, this will throw (causing a non-zero exit code).
 */
export function reportIntegrationSummary(summary: IntegrationSummary): void {
  const policyEnv = process.env.REQUIRE_INTEGRATION_INFRA

  logger.log('═══════════════════════════════════════════════')
  logger.log('  INTEGRATION TEST EXECUTION SUMMARY')
  logger.log('═══════════════════════════════════════════════')
  logger.log(`  Mode:              ${summary.mode}`)
  logger.log(`  Infra available:   ${summary.infraAvailable ? 'YES' : 'NO'}`)
  logger.log(`  Services init:     ${summary.servicesInitialized ? 'YES' : 'NO'}`)
  logger.log(`  Policy env:        REQUIRE_INTEGRATION_INFRA=${policyEnv ?? 'unset'}`)
  logger.log('═══════════════════════════════════════════════')

  if (
    summary.mode === 'infra' &&
    policyEnv === 'true' &&
    !summary.infraAvailable
  ) {
    throw new Error(
      'REQUIRE_INTEGRATION_INFRA=true but infrastructure is unavailable. ' +
        'Set up required infrastructure or set REQUIRE_INTEGRATION_INFRA=false.'
    )
  }
}

// Created and developed by Jai Singh
