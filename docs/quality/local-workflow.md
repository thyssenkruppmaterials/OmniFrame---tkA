# OneBox AI Local Quality Workflow

## Quick Start

Run all quality checks locally before pushing:

```bash
pnpm quality:check
```

This runs: lint:check -> format:check -> test:unit -> build

## Command Reference

### Frontend (TypeScript/React)

| Command | Purpose | CI Required? |
|---------|---------|-------------|
| `pnpm lint:check` | ESLint check-only (no auto-fix) | Yes |
| `pnpm format:check` | Prettier format check | Yes |
| `pnpm test:unit` | Unit tests (jsdom env, src/ only) | Yes |
| `pnpm test:integration` | Integration tests (node env, tests/integration/) | Optional (burn-in) |
| `pnpm test:all` | Both unit and integration | No (nightly) |
| `pnpm build` | TypeScript + Vite production build | Yes |
| `pnpm quality:check` | All required local checks | - |
| `pnpm quality:ci` | CI-equivalent sequence | - |

### Python Backend (api/)

| Command | Purpose | CI Required? |
|---------|---------|-------------|
| `pip install -r api/requirements-dev.txt` | Install test deps | Setup |
| `python -m pytest -q` | Run all Python tests | Yes |
| `python -m pytest -m "not integration"` | Unit tests only | Yes |
| `python -m pytest --collect-only` | Verify test discovery | Debug |

### Rust (rust-core-service/)

| Command | Purpose | CI Required? |
|---------|---------|-------------|
| `cargo check` | Type check (fast) | - |
| `cargo test --release` | Run Rust tests | Yes |
| `cargo check 2>&1 \| grep "^warning:"` | Count warnings | Budget check |

## Multi-Service Architecture

```
OneBox AI/
  src/           <- Frontend (React + TypeScript)
  api/           <- Python backend (FastAPI)
    tests/       <- Python test suite
    scripts/     <- Operational CLI scripts (NOT tests)
  rust-core-service/  <- Rust core service
  rust-work-service/  <- Out of scope this cycle
  rust-ai-service/    <- Out of scope this cycle
  rust-streaming-service/ <- Out of scope
  rust-dashboard-service/ <- Out of scope
```

## Troubleshooting

### ESLint EPERM errors on Windows
Transient lock directories (`pytest-cache-files-*`) can cause EPERM scandir failures.
Run `pnpm lint:check` after clearing them, or use the cleanup utility.

### Integration tests all failing with `null` values
Ensure tests run with `pnpm test:integration` (uses `environment: "node"`).
Running integration tests with `pnpm test:unit` uses jsdom, which causes
`isNodeEnvironment = false` and disables Redis cache.

### Prettier reports 600+ files
This is expected until a format pass is run. Format check is check-only in CI.
To fix: `pnpm format` (runs prettier --write).
