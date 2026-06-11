# OneBox AI - Baseline Metrics (2026-02-15 Post Re-Review)

> Captured before any remediation work begins. Credential findings excluded by stakeholder request.

## 1. Lint Check (`pnpm lint:check`)

- **Total warnings**: 1,418
- **Total errors**: 0
- **Status**: PASS (warnings only)

### Top-10 Rule Breakdown

| Rule | Count |
|------|-------|
| `@typescript-eslint/no-explicit-any` | 1,274 |
| `react-hooks/exhaustive-deps` | 78 |
| `@tanstack/query/no-unstable-deps` | 35 |
| `react-refresh/only-export-components` | 25 |
| `@tanstack/query/exhaustive-deps` | 6 |

> Note: `@typescript-eslint/no-explicit-any` accounts for ~89.8% of all warnings.

## 2. Format Check (`pnpm format:check`)

- **Status**: PASS
- **Result**: "All matched files use Prettier code style!"

## 3. Build (`pnpm build`)

- **Status**: PASS (with warnings)
- **Build time**: ~24.62s
- **Modules transformed**: 11,069
- **Build warnings**:
  1. `activity-source-config.service.ts` dual import warning (static + dynamic)
  2. Chunk size warning: `index-CSpz0YyQ.js` at 1,083.22 KB exceeds 600 KB limit
- **Notable large chunks**:
  - `index-CSpz0YyQ.js`: 1,083.22 KB (primary bundle - exceeds budget)
  - `shift-productivity-CGvNH7f-.js`: 490.26 KB
  - `TicketStatusBadge-BV35TXkF.js`: 441.59 KB
  - `customer-portal-B1ryksdz.js`: 417.62 KB
  - `recharts-DMZXEp-k.js`: 401.84 KB (existing manualChunk)

## 4. Unit Tests (`pnpm test:unit`)

- **Test files**: 5 passed
- **Tests**: 100 passed, 0 failed, 0 skipped
- **Duration**: 9.87s
- **Status**: PASS

## 5. Integration Tests (`pnpm test:integration`)

- **Test files**: 1 passed (vacuous)
- **Tests**: 28 skipped, 0 executed
- **Reason**: Infrastructure unavailable (SingletonAuthManager not available in Node.js environment)
- **Status**: PASS (but 0 assertions executed - false confidence)

## 6. Python Tests (`python -m pytest -q --tb=short`)

- **Tests**: 6 passed
- **Warnings**: Multiple Pydantic deprecation warnings (V1 validators)
- **Status**: PASS
- **Note**: Tests pass without 400 errors (host policy currently compatible)

## 7. Rust Tests (`cargo test --release`)

- **Tests**: 23 passed, 0 failed, 2 ignored (doc-tests)
- **Status**: PASS

## 8. Rust Check (`cargo check`)

- **Warnings**: 0 (only future-incompat notice for sqlx-postgres v0.7.4)
- **Status**: PASS

---

## Exclusions

- `excluded_by_request: ["hard_coded_dev_credentials"]`

## Timestamp

- **Captured**: 2026-02-15T16:40:00Z
- **Branch**: main
- **Commit**: (pre-remediation baseline)
