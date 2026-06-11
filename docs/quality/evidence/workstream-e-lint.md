# Workstream E: Static Quality — Evidence

> Secret dev credential findings excluded per [scope-lock-non-secret-2026-02-16.md](../scope-lock-non-secret-2026-02-16.md).

## Before State

- Total lint warnings: 154
- Auth/security paths: 11 warnings (no-explicit-any, exhaustive-deps, react-refresh)
- Feature hotspots: 59 warnings (exhaustive-deps, no-explicit-any, query-deps, unused suppressions)
- No regression ratchet — warnings could silently grow

**Baseline:** 154 warnings, 0 errors

## After State

- Total lint warnings: 80 (reduction of 74)
- Auth/security paths: 0 warnings (100% clean)
- Feature hotspots: 0 warnings (100% clean)
- Lint ratchet enforced: `.lint-baseline.json` at 79 warnings / 108 suppressions
- `scripts/lint-ratchet.mjs` fails CI if either metric regresses

**Post-change:** 80 warnings, 0 errors, ratchet enforced

## Fix Breakdown by Category

| Fix Type | Count | Description |
|----------|-------|-------------|
| `react-hooks/exhaustive-deps` | ~35 | Added missing deps or justified suppressions |
| `@typescript-eslint/no-explicit-any` | ~10 | Replaced with proper types |
| `react-refresh/only-export-components` | ~13 | ESLint config override for provider/hook patterns |
| Unused `eslint-disable` directives | 5 | Removed dead suppressions |
| `@tanstack/query/exhaustive-deps` | 4 | Added missing query key deps |
| Other | 7 | useMemo deps, type fixes |

## Files Changed (44 files)

### Configuration
- `eslint.config.js` — Added overrides for auth/hook patterns
- `.lint-baseline.json` — Created (79 warnings, 108 suppressions)
- `scripts/lint-ratchet.mjs` — Created (ratchet enforcement script)

### Auth/Security (Task 13)
- `src/lib/auth/auth-provider.tsx`

### Feature Hotspots (Task 14)
- 41 files across `src/features/shift-productivity/`, `src/features/rf-interface/`, `src/features/user-management/`, `src/components/kitting/`, `src/hooks/`

## Residual Risks

- 80 warnings remain outside targeted directories (camera-system, other features)
- Ratchet prevents growth but doesn't drive further reduction without explicit effort

---

*Date: 2026-02-16*
