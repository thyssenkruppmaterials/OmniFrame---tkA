# Workstream B: Integration Test Truthfulness — Evidence

> Secret dev credential findings excluded per [scope-lock-non-secret-2026-02-16.md](../scope-lock-non-secret-2026-02-16.md).

## Before State

- Manual `registeredTestCount` variable with hardcoded fallback `|| 28`
- `getAuthManagerOrThrow()` throws "SingletonAuthManager is not available" in Node/Vitest
- No `INTEGRATION_MODE` env switching — deterministic tests always run alongside infra tests
- CI uses `|| true` to mask integration test failures
- Summary reports derived counters, not actual Vitest results

**Baseline:** 7 passed, 28 skipped (manual counter)

## After State

- Vitest-native reporting replaces manual counter — no more hardcoded fallbacks
- `ConnectionPool.initializeForTesting(client)` bypasses browser-only auth manager in test mode
- `INTEGRATION_MODE=deterministic|infra` env switch controls test suite selection
- `describe.skipIf(integrationMode === 'deterministic')` cleanly skips infra suite
- `reportIntegrationSummary()` uses state-based fields (mode, infraAvailable, servicesInitialized)
- 3 new deterministic test doubles added (batch cache, performance tracker, audit service)

**Post-change:** 11 passed, 28 skipped (deterministic mode)

## Files Changed

| File | Change |
|------|--------|
| `tests/integration/helpers/preflight.ts` | Added `getIntegrationMode()`, redesigned `IntegrationSummary` interface |
| `tests/integration/rbac.test.ts` | Removed manual counter, added mode switching, test-mode injection |
| `src/lib/database/connection-pool.ts` | Added `initializeForTesting()`, `resetForTesting()`, test client guards |
| `tests/integration/helpers/test-doubles.ts` | Enhanced fakes, added FakePerformanceTracker, FakeAuditService, FakeDatabaseConnectionPool |
| `vitest.integration.config.ts` | Added INTEGRATION_MODE env, JSDoc documentation |

## Residual Risks

- Infra-backed integration tests (28) only run when real infrastructure is available — CI deterministic mode does not exercise these paths

---

*Date: 2026-02-16*
