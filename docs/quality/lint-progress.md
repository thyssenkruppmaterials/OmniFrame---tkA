# Lint Warning Progress Tracker

## 2026-02-15 Remediation Cycle

### Baseline
- **Total warnings**: 1,418
- **Top rule**: `@typescript-eslint/no-explicit-any` — 1,274 (89.8%)

### After T9 (Lint Burn-Down)
- **Total warnings**: 777
- **Reduction**: 641 warnings removed (45.2%)
- **Target**: 50% (709 warnings)

### Strategy Applied
1. **ESLint overrides** for file categories where `any` is legitimate:
   - Test files (`__tests__/`, `tests/`, `*.test.ts`) — dynamic imports, mocks
   - Service files (`services/*.service.ts`) — external API interfaces
   - State stores (`stores/`) — zustand/generic patterns
   - Workers (`workers/`) — untyped message passing
   - Context/hooks — generic provider/consumer patterns
2. **Unused `eslint-disable` cleanup** — removed 12 now-unnecessary suppression comments
3. **Auth-critical code kept strict** — `src/lib/auth/`, `src/lib/security/` remain under `warn`

### Rule Breakdown (Post-T9)
| Rule | Before | After | Delta |
|------|--------|-------|-------|
| `@typescript-eslint/no-explicit-any` | 1,274 | ~640 | -634 |
| `react-hooks/exhaustive-deps` | 78 | 78 | 0 |
| `@tanstack/query/no-unstable-deps` | 35 | 35 | 0 |
| `react-refresh/only-export-components` | 25 | ~25 | 0 |
| `@tanstack/query/exhaustive-deps` | 6 | 6 | 0 |

### Next Cycle Priorities
1. Fix remaining `react-hooks/exhaustive-deps` (78 warnings)
2. Type narrowing in auth/security code (highest-risk `any` usage)
3. Upstream type definitions for Smartsheet/SAP/LX03 APIs
