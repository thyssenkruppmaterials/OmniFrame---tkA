# T4 Evidence - Stabilize Redis/Rate-Limit Lifecycle in Tests

**Agent**: Agent-Backend
**Status**: Complete

## Files Changed
- `api/lib/cache/redis_service.py` — Added `reset()` classmethod, loop-awareness in `get_instance()`, `_safe_disconnect()` helper
- `api/tests/conftest.py` — Added `_reset_redis_singleton` autouse fixture for teardown

## Command Transcript
1. `python -m pytest -q --tb=short` → 8 passed (exit 0)

## Before/After
- **Before**: `RedisService._instance` persisted across test functions; stale event-loop references caused "Event loop is closed" errors
- **After**: Singleton detects loop changes and resets; autouse fixture ensures cleanup between tests

## Rollback
- Revert `redis_service.py` to original singleton; remove conftest fixture

## Residual Risk
- `redis_client.close()` deprecation warning (should use `aclose()`) — cosmetic, not functional
