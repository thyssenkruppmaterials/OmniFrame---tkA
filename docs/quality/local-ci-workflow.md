# OneBox AI - Local & CI Quality Workflow

> Updated: 2026-03-05 (Round 6 — CI / local alignment)

## Command Contract

| Command | What it does | Required in CI? |
|---------|-------------|-----------------|
| `pnpm lint:check` | ESLint check (0 errors required, warnings tracked) | Yes (`frontend-unit`) |
| `pnpm format:check` | Prettier format check | Yes (`frontend-unit`) |
| `pnpm build` | TypeScript check + Vite production build | Yes (`frontend-unit`) |
| `pnpm test:unit` | Vitest unit tests (5 suites, 100 tests) | Yes (`frontend-unit`) |
| `pnpm test:integration` | Vitest integration tests (Node env, preflight-gated) | Yes (`frontend-integration`) |
| `pnpm test:integration:perf` | Performance benchmark tests (nightly/non-blocking) | No |
| `pnpm quality:check` | governance + lint + ratchet + format + build + budget + unit (local gate) | No |
| `pnpm quality:ci` | identical to `quality:check` (CI-optimized alias) | No |
| `python -m pytest` | Python backend tests (from `api/` directory) | Yes (`python`) |
| `cargo test --release` | Rust tests (from `rust-core-service/`) | Yes (`rust`) |

## Local Developer Workflow

```bash
# Quick check before committing (identical to CI pipeline)
pnpm quality:check

# quality:ci is now an alias for quality:check — either works
pnpm quality:ci

# Full check including integration tests
pnpm quality:check && pnpm test:integration

# Python
cd api && python -m pytest -q

# Rust (all 5 services)
cargo test --manifest-path rust-core-service/Cargo.toml
cargo test --manifest-path rust-ai-service/Cargo.toml
cargo test --manifest-path rust-work-service/Cargo.toml
cargo test --manifest-path rust-dashboard-service/Cargo.toml
cargo test --manifest-path rust-streaming-service/Cargo.toml

# Matrix validation
node scripts/validate-check-matrix.mjs
```

## CI Job Matrix

| Job | Required? | Gates |
|-----|-----------|-------|
| `frontend-unit` | Yes | tracked artifacts, forbidden env, lint, ratchet, format, build, bundle budget, matrix validation, unit tests |
| `dependency-audit` | Yes | production dependency audit with allowlist |
| `frontend-integration` | Yes | deterministic integration tests |
| `frontend-integration-infra` | Yes (main/release) | infra-backed integration tests |
| `python` | Yes | pytest suite |
| `rust` | Yes | cargo test (all 5 services, min 3 tests each, zero-warning policy) |

## Failure Triage Playbook

### Lint failures (`pnpm lint:check`)
- Check error rule: `no-console` -> use `logger` from `@/lib/utils/logger`
- Check error rule: `no-unused-vars` -> prefix with `_` or remove
- Warnings are tracked but don't block

### Format failures (`pnpm format:check`)
- Run `pnpm exec prettier --write "src/**/*.{ts,tsx}"`
- Commit formatting separately from logic changes

### Build failures (`pnpm build`)
- TypeScript errors: fix type issues, check for missing imports
- Chunk size warnings: review code splitting, check `vite.config.ts` manualChunks

### Integration test failures
- Import crash (`window is not defined`): check `singleton-auth-manager.ts` guards
- Preflight skip: infrastructure unavailable (expected in CI without infra)
- Runtime errors: check service initialization in `rbac.test.ts`

### Python test failures
- Import errors: check `api/config/settings.py` env config
- Missing deps: `pip install -r api/requirements-dev.txt`

### Rust test failures
- Zero-warning policy: `RUSTFLAGS="-D warnings"` promotes all warnings to errors
- Minimum 3 functional tests per service required
- Check `cargo test` output for test count enforcement
