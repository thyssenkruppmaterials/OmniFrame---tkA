# T1 Evidence - Repair Backend Router Import Contract

**Agent**: Agent-Backend
**Status**: Complete

## Files Changed
- `api/utils/supabase_client.py` — Added `get_supabase_client()` adapter function re-exporting from `config.database`
- `api/main.py` — Added `drone` router import/mount; replaced broad try/except with fail-fast RuntimeError; added startup validation of critical route prefixes

## Command Transcript
1. `python -m pytest -q --tb=short` → 6 passed (exit 0) — confirms no regressions

## Before/After
- **Before**: `drone` router existed but was never imported or mounted; import failures silently logged at info level
- **After**: `drone` router is imported and mounted at `/api`; import failures raise `RuntimeError` at startup; startup validation checks critical prefixes

## Rollback
- Revert `api/main.py` to previous broad try/except pattern
- Remove `get_supabase_client` adapter from `api/utils/supabase_client.py`

## Residual Risk
- Services still use the adapter pattern via `utils.supabase_client` — works correctly but adds one layer of indirection
