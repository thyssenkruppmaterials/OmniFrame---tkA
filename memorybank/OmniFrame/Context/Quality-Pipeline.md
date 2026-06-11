---
tags: [type/context, status/active, domain/infra]
created: 2026-04-10
---
# Quality Pipeline

## Purpose
Documents the quality gates, scripts, testing infrastructure, and CI/CD checks that prevent regressions in OneBox.

## Quality Check Commands

### `pnpm quality:check` / `pnpm quality:ci`
Runs all quality gates in sequence (both commands are identical):

1. `node scripts/check-tracked-artifacts.mjs` — Ensures no temp/backup files are committed (`.new`, `.temp`, `.backup`, `.bak`, `.orig`)
2. `node scripts/check-forbidden-client-env.mjs` — Blocks builds if `VITE_SUPABASE_SERVICE_ROLE_KEY` is set in environment or `.env*` files
3. `pnpm lint:check` — ESLint check (no auto-fix)
4. `node scripts/lint-ratchet.mjs` — Lint ratchet against `.lint-baseline.json` baseline
5. `pnpm format:check` — Prettier format check
6. `pnpm build` — Full TypeScript + Vite build
7. `node scripts/check-bundle-budget.mjs` — Bundle budget enforcement
8. `pnpm test:unit` — Unit test suite

## Quality Scripts

### Lint Ratchet (`scripts/lint-ratchet.mjs`)
Prevents lint quality from regressing:
- Counts ESLint warnings, errors, and `eslint-disable` suppressions
- Compares against `.lint-baseline.json` baseline
- **Fails** if warnings or suppressions exceed baseline
- **Celebrates** when counts drop (encourages running `--update` to ratchet down)
- `--update` flag recalculates and saves new baseline

### Bundle Budget (`scripts/check-bundle-budget.mjs`)
Enforces hard size thresholds on the production build:
- **Max chunk size:** 500 KB per first-party JS chunk
- **Max total JS:** 7,500 KB across all chunks
- **Max over-budget chunks:** 0 allowed
- **Exempt lazy vendors:** `exceljs` (~937 KB, dynamic import), `vendor-pdfjs` (~400 KB, lazy-loaded)
- Supports `--json` for machine-readable output
- Displays top 15 largest chunks with pass/fail/warn status

### Forbidden Client Env (`scripts/check-forbidden-client-env.mjs`)
- Scans all `.env*` files and current environment for `VITE_SUPABASE_SERVICE_ROLE_KEY`
- Fails with a clear error if the secret is found — prevents accidental exposure in the client bundle

### Tracked Artifacts (`scripts/check-tracked-artifacts.mjs`)
- Checks `git ls-files` against forbidden patterns: `.new`, `.temp`, `.backup`, `.bak`, `.orig`
- Prevents accidental commit of temporary/backup files

### Check Matrix Validator (`scripts/validate-check-matrix.mjs`)
- Validates that `docs/quality/required-check-matrix.md` job names match actual `.github/workflows/ci.yml` job definitions
- Detects drift between CI documentation and workflow

## Git Hooks

### Husky Pre-commit (`.husky/pre-commit`)
- Runs `npx lint-staged`
- Configured via `lint-staged` in `package.json` (applies ESLint + Prettier to staged files)
- Husky initialized via `pnpm prepare`

## Testing Infrastructure

### Unit Tests (`pnpm test:unit`)
- Config: `vitest.config.ts`
- Framework: **Vitest**
- Runs: `vitest run --config vitest.config.ts`

### Integration Tests (`pnpm test:integration`)
- Config: `vitest.integration.config.ts`
- Environment: **Node** (not jsdom — services need real Node APIs)
- Path alias: `@` → `./src`
- Test pattern: `tests/integration/**/*.{test,spec}.{ts,tsx}`
- Two modes via `INTEGRATION_MODE` env:
  - **`deterministic`** (default): In-memory test doubles, no live infrastructure. Fast and CI-safe.
  - **`infra`**: Full Redis + Supabase integration. Skips gracefully if unreachable.
- Timeouts: 15s default, 30s for perf profile
- Performance profile: `INTEGRATION_PROFILE=perf` extends timeouts

### Test Commands
| Command | Description |
|---|---|
| `pnpm test` | Run all tests |
| `pnpm test:unit` | Unit tests only |
| `pnpm test:integration` | Integration tests (deterministic) |
| `pnpm test:integration:perf` | Integration with infra + perf profile |
| `pnpm test:all` | Unit + integration sequentially |
| `pnpm test:watch` | Watch mode |
| `pnpm test:ui` | Vitest UI |

## Dead Code Detection (Knip)

### Configuration (`knip.config.ts`)
- Entry points: `src/main.tsx`, `src/routeTree.gen.ts`, `src/routes/**/*.{ts,tsx}`
- Project scope: `src/**/*.{ts,tsx}`
- **Ignored paths:** `src/components/ui/**` (barrel re-exports), `src/routeTree.gen.ts` (auto-generated), `ios/**`, `supabase/**`, `tests/**`, `src/__tests__/**`, `src/workers/**`, `src/lib/testing/**`
- **Intentional keeps (planned features):** `src/features/drone-scanner/**` (Q2 2026), `src/lib/presence/**`, `src/lib/work-service/**`, legacy sidebar/nav components (migration in progress)
- **Ignored dependencies:** Tailwind plugins, Vite plugins, TanStack router plugin, type packages

## Utility Scripts
| Script | Purpose |
|---|---|
| `scripts/create-admin.js` | Create admin user |
| `scripts/clear-cache.js` | Clear application caches |
| `scripts/generate-build-info.js` | Generate build info JSON |
| `scripts/import_legacy_inbound_scans.py` | Legacy data migration |
| `scripts/apply_schema_migration.py` | Database schema migration |
| `scripts/analyze_import_errors.py` | Analyze import errors |

## Related
- [[Build-Configuration]] — Vite, TS, ESLint details
- [[Deployment-Railway]] — How builds are deployed
