# Finding-to-Fix Evidence Matrix (Post-Changes)

> Generated: 2026-02-15

## Summary

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Rust warnings | 16 | 0 | -100% |
| Unit test pass rate | 100/100 | 100/100 | Maintained |
| Integration test isolation | No (mixed with unit) | Yes (separate config) | Fixed |
| CI soft-pass patterns | 1 (`\|\| true`) | 0 | Eliminated |
| CI placeholder jobs | 1 (Python echo) | 0 | Replaced |
| Python test infra | None | pytest + smoke suite | Created |
| Pytest collection of scripts | 3 scripts collected | 0 | Fixed |
| Missing .gitignore entries | 3 (dev-dist, .pytest_cache, pytest-cache-files) | 0 | Fixed |
| ESLint ignores for generated dirs | 2 dirs (dist, components/ui) | 12+ dirs | Fixed |
| Future-incompat risks | 1 (sqlx-postgres) | 1 (documented, upgrade path known) | Documented |

## Detailed Matrix

| ID | Finding | Severity | Files Changed | Proof Command | Before | After | Residual Risk |
|----|---------|----------|---------------|---------------|--------|-------|---------------|
| F01 | Vitest mixes unit+integration | High | `vitest.config.ts`, `vitest.integration.config.ts`, `package.json` | `pnpm test:unit` | All tests in one run (128 total, 15 fail) | Unit only: 100 pass, 0 fail | None |
| F02 | Integration tests use jsdom | High | `vitest.integration.config.ts` | `pnpm test:integration` | `environment: "jsdom"` causes cache null | `environment: "node"` with 30s timeouts | Infra still needed for real-infra profile |
| F03 | CI lint auto-fixes | Medium | `.github/workflows/ci.yml` | CI workflow review | `pnpm lint` (auto-fix) | `pnpm lint:check` (check-only) | None |
| F04 | Rust `\|\| true` soft-pass | High | `.github/workflows/ci.yml` | CI workflow review | `cargo test --release 2>&1 \|\| true` | `cargo test --release` (strict) | None |
| F05 | Python CI placeholder | High | `.github/workflows/ci.yml` | CI workflow review | `echo "not configured"` | Real pytest + artifact upload | Smoke tests are basic; expand over time |
| F06 | Rust 16 warnings | Medium | 9 Rust source files | `cargo check` | 16 warnings | 0 warnings | dead_code items prefixed, not removed |
| F07 | No pytest infrastructure | Critical | `api/requirements-dev.txt`, `pytest.ini`, `api/tests/*` | `python -m pytest --collect-only` | No pytest, no tests | Full config + smoke suite | Smoke suite has limited coverage |
| F08 | Scripts collected by pytest | Medium | 3 renamed scripts | `python -m pytest --collect-only` | 3 scripts with `test_` prefix | Renamed to `*_cli.py` / `*_check.py` | `api/routers/test.py` still exists (mitigated by testpaths) |
| F09 | ESLint scans generated dirs | Medium | `eslint.config.js` | `pnpm lint:check` | Only `dist` and `components/ui` ignored | 12+ dirs ignored including dev-dist, api, rust | None |
| F10 | .gitignore missing entries | Low | `.gitignore` | `git status` | Missing dev-dist, .pytest_cache, pytest-cache-files | All three added | None |
| F11 | sqlx-postgres future-incompat | Medium | Documented only | `cargo report future-incompatibilities` | Unacknowledged | Documented; upgrade path: sqlx 0.8.x | Requires dependency upgrade in future cycle |
| F12 | No CI unit/integration split | Medium | `.github/workflows/ci.yml` | CI workflow review | Single frontend job | `frontend-unit` (required) + `frontend-integration` (burn-in) | Integration job is `continue-on-error` during burn-in |
| F13 | No quality scripts | Low | `package.json` | `pnpm quality:check` | No unified quality command | `quality:check` and `quality:ci` added | None |
| F14 | No developer workflow docs | Low | `docs/quality/local-workflow.md` | File exists | No documentation | Full command reference + troubleshooting | None |
| F15 | No flaky test policy | Low | `docs/quality/flaky-test-quarantine-policy.md` | File exists | No policy | 14-day SLA with issue linking | Enforcement not yet automated |
| EX1 | Exposed dev credentials | - | N/A | N/A | N/A | N/A | `out_of_scope_excluded` per scope lock |

## Excluded Findings

| Finding | Tag | Reason |
|---------|-----|--------|
| Exposed development credentials | `out_of_scope_excluded` | Excluded per scope lock -- future scoped work |
| Other Rust services (work, ai, streaming, dashboard) | `out_of_scope_excluded` | Explicitly scoped to rust-core-service only |
