# T3 Evidence - Harden dotenv/config Loading

**Agent**: Agent-Backend
**Status**: Complete

## Files Changed
- `api/config/settings.py` — Added `_resolve_env_file()` to prefer `.env.test` in test mode
- `.env.test` (new) — Minimal test environment config (no secrets)
- `.github/workflows/ci.yml` — Added env setup step + TESTING env var + zero-test guard for Python job
- `docs/quality/env-encoding-policy.md` (new) — Encoding policy documentation

## Command Transcript
1. `python -m pytest -q --tb=short` → 8 passed (exit 0)

## Before/After
- **Before**: Tests depended on developer's `.env` file encoding; CI had no env setup
- **After**: Tests use `.env.test` when `TESTING=true`; CI sets up env explicitly; zero-test guard added

## Rollback
- Remove `.env.test`; revert settings.py `_resolve_env_file()` function

## Residual Risk
- None — `.env.test` contains only placeholder values
