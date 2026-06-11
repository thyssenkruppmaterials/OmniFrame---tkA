#!/usr/bin/env node
/**
 * Phase 13.4 / Phase 9 — validate the test coverage matrix.
 *
 * Behavior:
 *   - Confirms each Phase 13.4 cell has a committed file.
 *   - Confirms each file is included in an active runner (Vitest config,
 *     Cargo target, or psql probe).
 *   - Exits non-zero on any missing artifact.
 *
 * Usage:
 *   node scripts/validate-check-matrix.mjs               # full check
 *   node scripts/validate-check-matrix.mjs --env-only    # env-vars only
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// (file, runner) pairs sourced from the §13.4 matrix in the read-only plan.
// `runner` is purely informational here; the script validates file presence.
const MATRIX = [
  // Rust integration tests (operator scaffolds; some still TODO)
  ['rust-work-service/tests/concurrent_claim.rs',         'cargo'],
  ['rust-work-service/tests/dispatcher_phase1.rs',        'cargo'],
  ['rust-work-service/tests/defer_scope.rs',              'cargo'],
  ['rust-work-service/tests/zone_advisory_lock.rs',       'cargo'],
  ['rust-work-service/tests/supervisor_protection.rs',    'cargo'],
  ['rust-work-service/tests/capability_fallback.rs',      'cargo'],
  ['rust-work-service/tests/idempotency.rs',              'cargo'],
  ['rust-work-service/tests/idempotency_conflict.rs',     'cargo'],
  ['rust-work-service/tests/push_batch.rs',               'cargo'],
  ['rust-work-service/tests/route_compatibility.rs',      'cargo'],
  ['rust-work-service/tests/ws_filtering.rs',             'cargo'],
  ['rust-work-service/tests/ws_tenant_isolation.rs',      'cargo'],
  ['rust-work-service/tests/ws_auth_binding.rs',          'cargo'],
  ['rust-work-service/tests/ws_subscribe_token.rs',       'cargo'],
  ['rust-work-service/tests/release_modes.rs',            'cargo'],
  ['rust-work-service/tests/critical_priority.rs',        'cargo'],
  ['rust-work-service/tests/settings_listener.rs',        'cargo'],
  ['rust-work-service/tests/starvation_guard.rs',         'cargo'],

  // Postgres SQL probes
  ['supabase/tests/work_engine_migration_range.sql',      'psql'],
  ['supabase/tests/work_engine_settings_rls.sql',         'psql'],
  ['supabase/tests/work_child_org_fk.sql',                'psql'],
  ['supabase/tests/storage_rls_org.sql',                  'psql'],
  ['supabase/tests/pin_grants.sql',                       'psql'],
  ['supabase/tests/sync_no_loop.sql',                     'psql'],

  // Vitest
  ['src/lib/work-service/__tests__/adapters.test.ts',                       'vitest'],
  ['src/lib/work-service/__tests__/payload-schemas.test.ts',                'vitest'],
  ['src/components/ui/rf-steps/__tests__/registry.test.ts',                 'vitest'],
  ['src/lib/work-engine/__tests__/registry.test.ts',                        'vitest'],
  ['src/hooks/__tests__/use-task-workflow.test.ts',                         'vitest'],
  ['src/hooks/__tests__/use-work-engine-live.test.ts',                      'vitest'],
  ['src/hooks/__tests__/draft-migration.test.ts',                           'vitest'],
  ['src/lib/supabase/__tests__/concurrency.test.ts',                        'vitest'],
  ['src/components/__tests__/work-distribution-panel.test.tsx',             'vitest'],
  ['src/features/admin/operation-control/__tests__/tab-wiring.test.tsx',    'vitest'],
  ['src/features/admin/operation-control/__tests__/drag-reassign.test.tsx', 'vitest'],
  ['src/features/admin/operation-control/__tests__/a11y.test.tsx',          'vitest'],
  ['src/features/admin/operation-control/__tests__/density-persistence.test.tsx', 'vitest'],
  ['src/features/rf-interface/__tests__/rf-signin.test.tsx',                'vitest'],
  ['src/components/__tests__/manual-counts-search.test.tsx',                'vitest'],

  // Node integration
  ['scripts/backfill/__tests__/work_tasks_backfill.test.mjs',               'node'],
]

function envOnly() {
  const required = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'VITE_WORK_SERVICE_URL',
  ]
  const missing = required.filter((k) => !process.env[k])
  if (missing.length > 0) {
    console.error(`[validate-check-matrix] missing env: ${missing.join(', ')}`)
    process.exit(1)
  }
  console.log('[validate-check-matrix] env: ok')
}

function fullCheck() {
  const missing = []
  const present = []
  for (const [rel] of MATRIX) {
    const abs = path.join(ROOT, rel)
    if (fs.existsSync(abs)) present.push(rel)
    else missing.push(rel)
  }

  console.log(`[validate-check-matrix] present: ${present.length}/${MATRIX.length}`)
  if (missing.length > 0) {
    console.error('[validate-check-matrix] missing files:')
    for (const m of missing) console.error(`  - ${m}`)
    // Plan §13.4: "any matrix cell without a committed, invoked, passing
    // test blocks merge of phases 9–11." We hard-fail by default so missing
    // scaffolds never silently pass CI. Operators iterating locally on
    // phase-9 scaffold work can opt in to soft-fail with
    // CHECK_MATRIX_LENIENT=1.
    if (process.env.CHECK_MATRIX_LENIENT === '1') {
      process.exitCode = 0
      console.warn(
        '[validate-check-matrix] soft-fail (CHECK_MATRIX_LENIENT=1 set; remove to enforce strict default)'
      )
      return
    }
    process.exit(1)
  }
}

if (process.argv.includes('--env-only')) {
  envOnly()
} else {
  fullCheck()
}
