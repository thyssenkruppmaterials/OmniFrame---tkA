# T6 Evidence - Fix Node Integration Import Boundary

**Agent**: Agent-Integration
**Status**: Complete

## Files Changed
- `src/lib/database/connection-pool.ts` — Split `getAuthManager()` into null-safe version + `getAuthManagerOrThrow()` for call sites that require it; all runtime method calls use `getAuthManagerOrThrow()`

## Command Transcript
1. `pnpm build` → success, built in 36.47s (exit 0)

## Before/After
- **Before**: `getAuthManager()` always threw when `_singletonAuthManager` was null (Node.js), making integration preflight log a scary error to stderr
- **After**: `getAuthManager()` returns null gracefully; `getAuthManagerOrThrow()` throws only when methods actually need it; preflight error handling unchanged

## Rollback
- Revert to single `getAuthManager()` that always throws

## Residual Risk
- The static import of `singleton-auth-manager` still executes module-level browser code in Node.js — but it gracefully exports null when `window` is unavailable
