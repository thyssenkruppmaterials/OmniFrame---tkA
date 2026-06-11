# Workstream F: Python Modernization — Evidence

> Secret dev credential findings excluded per [scope-lock-non-secret-2026-02-16.md](../scope-lock-non-secret-2026-02-16.md).

## Before State

- 1 remaining Pydantic v1 pattern: `class Config: arbitrary_types_allowed = True` in `api/auth/supabase_auth.py`
- Redis `close()` deprecated usage in `api/lib/cache/redis_service.py`
- 1 DeprecationWarning from gotrue (transitive dep via supabase SDK)
- No warning filters in pytest.ini

**Baseline:** 8 tests passed with deprecation warnings

## After State

- Zero Pydantic v1 patterns — `class Config` converted to `model_config = ConfigDict(...)`
- Redis `close()` updated to `aclose()` for async client
- Warning filters in `pytest.ini` for unavoidable third-party warnings (gotrue, supabase)
- `error::DeprecationWarning` promotes all deprecation warnings to errors — catches regressions

**Post-change:** 8 tests passed, 0 warnings

## Files Changed

| File | Change |
|------|--------|
| `api/auth/supabase_auth.py` | `class Config` → `model_config = ConfigDict(arbitrary_types_allowed=True)` |
| `api/lib/cache/redis_service.py` | `await self.redis_client.close()` → `await self.redis_client.aclose()` |
| `pytest.ini` | Added `filterwarnings` with `error::DeprecationWarning` + gotrue/supabase ignores |

## Gotrue Status

- Not a direct dependency — transitive via `supabase>=2.3.0` → `gotrue v2.12.4`
- Package renamed upstream to `supabase-auth-py` but `supabase-py` hasn't updated yet
- Warning filter applied with upstream issue reference

## Residual Risks

- gotrue deprecation warning will persist until supabase SDK updates its dependency chain
- Warning filter documented with upstream context for future cleanup

---

*Date: 2026-02-16*
