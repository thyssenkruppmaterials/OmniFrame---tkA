# T8 Evidence - Align Audit Logging Payload with DB Schema

**Agent**: Agent-Security
**Status**: Complete

## Files Changed
- `src/lib/security/server-permission-validator.ts` — Removed `execution_time_ms` from top-level audit payload; moved to `new_value` JSONB field; added `AUDIT_SCHEMA_KEYS` whitelist and schema validation in `createAuditLog()`

## Command Transcript
1. Build verification via `pnpm build` → included in T6 build run

## Before/After
- **Before**: `execution_time_ms: responseTime` was a top-level field in audit insert; if column didn't exist in DB, insert silently failed
- **After**: `execution_time_ms` stored in `new_value` JSONB; `createAuditLog()` strips unknown fields with warning log; `AUDIT_SCHEMA_KEYS` whitelist prevents schema drift

## Rollback
- Remove schema validation; restore `execution_time_ms` as top-level field

## Residual Risk
- `AUDIT_SCHEMA_KEYS` must be updated if new columns are added to `audit_logs` table
