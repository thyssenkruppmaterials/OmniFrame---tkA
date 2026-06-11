# Round 5 Final Evidence — Non-Secret Scope (2026-02-18)

> **Scope:** Secret dev credential findings excluded per [scope-lock-non-secret-2026-02-16.md](../scope-lock-non-secret-2026-02-16.md).

## Validation Matrix Results (Post-Remediation)

| Command | Result | Status | Delta from Round 3 |
|---------|--------|--------|--------------------|
| `pnpm lint:check` | 3 warnings, 0 errors | **PASS** | Improved (was 5) |
| `node scripts/lint-ratchet.mjs` | 3/3 warnings, 124/124 suppressions | **PASS** | Ratchet tightened |
| `pnpm format:check` | All files formatted | **PASS** | Fixed regression (was 109 files) |
| `pnpm build` | Builds successfully (1 cosmetic vendor warning) | **PASS** | Improved (was 2 mixed import warnings) |
| `node scripts/check-bundle-budget.mjs` | All chunks within budget (6739 KB) | **PASS** | Unchanged |
| `pnpm test:unit` | 104 passed | **PASS** | Unchanged |
| `pnpm audit --prod --audit-level high` | 0 findings | **PASS** | Unchanged |
| `pnpm audit --prod --audit-level moderate` | 0 findings | **PASS** | Unchanged |
| `pytest -q api/tests` | 8 passed | **PASS** | Unchanged |
| `cargo test (core)` | 23 passed, 2 ignored | **PASS** | Improved (was 0 passed) |
| `cargo test (ai)` | 3 passed | **PASS** | Unchanged |
| `cargo test (work)` | 8 passed | **PASS** | **Improved** (was 2 passed) |
| `cargo test (dashboard)` | 7 passed | **PASS** | Unchanged |
| `cargo test (streaming)` | 14 passed | **PASS** | Unchanged |
| `node scripts/validate-check-matrix.mjs` | 6 jobs validated | **PASS** | New check |

## Finding Closure Matrix

| ID | Finding | Round 5 Entry State | Resolution | Evidence |
|----|---------|---------------------|------------|----------|
| R5-01 | Infra integration instability | VERIFY | Profile formalization, timeout tuning, repeat script added | `vitest.integration.config.ts`, `package.json` |
| R5-02 | Test harness config drift | ACTIVE | Shared `redis-config.ts` utility; 4 services refactored to use env vars | `src/lib/infra/redis-config.ts` |
| R5-03 | Audit write path mismatch | ACTIVE | 4 intervals stored, shutdown clears all timers | `src/lib/audit/audit-service.ts` |
| R5-04 | Format gate failure | **REGRESSION** (109 files) | Full repo formatted, format:check PASS | `pnpm format:check` output |
| R5-05 | Build warning noise | ACTIVE | `role.service.ts` dynamic imports converted to static; rbac-service warning eliminated | `role.service.ts` import change |
| R5-06 | Lint regression | **REGRESSION** (8 warnings) | Reduced to 3 (removed `any`, fixed queryKey deps, removed unused directives) | `pnpm lint:check` output |
| R5-07 | Python deprecation | MOSTLY DONE | pytest.ini strict mode verified; `-W` flag incompatible with gotrue suppression (documented) | `pytest -q api/tests` output |
| R5-08 | Governance drift | PARTIAL | Matrix validation script created; all 5 Rust services enforced with min 3 tests | `scripts/validate-check-matrix.mjs`, `ci.yml` |
| R5-09 | Rust test coverage | core=0,work=0,stream=0 | core=23, work=8, stream=14 — all >= 3 | `cargo test` outputs |

## Hard Gate Summary

| Gate | Status | Evidence |
|------|--------|----------|
| Integration executes non-zero deterministic tests | PASS | 11 tests via `INTEGRATION_MODE=deterministic` (from Round 3) |
| Explicit `INTEGRATION_MODE` in CI | PASS | Both lanes set mode explicitly |
| No expired audit exceptions | PASS | `.audit-allowlist.json` is empty |
| No audit findings (high or moderate) | PASS | 0 findings at moderate level |
| No first-party chunk over 500 kB | PASS | Largest: 454 kB (feature-admin-onboarding) |
| Lint warnings within ratchet | PASS | 3 ≤ 3 (baseline tightened from 8) |
| No first-party deprecation warnings | PASS | pytest passes (gotrue/supabase filtered) |
| All required CI checks documented | PASS | 6 jobs, 16+ gates, matrix validated |
| All Rust services ≥ 3 functional tests | PASS | core=23, ai=3, work=8, dashboard=7, streaming=14 |
| Matrix validation script | PASS | `node scripts/validate-check-matrix.mjs` |

## Changes Made (Round 5)

### Code Changes
1. **Format fix**: 109 files reformatted with Prettier
2. **Lint reduction**: Removed `any` types in `useTickets.ts`, fixed `@tanstack/query/exhaustive-deps` in `useTickets.ts` and `use-camera-events.ts`, removed unused eslint-disable directive
3. **Build warning fix**: `role.service.ts` dynamic imports of `rbac-service` converted to static import
4. **Shared Redis config**: Created `src/lib/infra/redis-config.ts` with env-var-driven config; refactored 4 services (`redis-cache-service`, `rate-limiter`, `performance-tracker`, `audit-service`)
5. **Audit timer cleanup**: Stored 4 interval references in `processingIntervals[]`; `shutdown()` now clears all timers and intervals
6. **Rust work-service tests**: Added 6 auth tests + 1 config test (8 total, was 2)
7. **Integration config**: Separate timeout for functional (15s) vs perf (30s) profiles; added `test:integration:infra:repeat` script

### CI/Governance Changes
8. **CI minimum test enforcement**: All 5 Rust services now require >= 3 passing tests
9. **Matrix validation script**: `scripts/validate-check-matrix.mjs` validates CI job names match documentation
10. **Lint ratchet tightened**: `.lint-baseline.json` updated from 8/125 to 3/124
11. **Required-check-matrix.md**: Updated ratchet baselines and Rust minimum test policy

### Documentation Changes
12. **Scope lock**: Round 5 marker added with round history table
13. **Round 5 baseline evidence**: Captured full validation matrix with delta analysis
14. **This evidence document**: Full closure matrix with per-finding resolution

---

*Captured: 2026-02-18*
*Secret dev credential findings excluded per scope lock.*
