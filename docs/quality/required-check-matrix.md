# Required Check Matrix (2026-02-28)

All checks listed as "Required" must pass before merging to `main`.
CI workflow: `.github/workflows/ci.yml`

## CI Jobs

| Job | Runs On | Purpose |
|-----|---------|---------|
| `frontend-unit` | `ubuntu-latest` | Tracked artifacts, forbidden env, lint, format, build, bundle budget, check-matrix alignment, unit tests |
| `dependency-audit` | `ubuntu-latest` | Production dependency audit with allowlist |
| `frontend-integration` | `ubuntu-latest` | Deterministic integration tests (required on every PR) |
| `frontend-integration-infra` | `ubuntu-latest` + Redis service | Infra-backed integration tests (required for main/release branches) |
| `rust` | `ubuntu-latest` | Rust services build + test (zero-warning policy) |
| `python` | `ubuntu-latest` | Python backend pytest suite |

## Enforced Gates

| Gate | CI Job | Enforcement | Fail Criteria |
|------|--------|-------------|---------------|
| Tracked Artifacts | `frontend-unit` | `node scripts/check-tracked-artifacts.mjs` | Tracked files match forbidden artifact patterns (`.new`, `.temp`, `.backup`, etc.) |
| Forbidden Client Env | `frontend-unit` | `node scripts/check-forbidden-client-env.mjs` | `VITE_SUPABASE_SERVICE_ROLE_KEY` is set in build environment or env files |
| Lint | `frontend-unit` | `pnpm lint:check` | Any ESLint errors |
| Lint Ratchet | `frontend-unit` | `node scripts/lint-ratchet.mjs` | Warnings or suppressions exceed `.lint-baseline.json` |
| Format | `frontend-unit` | `pnpm format:check` | Any unformatted files |
| Build | `frontend-unit` | `pnpm build` | Non-zero exit code |
| Bundle Budget | `frontend-unit` | `node scripts/check-bundle-budget.mjs` | Any first-party chunk > 500 KB, total JS > 7500 KB, or any over-budget chunks |
| Check-Matrix Alignment | `frontend-unit` | `node scripts/validate-check-matrix.mjs` | Drift between CI job names and this doc |
| Unit Tests | `frontend-unit` | `pnpm test:unit` | Any test failure |
| Dependency Audit | `dependency-audit` | `pnpm audit` with `.audit-allowlist.json` | Unexpected high-severity findings or expired allowlist entries |
| Integration Tests (deterministic) | `frontend-integration` | `pnpm test:integration` with `INTEGRATION_MODE=deterministic` | Test failures fail the step directly |
| Integration Execution (deterministic) | `frontend-integration` | JSON result parsing | All deterministic tests skipped (0 passed, 0 failed) |
| Integration Tests (infra) | `frontend-integration-infra` | `pnpm test:integration` with `INTEGRATION_MODE=infra` | Test failures fail the step directly |
| Integration Execution (infra) | `frontend-integration-infra` | JSON result parsing | All infra tests skipped (0 passed, 0 failed) |
| Integration Artifacts | `frontend-integration` / `frontend-integration-infra` | `actions/upload-artifact@v4` | Uploads JSON + logs on failure |
| Rust Build + Tests | `rust` | `cargo build` / `cargo test` with `RUSTFLAGS="-D warnings"` | Any warning (promoted to error) or test failure |
| Rust Minimum Tests | `rust` | Test count check | All 5 Rust services require >= 3 passing functional tests |
| Python Tests | `python` | `python -m pytest` | Any test failure or zero tests collected |
| Python Deprecation Warnings | `python` | `pytest.ini` `filterwarnings = error::DeprecationWarning` | Any unfiltered DeprecationWarning (third-party suppressions: gotrue, supabase — review 2026-06-01) |

## Key Enforcement Mechanisms

### Lint Ratchet (`scripts/lint-ratchet.mjs`)
- Compares current ESLint warning count and `eslint-disable` suppression count against `.lint-baseline.json`
- Fails if either metric exceeds baseline — prevents lint quality regression
- Run `node scripts/lint-ratchet.mjs --update` to ratchet down after improvements

### Bundle Budget (`scripts/check-bundle-budget.mjs`)
- Hard limit: 500 KB per first-party JS chunk, 7500 KB total JS
- Zero over-budget first-party chunks allowed
- Lazy-loaded vendor chunks (exceljs, vendor-pdfjs) are exempt from per-chunk limit
- Exits with code 1 on any budget violation

### Rust Zero-Warning Policy (`RUSTFLAGS="-D warnings"`)
- Job-level `RUSTFLAGS: "-D warnings"` promotes all Rust warnings to compile errors
- Applies to all `cargo check`, `cargo build`, and `cargo test` commands across all services
- Gold-standard enforcement — no warning budget counting needed

### Dependency Audit Gate (`dependency-audit` job)
- Uses `pnpm audit --json` for structured JSON parsing (no text grep, no `|| true`)
- Validates allowlist entries have required fields (`id`, `owner`, `reason`, `expires`)
- Checks expiry dates before allowing exceptions
- Compares advisory IDs against allowlist (deterministic)

### Integration Test Enforcement
- Two distinct lanes: `frontend-integration` (deterministic, every PR) and `frontend-integration-infra` (infra, main/release branches)
- Each lane sets `INTEGRATION_MODE` explicitly — no silent defaults
- `|| true` removed — test failures directly fail the CI step
- Secondary enforcement step (`if: always()`) parses JSON results for all-skipped detection
- Performance benchmarks gated by `INTEGRATION_PROFILE=perf` (not run in required lanes)
- Artifacts (JSON results, console output, logs) uploaded on failure for debugging

## Ratchet Baselines

| Metric | Baseline File | Current | Notes |
|--------|--------------|---------|-------|
| ESLint warnings | `.lint-baseline.json` | 16 | Tracked by `lint-ratchet.mjs` (Round 6: 0 errors, 16 warnings) |
| ESLint suppressions | `.lint-baseline.json` | 127 | `eslint-disable` directive count |
| Rust warnings | N/A (RUSTFLAGS) | 0 | Zero-tolerance via `-D warnings` |
| Audit exceptions | `.audit-allowlist.json` | 0 | Empty — lodash resolved via pnpm.overrides |

## Branch Protection Verification Checklist

| Item | Status | Owner | Verified |
|------|--------|-------|----------|
| `frontend-unit` is required check | Requires manual GitHub settings verification | Repo admin | Pending |
| `dependency-audit` is required check | Requires manual GitHub settings verification | Repo admin | Pending |
| `frontend-integration` is required check | Requires manual GitHub settings verification | Repo admin | Pending |
| `frontend-integration-infra` is required for main/release | Requires manual GitHub settings verification | Repo admin | Pending |
| `rust` is required check | Requires manual GitHub settings verification | Repo admin | Pending |
| `python` is required check | Requires manual GitHub settings verification | Repo admin | Pending |
| Branch protection rule exists on `main` | Requires manual GitHub settings verification | Repo admin | Pending |
| Require up-to-date branches before merging | Requires manual GitHub settings verification | Repo admin | Pending |

*Note: This checklist requires manual verification in GitHub repository settings. CI jobs are defined and working; branch protection rules must be configured to match.*

## Files

- CI workflow: `.github/workflows/ci.yml`
- Lint baseline: `.lint-baseline.json`
- Audit allowlist: `.audit-allowlist.json`
- Bundle budget script: `scripts/check-bundle-budget.mjs`
- Lint ratchet script: `scripts/lint-ratchet.mjs`
- Tracked artifacts check: `scripts/check-tracked-artifacts.mjs`
- Forbidden client env check: `scripts/check-forbidden-client-env.mjs`
- Check-matrix validation: `scripts/validate-check-matrix.mjs`
- Bundle budget docs: `docs/quality/bundle-budget.md`
- Dependency risk ADR: `docs/quality/adr/adr-dependency-risk-round3.md`
- Risk acceptance: `docs/quality/dependency-risk-acceptance.md`
