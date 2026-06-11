// Created and developed by Jai Singh
/**
 * Vitest Integration Test Configuration
 *
 * Supports two modes controlled by the INTEGRATION_MODE env variable:
 *
 *   - 'deterministic' (default):
 *       Runs only deterministic tests that use in-memory test doubles.
 *       No live infrastructure (Redis, Supabase) required.
 *       Fast and reliable — recommended for CI.
 *
 *   - 'infra':
 *       Runs the full infrastructure-backed integration suite against live
 *       Redis + Supabase. Tests are skipped gracefully if infrastructure is
 *       unreachable. Use locally when you have services running.
 *
 * Set INTEGRATION_MODE in your environment before running:
 *   INTEGRATION_MODE=infra pnpm test:integration
 */
import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // Integration tests run in Node (services need real Node APIs, not jsdom stubs)
    // This prevents the isNodeEnvironment check in redis-cache-service from returning false
    environment: 'node',
    // No jsdom setup file needed — Node environment has real crypto
    // Align path aliases with vite.config.ts
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Integration tests only — unit tests use vitest.config.ts
    include: ['tests/integration/**/*.{test,spec}.{ts,tsx}'],
    testTimeout: process.env.INTEGRATION_PROFILE === 'perf' ? 30_000 : 15_000,
    hookTimeout: process.env.INTEGRATION_PROFILE === 'perf' ? 30_000 : 15_000,
    // Pass integration mode and profile to the test environment
    env: {
      INTEGRATION_MODE: process.env.INTEGRATION_MODE ?? 'deterministic',
      ...(process.env.INTEGRATION_PROFILE ? { INTEGRATION_PROFILE: process.env.INTEGRATION_PROFILE } : {}),
    },
  },
})

// Created and developed by Jai Singh
